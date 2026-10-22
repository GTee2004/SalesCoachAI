import asyncio
import json
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from pipecat.clocks.system_clock import SystemClock
from pipecat.frames.frames import (
    EndFrame,
    ErrorFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    StartFrame,
    TextFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
)
from pipecat.observers.base_observer import BaseObserver
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessorSetup
from pipecat.utils.asyncio.task_manager import TaskManager
from pipecat.workers.runner import WorkerRunner

from src.salescoach_voice.config import Settings, TTSProvider
from src.salescoach_voice.providers import gemini, openrouter_tts
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
        SONIOX_API_KEY="test-stt-key",
        VOICE_AGENT_LLM_API_KEY="test-voice-agent-key",
        VOICE_AGENT_LLM_BASE_URL="https://voice-provider.test/api/v1/",
    )


@pytest_asyncio.fixture
async def make_service(monkeypatch, settings):
    client_class = httpx.AsyncClient
    services = []

    async def make(handler, gender="female"):
        monkeypatch.setattr(
            openrouter_tts.httpx,
            "AsyncClient",
            lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs),
        )
        service = create_tts(settings, TTSProvider.GEMINI, gender)
        worker = PipelineWorker(Pipeline([service]))
        await service.setup(
            FrameProcessorSetup(clock=SystemClock(), task_manager=TaskManager(), pipeline_worker=worker)
        )
        services.append(service)
        return service

    yield make
    for service in services:
        await service.cleanup()


class GatedAudioStream(httpx.AsyncByteStream):
    def __init__(self):
        self.release = asyncio.Event()
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"\x01\x00" * 12_000
        await self.release.wait()
        yield b"\x02\x00" * 120

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
@pytest.mark.parametrize("gender,voice", [("female", "Kore"), ("male", "Charon")])
async def test_gemini_uses_shared_credentials_and_streams_before_response_finishes(make_service, gender, voice):
    stream = GatedAudioStream()

    def handle(request):
        assert request.method == "POST"
        assert str(request.url) == "https://voice-provider.test/api/v1/audio/speech"
        assert request.headers["authorization"] == "Bearer test-voice-agent-key"
        assert json.loads(request.content) == {
            "model": "google/gemini-3.8-flash-lite-tts",
            "input": "Xin chào.",
            "voice": voice,
            "response_format": "pcm",
        }
        return httpx.Response(200, headers={"content-type": "audio/pcm;rate=24000;channels=1"}, stream=stream)

    service = await make_service(handle, gender)
    frames = service.run_tts("Xin chào.", "utterance-1")
    first = await asyncio.wait_for(anext(frames), timeout=1)
    assert isinstance(first, TTSAudioRawFrame)
    assert first.audio == b"\x01\x00" * 12_000
    assert first.sample_rate == 24_000
    assert first.num_channels == 1
    assert first.context_id == "utterance-1"
    assert not stream.release.is_set()
    stream.release.set()
    remaining = [frame async for frame in frames]
    assert len(remaining) == 1
    assert remaining[0].audio == b"\x02\x00" * 120
    assert remaining[0].context_id == "utterance-1"
    assert stream.closed


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 401, 402, 429, 502])
async def test_api_errors_never_emit_audio_or_provider_body(make_service, status):
    service = await make_service(
        lambda request: httpx.Response(
            status, json={"error": {"message": "test-voice-agent-key private upstream details"}}
        )
    )
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-2")]
    assert len(frames) == 1
    assert isinstance(frames[0], ErrorFrame)
    assert frames[0].error == f"Gemini TTS request failed (HTTP {status})"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content_type,content,error",
    [
        ("application/json", b'{"error":"failed"}', "unsupported audio format"),
        ("audio/mpeg", b"fake-mp3", "unsupported audio format"),
        ("audio/pcm", b"", "no audio"),
    ],
)
async def test_invalid_audio_responses(make_service, content_type, content, error):
    service = await make_service(
        lambda request: httpx.Response(200, headers={"content-type": content_type}, content=content)
    )
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-3")]
    assert len(frames) == 1
    assert isinstance(frames[0], ErrorFrame)
    assert error in frames[0].error


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exception,error",
    [
        (httpx.ReadTimeout, "Gemini TTS request timed out"),
        (httpx.ConnectError, "Gemini TTS connection failed"),
    ],
)
async def test_network_failures(make_service, exception, error):
    def handle(request):
        raise exception("private upstream details", request=request)

    service = await make_service(handle)
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-4")]
    assert len(frames) == 1
    assert isinstance(frames[0], ErrorFrame)
    assert frames[0].error == error


@pytest.mark.asyncio
async def test_cancellation_closes_response_without_error_audio(make_service):
    stream = GatedAudioStream()
    service = await make_service(
        lambda request: httpx.Response(200, headers={"content-type": "audio/pcm"}, stream=stream)
    )
    frames = service.run_tts("Xin chào.", "utterance-5")
    assert isinstance(await anext(frames), TTSAudioRawFrame)
    next_frame = asyncio.create_task(anext(frames))
    await asyncio.sleep(0)
    next_frame.cancel()
    with pytest.raises(asyncio.CancelledError):
        await next_frame
    assert stream.closed
    await service.cleanup()
    assert service._client.is_closed


@pytest.mark.asyncio
async def test_blank_text_does_not_call_provider(make_service):
    def handle(request):
        pytest.fail("Blank text must not generate a billed request")

    service = await make_service(handle)
    assert [frame async for frame in service.run_tts(" \n", "utterance-6")] == []


@pytest.mark.asyncio
async def test_full_reply_is_one_request_only_after_llm_finishes(make_service):
    inputs = []

    def handle(request):
        inputs.append(json.loads(request.content)["input"])
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x00" * 120)

    service = await make_service(handle)
    direction = FrameDirection.DOWNSTREAM
    await service.process_frame(StartFrame(), direction)
    await service.process_frame(LLMFullResponseStartFrame(), direction)
    for text in ["Xin ", "chào. ", "Tôi muốn hỏi ", "về căn hộ.\nGiá bao nhiêu?"]:
        await service.process_frame(TextFrame(text), direction)
        assert inputs == []
    await service.process_frame(LLMFullResponseEndFrame(), direction)
    assert inputs == ["Xin chào. Tôi muốn hỏi về căn hộ.\nGiá bao nhiêu?"]

    await service.process_frame(LLMFullResponseStartFrame(), direction)
    await service.process_frame(TextFrame("Cảm ơn"), direction)
    await service.process_frame(LLMFullResponseEndFrame(), direction)
    assert inputs == ["Xin chào. Tôi muốn hỏi về căn hộ.\nGiá bao nhiêu?", "Cảm ơn"]


@pytest.mark.asyncio
async def test_interruption_discards_unsynthesized_reply(make_service):
    inputs = []

    def handle(request):
        inputs.append(json.loads(request.content)["input"])
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x00" * 120)

    service = await make_service(handle)
    direction = FrameDirection.DOWNSTREAM
    await service.process_frame(StartFrame(), direction)
    await service.process_frame(LLMFullResponseStartFrame(), direction)
    await service.process_frame(TextFrame("Không được đọc. Đây là câu chưa xong"), direction)
    await service.process_frame(InterruptionFrame(), direction)
    await service.process_frame(LLMFullResponseEndFrame(), direction)
    assert inputs == []

    await service.process_frame(LLMFullResponseStartFrame(), direction)
    await service.process_frame(TextFrame("Câu trả lời mới."), direction)
    await service.process_frame(LLMFullResponseEndFrame(), direction)
    assert inputs == ["Câu trả lời mới."]


class FrameRecorder(BaseObserver):
    def __init__(self):
        super().__init__()
        self.frames = []

    async def on_push_frame(self, data):
        self.frames.append(data.frame)


@pytest.mark.asyncio
async def test_gemini_audio_can_arrive_after_pipecats_default_idle_timeout(monkeypatch, settings):
    async def handle(request):
        await asyncio.sleep(3.2)
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x00" * 12_000)

    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        openrouter_tts.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle), **kwargs),
    )
    service = create_tts(settings, TTSProvider.GEMINI, "female")
    recorder = FrameRecorder()
    worker = PipelineWorker(Pipeline([service]), observers=[recorder])
    await worker.queue_frames([TTSSpeakFrame("Xin chào."), EndFrame()])
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await asyncio.wait_for(runner.run(), timeout=8)

    errors = [frame.error for frame in recorder.frames if isinstance(frame, ErrorFrame)]
    assert errors == []
    audio = [frame for frame in recorder.frames if isinstance(frame, TTSAudioRawFrame)]
    assert audio
    assert any(frame.audio == b"\x01\x00" * 12_000 for frame in audio)


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["headers", "body"])
async def test_request_deadline_bounds_waiting_for_audio(make_service, monkeypatch, phase):
    monkeypatch.setattr(gemini, "GEMINI_REQUEST_TIMEOUT_SECONDS", 0.05)
    stream = GatedAudioStream()

    async def handle(request):
        if phase == "headers":
            await asyncio.Event().wait()
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, stream=stream)

    service = await make_service(handle)
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-timeout")]
    assert isinstance(frames[-1], ErrorFrame)
    assert frames[-1].error == "Gemini TTS request timed out"
    if phase == "body":
        assert isinstance(frames[0], TTSAudioRawFrame)
        assert stream.closed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    [
        lambda request: httpx.Response(503),
        lambda request: httpx.Response(429),
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("refused", request=request)),
    ],
)
async def test_transient_failure_before_audio_is_retried_once(make_service, failure):
    requests = []

    def handle(request):
        requests.append(request)
        if len(requests) == 1:
            return failure(request)
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x00" * 120)

    service = await make_service(handle)
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-retry")]
    assert len(requests) == 2
    assert [type(frame) for frame in frames] == [TTSAudioRawFrame]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 401])
async def test_rejected_request_is_not_retried(make_service, status):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(status)

    service = await make_service(handle)
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-rejected")]
    assert len(requests) == 1
    assert isinstance(frames[0], ErrorFrame)


class BrokenAfterAudioStream(httpx.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"\x01\x00" * 12_000
        raise httpx.ReadError("connection reset")


@pytest.mark.asyncio
async def test_failure_after_audio_started_is_never_retried(make_service):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, stream=BrokenAfterAudioStream())

    service = await make_service(handle)
    frames = [frame async for frame in service.run_tts("Xin chào.", "utterance-broken")]
    # Repeating the request would make the buyer say the sentence twice.
    assert len(requests) == 1
    assert isinstance(frames[0], TTSAudioRawFrame)
    assert isinstance(frames[-1], ErrorFrame)
    assert frames[-1].error == "Gemini TTS connection failed"


@pytest.mark.asyncio
async def test_connect_timeout_is_short(make_service):
    service = await make_service(lambda request: httpx.Response(200))
    assert service._client.timeout.connect == gemini.GEMINI_CONNECT_TIMEOUT_SECONDS
    assert service._client.timeout.read == gemini.GEMINI_REQUEST_TIMEOUT_SECONDS
