import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
)

from .auth import bearer_token, verify_connection_token, verify_control_key
from .config import TTSProvider
from .evaluation import EvaluationError
from .models import EndSessionRequest, EvaluationRequest, SessionRegistration
from .pipeline import run_voice_pipeline
from .providers.stt import mic_type_selectable
from .runtime import Runtime, get_runtime, observe_task_failure
from .usage import UsageMeter

logger = logging.getLogger("uvicorn.error.salescoach_voice")
router = APIRouter()

# What an evaluation's LLM calls consumed, as JSON in the usage event's format.
USAGE_HEADER = "X-Service-Usage"

TTS_PROVIDER_NAMES = {
    TTSProvider.SONIOX: "Soniox",
    TTSProvider.GEMINI: "Gemini",
    TTSProvider.ELEVENLABS: "ElevenLabs",
}


@router.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "live"}


@router.get("/health/ready")
async def health_ready(current: Runtime = Depends(get_runtime)) -> dict[str, str]:
    if not current.ready:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Not ready")
    return {"status": "ready"}


@router.get("/internal/status")
async def runtime_status(
    authorization: str | None = Header(default=None),
    current: Runtime = Depends(get_runtime),
) -> dict:
    verify_control_key(current.settings, authorization)
    return {
        "ready": current.ready,
        "activeSessions": current.registry.active_count(),
        "maxConcurrentSessions": current.settings.max_concurrent_sessions,
        "micTypeSelectable": mic_type_selectable(current.settings),
    }


@router.post("/internal/sessions", status_code=201)
async def register_session(
    registration: SessionRegistration,
    authorization: str | None = Header(default=None),
    current: Runtime = Depends(get_runtime),
) -> dict:
    verify_control_key(current.settings, authorization)
    if not current.ready:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Not ready")
    candidates = [registration.ttsProvider, *registration.ttsFallbacks]
    provider = next((p for p in candidates if current.tts_available(p)), None)
    if provider is None:
        names = " / ".join(dict.fromkeys(TTS_PROVIDER_NAMES[p] for p in candidates))
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"{names} TTS unavailable")
    if provider is not registration.ttsProvider:
        logger.warning(
            "TTS %s unavailable; falling back to %s",
            registration.ttsProvider.value,
            provider.value,
            extra={"session_id": str(registration.sessionId)},
        )
    registration = registration.model_copy(update={"ttsProvider": provider, "ttsFallbacks": []})
    voice_session = await current.registry.register(registration)
    return {
        "sessionId": str(voice_session.registration.sessionId),
        "status": voice_session.state,
        "ttsProvider": provider.value,
        "startupExpiresAt": (
            datetime.now(UTC)
            + timedelta(
                seconds=max(
                    0,
                    current.settings.connection_startup_seconds
                    - (asyncio.get_running_loop().time() - voice_session.registered_at),
                )
            )
        ).isoformat(),
        "reconnectSeconds": current.settings.connection_reconnect_seconds,
    }


@router.post("/internal/sessions/{session_id}/end")
async def end_session(
    session_id: UUID,
    body: EndSessionRequest,
    authorization: str | None = Header(default=None),
    current: Runtime = Depends(get_runtime),
) -> dict[str, str]:
    verify_control_key(current.settings, authorization)
    await current.registry.end(session_id, body.reason)
    return {"sessionId": str(session_id), "status": "ended"}


@router.get("/internal/sessions/{session_id}")
async def session_status(
    session_id: UUID,
    authorization: str | None = Header(default=None),
    current: Runtime = Depends(get_runtime),
) -> dict:
    verify_control_key(current.settings, authorization)
    voice_session = current.registry.get(session_id)
    return {
        "sessionId": str(session_id),
        "status": voice_session.state,
        "peerId": voice_session.peer_id,
        "attemptId": str(voice_session.attempt_id),
        "activityLeaseUntil": (
            (
                datetime.now(UTC)
                + timedelta(
                    seconds=max(
                        0,
                        current.settings.connection_heartbeat_seconds
                        - (asyncio.get_running_loop().time() - voice_session.last_activity)
                        + 10,
                    )
                )
            ).isoformat()
            if voice_session.last_activity is not None
            and voice_session.state == "active"
            and asyncio.get_running_loop().time() - voice_session.last_activity
            < current.settings.connection_heartbeat_seconds
            else None
        ),
    }


@router.post("/internal/evaluations")
async def evaluate_transcript(
    body: EvaluationRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    current: Runtime = Depends(get_runtime),
) -> dict:
    verify_control_key(current.settings, authorization)
    # Tokens travel in a header so the evaluation body stays the wire contract.
    # Failed evaluations were billed too, so the header goes on errors as well.
    usage = UsageMeter()
    try:
        result = await current.evaluator.generate_practice(body, usage)
    except EvaluationError as exc:
        # This authenticated internal endpoint exposes validation diagnostics to
        # the frontend server log; learner responses remain generic.
        detail = {"code": exc.code, "reason": exc.reason} if exc.reason else exc.code
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
            headers={USAGE_HEADER: json.dumps(usage.summary())},
        ) from exc
    response.headers[USAGE_HEADER] = json.dumps(usage.summary())
    return result


@router.post("/api/offer")
async def offer(
    request: Request,
    token: str = Depends(bearer_token),
    current: Runtime = Depends(get_runtime),
) -> dict:
    if not current.ready:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Not ready")
    body = await _bounded_json(request)
    claims = verify_connection_token(token, current.settings, current.nonces)
    session_id = UUID(claims["session_id"])
    request_data = body.get("requestData") or body.get("request_data") or {}
    if request_data.get("sessionId") != str(session_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session binding mismatch")
    voice_session = current.registry.authorize_offer(session_id, claims["user_id"])
    if claims["attempt_id"] != str(voice_session.attempt_id):
        raise HTTPException(status_code=409, detail="Stale connection attempt")
    web_request = SmallWebRTCRequest.from_dict(body)

    async def connected(connection) -> None:
        try:
            await current.registry.bind_peer(voice_session, connection.pc_id)
        except Exception:
            await connection.disconnect()
            raise

        async def voice_task() -> None:
            try:
                await run_voice_pipeline(
                    connection,
                    voice_session,
                    current.registry,
                    current.settings,
                )
            except Exception as exc:
                logger.exception("Voice pipeline failed", extra={"session_id": str(session_id)})
                if current.registry.is_current(voice_session):
                    await current.registry.fail(session_id, type(exc).__name__, expected_session=voice_session)
            finally:
                await current.registry.detach_worker(voice_session, connection.pc_id)
                await connection.disconnect()

        task = asyncio.create_task(
            voice_task(),
            name=f"voice-{session_id}",
        )
        current.tasks.add(task)
        task.add_done_callback(current.tasks.discard)
        task.add_done_callback(observe_task_failure)

    answer = await current.webrtc.handle_web_request(web_request, connected)
    if not answer:
        raise HTTPException(status_code=500, detail="No WebRTC answer")
    return answer


@router.patch("/api/offer", status_code=204)
async def patch_offer(
    request: Request,
    token: str = Depends(bearer_token),
    current: Runtime = Depends(get_runtime),
) -> None:
    body = await _bounded_json(request)
    claims = verify_connection_token(token, current.settings, current.nonces, consume_nonce=False)
    session_id = UUID(claims["session_id"])
    voice_session = current.registry.authorize_patch(body.get("pc_id", ""), session_id, claims["user_id"])
    if claims["attempt_id"] != str(voice_session.attempt_id):
        raise HTTPException(status_code=409, detail="Stale connection attempt")
    patch = SmallWebRTCPatchRequest(
        pc_id=body["pc_id"],
        candidates=[IceCandidate(**candidate) for candidate in body.get("candidates", [])],
    )
    await current.webrtc.handle_patch_request(patch)


async def _bounded_json(request: Request) -> dict:
    if int(request.headers.get("content-length", "0")) > 256_000:
        raise HTTPException(status_code=413, detail="Payload too large")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    return body
