import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    ErrorFrame,
    InputAudioRawFrame,
    LLMContextFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    TTSStoppedFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TextAggregationMode, TTSService
from pipecat.transports.base_output import BaseOutputTransport
from pipecat.transports.base_transport import TransportParams
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from src.salescoach_voice import pipeline as voice_pipeline
from src.salescoach_voice.opening import (
    OpeningCoordinator,
    OpeningInputGate,
    PlaybackObserver,
)
from src.salescoach_voice.rtvi import ClientRTVIProcessor
from src.salescoach_voice.sessions import SessionState
from src.salescoach_voice.transcript import TranscriptPersistenceProcessor
from src.salescoach_voice.usage import UsageMeter


class FakeSTT(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.audio_seen = 0

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction is FrameDirection.DOWNSTREAM and isinstance(frame, InputAudioRawFrame):
            self.audio_seen += 1
            await self.push_frame(ProposedUserStartedSpeakingFrame())
            await self.push_frame(
                TranscriptionFrame(
                    text="early microphone",
                    user_id="user",
                    timestamp="now",
                    finalized=True,
                )
            )
            await self.push_frame(ProposedUserStoppedSpeakingFrame())
        else:
            await self.push_frame(frame, direction)


class Capture(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.transcripts = []
        self.llm_contexts = []

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction is FrameDirection.DOWNSTREAM:
            if isinstance(frame, TranscriptionFrame):
                self.transcripts.append(frame.text)
            if isinstance(frame, LLMContextFrame):
                self.llm_contexts.append(list(frame.context.get_messages()))
        await self.push_frame(frame, direction)


class PlaybackTrace(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.frames = []

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction is FrameDirection.DOWNSTREAM and isinstance(
            frame, (BotStartedSpeakingFrame, BotStoppedSpeakingFrame, TTSStoppedFrame)
        ):
            self.frames.append(type(frame))
        await self.push_frame(frame, direction)


class InMemoryTTS(TTSService):
    def __init__(self):
        super().__init__(
            settings=TTSSettings(model="in-memory", voice="test", language=None),
            sample_rate=16000,
            text_aggregation_mode=TextAggregationMode.SENTENCE,
            push_start_frame=True,
            push_stop_frames=True,
            stop_frame_timeout_s=0.05,
        )

    async def run_tts(self, text, context_id):
        yield TTSAudioRawFrame(b"\x01\x00" * 8000, 16000, 1, context_id=context_id)


class NoAudioTTS(InMemoryTTS):
    async def run_tts(self, text, context_id):
        yield ErrorFrame(error="synthetic no audio")


class PartialErrorTTS(InMemoryTTS):
    async def run_tts(self, text, context_id):
        yield TTSAudioRawFrame(b"\x01\x00" * 8000, 16000, 1, context_id=context_id)
        yield ErrorFrame(error="synthetic partial failure")


class InMemoryOutput(BaseOutputTransport):
    def __init__(self):
        super().__init__(
            TransportParams(
                audio_out_enabled=True,
                audio_out_sample_rate=16000,
                audio_out_auto_silence=False,
                audio_out_10ms_chunks=1,
            )
        )
        self.audio_written = 0

    async def start(self, frame):
        await self.set_transport_ready(frame)

    async def write_audio_frame(self, frame):
        self.audio_written += len(frame.audio)
        return True


@pytest.mark.asyncio
@pytest.mark.parametrize("ack_during_activation", [False, True])
async def test_opener_waits_for_matching_client_ack_after_connection_and_bot_ready(monkeypatch, ack_during_activation):
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
            self.rtvi = rtvi_processor
            self.queued = []
            self.handlers = {}
            self.rtvi.push_frame = AsyncMock()

        def event_handler(self, name):
            def register(handler):
                self.handlers[name] = handler
                return handler

            return register

        async def queue_frames(self, frames):
            self.queued.extend(frames)

    transport = FakeTransport()
    worker = None
    current = True

    class FakeRunner:
        def __init__(self, **_kwargs):
            pass

        async def add_workers(self, item):
            nonlocal worker
            worker = item

        async def run(self):
            nonlocal current
            assert worker is not None
            on_client_message = worker.rtvi._event_handlers["on_client_message"].handlers[0]
            for data in (None, {}, {"sessionId": "stale"}):
                await on_client_message(
                    worker.rtvi,
                    SimpleNamespace(type="practice-ready", data=data),
                )
            await on_client_message(
                worker.rtvi,
                SimpleNamespace(type="other", data={"sessionId": "session-1"}),
            )
            current = False
            await on_client_message(
                worker.rtvi,
                SimpleNamespace(type="practice-ready", data={"sessionId": "session-1"}),
            )
            current = True
            assert worker.queued == []
            await transport.handlers["on_client_connected"](transport, None)
            expected = ["Hello, buyer."] if ack_during_activation else []
            assert [frame.text for frame in worker.queued if isinstance(frame, TTSSpeakFrame)] == expected
            await worker.rtvi.set_bot_ready()
            assert [frame.text for frame in worker.queued if isinstance(frame, TTSSpeakFrame)] == expected
            message = SimpleNamespace(type="practice-ready", data={"sessionId": "session-1"})
            await asyncio.gather(
                on_client_message(worker.rtvi, message),
                on_client_message(worker.rtvi, message),
            )
            assert [frame.text for frame in worker.queued if isinstance(frame, TTSSpeakFrame)] == ["Hello, buyer."]
            current = False

        async def cancel(self):
            pass

    monkeypatch.setattr(voice_pipeline, "SmallWebRTCTransport", lambda **_kwargs: transport)
    monkeypatch.setattr(voice_pipeline, "PipelineWorker", FakeWorker)
    monkeypatch.setattr(voice_pipeline, "WorkerRunner", FakeRunner)
    monkeypatch.setattr(voice_pipeline, "create_audio_in_filter", lambda _settings: None)
    monkeypatch.setattr(voice_pipeline, "create_stt", lambda *_args: FrameProcessor())
    monkeypatch.setattr(voice_pipeline, "create_llm", lambda *_args: FrameProcessor())
    monkeypatch.setattr(voice_pipeline, "create_tts", lambda *_args: FrameProcessor())
    monkeypatch.setattr(voice_pipeline, "create_latency_observer", lambda _session: None)

    registration = SimpleNamespace(
        sessionId="session-1",
        scenario=SimpleNamespace(firstUtterance="Hello, buyer.", systemPrompt="", sttTerms=[]),
        ttsProvider="gemini",
        buyerGender="female",
        micType=None,
    )
    session = SimpleNamespace(
        registration=registration,
        state=SessionState.AWAITING_CONNECTION,
        usage=UsageMeter(),
        begin_outage=Mock(),
        end_outage=Mock(),
        outage_extension=lambda _now: 0,
    )

    async def mark_active(_session):
        if ack_during_activation:
            on_client_message = worker.rtvi._event_handlers["on_client_message"].handlers[0]
            await on_client_message(
                worker.rtvi,
                SimpleNamespace(type="practice-ready", data={"sessionId": "session-1"}),
            )
            assert worker.queued == []
        session.state = SessionState.ACTIVE

    registry = SimpleNamespace(
        attach_worker=AsyncMock(),
        detach_worker=AsyncMock(),
        mark_active=mark_active,
        fail=AsyncMock(),
        end=AsyncMock(),
        is_current=lambda _session: current,
        touch=lambda _session, _attempt: current,
    )
    settings = SimpleNamespace(
        voice_agent_llm_base_url="https://openrouter.ai/api/v1",
        session_max_seconds=10,
        opening_timeout_seconds=10,
        learner_idle_check_in_seconds=20,
        learner_idle_hang_up_seconds=15,
    )
    await voice_pipeline.run_voice_pipeline(SimpleNamespace(pc_id="peer-1"), session, registry, settings)


@pytest.mark.asyncio
async def test_later_reply_rejects_speech_echo_and_accepts_fresh_audio_after_playback():
    opening = OpeningCoordinator("")
    stt = FakeSTT()
    persistence = Capture()
    llm = Capture()
    context = LLMContext()
    user, _assistant = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(user_turn_strategies=ExternalUserTurnStrategies()),
        realtime_service_mode=False,
    )
    output = InMemoryOutput()
    stopped = asyncio.Event()
    original_stopped = opening.playback_stopped

    async def playback_stopped():
        await original_stopped()
        stopped.set()

    opening.playback_stopped = playback_stopped
    worker = PipelineWorker(
        Pipeline(
            [
                OpeningInputGate(opening),
                stt,
                OpeningInputGate(opening),
                persistence,
                user,
                llm,
                InMemoryTTS(),
                output,
                PlaybackObserver(opening),
            ]
        )
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    original_write_audio = output.write_audio_frame
    injected = False
    queued_during_playback = None
    queued_transcript = None

    async def write_audio_frame(frame):
        nonlocal injected, queued_during_playback, queued_transcript
        if not injected:
            injected = True
            queued_during_playback = InputAudioRawFrame(audio=b"\0\0" * 160, sample_rate=16000, num_channels=1)
            queued_transcript = TranscriptionFrame(
                text="queued bot echo", user_id="user", timestamp="now", finalized=True
            )
            await worker.queue_frames(
                [
                    InputAudioRawFrame(audio=b"\0\0" * 160, sample_rate=16000, num_channels=1),
                    TranscriptionFrame(text="live bot echo", user_id="user", timestamp="now", finalized=True),
                ]
            )
        return await original_write_audio(frame)

    output.write_audio_frame = write_audio_frame
    run_task = asyncio.create_task(runner.run())
    try:
        await worker.queue_frames([TTSSpeakFrame("A later assistant reply.")])
        await asyncio.wait_for(stopped.wait(), timeout=8)
        await asyncio.sleep(0.1)
        assert injected and output.audio_written > 0
        assert queued_during_playback is not None and queued_transcript is not None
        await worker.queue_frames([queued_during_playback, queued_transcript])
        await asyncio.sleep(0.1)
        assert stt.audio_seen == 0
        assert persistence.transcripts == []
        assert llm.llm_contexts == []
        assert not [message for message in context.get_messages() if message["role"] == "user"]
        await worker.queue_frames([InputAudioRawFrame(audio=b"\0\0" * 160, sample_rate=16000, num_channels=1)])
        await asyncio.sleep(0.1)
        assert stt.audio_seen == 1
        assert persistence.transcripts == ["early microphone"]
    finally:
        await worker.queue_frames([EndFrame()])
        await asyncio.wait_for(run_task, timeout=8)


@pytest.mark.asyncio
async def test_early_audio_and_final_transcript_cannot_reach_stt_persistence_or_context():
    opening = OpeningCoordinator("Hello, buyer")
    stt = FakeSTT()
    persistence = Capture()
    llm = Capture()
    context = LLMContext()
    user, assistant = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(user_turn_strategies=ExternalUserTurnStrategies()),
        realtime_service_mode=False,
    )
    worker = PipelineWorker(
        Pipeline(
            [
                OpeningInputGate(opening),
                stt,
                OpeningInputGate(opening),
                persistence,
                user,
                llm,
                assistant,
            ]
        )
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await worker.queue_frames(
        [
            InputAudioRawFrame(audio=b"\0\0" * 160, sample_rate=16000, num_channels=1),
            ProposedUserStartedSpeakingFrame(),
            TranscriptionFrame(
                text="direct early final",
                user_id="user",
                timestamp="now",
                finalized=True,
            ),
            ProposedUserStoppedSpeakingFrame(),
            EndFrame(),
        ]
    )
    await asyncio.wait_for(runner.run(), timeout=10)
    assert stt.audio_seen == 0
    assert persistence.transcripts == []
    assert llm.llm_contexts == []
    assert context.get_messages() == []


@pytest.mark.asyncio
async def test_release_needs_committed_text_final_tts_and_final_output_stop():
    opening = OpeningCoordinator("Hello, buyer")
    await opening.playback_started()
    await opening.playback_stopped()
    await opening.assistant_committed("Hello, buyer")
    assert opening.phase == "opening"
    await opening.playback_started()
    await opening.synthesis_stopped()
    assert opening.phase == "opening"
    await opening.playback_stopped()
    assert opening.phase == "listening"


@pytest.mark.asyncio
async def test_failed_readiness_callback_keeps_input_closed():
    async def publish(_phase):
        raise RuntimeError("event delivery failed")

    opening = OpeningCoordinator("Hello, buyer", publish)
    await opening.assistant_committed("Hello, buyer")
    await opening.synthesis_stopped()
    await opening.playback_started()
    with pytest.raises(RuntimeError, match="event delivery failed"):
        await opening.playback_stopped()
    assert opening.phase == "opening"
    assert not opening.admits(InputAudioRawFrame(audio=b"\0\0", sample_rate=16000, num_channels=1))


@pytest.mark.asyncio
async def test_empty_opener_listens_immediately_and_failure_never_releases():
    assert OpeningCoordinator("  ").phase == "listening"
    opening = OpeningCoordinator("Hello, buyer")
    await opening.fail()
    await opening.assistant_committed("Hello, buyer")
    await opening.synthesis_stopped()
    await opening.playback_started()
    await opening.playback_stopped()
    assert opening.phase == "failed"


@pytest.mark.asyncio
async def test_queued_opening_frames_stay_rejected_after_release():
    opening = OpeningCoordinator("Hello, buyer")
    old_audio = InputAudioRawFrame(audio=b"\0\0" * 160, sample_rate=16000, num_channels=1)
    old_transcript = TranscriptionFrame(text="queued before release", user_id="user", timestamp="now", finalized=True)
    await opening.assistant_committed("Hello, buyer")
    await opening.synthesis_stopped()
    await opening.playback_started()
    await opening.playback_stopped()
    assert opening.phase == "listening"

    stt = FakeSTT()
    persistence = Capture()
    worker = PipelineWorker(Pipeline([OpeningInputGate(opening), stt, OpeningInputGate(opening), persistence]))
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await worker.queue_frames(
        [
            old_audio,
            old_transcript,
            InputAudioRawFrame(audio=b"\0\0" * 160, sample_rate=16000, num_channels=1),
            EndFrame(),
        ]
    )
    await asyncio.wait_for(runner.run(), timeout=10)
    assert stt.audio_seen == 1
    assert persistence.transcripts == ["early microphone"]


@pytest.mark.asyncio
async def test_duplicate_playback_stop_does_not_discard_new_user_audio():
    opening = OpeningCoordinator("")
    await opening.playback_started()
    await opening.playback_stopped()
    fresh_audio = InputAudioRawFrame(audio=b"\0\0", sample_rate=16000, num_channels=1)
    await opening.playback_stopped()
    assert opening.admits(fresh_audio)


@pytest.mark.asyncio
async def test_bot_ready_snapshots_opening_or_listening_and_preserves_about():
    opening = OpeningCoordinator("Hello, buyer")
    processor = ClientRTVIProcessor(opening)
    processor.push_frame = AsyncMock()
    await processor.set_bot_ready({"feature": "practice"})
    assert processor.push_frame.call_args.args[0].message["data"]["about"] == {
        "feature": "practice",
        "voiceInputState": "opening",
    }

    await opening.assistant_committed("Hello, buyer")
    await opening.synthesis_stopped()
    await opening.playback_started()
    await opening.playback_stopped()
    await processor.set_bot_ready({"feature": "practice"})
    assert processor.push_frame.call_args.args[0].message["data"]["about"] == {
        "feature": "practice",
        "voiceInputState": "listening",
    }


@pytest.mark.asyncio
async def test_terminal_transition_uses_rtvi_server_message():
    opening = OpeningCoordinator("Hello, buyer")
    processor = ClientRTVIProcessor(opening)
    processor.push_frame = AsyncMock()

    async def publish(phase):
        await processor.send_server_message({"type": "voice-input-state", "state": phase})

    opening.on_transition = publish
    await opening.fail()
    sent = processor.push_frame.call_args.args[0].message
    assert sent["type"] == "server-message"
    assert sent["data"] == {"type": "voice-input-state", "state": "failed"}


@pytest.mark.asyncio
async def test_real_tts_output_and_assistant_aggregation_complete_opener():
    released = asyncio.Event()

    session = SimpleNamespace(utterances=[])
    registry = SimpleNamespace(emit=AsyncMock())
    opening = OpeningCoordinator("Hello, buyer.")
    transcript = TranscriptPersistenceProcessor(registry, session, role="assistant", opening=opening)

    async def on_transition(phase):
        if phase == "listening":
            await transcript.resolve_opening(completed=True)
            released.set()

    opening.on_transition = on_transition
    context = LLMContext()
    _user, assistant = LLMContextAggregatorPair(context, realtime_service_mode=False)

    @assistant.event_handler("on_assistant_turn_stopped")
    async def committed(_aggregator, message):
        await opening.assistant_committed(message.content, interrupted=message.interrupted)

    output = InMemoryOutput()
    trace = PlaybackTrace()
    worker = PipelineWorker(Pipeline([InMemoryTTS(), output, transcript, assistant, trace, PlaybackObserver(opening)]))
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    run_task = asyncio.create_task(runner.run())
    try:
        await worker.queue_frames([TTSSpeakFrame("Hello, buyer.")])
        await asyncio.wait_for(released.wait(), timeout=8)
        assert output.audio_written > 0
        assert {
            BotStartedSpeakingFrame,
            BotStoppedSpeakingFrame,
            TTSStoppedFrame,
        }.issubset(set(trace.frames))
        assert {message["content"] for message in context.get_messages() if message["role"] == "assistant"} == {
            "Hello, buyer."
        }
        assert [(turn.text, turn.interrupted) for turn in session.utterances] == [("Hello, buyer.", False)]
        assert registry.emit.call_args.args[2]["playbackStatus"] == "completed"
    finally:
        await worker.queue_frames([EndFrame()])
        await asyncio.wait_for(run_task, timeout=8)


@pytest.mark.asyncio
@pytest.mark.parametrize("tts_type", [NoAudioTTS, PartialErrorTTS])
async def test_failed_opener_never_persists_completed_assistant_turn(tts_type):
    failed = asyncio.Event()
    session = SimpleNamespace(utterances=[])
    registry = SimpleNamespace(emit=AsyncMock())
    opening = OpeningCoordinator("Hello, buyer.")
    transcript = TranscriptPersistenceProcessor(registry, session, role="assistant", opening=opening)

    async def on_transition(phase):
        if phase == "failed":
            await transcript.resolve_opening(completed=False)
            failed.set()

    opening.on_transition = on_transition
    output = InMemoryOutput()
    context = LLMContext()
    _user, assistant = LLMContextAggregatorPair(context, realtime_service_mode=False)

    @assistant.event_handler("on_assistant_turn_stopped")
    async def committed(_aggregator, message):
        await opening.assistant_committed(message.content, interrupted=message.interrupted)

    worker = PipelineWorker(Pipeline([tts_type(), output, transcript, assistant, PlaybackObserver(opening)]))

    @worker.event_handler("on_pipeline_error")
    async def failed_on_error(_worker, _frame):
        await opening.fail()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    run_task = asyncio.create_task(runner.run())
    try:
        await worker.queue_frames([TTSSpeakFrame("Hello, buyer.")])
        await asyncio.wait_for(failed.wait(), timeout=8)
    finally:
        await worker.queue_frames([EndFrame()])
        await asyncio.wait_for(run_task, timeout=8)
    assert opening.phase == "failed"
    assert session.utterances == []
    assert registry.emit.call_args_list == []
    if tts_type is PartialErrorTTS:
        assert output.audio_written > 0
