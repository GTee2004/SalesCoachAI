from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from pipecat.frames.frames import InterruptionFrame, TTSStoppedFrame, TTSTextFrame
from pipecat.observers.user_bot_latency_observer import (
    LatencyBreakdown,
    LatencyContribution,
    LatencyOwnerKind,
    MeasuredFrom,
)
from pipecat.processors.frame_processor import FrameDirection

from src.salescoach_voice.latency import turn_latency
from src.salescoach_voice.transcript import TranscriptPersistenceProcessor


def contribution(key: str, secs: float) -> LatencyContribution:
    return LatencyContribution(
        key=key, label=key, owner="test", owner_kind=LatencyOwnerKind.SERVICE, start_time=0, duration_secs=secs
    )


def test_turn_latency_sums_repeated_stage_keys_in_ms():
    breakdown = LatencyBreakdown(
        contributions=[
            contribution("transcription", 0.2),
            contribution("llm_inference", 0.5004),
            contribution("speech_synthesis", 0.1),
            contribution("speech_synthesis", 0.05),
        ],
        measured_from=MeasuredFrom.USER_SILENCE,
        total_secs=0.8504,
    )
    assert turn_latency(breakdown) == {
        "totalMs": 850,
        "stages": {"transcription": 200, "llm_inference": 500, "speech_synthesis": 150},
    }


async def speak(transcript: TranscriptPersistenceProcessor, text: str, end) -> None:
    await transcript.process_frame(TTSTextFrame(text, aggregated_by="word", context_id="c"), FrameDirection.DOWNSTREAM)
    await transcript.process_frame(end, FrameDirection.DOWNSTREAM)


@pytest.mark.asyncio
async def test_latency_is_saved_once_with_the_reply_it_measured():
    latency = {"totalMs": 900, "stages": {"llm_inference": 600}}
    session = SimpleNamespace(utterances=[], pending_latency=latency, registration=SimpleNamespace(sessionId=uuid4()))
    registry = SimpleNamespace(emit=AsyncMock(), enqueue=Mock())
    transcript = TranscriptPersistenceProcessor(registry, session, role="assistant")
    transcript.push_frame = AsyncMock()

    await speak(transcript, "Dạ, em nghe.", TTSStoppedFrame(context_id="c"))
    await speak(transcript, "Anh nói tiếp đi.", InterruptionFrame())

    first, second = (call.args[2] for call in registry.enqueue.call_args_list if call.args[1] == "transcript.final")
    assert first["latency"] == latency
    assert "latency" not in second
    assert second["interrupted"] is True
    assert session.pending_latency is None


@pytest.mark.asyncio
async def test_latency_of_a_discarded_reply_is_dropped():
    session = SimpleNamespace(utterances=[], pending_latency={"totalMs": 900, "stages": {}})
    registry = SimpleNamespace(emit=AsyncMock(), enqueue=Mock())
    transcript = TranscriptPersistenceProcessor(registry, session, role="assistant")
    transcript.push_frame = AsyncMock()

    # A reply with no spoken text is not persisted, so neither is its latency.
    await transcript.process_frame(TTSStoppedFrame(context_id="c"), FrameDirection.DOWNSTREAM)

    assert registry.emit.call_args_list == []
    assert registry.enqueue.call_args_list == []
    assert session.pending_latency is None
