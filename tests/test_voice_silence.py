import asyncio
from types import SimpleNamespace

import pytest
from pipecat.frames.frames import EndFrame, UserIdleTimeoutUpdateFrame

from src.salescoach_voice import pipeline as voice_pipeline
from src.salescoach_voice.silence import CHECK_IN_UTTERANCE, HANG_UP_UTTERANCE, LearnerSilence
from tests.test_voice_resilience import end_reasons, run_pipeline_with_errors, spoken

# --- Silence decisions ---------------------------------------------------------


def test_first_silence_checks_in_and_the_next_hangs_up():
    silence = LearnerSilence()

    assert silence.on_silence() == "check_in"
    assert silence.on_silence() == "hang_up"
    assert silence.on_silence() is None


def test_learner_answering_the_check_in_starts_over():
    silence = LearnerSilence()
    silence.on_silence()

    assert silence.learner_spoke() is True
    assert silence.on_silence() == "check_in"


def test_learner_speech_without_a_check_in_changes_nothing():
    silence = LearnerSilence()

    assert silence.learner_spoke() is False
    assert silence.on_silence() == "check_in"


def test_learner_speech_does_not_cancel_a_hang_up():
    silence = LearnerSilence()
    silence.on_silence()
    silence.on_silence()

    assert silence.learner_spoke() is False
    assert silence.hanging_up


# --- Pipeline ------------------------------------------------------------------


async def settle():
    # Pipecat runs async event handlers as tasks.
    for _ in range(5):
        await asyncio.sleep(0)


async def learner_silent(services):
    await services.user_aggregator._call_event_handler("on_user_turn_idle")
    await settle()


async def learner_said(services, text: str):
    message = SimpleNamespace(content=text, timestamp="")
    await services.user_aggregator._call_event_handler("on_user_turn_stopped", None, message)
    await settle()


def idle_timeouts(worker) -> list[float]:
    return [frame.timeout for frame in worker.queued if isinstance(frame, UserIdleTimeoutUpdateFrame)]


def server_messages(worker) -> list[dict]:
    return [call.args[0].message["data"] for call in worker.rtvi.push_frame.await_args_list]


@pytest.mark.asyncio
async def test_silence_timer_uses_the_check_in_setting(monkeypatch):
    captured = {}

    async def errors(services):
        captured["timeout"] = services.user_aggregator._params.user_idle_timeout
        return []

    await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert captured["timeout"] == 20


@pytest.mark.asyncio
async def test_first_silence_gets_one_check_in(monkeypatch):
    async def errors(services):
        await learner_silent(services)
        return []

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert spoken(worker) == [CHECK_IN_UTTERANCE]
    assert idle_timeouts(worker) == [15]
    assert not any(isinstance(frame, EndFrame) for frame in worker.queued)
    assert end_reasons(registry) == ["client_disconnected"]


@pytest.mark.asyncio
async def test_silence_after_the_check_in_ends_the_call_once_goodbye_plays(monkeypatch):
    async def errors(services):
        await learner_silent(services)
        await learner_silent(services)
        assert not any(isinstance(frame, EndFrame) for frame in services.worker.queued)
        services.playback._on_playback_stopped()
        await settle()
        return []

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert spoken(worker) == [CHECK_IN_UTTERANCE, HANG_UP_UTTERANCE]
    assert isinstance(worker.queued[-1], EndFrame)
    assert {"type": "call-ending", "reason": "learner_idle"} in server_messages(worker)
    assert end_reasons(registry) == ["learner_idle"]


@pytest.mark.asyncio
async def test_call_ends_even_if_the_goodbye_never_plays(monkeypatch):
    monkeypatch.setattr(voice_pipeline, "HANG_UP_PLAYBACK_SECONDS", 0.01)

    async def errors(services):
        await learner_silent(services)
        await learner_silent(services)
        await asyncio.sleep(0.05)
        return []

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert isinstance(worker.queued[-1], EndFrame)
    assert end_reasons(registry) == ["learner_idle"]


@pytest.mark.asyncio
async def test_learner_answering_the_check_in_keeps_the_call(monkeypatch):
    async def errors(services):
        await learner_silent(services)
        await learner_said(services, "Dạ em đây ạ")
        await learner_silent(services)
        return []

    registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert spoken(worker) == [CHECK_IN_UTTERANCE, CHECK_IN_UTTERANCE]
    # Back to the check-in delay once the learner answers.
    assert idle_timeouts(worker) == [15, 20, 15]
    assert end_reasons(registry) == ["client_disconnected"]


@pytest.mark.asyncio
async def test_empty_learner_turn_does_not_count_as_an_answer(monkeypatch):
    async def errors(services):
        await learner_silent(services)
        await learner_said(services, "  ")
        await learner_silent(services)
        return []

    _registry, worker, _session = await run_pipeline_with_errors(monkeypatch, first_utterance="", errors=errors)

    assert spoken(worker) == [CHECK_IN_UTTERANCE, HANG_UP_UTTERANCE]


@pytest.mark.asyncio
async def test_buyer_speaks_the_lines_the_web_app_sent(monkeypatch):
    async def errors(services):
        await learner_silent(services)
        await learner_silent(services)
        return []

    _registry, worker, _session = await run_pipeline_with_errors(
        monkeypatch,
        first_utterance="",
        errors=errors,
        check_in_utterance="Alo, em còn ở đó không?",
        hang_up_utterance="Anh cúp máy nhé.",
    )

    assert spoken(worker) == ["Alo, em còn ở đó không?", "Anh cúp máy nhé."]


@pytest.mark.asyncio
async def test_silence_during_the_opening_is_ignored(monkeypatch):
    async def errors(services):
        await learner_silent(services)
        return []

    _registry, worker, _session = await run_pipeline_with_errors(
        monkeypatch, first_utterance="Xin chào.", errors=errors
    )

    assert spoken(worker) == []
