from datetime import UTC, datetime, timedelta
from functools import partial
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.salescoach_voice.api import router
from src.salescoach_voice.config import Settings, TTSProvider
from src.salescoach_voice.providers import tts
from src.salescoach_voice.providers.tts import create_tts
from src.salescoach_voice.runtime import Runtime, get_runtime
from src.salescoach_voice.sessions import SessionRegistry

CONTROL_KEY = "c" * 32


def make_settings(**overrides):
    # Every ElevenLabs value is explicit so a developer's own .env cannot leak in.
    values = {
        "WEB_APP_ORIGIN": "http://localhost:4500",
        "VOICE_CONTROL_API_KEY": CONTROL_KEY,
        "VOICE_TOKEN_SECRET": "t" * 32,
        "VOICE_EVENT_INGEST_URL": "http://localhost:4500/api/internal/voice/events",
        "VOICE_EVENT_INGEST_KEY": "e" * 32,
        "SONIOX_API_KEY": "test-stt-key",
        "VOICE_AGENT_LLM_API_KEY": "test-voice-agent-key",
        "ELEVENLABS_API_KEY": "test-elevenlabs-key",
        "ELEVENLABS_TTS_MODEL": "eleven_flash_v2_5",
        "ELEVENLABS_TTS_VOICE_FEMALE": "female-voice-id",
        "ELEVENLABS_TTS_VOICE_MALE": "male-voice-id",
    }
    return Settings(_env_file=None, **(values | overrides))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides,gender,missing",
    [
        ({"ELEVENLABS_API_KEY": None}, "female", "ELEVENLABS_API_KEY"),
        ({"ELEVENLABS_API_KEY": ""}, "male", "ELEVENLABS_API_KEY"),
        ({"ELEVENLABS_TTS_VOICE_FEMALE": None}, "female", "ELEVENLABS_TTS_VOICE_FEMALE"),
        ({"ELEVENLABS_TTS_VOICE_MALE": ""}, "male", "ELEVENLABS_TTS_VOICE_MALE"),
    ],
)
async def test_elevenlabs_requires_key_and_voice(overrides, gender, missing):
    with pytest.raises(RuntimeError, match=missing):
        create_tts(make_settings(**overrides), TTSProvider.ELEVENLABS, gender)


async def register(settings, provider, fallbacks=(), elevenlabs_refusal=None):
    current = SimpleNamespace(
        ready=True,
        settings=settings,
        registry=SessionRegistry(settings, SimpleNamespace(emit=AsyncMock())),
        elevenlabs_refusal=elevenlabs_refusal,
    )
    current.tts_available = partial(Runtime.tts_available, current)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(
            "/internal/sessions",
            headers={"authorization": f"Bearer {CONTROL_KEY}"},
            json={
                "sessionId": str(uuid4()),
                "userId": "learner",
                "ttsProvider": provider,
                "ttsFallbacks": list(fallbacks),
                "buyerGender": "female",
                "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
                "scenario": {"systemPrompt": "buyer"},
            },
        )


@pytest.mark.asyncio
async def test_registration_accepts_elevenlabs_when_configured():
    response = await register(make_settings(), "elevenlabs")
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["ELEVENLABS_API_KEY", "ELEVENLABS_TTS_VOICE_FEMALE", "ELEVENLABS_TTS_VOICE_MALE"])
async def test_registration_refuses_elevenlabs_without_key_or_voices(missing):
    response = await register(make_settings(**{missing: None}), "elevenlabs")
    assert response.status_code == 503
    assert response.json() == {"detail": "ElevenLabs TTS unavailable"}


@pytest.mark.asyncio
async def test_other_providers_do_not_need_elevenlabs_configuration():
    settings = make_settings(ELEVENLABS_API_KEY=None, ELEVENLABS_TTS_VOICE_FEMALE=None, ELEVENLABS_TTS_VOICE_MALE=None)
    response = await register(settings, "gemini")
    assert response.status_code == 201


NO_ELEVENLABS = {"ELEVENLABS_API_KEY": None}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides,expected",
    [
        ({}, "elevenlabs"),
        (NO_ELEVENLABS, "soniox"),
        (NO_ELEVENLABS | {"SONIOX_API_KEY": None, "VOICE_INPUT_PROFILE": "assemblyai_native"}, "gemini"),
    ],
)
async def test_registration_falls_back_in_order_and_reports_the_provider(overrides, expected):
    if "VOICE_INPUT_PROFILE" in overrides:
        # Without Soniox, speech-to-text has to come from AssemblyAI.
        overrides = overrides | {"ASSEMBLYAI_API_KEY": "test-assemblyai-key"}
    response = await register(make_settings(**overrides), "elevenlabs", ["soniox", "gemini"])
    assert response.status_code == 201
    assert response.json()["ttsProvider"] == expected


@pytest.mark.asyncio
async def test_registration_without_fallbacks_keeps_the_requested_provider():
    response = await register(make_settings(**NO_ELEVENLABS), "elevenlabs")
    assert response.status_code == 503
    assert response.json() == {"detail": "ElevenLabs TTS unavailable"}


@pytest.mark.asyncio
async def test_key_refused_at_startup_sends_sessions_to_the_next_provider():
    response = await register(make_settings(), "elevenlabs", ["soniox"], elevenlabs_refusal="invalid_api_key: bad")
    assert response.status_code == 201
    assert response.json()["ttsProvider"] == "soniox"


@pytest.mark.asyncio
async def test_key_refused_at_startup_without_fallbacks_refuses_the_session():
    response = await register(make_settings(), "elevenlabs", elevenlabs_refusal="invalid_api_key: bad")
    assert response.status_code == 503
    assert response.json() == {"detail": "ElevenLabs TTS unavailable"}


def elevenlabs_answers(monkeypatch, handler):
    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        tts.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs),
    )


def refused(status, error_type, code, message=""):
    return httpx.Response(status, json={"detail": {"type": error_type, "code": code, "message": message}})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer,expected",
    [
        (
            refused(400, "authentication_error", "invalid_api_key", "API key is invalid."),
            "invalid_api_key: API key is invalid.",
        ),
        (refused(401, "authentication_error", "unauthorized", "Invalid API key"), "unauthorized: Invalid API key"),
        (refused(404, "not_found", "voice_not_found"), "voice_not_found: female-voice-id"),
    ],
)
async def test_startup_check_reports_a_refused_key_or_voice(monkeypatch, answer, expected):
    elevenlabs_answers(monkeypatch, lambda _request: answer)

    assert await tts.elevenlabs_refusal(make_settings()) == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(200, json={"voice_id": "female-voice-id"}),
        # A key restricted to text to speech can't read voices but can speak.
        refused(401, "authorization_error", "missing_permissions"),
        httpx.Response(503, text="unavailable"),
    ],
)
async def test_startup_check_leaves_everything_else_to_the_calls(monkeypatch, answer):
    requests = []

    def handle(request):
        requests.append(request)
        return answer

    elevenlabs_answers(monkeypatch, handle)

    assert await tts.elevenlabs_refusal(make_settings()) is None
    assert [request.url.path for request in requests] == ["/v1/voices/female-voice-id", "/v1/voices/male-voice-id"]
    assert requests[0].headers["xi-api-key"] == "test-elevenlabs-key"


@pytest.mark.asyncio
async def test_startup_check_skips_an_unconfigured_elevenlabs(monkeypatch):
    elevenlabs_answers(monkeypatch, lambda _request: pytest.fail("ElevenLabs was called"))

    assert await tts.elevenlabs_refusal(make_settings(ELEVENLABS_API_KEY=None)) is None
