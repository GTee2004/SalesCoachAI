import asyncio
from unittest.mock import AsyncMock, Mock

import pytest
from pipecat.utils.network import exponential_backoff_time
from websockets.asyncio.connection import Connection
from websockets.datastructures import Headers
from websockets.exceptions import InvalidStatus
from websockets.http11 import Response
from websockets.protocol import State

from src.salescoach_voice.config import Settings, TTSProvider
from src.salescoach_voice.providers import websocket
from src.salescoach_voice.providers.stt import create_stt
from src.salescoach_voice.providers.tts import create_tts, tts_services
from src.salescoach_voice.providers.websocket import ResilientWebsocket, SendTimeoutConnection


def settings(**overrides):
    return Settings(
        _env_file=None,
        WEB_APP_ORIGIN="http://localhost:4500",
        VOICE_CONTROL_API_KEY="c" * 32,
        VOICE_TOKEN_SECRET="t" * 32,
        VOICE_EVENT_INGEST_URL="http://localhost:4500/api/internal/voice/events",
        VOICE_EVENT_INGEST_KEY="e" * 32,
        VOICE_AGENT_LLM_API_KEY="test-llm-key",
        SONIOX_API_KEY="test-soniox-key",
        ASSEMBLYAI_API_KEY="test-assemblyai-key",
        ELEVENLABS_API_KEY="test-elevenlabs-key",
        ELEVENLABS_TTS_VOICE_FEMALE="voice-f",
        ELEVENLABS_TTS_VOICE_MALE="voice-m",
        **overrides,
    )


SERVICES = {
    "soniox_stt": lambda: create_stt(settings(VOICE_INPUT_PROFILE="soniox_native")),
    "assemblyai_stt": lambda: create_stt(settings(VOICE_INPUT_PROFILE="assemblyai_native")),
    "soniox_tts": lambda: create_tts(settings(), TTSProvider.SONIOX, "female"),
    # ElevenLabs comes first in its failover to OpenRouter.
    "elevenlabs_tts": lambda: tts_services(create_tts(settings(), TTSProvider.ELEVENLABS, "female"))[0],
    "elevenlabs_dialogue_tts": lambda: tts_services(
        create_tts(settings(ELEVENLABS_TTS_MODEL="eleven_v4_turbo"), TTSProvider.ELEVENLABS, "female")
    )[0],
}


def rejected(status: int) -> InvalidStatus:
    return InvalidStatus(Response(status, "rejected", Headers()))


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(websocket.random, "uniform", lambda _low, _high: 0)
    monkeypatch.setattr(websocket, "RECONNECT_MIN_WAIT_SECONDS", 0)


@pytest.mark.parametrize("name", SERVICES)
def test_every_websocket_service_reconnects_sooner(name):
    service = SERVICES[name]()

    assert isinstance(service, ResilientWebsocket)
    waits = [
        exponential_backoff_time(
            attempt,
            min_wait=service._reconnect_backoff_min_wait,
            max_wait=service._reconnect_backoff_max_wait,
        )
        for attempt in range(1, websocket.RECONNECT_ATTEMPTS + 1)
    ]
    assert waits == [1, 2, 4, 4]


@pytest.mark.asyncio
@pytest.mark.parametrize("name", SERVICES)
async def test_first_connect_is_retried_with_a_short_open_timeout(name, monkeypatch):
    service = SERVICES[name]()
    connection = AsyncMock()
    connect = AsyncMock(side_effect=[TimeoutError(), OSError("network unreachable"), connection])
    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", connect)

    assert await service._websocket_connect("wss://provider.test") is connection

    assert connect.await_count == websocket.FIRST_CONNECT_ATTEMPTS
    assert connect.await_args.kwargs["open_timeout"] == websocket.OPEN_TIMEOUT_SECONDS
    assert connect.await_args.kwargs["create_connection"] is SendTimeoutConnection


@pytest.mark.asyncio
async def test_rejected_credentials_are_not_retried(monkeypatch):
    service = SERVICES["soniox_stt"]()
    connect = AsyncMock(side_effect=rejected(401))
    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", connect)

    with pytest.raises(InvalidStatus):
        await service._websocket_connect("wss://provider.test")
    assert connect.await_count == 1


@pytest.mark.asyncio
async def test_later_connects_leave_retrying_to_the_reconnect_loop(monkeypatch):
    service = SERVICES["soniox_tts"]()
    connect = AsyncMock(side_effect=[AsyncMock(), TimeoutError()])
    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", connect)
    await service._websocket_connect("wss://provider.test")

    with pytest.raises(TimeoutError):
        await service._websocket_connect("wss://provider.test")
    assert connect.await_count == 2


@pytest.mark.asyncio
async def test_reconnect_gives_up_after_four_attempts_and_says_so():
    service = SERVICES["soniox_stt"]()
    service._reconnect_backoff_min_wait = service._reconnect_backoff_max_wait = 0
    service._disconnect_websocket = AsyncMock()
    service._connect_websocket = AsyncMock()  # Leaves no socket, so each attempt fails.
    report_error = AsyncMock()

    assert not await service._try_reconnect(report_error=report_error)

    assert service._connect_websocket.await_count == websocket.RECONNECT_ATTEMPTS
    assert report_error.await_args.kwargs == {"force_treat_as_permanent": True}


@pytest.mark.asyncio
async def test_reconnect_counts_only_once_the_provider_answers(monkeypatch):
    monkeypatch.setattr(websocket, "PONG_TIMEOUT_SECONDS", 0.01)
    service = SERVICES["soniox_stt"]()
    loop = asyncio.get_running_loop()
    unanswered, answered = loop.create_future(), loop.create_future()
    answered.set_result(0.01)
    service._websocket = Mock(state=State.OPEN, ping=AsyncMock(return_value=unanswered))
    assert not await service._verify_connection()

    service._websocket.ping = AsyncMock(return_value=answered)
    assert await service._verify_connection()


@pytest.mark.asyncio
async def test_stalled_send_drops_the_connection(monkeypatch):
    monkeypatch.setattr(websocket, "SEND_TIMEOUT_SECONDS", 0.01)

    async def full_send_buffer(self, message, text=None):
        await asyncio.sleep(10)

    monkeypatch.setattr(Connection, "send", full_send_buffer)
    connection = object.__new__(SendTimeoutConnection)
    connection.transport = Mock()

    with pytest.raises(TimeoutError):
        await connection.send(b"\0\0" * 320)
    connection.transport.abort.assert_called_once()
