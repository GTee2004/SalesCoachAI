import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pipecat.frames.frames import MetricsFrame
from pipecat.metrics.metrics import (
    LLMTokenUsage,
    LLMUsageMetricsData,
    STTUsage,
    STTUsageMetricsData,
    TTFBMetricsData,
    TTSUsageMetricsData,
)
from pipecat.processors.frame_processor import FrameProcessor

from src.salescoach_voice.sessions import SessionRegistry, SessionState
from src.salescoach_voice.usage import UsageMeter, llm_provider


def test_llm_provider_is_named_by_host():
    assert llm_provider("https://openrouter.ai/api/v1") == "openrouter"
    assert llm_provider("https://api.openai.com/v1") == "api.openai.com"


@pytest.mark.asyncio
async def test_meter_counts_only_what_the_tracked_service_reports():
    stt, llm, tts = FrameProcessor(), FrameProcessor(), FrameProcessor()
    meter = UsageMeter()
    meter.track(stt, "soniox")
    meter.track(llm, "openrouter")
    meter.track(tts, "elevenlabs")

    stt_usage = STTUsageMetricsData(processor=stt.name, model="stt-rt-v5", value=STTUsage(audio_seconds=1.25))
    await stt.push_frame(MetricsFrame(data=[stt_usage]))
    await stt.push_frame(MetricsFrame(data=[stt_usage.model_copy(update={"value": STTUsage(audio_seconds=2.5)})]))
    # The STT metrics pass through the LLM and TTS on their way downstream.
    await llm.push_frame(MetricsFrame(data=[stt_usage]))
    await tts.push_frame(MetricsFrame(data=[stt_usage]))
    tokens = LLMTokenUsage(prompt_tokens=1200, completion_tokens=40, total_tokens=1240, cache_read_input_tokens=1000)
    await llm.push_frame(
        MetricsFrame(
            data=[
                TTFBMetricsData(processor=llm.name, model="openai/gpt-6-luna", value=0.4),
                LLMUsageMetricsData(processor=llm.name, model="openai/gpt-6-luna", value=tokens),
            ]
        )
    )
    await tts.push_frame(MetricsFrame(data=[TTSUsageMetricsData(processor=tts.name, model=None, value=17)]))

    assert meter.summary() == [
        {"service": "stt", "provider": "soniox", "model": "stt-rt-v5", "audioSeconds": 3.75},
        {
            "service": "llm",
            "provider": "openrouter",
            "model": "openai/gpt-6-luna",
            "inputTokens": 1200,
            "cachedInputTokens": 1000,
            "outputTokens": 40,
        },
        {"service": "tts", "provider": "elevenlabs", "model": "unknown", "characters": 17},
    ]


@pytest.mark.asyncio
async def test_usage_event_reports_services_with_active_seconds():
    sink = SimpleNamespace(emit=AsyncMock())
    registry = SessionRegistry(SimpleNamespace(max_concurrent_sessions=6), sink)
    session = await registry.register(
        SimpleNamespace(
            sessionId=uuid4(),
            userId="learner",
            expiresAt=datetime.now(UTC) + timedelta(minutes=5),
            ttsProvider="soniox",
            buyerGender="female",
            micType=None,
            nextSequence=1,
            maxDurationSeconds=900,
        )
    )
    session.usage.add_tts("soniox", "tts-rt-v2", 42)

    await registry.end(session.registration.sessionId, "learner_ended")

    usage = next(call.args[0] for call in sink.emit.call_args_list if call.args[0].type == "usage.recorded")
    assert usage.payload == {
        "activeSeconds": 0,
        "outageSeconds": 0,
        "services": [{"service": "tts", "provider": "soniox", "model": "tts-rt-v2", "characters": 42}],
    }


async def ended_usage(*, active_seconds: int, configure) -> dict:
    """End an active session after `configure(session, now)` and return its usage payload."""
    sink = SimpleNamespace(emit=AsyncMock())
    registry = SessionRegistry(SimpleNamespace(max_concurrent_sessions=6), sink)
    session = await registry.register(
        SimpleNamespace(
            sessionId=uuid4(),
            userId="learner",
            expiresAt=datetime.now(UTC) + timedelta(minutes=5),
            ttsProvider="soniox",
            buyerGender="female",
            micType=None,
            nextSequence=1,
            maxDurationSeconds=900,
        )
    )
    await registry.mark_active(session)
    now = asyncio.get_running_loop().time()
    session.active_started_at = now - active_seconds
    configure(session, now)
    await registry.end(session.registration.sessionId, "learner_ended")
    return next(call.args[0] for call in sink.emit.call_args_list if call.args[0].type == "usage.recorded").payload


@pytest.mark.asyncio
async def test_dead_time_is_reported_as_not_charged():
    def configure(session, now):
        session.begin_outage(now - 40)
        session.end_outage()

    usage = await ended_usage(active_seconds=300, configure=configure)

    assert (usage["activeSeconds"], usage["outageSeconds"]) == (300, 40)


@pytest.mark.asyncio
async def test_outage_still_running_when_the_call_ends_is_counted_to_the_end():
    def configure(session, now):
        session.begin_outage(now - 25)

    usage = await ended_usage(active_seconds=300, configure=configure)

    assert usage["outageSeconds"] == 25


@pytest.mark.asyncio
async def test_a_second_failure_during_an_outage_does_not_restart_it():
    def configure(session, now):
        session.begin_outage(now - 30)
        session.begin_outage(now - 10)

    usage = await ended_usage(active_seconds=300, configure=configure)

    assert usage["outageSeconds"] == 30


@pytest.mark.asyncio
async def test_practice_that_never_started_is_not_charged_at_all():
    def configure(session, _now):
        session.practice_never_started = True

    usage = await ended_usage(active_seconds=55, configure=configure)

    assert (usage["activeSeconds"], usage["outageSeconds"]) == (55, 55)


async def credit_limited_session(max_duration: int):
    sink = SimpleNamespace(emit=AsyncMock())
    registry = SessionRegistry(SimpleNamespace(max_concurrent_sessions=6, connection_heartbeat_seconds=3600), sink)
    session = await registry.register(
        SimpleNamespace(
            sessionId=uuid4(),
            userId="learner",
            expiresAt=datetime.now(UTC) + timedelta(minutes=30),
            ttsProvider="soniox",
            buyerGender="female",
            micType=None,
            nextSequence=1,
            maxDurationSeconds=max_duration,
        )
    )
    await registry.mark_active(session)
    assert registry.touch(session, str(session.attempt_id))
    return registry, session, sink


@pytest.mark.asyncio
async def test_time_lost_to_an_outage_does_not_use_up_the_allowance():
    registry, session, sink = await credit_limited_session(300)
    now = asyncio.get_running_loop().time()
    session.active_started_at = now - 320
    session.begin_outage(now - 60)
    session.end_outage()

    await registry.sweep()
    assert session.state is SessionState.ACTIVE

    session.active_started_at = now - 361
    await registry.sweep()
    assert session.state is SessionState.ENDED
    usage = next(call.args[0] for call in sink.emit.call_args_list if call.args[0].type == "usage.recorded")
    # The call ran past its 300 s allowance by the outage, and is charged 300 s.
    assert usage.payload["activeSeconds"] - usage.payload["outageSeconds"] == 300
    assert usage.payload["activeSeconds"] > 300


@pytest.mark.asyncio
async def test_the_extension_is_bounded_but_the_outage_is_still_not_charged():
    def configure(session, now):
        session.registration.maxDurationSeconds = 300
        session.begin_outage(now - 650)

    usage = await ended_usage(active_seconds=700, configure=configure)

    # At most 300 + 300 s reported; all 650 s of outage within it are waived.
    assert usage["activeSeconds"] == 600
    assert usage["outageSeconds"] == 600
