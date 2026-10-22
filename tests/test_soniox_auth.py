import json
from unittest.mock import AsyncMock

import pytest
from websockets.datastructures import Headers

from src.salescoach_voice.config import Settings, TTSProvider
from src.salescoach_voice.providers.soniox import AuthenticatedSonioxSTTService, AuthenticatedSonioxTTSService
from src.salescoach_voice.providers.stt import create_stt
from src.salescoach_voice.providers.tts import create_tts


@pytest.fixture
def settings():
    return Settings(
        _env_file=None,
        WEB_APP_ORIGIN="http://localhost:4500",
        VOICE_CONTROL_API_KEY="c" * 32,
        VOICE_TOKEN_SECRET="t" * 32,
        VOICE_EVENT_INGEST_URL="http://localhost:4500/api/internal/voice/events",
        VOICE_EVENT_INGEST_KEY="e" * 32,
        VOICE_AGENT_LLM_API_KEY="test-llm-key",
        VOICE_INPUT_PROFILE="soniox_native",
        SONIOX_API_KEY="test-soniox-key",
        SONIOX_REGION="jp",
    )


def make_service(settings, kind):
    if kind == "stt":
        service = create_stt(settings)
        assert isinstance(service, AuthenticatedSonioxSTTService)
        return service, settings.soniox_stt_url
    service = create_tts(settings, TTSProvider.SONIOX, "female")
    assert isinstance(service, AuthenticatedSonioxTTSService)
    return service, settings.soniox_tts_url


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["stt", "tts"])
async def test_factory_service_authenticates_initial_connection_and_reconnect(settings, kind, monkeypatch):
    service, url = make_service(settings, kind)
    websocket = AsyncMock()
    connect = AsyncMock(return_value=websocket)
    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", connect)

    for attempt in range(2):
        service._websocket = None
        await service._connect_websocket()
        assert service._websocket is websocket
        assert connect.await_count == attempt + 1
        assert connect.await_args.args == (url,)
        assert connect.await_args.kwargs["additional_headers"]["Authorization"] == "Bearer test-soniox-key"
        assert connect.await_args.kwargs["close_timeout"] == service._ws_close_timeout

    # Pipecat's legacy config carries the same key, which Soniox still accepts.
    config = json.loads(websocket.send.await_args.args[0]) if kind == "stt" else service._build_config_msg("stream-1")
    assert config["api_key"] == "test-soniox-key"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["stt", "tts"])
async def test_auth_preserves_other_headers_and_connection_options(settings, kind, monkeypatch):
    service, url = make_service(settings, kind)
    websocket = AsyncMock()
    connect = AsyncMock(return_value=websocket)
    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", connect)
    original_headers = Headers({"X-Request-ID": "request-1", "authorization": "Bearer stale-key"})

    result = await service._websocket_connect(url, additional_headers=original_headers, close_timeout=7)

    assert result is websocket
    headers = connect.await_args.kwargs["additional_headers"]
    assert headers["X-Request-ID"] == "request-1"
    assert headers.get_all("Authorization") == ["Bearer test-soniox-key"]
    assert connect.await_args.kwargs["close_timeout"] == 7
    assert original_headers["authorization"] == "Bearer stale-key"
