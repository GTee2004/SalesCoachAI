import asyncio
import logging
from contextlib import suppress
from dataclasses import replace

from pipecat.frames.frames import (
    EndFrame,
    LLMContextFrame,
    LLMTextFrame,
    TTSSpeakFrame,
    UserIdleTimeoutUpdateFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.service_switcher import ServiceSwitcher
from pipecat.pipeline.worker import (
    PipelineParams,
    PipelineWorker,
    ProcessorUnusablePolicy,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

from .config import Settings
from .latency import create_latency_observer
from .opening import (
    OpeningCoordinator,
    OpeningInputGate,
    OpeningPhase,
    PlaybackObserver,
)
from .providers.audio_filter import create_audio_in_filter
from .providers.llm import create_llm
from .providers.stt import create_stt, stt_provider, stt_services
from .providers.tts import create_tts, tts_provider, tts_services
from .rtvi import ClientRTVIProcessor
from .sessions import SessionRegistry, SessionState, VoiceSession
from .silence import (
    CHECK_IN_UTTERANCE,
    HANG_UP_PLAYBACK_SECONDS,
    HANG_UP_UTTERANCE,
    LearnerSilence,
)
from .tracing import is_tracing_enabled
from .transcript import TranscriptPersistenceProcessor
from .turn_detection import user_aggregator_params
from .usage import llm_provider

logger = logging.getLogger("uvicorn.error.salescoach_voice")

# Spoken after a failed buyer reply when the web app sent no line of its own.
REPAIR_UTTERANCE = "Alo, nghe không rõ, nói lại giúp được không?"
# Failed buyer replies in a row before the call stops instead of asking again.
MAX_CONSECUTIVE_FAILED_REPLIES = 3


def reconnecting(processor) -> bool:
    """Whether a websocket service reported an error while it can still reconnect.

    Reads pipecat 1.12's private reconnect flag. Its reconnect attempts report
    each failure, and the last one leaves the service unusable.
    """
    return processor is not None and processor.is_usable and getattr(processor, "_reconnect_in_progress", False) is True


async def run_voice_pipeline(
    connection: SmallWebRTCConnection,
    voice_session: VoiceSession,
    registry: SessionRegistry,
    settings: Settings,
) -> None:
    opening = OpeningCoordinator(voice_session.registration.scenario.firstUtterance)
    rtvi = ClientRTVIProcessor(opening)

    async def publish_phase(phase: OpeningPhase) -> None:
        if phase == "listening":
            try:
                await assistant_transcript.resolve_opening(completed=True)
                await rtvi.send_server_message({"type": "voice-input-state", "state": phase})
            except Exception:
                await abort_opening("opening_publish_failed")
        else:
            await assistant_transcript.resolve_opening(completed=False)
            await rtvi.send_server_message({"type": "voice-input-state", "state": phase})

    opening.on_transition = publish_phase
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_filter=create_audio_in_filter(settings),
        ),
    )
    stt = create_stt(
        settings,
        voice_session.registration.micType,
        voice_session.registration.scenario.sttTerms,
    )
    llm = create_llm(settings, voice_session.registration.scenario.systemPrompt)
    tts = create_tts(
        settings,
        voice_session.registration.ttsProvider,
        voice_session.registration.buyerGender,
    )
    for service in stt_services(stt):
        voice_session.usage.track(service, stt_provider(service))
    voice_session.usage.track(llm, llm_provider(settings.voice_agent_llm_base_url))
    for service in tts_services(tts):
        voice_session.usage.track(service, tts_provider(service, settings))
    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        # Starts counting when the buyer stops speaking; see on_learner_silent.
        user_params=replace(user_aggregator_params(), user_idle_timeout=settings.learner_idle_check_in_seconds),
    )
    silence = LearnerSilence()
    goodbye_played = asyncio.Event()

    def on_playback_stopped() -> None:
        if silence.hanging_up:
            goodbye_played.set()

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(_aggregator, message) -> None:
        await opening.assistant_committed(message.content, interrupted=message.interrupted)

    user_transcript = TranscriptPersistenceProcessor(registry, voice_session, role="user")
    assistant_transcript = TranscriptPersistenceProcessor(registry, voice_session, role="assistant", opening=opening)
    pipeline = Pipeline(
        [
            transport.input(),
            OpeningInputGate(opening),
            stt,
            OpeningInputGate(opening),
            user_transcript,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_transcript,
            assistant_aggregator,
            # The buyer speaking again ends any outage being counted.
            PlaybackObserver(
                opening,
                on_playback_started=voice_session.end_outage,
                on_playback_stopped=on_playback_stopped,
            ),
        ]
    )
    latency_observer = create_latency_observer(voice_session)
    worker = PipelineWorker(
        pipeline,
        rtvi_processor=rtvi,
        observers=[latency_observer],
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        # OpenTelemetry -> Langfuse. One trace per voice session; turn spans carry
        # turn.user_bot_latency_seconds, service spans carry metrics.ttfb.
        enable_tracing=is_tracing_enabled(),
        enable_turn_tracking=True,
        conversation_id=str(voice_session.registration.sessionId),
        additional_span_attributes={
            "langfuse.session.id": str(voice_session.registration.sessionId),
        },
        processor_unusable_policy=ProcessorUnusablePolicy.END,
        idle_timeout_secs=settings.session_max_seconds,
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    runner_task: asyncio.Task | None = None
    runner_started = asyncio.Event()

    async def cancel_runner() -> None:
        if runner_task is not None:
            # WorkerRunner.run() resets its shutdown signal on entry. Wait for
            # it to enter before cancelling an immediately ended session.
            await runner_started.wait()
        await runner.cancel()

    async def run_worker() -> None:
        runner_started.set()
        await runner.run()

    async def stop_worker() -> None:
        await cancel_runner()
        try:
            # Pipecat's transport skips disconnect while ICE is still connecting.
            await connection.disconnect()
        finally:
            if runner_task is not None:
                await asyncio.shield(asyncio.gather(runner_task, return_exceptions=True))

    await registry.attach_worker(voice_session, connection.pc_id, stop_worker)
    opener_watchdog: asyncio.Task | None = None
    ready_received = False
    opener_started = False

    async def fail_opening(reason: str) -> None:
        if opening.phase != "opening":
            return
        # Ended before the buyer's first line finished, so nothing is charged.
        voice_session.practice_never_started = True
        try:
            await opening.fail()
        finally:
            if registry.is_current(voice_session):
                await registry.fail(voice_session.registration.sessionId, reason, expected_session=voice_session)

    async def abort_opening(reason: str) -> None:
        try:
            await fail_opening(reason)
        finally:
            await cancel_runner()

    async def watch_opener() -> None:
        await asyncio.sleep(settings.opening_timeout_seconds)
        if opening.phase == "opening":
            await abort_opening("opening_timeout")

    # Errors name the service that failed, or the failover switcher once it
    # has no service left to switch to.
    service_kinds = {
        stt: "stt",
        **dict.fromkeys(stt_services(stt), "stt"),
        llm: "llm",
        tts: "tts",
        **dict.fromkeys(tts_services(tts), "tts"),
    }
    # Why the pipeline stopped itself, when a service can no longer do its job.
    provider_failure: str | None = None
    repair_utterance = getattr(voice_session.registration.scenario, "repairUtterance", "") or REPAIR_UTTERANCE
    check_in_utterance = getattr(voice_session.registration.scenario, "checkInUtterance", "") or CHECK_IN_UTTERANCE
    hang_up_utterance = getattr(voice_session.registration.scenario, "hangUpUtterance", "") or HANG_UP_UTTERANCE
    failed_replies = 0
    # When the LLM was handed the turn it is working on.
    reply_started_at: float | None = None

    @llm.event_handler("on_before_process_frame")
    async def on_reply_requested(_llm, frame) -> None:
        nonlocal reply_started_at
        if isinstance(frame, LLMContextFrame):
            reply_started_at = asyncio.get_running_loop().time()

    @llm.event_handler("on_before_push_frame")
    async def on_llm_output(_llm, frame) -> None:
        nonlocal failed_replies
        if isinstance(frame, LLMTextFrame):
            failed_replies = 0

    async def recover_failed_reply(category: str) -> None:
        """Ask the learner to repeat, in character, or stop a call that keeps failing.

        The failed reply's user message stays in the context, so the next turn
        answers it together with whatever the learner says next.
        """
        nonlocal failed_replies, provider_failure
        failed_replies += 1
        if failed_replies < MAX_CONSECUTIVE_FAILED_REPLIES:
            await worker.queue_frames([TTSSpeakFrame(repair_utterance)])
            return
        provider_failure = provider_failure or f"provider_failed:llm:{category}"
        logger.error(
            "Voice session stopped after %d failed replies session_id=%s",
            failed_replies,
            voice_session.registration.sessionId,
        )
        await rtvi.send_server_message({"type": "voice-service-failed", "service": "llm"})
        await worker.queue_frames([EndFrame()])

    @worker.event_handler("on_pipeline_error")
    async def on_pipeline_error(_worker, frame) -> None:
        nonlocal provider_failure
        processor = frame.processor
        kind = service_kinds.get(processor, "pipeline")
        category = getattr(frame.category, "value", "unknown")
        if processor is not None and not processor.is_usable:
            provider_failure = provider_failure or f"provider_failed:{kind}:{category}"
            logger.error(
                "Voice service failed session_id=%s service=%s category=%s",
                voice_session.registration.sessionId,
                kind,
                category,
            )
        else:
            logger.warning(
                "Voice service error session_id=%s service=%s category=%s",
                voice_session.registration.sessionId,
                kind,
                category,
            )
        # The opener is spoken once, so other errors in this phase lose it. Speech
        # recognition still reconnecting may recover before the learner talks.
        if opening.phase == "opening" and not (kind == "stt" and reconnecting(processor)):
            await abort_opening("opening_failed")
        elif opening.phase == "listening" and processor is llm and llm.is_usable:
            # The learner has been waiting since the failed turn began.
            voice_session.begin_outage(reply_started_at or asyncio.get_running_loop().time())
            await recover_failed_reply(category)

    hang_up_task: asyncio.Task | None = None

    async def end_after_goodbye() -> None:
        # The call ends once the goodbye has played, or without it if it never does.
        with suppress(TimeoutError):
            await asyncio.wait_for(goodbye_played.wait(), HANG_UP_PLAYBACK_SECONDS)
        await worker.queue_frames([EndFrame()])

    @user_aggregator.event_handler("on_user_turn_idle")
    async def on_learner_silent(_aggregator) -> None:
        nonlocal hang_up_task
        if (
            opening.phase != "listening"
            or voice_session.state is not SessionState.ACTIVE
            or not registry.is_current(voice_session)
        ):
            return
        action = silence.on_silence()
        if action == "check_in":
            await worker.queue_frames(
                [
                    UserIdleTimeoutUpdateFrame(timeout=settings.learner_idle_hang_up_seconds),
                    TTSSpeakFrame(check_in_utterance),
                ]
            )
        elif action == "hang_up":
            logger.info("Learner stayed silent; ending call session_id=%s", voice_session.registration.sessionId)
            # Lets the page show why the call ended instead of a connection error.
            await rtvi.send_server_message({"type": "call-ending", "reason": "learner_idle"})
            await worker.queue_frames([TTSSpeakFrame(hang_up_utterance)])
            hang_up_task = asyncio.create_task(end_after_goodbye())

    @user_aggregator.event_handler("on_user_turn_stopped")
    async def on_learner_turn(_aggregator, _strategy, message) -> None:
        if message.content.strip() and silence.learner_spoke():
            await worker.queue_frames([UserIdleTimeoutUpdateFrame(timeout=settings.learner_idle_check_in_seconds)])

    if isinstance(tts, ServiceSwitcher):

        @tts.strategy.event_handler("on_service_switched")
        async def on_tts_switched(_strategy, _service) -> None:
            if opening.phase == "opening" and opener_started:
                # The opener may have been cut off part-way, and it is spoken once.
                await abort_opening("opening_failed")
            elif opening.phase == "listening":
                # A reply in flight was lost while the failed service retried.
                voice_session.begin_outage(asyncio.get_running_loop().time())

    async def maybe_start_opener() -> None:
        nonlocal opener_started
        if (
            not ready_received
            or opening.phase != "opening"
            or voice_session.state is not SessionState.ACTIVE
            or not registry.is_current(voice_session)
            or opener_started
        ):
            return
        opener_started = True
        await worker.queue_frames([TTSSpeakFrame(opening.first_utterance)])

    @rtvi.event_handler("on_client_message")
    async def on_client_message(_processor, message) -> None:
        nonlocal ready_received
        if message.type in {"practice-ready", "practice-heartbeat"} and isinstance(message.data, dict):
            if message.data.get("sessionId") != str(voice_session.registration.sessionId):
                return
            if not registry.touch(voice_session, message.data.get("attemptId", "")):
                return
        if (
            message.type != "practice-ready"
            or not isinstance(message.data, dict)
            or message.data.get("sessionId") != str(voice_session.registration.sessionId)
            or opening.phase != "opening"
            or not registry.is_current(voice_session)
        ):
            return
        ready_received = True
        await maybe_start_opener()

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client) -> None:
        nonlocal opener_watchdog
        del transport, client
        if opening.phase == "opening":
            opener_watchdog = asyncio.create_task(watch_opener())
        await registry.mark_active(voice_session)
        await maybe_start_opener()

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client) -> None:
        del transport, client
        await abort_opening("client_disconnected")

    lifetime_stopping = False

    async def watch_connection_lifetime() -> None:
        nonlocal lifetime_stopping
        # Independent of maintenance/event ingestion: a slow persistence sink
        # must not keep a lost client's STT/TTS sockets alive.
        while registry.is_current(voice_session) and voice_session.state in {
            SessionState.AWAITING_CONNECTION,
            SessionState.ACTIVE,
        }:
            now = asyncio.get_running_loop().time()
            last_activity = getattr(voice_session, "last_activity", None)
            if last_activity is None:
                remaining = getattr(settings, "connection_startup_seconds", 120) - (
                    now - getattr(voice_session, "registered_at", now)
                )
                reason = "connection_startup_timeout"
            else:
                remaining = getattr(settings, "connection_heartbeat_seconds", 30) - (now - last_activity)
                reason = "heartbeat_timeout"
            if remaining <= 0:
                lifetime_stopping = True
                await registry.end(
                    voice_session.registration.sessionId,
                    reason,
                    evidence_complete=False,
                    expected_session=voice_session,
                )
                return
            await asyncio.sleep(min(5, remaining))

    async def extend_for_outages(deadline: asyncio.Timeout) -> None:
        """Push the hard duration cap back by the time lost to outages.

        The credit limit already ignores that time; without this, a call using
        its whole allowance would still be cut at the cap.
        """
        loop = asyncio.get_running_loop()
        base = deadline.when()
        while not deadline.expired():
            deadline.reschedule(base + voice_session.outage_extension(loop.time()))
            await asyncio.sleep(1)

    lifetime_watchdog = asyncio.create_task(watch_connection_lifetime())
    duration_extender: asyncio.Task | None = None
    try:
        runner_task = asyncio.create_task(run_worker())
        async with asyncio.timeout(settings.session_max_seconds) as deadline:
            duration_extender = asyncio.create_task(extend_for_outages(deadline))
            await runner_task
    except TimeoutError:
        if opening.phase == "opening":
            await abort_opening("opening_timeout")
        else:
            await registry.end(voice_session.registration.sessionId, "duration_limit", expected_session=voice_session)
    finally:
        # Release the runner/pipeline references before finalizing from this task.
        # Otherwise registry.end() would await the runner we just finished.
        await registry.detach_worker(voice_session, connection.pc_id)
        if duration_extender:
            duration_extender.cancel()
            with suppress(asyncio.CancelledError):
                await duration_extender
        if not lifetime_stopping:
            lifetime_watchdog.cancel()
        with suppress(asyncio.CancelledError):
            await lifetime_watchdog
        if opener_watchdog:
            opener_watchdog.cancel()
            with suppress(asyncio.CancelledError):
                await opener_watchdog
        if hang_up_task:
            hang_up_task.cancel()
            with suppress(asyncio.CancelledError):
                await hang_up_task
        await fail_opening("opening_cancelled")
        if registry.is_current(voice_session) and voice_session.state.value in {
            "active",
            "awaiting_connection",
        }:
            await registry.end(
                voice_session.registration.sessionId,
                provider_failure or ("learner_idle" if silence.hanging_up else "client_disconnected"),
                expected_session=voice_session,
            )
