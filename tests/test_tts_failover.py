import asyncio
import json

import httpx
import pytest
from pipecat.frames.frames import EndFrame, TTSAudioRawFrame, TTSSpeakFrame
from pipecat.observers.base_observer import BaseObserver
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.service_switcher import ServiceSwitcher
from pipecat.pipeline.worker import PipelineWorker, ProcessorUnusablePolicy
from pipecat.workers.runner import WorkerRunner
from websockets.exceptions import ConnectionClosedError
from websockets.frames import Close
from websockets.protocol import State

from src.salescoach_voice.config import Settings, TTSProvider
from src.salescoach_voice.providers import openrouter_tts, websocket
from src.salescoach_voice.providers.gemini import GeminiTTSService
from src.salescoach_voice.providers.openrouter_tts import OpenRouterTTSService
from src.salescoach_voice.providers.tts import (
    ResilientElevenLabsDialogueTTSService,
    create_tts,
    tts_provider,
    tts_services,
)


def make_settings(**overrides):
    # Every value is explicit so a developer's own .env cannot leak in.
    values = {
        "WEB_APP_ORIGIN": "http://localhost:4500",
        "VOICE_CONTROL_API_KEY": "c" * 32,
        "VOICE_TOKEN_SECRET": "t" * 32,
        "VOICE_EVENT_INGEST_URL": "http://localhost:4500/api/internal/voice/events",
        "VOICE_EVENT_INGEST_KEY": "e" * 32,
        "SONIOX_API_KEY": "test-stt-key",
        "VOICE_AGENT_LLM_API_KEY": "test-openrouter-key",
        "VOICE_AGENT_LLM_BASE_URL": "https://openrouter.ai/api/v1",
        "ELEVENLABS_API_KEY": "test-elevenlabs-key",
        "ELEVENLABS_TTS_MODEL": "eleven_v4_turbo",
        "ELEVENLABS_TTS_VOICE_FEMALE": "female-voice-id",
        "ELEVENLABS_TTS_VOICE_MALE": "male-voice-id",
        "ELEVENLABS_TTS_OPENROUTER_FALLBACK": True,
    }
    return Settings(_env_file=None, **(values | overrides))


def test_elevenlabs_falls_back_to_the_same_model_and_voice_through_openrouter():
    tts = create_tts(make_settings(), TTSProvider.ELEVENLABS, "male")

    assert isinstance(tts, ServiceSwitcher)
    elevenlabs, fallback = tts_services(tts)
    assert tts.strategy.active_service is elevenlabs
    assert isinstance(elevenlabs, ResilientElevenLabsDialogueTTSService)
    assert isinstance(fallback, OpenRouterTTSService)
    assert fallback._settings.model == "elevenlabs/eleven-v4-turbo"
    assert fallback._settings.voice == elevenlabs._settings.voice == "male-voice-id"


@pytest.mark.parametrize(
    "overrides",
    [
        {"ELEVENLABS_TTS_OPENROUTER_FALLBACK": False},
        # The LLM key only works for OpenRouter when the LLM is served there.
        {"VOICE_AGENT_LLM_BASE_URL": "https://api.openai.com/v1"},
        # A model OpenRouter doesn't serve would change the voice.
        {"ELEVENLABS_TTS_MODEL": "eleven_ttv_v3"},
    ],
)
def test_elevenlabs_runs_alone_without_a_matching_openrouter_model(overrides):
    tts = create_tts(make_settings(**overrides), TTSProvider.ELEVENLABS, "female")

    assert not isinstance(tts, ServiceSwitcher)
    assert tts_provider(tts, make_settings()) == "elevenlabs"


def test_usage_is_billed_to_whoever_spoke():
    settings = make_settings()
    elevenlabs, fallback = tts_services(create_tts(settings, TTSProvider.ELEVENLABS, "female"))

    assert tts_provider(elevenlabs, settings) == "elevenlabs"
    assert tts_provider(fallback, settings) == "openrouter"
    assert tts_provider(create_tts(settings, TTSProvider.GEMINI, "female"), settings) == "gemini"
    assert tts_provider(create_tts(settings, TTSProvider.SONIOX, "female"), settings) == "soniox"
    assert isinstance(create_tts(settings, TTSProvider.GEMINI, "female"), GeminiTTSService)


class FrameRecorder(BaseObserver):
    def __init__(self):
        super().__init__()
        self.frames = []

    async def on_push_frame(self, data):
        self.frames.append(data.frame)


@pytest.mark.asyncio
async def test_openrouter_speaks_when_elevenlabs_cannot_connect_at_call_start(monkeypatch):
    monkeypatch.setattr(websocket.random, "uniform", lambda _low, _high: 0)
    monkeypatch.setattr(websocket, "RECONNECT_MIN_WAIT_SECONDS", 0)
    elevenlabs_attempts = 0

    async def unreachable(_uri, **_kwargs):
        nonlocal elevenlabs_attempts
        elevenlabs_attempts += 1
        raise TimeoutError("ElevenLabs unreachable")

    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", unreachable)
    requests = []

    def speak(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x00" * 4_800)

    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        openrouter_tts.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(speak), **kwargs),
    )
    tts = create_tts(make_settings(), TTSProvider.ELEVENLABS, "female")
    elevenlabs, fallback = tts_services(tts)
    recorder = FrameRecorder()
    worker = PipelineWorker(
        Pipeline([tts]), observers=[recorder], processor_unusable_policy=ProcessorUnusablePolicy.END
    )
    errors = []

    @worker.event_handler("on_pipeline_error")
    async def on_pipeline_error(_worker, frame) -> None:
        errors.append(frame)

    await worker.queue_frames([TTSSpeakFrame("Dạ, em nghe đây ạ."), EndFrame()])
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await asyncio.wait_for(runner.run(), timeout=10)

    assert elevenlabs_attempts == websocket.FIRST_CONNECT_ATTEMPTS
    assert not elevenlabs.is_usable
    assert tts.strategy.active_service is fallback
    assert errors == []
    assert requests == [
        {
            "model": "elevenlabs/eleven-v4-turbo",
            "input": "Dạ, em nghe đây ạ.",
            "voice": "female-voice-id",
            "response_format": "pcm",
            "provider": {"options": {"elevenlabs": {"language_code": "vi"}}},
        }
    ]
    assert any(isinstance(frame, TTSAudioRawFrame) for frame in recorder.frames)


class RefusingConnection:
    """An ElevenLabs socket that accepts the handshake, then refuses the key.

    ElevenLabs sends the refusal straight away, before we send anything.
    """

    def __init__(self) -> None:
        self.state = State.OPEN
        self._messages: asyncio.Queue = asyncio.Queue()
        self._messages.put_nowait(
            json.dumps({"message": "API key is invalid.", "error": "invalid_api_key", "code": 1008})
        )
        self._messages.put_nowait(None)

    async def send(self, message, text=None) -> None:
        pass

    async def close(self) -> None:
        self.state = State.CLOSED

    async def wait_closed(self) -> None:
        pass

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self._messages.get()
        if message is None:
            self.state = State.CLOSED
            raise ConnectionClosedError(Close(1008, "API key is invalid."), None)
        return message


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["eleven_v4_turbo", "eleven_flash_v2_5"])
async def test_openrouter_speaks_when_elevenlabs_refuses_the_key(monkeypatch, model):
    connections = []

    async def connect(_uri, **_kwargs):
        connections.append(RefusingConnection())
        return connections[-1]

    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", connect)
    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        openrouter_tts.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x00" * 4_800)
            ),
            **kwargs,
        ),
    )
    tts = create_tts(make_settings(ELEVENLABS_TTS_MODEL=model), TTSProvider.ELEVENLABS, "female")
    elevenlabs, fallback = tts_services(tts)
    recorder = FrameRecorder()
    worker = PipelineWorker(
        Pipeline([tts]), observers=[recorder], processor_unusable_policy=ProcessorUnusablePolicy.END
    )
    errors = []

    @worker.event_handler("on_pipeline_error")
    async def on_pipeline_error(_worker, frame) -> None:
        errors.append(frame)

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    running = asyncio.create_task(runner.run())
    for _ in range(100):
        if not elevenlabs.is_usable:
            break
        await asyncio.sleep(0.01)
    await worker.queue_frames([TTSSpeakFrame("Dạ, em nghe đây ạ."), EndFrame()])
    await asyncio.wait_for(running, timeout=10)

    assert not elevenlabs.is_usable
    assert tts.strategy.active_service is fallback
    # Reconnecting can't fix a refused key.
    assert len(connections) == 1
    # The error is answered by the switch, so the opening isn't aborted.
    assert errors == []
    assert any(isinstance(frame, TTSAudioRawFrame) for frame in recorder.frames)


@pytest.mark.parametrize("model", ["eleven_v4", "eleven_v4_turbo"])
def test_elevenlabs_v4_asks_for_vietnamese(model):
    elevenlabs, _fallback = tts_services(
        create_tts(make_settings(ELEVENLABS_TTS_MODEL=model), TTSProvider.ELEVENLABS, "female")
    )
    elevenlabs._output_format = "pcm_24000"

    assert "&language_code=vi" in elevenlabs._build_websocket_url()
