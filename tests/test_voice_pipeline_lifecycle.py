import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_response_universal import LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies

from src.salescoach_voice import pipeline as voice_pipeline
from src.salescoach_voice.sessions import SessionRegistry, SessionState


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "end_before_runner_starts,termination",
    [(False, "end"), (True, "end"), (False, "startup_timeout"), (False, "browser_close"), (False, "watchdog_timeout")],
)
async def test_termination_during_setup_closes_peer_and_waits_for_real_worker_cleanup(
    monkeypatch, end_before_runner_starts, termination
):
    setup_started = asyncio.Event()
    finish_setup = asyncio.Event()
    cleaned = asyncio.Event()

    class Passthrough(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)

    class StartingSTT(Passthrough):
        async def setup(self, setup):
            await super().setup(setup)
            setup_started.set()
            await finish_setup.wait()

        async def cleanup(self):
            await super().cleanup()
            cleaned.set()

    class Transport:
        def __init__(self):
            self.handlers = {}

        def input(self):
            return Passthrough()

        def output(self):
            return Passthrough()

        def event_handler(self, name):
            def register(handler):
                self.handlers[name] = handler
                return handler

            return register

    transport = Transport()
    rtvi = voice_pipeline.ClientRTVIProcessor()
    rtvi.send_server_message = AsyncMock()
    monkeypatch.setattr(voice_pipeline, "ClientRTVIProcessor", lambda _opening: rtvi)
    monkeypatch.setattr(voice_pipeline, "SmallWebRTCTransport", lambda **_kwargs: transport)
    monkeypatch.setattr(voice_pipeline, "create_audio_in_filter", lambda _settings: None)
    monkeypatch.setattr(voice_pipeline, "create_stt", lambda *_args: StartingSTT())
    monkeypatch.setattr(voice_pipeline, "create_llm", lambda *_args: Passthrough())
    monkeypatch.setattr(voice_pipeline, "create_tts", lambda *_args: Passthrough())
    monkeypatch.setattr(
        voice_pipeline,
        "user_aggregator_params",
        lambda: LLMUserAggregatorParams(user_turn_strategies=ExternalUserTurnStrategies()),
    )
    workers = []

    def create_worker(pipeline, **kwargs):
        worker = PipelineWorker(pipeline, setup_timeout_secs=0.5, **kwargs)
        workers.append(worker)
        return worker

    monkeypatch.setattr(voice_pipeline, "PipelineWorker", create_worker)
    settings = SimpleNamespace(
        max_concurrent_sessions=6,
        session_max_seconds=10,
        opening_timeout_seconds=10,
        learner_idle_check_in_seconds=20,
        learner_idle_hang_up_seconds=15,
        voice_agent_llm_base_url="https://openrouter.ai/api/v1",
        connection_startup_seconds=0.02 if termination == "watchdog_timeout" else 120,
    )
    registry = SessionRegistry(settings, SimpleNamespace(emit=AsyncMock()))
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
            scenario=SimpleNamespace(firstUtterance="Xin chào.", systemPrompt="", sttTerms=[]),
        )
    )
    await registry.bind_peer(session, "peer")
    ending = None
    attach_worker = registry.attach_worker

    async def attach_and_maybe_end(*args):
        nonlocal ending
        await attach_worker(*args)
        if end_before_runner_starts:
            ending = asyncio.create_task(registry.end(session.registration.sessionId, "user_ended"))

    monkeypatch.setattr(registry, "attach_worker", attach_and_maybe_end)

    async def disconnect():
        await transport.handlers["on_client_disconnected"](transport, connection)

    connection = SimpleNamespace(pc_id="peer", disconnect=AsyncMock(side_effect=disconnect))
    running = asyncio.create_task(voice_pipeline.run_voice_pipeline(connection, session, registry, settings))
    try:
        await asyncio.wait_for(setup_started.wait(), 2)
        if not end_before_runner_starts:
            if termination == "watchdog_timeout":
                ending = running
            elif termination == "browser_close":
                ending = asyncio.create_task(connection.disconnect())
            elif termination == "startup_timeout":
                session.registered_at -= 121
                ending = asyncio.create_task(registry.sweep())
            else:
                ending = asyncio.create_task(registry.end(session.registration.sessionId, "user_ended"))
        async with asyncio.timeout(2):
            while not connection.disconnect.await_count:
                await asyncio.sleep(0.001)
        if termination != "browser_close":
            assert session.state is SessionState.ENDING
            assert not ending.done()
        assert not cleaned.is_set()
        finish_setup.set()
        await asyncio.wait_for(ending, 2)
        await asyncio.wait_for(running, 2)
        assert cleaned.is_set()
        assert workers[0].has_finished()
        assert session.state is (SessionState.FAILED if termination == "browser_close" else SessionState.ENDED)
        assert session.cancel_worker is None
        connection.disconnect.assert_awaited_once()
    finally:
        finish_setup.set()
        await asyncio.wait_for(
            asyncio.gather(running, *([ending] if ending is not None else []), return_exceptions=True), 3
        )
