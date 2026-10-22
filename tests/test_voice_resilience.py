import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import httpx
import pytest
from pipecat.frames.frames import EndFrame, ErrorFrame, LLMContextFrame, LLMTextFrame, TTSSpeakFrame
from pipecat.pipeline.service_switcher import ServiceSwitcher, ServiceSwitcherStrategyFailover
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.utils.errors import ErrorCategory
from pydantic import SecretStr

from src.salescoach_voice import persistence
from src.salescoach_voice import pipeline as voice_pipeline
from src.salescoach_voice.models import VoiceEvent
from src.salescoach_voice.persistence import EventSink
from src.salescoach_voice.providers.llm import FirstTokenDeadlineStream, create_llm
from src.salescoach_voice.sessions import SessionState
from src.salescoach_voice.usage import UsageMeter

# --- Voice LLM deadlines ---------------------------------------------------


def reply(text: str | None):
    delta = SimpleNamespace(content=text, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)] if text is not None else [])


class FakeStream:
    def __init__(self, *steps):
        # Each step is a chunk, or a number of seconds to stall before the next one.
        self._steps = list(steps)
        self.closed = False

    def __aiter__(self):
        return self._chunks()

    async def _chunks(self):
        for step in self._steps:
            if isinstance(step, (int, float)):
                await asyncio.sleep(step)
            else:
                yield step

    async def close(self):
        self.closed = True


async def collect(stream):
    return [chunk.choices[0].delta.content for chunk in [c async for c in stream] if chunk.choices]


def test_voice_llm_client_bounds_reads_and_sdk_retries():
    llm = create_llm(
        SimpleNamespace(
            voice_agent_llm_api_key=SecretStr("sk-test"),
            voice_agent_llm_base_url="https://openrouter.ai/api/v1",
            voice_agent_llm_model="openai/gpt-4.1-mini",
            voice_agent_llm_fallback_model=None,
            voice_agent_llm_first_token_seconds=5,
            voice_agent_llm_max_tokens=400,
        ),
        "Bạn là khách hàng.",
    )
    assert llm._client.timeout.connect == 3
    assert llm._client.timeout.read == 10
    assert llm._client.max_retries == 1


@pytest.mark.asyncio
async def test_request_without_reply_text_is_reissued_once():
    stalled = FakeStream(reply(None), 5, reply("never"))
    answered = FakeStream(reply("Dạ"), reply(" vâng"))
    streams = iter([stalled, answered])

    async def open_stream():
        return next(streams)

    chunks = await collect(FirstTokenDeadlineStream([open_stream, open_stream], timeout=0.05))

    assert chunks == ["Dạ", " vâng"]
    assert stalled.closed and answered.closed


@pytest.mark.asyncio
async def test_reply_that_never_starts_is_reported_after_retries():
    opened = []

    async def open_stream():
        opened.append(FakeStream(5))
        return opened[-1]

    with pytest.raises(TimeoutError):
        await collect(FirstTokenDeadlineStream([open_stream, open_stream], timeout=0.05))
    assert len(opened) == 2 and all(stream.closed for stream in opened)


@pytest.mark.asyncio
async def test_started_reply_is_never_reissued_or_cut_by_the_deadline():
    opened = []

    async def open_stream():
        opened.append(FakeStream(reply("Dạ"), 0.1, reply(" vâng")))
        return opened[-1]

    chunks = await collect(FirstTokenDeadlineStream([open_stream, open_stream], timeout=0.05))

    assert chunks == ["Dạ", " vâng"]
    assert len(opened) == 1


# --- Pipeline error handling -------------------------------------------------


async def run_pipeline_with_errors(
    monkeypatch,
    *,
    first_utterance: str,
    errors,
    repair_utterance: str = "",
    check_in_utterance: str = "",
    hang_up_utterance: str = "",
    session_max_seconds: float = 10,
    run_seconds: float = 0,
    outage_extension: float = 0,
    tts: FrameProcessor | None = None,
):
    """Run the voice pipeline with fakes, feeding it what `errors(services)` returns.

    ErrorFrames go to the pipeline's error handler; other frames are pushed out
    of the fake LLM, as a reply that produced text would be.
    """
    services = SimpleNamespace(stt=FrameProcessor(), llm=FrameProcessor(), tts=tts or FrameProcessor())

    class FakeTransport:
        def __init__(self, **_kwargs):
            self.handlers = {}

        def event_handler(self, name):
            def register(handler):
                self.handlers[name] = handler
                return handler

            return register

        def input(self):
            return FrameProcessor()

        def output(self):
            return FrameProcessor()

    class FakeWorker:
        def __init__(self, _pipeline, *, rtvi_processor, **_kwargs):
            self.handlers = {}
            self.queued = []
            self.rtvi = rtvi_processor
            rtvi_processor.push_frame = AsyncMock()

        def event_handler(self, name):
            def register(handler):
                self.handlers[name] = handler
                return handler

            return register

        async def queue_frames(self, frames):
            self.queued.extend(frames)

    worker = None

    class FakeRunner:
        def __init__(self, **_kwargs):
            pass

        async def add_workers(self, item):
            nonlocal worker
            worker = services.worker = item

        async def run(self):
            for frame in await errors(services):
                if isinstance(frame, ErrorFrame):
                    await worker.handlers["on_pipeline_error"](worker, frame)
                elif isinstance(frame, LLMContextFrame):
                    await services.llm._call_event_handler("on_before_process_frame", frame)
                else:
                    await services.llm._call_event_handler("on_before_push_frame", frame)
            await asyncio.sleep(run_seconds)

        async def cancel(self):
            pass

    monkeypatch.setattr(voice_pipeline, "SmallWebRTCTransport", FakeTransport)
    monkeypatch.setattr(voice_pipeline, "PipelineWorker", FakeWorker)
    monkeypatch.setattr(voice_pipeline, "WorkerRunner", FakeRunner)
    monkeypatch.setattr(voice_pipeline, "create_audio_in_filter", lambda _settings: None)
    monkeypatch.setattr(voice_pipeline, "create_stt", lambda *_args: services.stt)
    monkeypatch.setattr(voice_pipeline, "create_llm", lambda *_args: services.llm)
    monkeypatch.setattr(voice_pipeline, "create_tts", lambda *_args: services.tts)
    monkeypatch.setattr(voice_pipeline, "create_latency_observer", lambda _session: None)

    make_aggregators = voice_pipeline.LLMContextAggregatorPair

    def capture_aggregators(*args, **kwargs):
        services.user_aggregator, assistant = make_aggregators(*args, **kwargs)
        return services.user_aggregator, assistant

    monkeypatch.setattr(voice_pipeline, "LLMContextAggregatorPair", capture_aggregators)

    class CapturedPlaybackObserver(voice_pipeline.PlaybackObserver):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            services.playback = self

    monkeypatch.setattr(voice_pipeline, "PlaybackObserver", CapturedPlaybackObserver)
    registration = SimpleNamespace(
        sessionId="session-1",
        scenario=SimpleNamespace(
            firstUtterance=first_utterance,
            repairUtterance=repair_utterance,
            checkInUtterance=check_in_utterance,
            hangUpUtterance=hang_up_utterance,
            systemPrompt="",
            sttTerms=[],
        ),
        ttsProvider="soniox",
        buyerGender="female",
        micType=None,
    )
    session = SimpleNamespace(
        registration=registration,
        state=SessionState.ACTIVE,
        usage=UsageMeter(),
        begin_outage=Mock(),
        end_outage=Mock(),
        outage_extension=lambda _now: outage_extension,
        practice_never_started=False,
    )
    registry = SimpleNamespace(
        attach_worker=AsyncMock(),
        detach_worker=AsyncMock(),
        fail=AsyncMock(),
        end=AsyncMock(),
        is_current=lambda _session: True,
        touch=lambda _session, _attempt_id: True,
    )
    settings = SimpleNamespace(
        voice_agent_llm_base_url="https://openrouter.ai/api/v1",
        session_max_seconds=session_max_seconds,
        opening_timeout_seconds=10,
        learner_idle_check_in_seconds=20,
        learner_idle_hang_up_seconds=15,
    )
    await voice_pipeline.run_voice_pipeline(SimpleNamespace(pc_id="peer-1"), session, registry, settings)
    return registry, worker, session


def end_reasons(registry) -> list[str]:
    return [call.args[1] for call in registry.end.await_args_list]


def spoken(worker) -> list[str]:
    return [frame.text for frame in worker.queued if isinstance(frame, TTSSpeakFrame)]


def failed_reply(services) -> ErrorFrame:
    return ErrorFrame("LLM produced no reply", processor=services.llm, category=ErrorCategory.CONNECTIVITY)


@pytest.mark.asyncio
async def test_stt_reconnect_attempt_does_not_abort_the_opening(monkeypatch):
    async def errors(services):
        services.stt._reconnect_in_progress = True
        return [ErrorFrame("reconnection attempt 1 failed", processor=services.stt)]

    registry, _worker, _session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="Xin chào.", errors=errors
    )

    assert not any(call.args[1] == "opening_failed" for call in registry.fail.await_args_list)


@pytest.mark.asyncio
async def test_lost_opener_audio_still_aborts_the_opening(monkeypatch):
    async def errors(services):
        return [ErrorFrame("TTS request failed", processor=services.tts)]

    registry, _worker, _session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="Xin chào.", errors=errors
    )

    assert registry.fail.await_args.args[1] == "opening_failed"


@pytest.mark.asyncio
async def test_service_that_stops_the_call_is_recorded_as_the_end_reason(monkeypatch):
    async def errors(services):
        await services.tts.set_usable(False)
        return [ErrorFrame("3 consecutive TTS contexts", processor=services.tts, category=ErrorCategory.CONNECTIVITY)]

    registry, _worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert registry.end.await_args.args[1] == "provider_failed:tts:connectivity"


@pytest.mark.asyncio
async def test_learner_disconnect_keeps_its_end_reason(monkeypatch):
    async def errors(services):
        return [ErrorFrame("one silent reply", processor=services.tts)]

    registry, _worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert registry.end.await_args.args[1] == "client_disconnected"


@pytest.mark.asyncio
async def test_failed_reply_asks_the_learner_to_repeat_in_character(monkeypatch):
    async def errors(services):
        return [failed_reply(services)]

    registry, worker, _session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="", errors=errors, repair_utterance="Alo, anh chưa nghe rõ, nói lại giúp anh nhé?"
    )

    assert spoken(worker) == ["Alo, anh chưa nghe rõ, nói lại giúp anh nhé?"]
    assert not any(isinstance(frame, EndFrame) for frame in worker.queued)
    assert registry.end.await_args.args[1] == "client_disconnected"


@pytest.mark.asyncio
async def test_failed_reply_without_a_scenario_line_uses_a_neutral_one(monkeypatch):
    async def errors(services):
        return [failed_reply(services)]

    _registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert spoken(worker) == [voice_pipeline.REPAIR_UTTERANCE]


@pytest.mark.asyncio
async def test_reply_that_fails_during_the_opening_is_not_repaired(monkeypatch):
    async def errors(services):
        return [failed_reply(services)]

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="Xin chào.", errors=errors)

    assert spoken(worker) == []
    assert registry.fail.await_args.args[1] == "opening_failed"


@pytest.mark.asyncio
async def test_call_stops_after_three_failed_replies_in_a_row(monkeypatch):
    async def errors(services):
        return [failed_reply(services) for _ in range(voice_pipeline.MAX_CONSECUTIVE_FAILED_REPLIES)]

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert len(spoken(worker)) == voice_pipeline.MAX_CONSECUTIVE_FAILED_REPLIES - 1
    assert isinstance(worker.queued[-1], EndFrame)
    sent = worker.rtvi.push_frame.await_args.args[0].message
    assert sent["data"] == {"type": "voice-service-failed", "service": "llm"}
    assert registry.end.await_args.args[1] == "provider_failed:llm:connectivity"


@pytest.mark.asyncio
async def test_a_reply_that_works_resets_the_failure_count(monkeypatch):
    async def errors(services):
        return [failed_reply(services), failed_reply(services), LLMTextFrame("Dạ"), failed_reply(services)]

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert len(spoken(worker)) == 3
    assert not any(isinstance(frame, EndFrame) for frame in worker.queued)
    assert registry.end.await_args.args[1] == "client_disconnected"


@pytest.mark.asyncio
async def test_failed_reply_is_not_charged_from_when_the_turn_began(monkeypatch):
    began = None

    async def errors(services):
        nonlocal began
        began = asyncio.get_running_loop().time()
        return [LLMContextFrame(LLMContext()), failed_reply(services)]

    _registry, _worker, session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    (started_at,) = session.begin_outage.call_args.args
    assert started_at >= began
    assert not session.practice_never_started


@pytest.mark.asyncio
async def test_attempt_that_fails_during_the_opening_is_not_charged(monkeypatch):
    async def errors(services):
        return [ErrorFrame("TTS request failed", processor=services.tts)]

    _registry, _worker, session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="Xin chào.", errors=errors
    )

    assert session.practice_never_started
    session.begin_outage.assert_not_called()


@pytest.mark.asyncio
async def test_other_service_errors_are_still_charged(monkeypatch):
    async def errors(services):
        return [ErrorFrame("one silent reply", processor=services.tts)]

    _registry, _worker, session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    session.begin_outage.assert_not_called()
    assert not session.practice_never_started


@pytest.mark.asyncio
def tts_failover() -> ServiceSwitcher:
    return ServiceSwitcher(services=[FrameProcessor(), FrameProcessor()], strategy_type=ServiceSwitcherStrategyFailover)


async def fail_over(tts: ServiceSwitcher) -> None:
    primary = tts.strategy.active_service
    await primary.set_usable(False)
    await tts.strategy.handle_error(ErrorFrame("reconnect attempts exhausted", processor=primary))
    # The pipeline hears of the switch in a task of its own.
    await asyncio.sleep(0.01)


async def start_opener(worker) -> None:
    ready = SimpleNamespace(type="practice-ready", data={"sessionId": "session-1", "attemptId": "attempt-1"})
    await worker.rtvi._call_event_handler("on_client_message", ready)
    await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_tts_failover_before_the_opener_keeps_the_opening(monkeypatch):
    tts = tts_failover()

    async def errors(_services):
        await fail_over(tts)
        return []

    registry, _worker, session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="Xin chào.", errors=errors, tts=tts
    )

    assert not any(call.args[1] == "opening_failed" for call in registry.fail.await_args_list)
    session.begin_outage.assert_not_called()


@pytest.mark.asyncio
async def test_tts_failover_while_the_opener_plays_aborts_the_opening(monkeypatch):
    tts = tts_failover()

    async def errors(services):
        await start_opener(services.worker)
        assert spoken(services.worker) == ["Xin chào."]
        await fail_over(tts)
        return []

    registry, _worker, session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="Xin chào.", errors=errors, tts=tts
    )

    assert registry.fail.await_args.args[1] == "opening_failed"
    assert session.practice_never_started


@pytest.mark.asyncio
async def test_tts_failover_mid_call_is_not_charged(monkeypatch):
    tts = tts_failover()
    switched_at = None

    async def errors(_services):
        nonlocal switched_at
        switched_at = asyncio.get_running_loop().time()
        await fail_over(tts)
        return []

    registry, _worker, session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors, tts=tts)

    (started_at,) = session.begin_outage.call_args.args
    assert started_at >= switched_at
    assert end_reasons(registry) == ["client_disconnected"]


@pytest.mark.asyncio
async def test_call_reaches_its_duration_cap_without_an_outage(monkeypatch):
    async def errors(_services):
        return []

    registry, _worker, _session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="", errors=errors, session_max_seconds=0.2, run_seconds=1
    )

    assert "duration_limit" in end_reasons(registry)


@pytest.mark.asyncio
async def test_duration_cap_is_pushed_back_by_time_lost_to_an_outage(monkeypatch):
    async def errors(_services):
        return []

    registry, _worker, _session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="", errors=errors, session_max_seconds=0.2, run_seconds=1, outage_extension=5
    )

    assert end_reasons(registry) == ["client_disconnected"]


# --- Event delivery ----------------------------------------------------------


def event(session_id: UUID, sequence: int) -> VoiceEvent:
    return VoiceEvent(
        eventId=uuid4(),
        sessionId=session_id,
        sequence=sequence,
        type="transcript.final",
        occurredAt=datetime.now(UTC),
        payload={},
    )


def make_sink(monkeypatch, handler) -> EventSink:
    monkeypatch.setattr(persistence.random, "uniform", lambda _low, _high: 0)
    sink = EventSink(
        SimpleNamespace(
            voice_event_ingest_url="http://web.test/api/internal/voice/events",
            voice_event_ingest_key=SecretStr("k" * 32),
        )
    )
    sink._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return sink


def delivered_sequences(requests):
    return [VoiceEvent.model_validate_json(request.content).sequence for request in requests]


@pytest.mark.asyncio
async def test_rejected_event_is_dropped_without_blocking_its_session(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(400 if len(requests) == 1 else 200)

    sink = make_sink(monkeypatch, handler)
    session_id = uuid4()

    await sink.emit(event(session_id, 1))
    await sink.emit(event(session_id, 2))

    assert delivered_sequences(requests) == [1, 2]
    assert [item.sequence for item in sink.rejected] == [1]


@pytest.mark.asyncio
async def test_unavailable_ingestion_keeps_events_queued_in_order(monkeypatch):
    statuses = iter([503, 503, 503, 200, 200])
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(next(statuses))

    sink = make_sink(monkeypatch, handler)
    session_id = uuid4()

    with pytest.raises(RuntimeError):
        await sink.emit(event(session_id, 1))
    await sink.emit(event(session_id, 2))

    assert delivered_sequences(requests) == [1, 1, 1, 1, 2]
    assert sink.rejected == type(sink.rejected)()


@pytest.mark.asyncio
async def test_misconfigured_sink_keeps_events_instead_of_dropping_them(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(401)

    sink = make_sink(monkeypatch, handler)

    with pytest.raises(RuntimeError):
        await sink.emit(event(uuid4(), 1))

    assert len(requests) == 1
    assert not sink.rejected


@pytest.mark.asyncio
async def test_slow_session_does_not_hold_up_other_sessions(monkeypatch):
    slow, fast = uuid4(), uuid4()
    release = asyncio.Event()

    async def handler(request):
        if VoiceEvent.model_validate_json(request.content).sessionId == slow:
            await release.wait()
        return httpx.Response(200)

    sink = make_sink(monkeypatch, handler)
    waiting = asyncio.create_task(sink.emit(event(slow, 1)))
    await asyncio.sleep(0)

    await asyncio.wait_for(sink.emit(event(fast, 1)), 1)

    release.set()
    await waiting


@pytest.mark.asyncio
async def test_queued_events_are_delivered_in_the_background_in_order(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200)

    sink = make_sink(monkeypatch, handler)
    session_id = uuid4()

    sink.enqueue(event(session_id, 1))
    sink.enqueue(event(session_id, 2))
    await sink.emit(event(session_id, 3))

    assert delivered_sequences(requests) == [1, 2, 3]
