import asyncio
import json

import pytest
from pipecat.frames.frames import EndFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker, ProcessorUnusablePolicy
from pipecat.workers.runner import WorkerRunner
from websockets.exceptions import ConnectionClosedOK
from websockets.protocol import State

from src.salescoach_voice.config import Settings
from src.salescoach_voice.providers import websocket
from src.salescoach_voice.providers.stt import create_stt, stt_services


class FakeConnection:
    """An open provider socket that stays quiet until closed."""

    def __init__(self) -> None:
        self.state = State.OPEN
        self.sent: list = []
        self._messages: asyncio.Queue = asyncio.Queue()

    async def send(self, message, text=None) -> None:
        self.sent.append(message)
        if isinstance(message, str) and '"Terminate"' in message:
            await self._messages.put(
                json.dumps({"type": "Termination", "audio_duration_seconds": 0, "session_duration_seconds": 0})
            )

    async def close(self) -> None:
        self.state = State.CLOSED
        await self._messages.put(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self._messages.get()
        if message is None:
            raise ConnectionClosedOK(None, None)
        return message


class Provider:
    """Stands in for one provider's websocket endpoint."""

    def __init__(self, *, up: bool) -> None:
        self.up = up
        self.connections: list[FakeConnection] = []
        self.connected = asyncio.Event()

    async def connect(self) -> FakeConnection:
        if not self.up:
            raise TimeoutError("provider unreachable")
        connection = FakeConnection()
        self.connections.append(connection)
        self.connected.set()
        return connection


@pytest.fixture
def providers(monkeypatch):
    monkeypatch.setattr(websocket.random, "uniform", lambda _low, _high: 0)
    monkeypatch.setattr(websocket, "RECONNECT_MIN_WAIT_SECONDS", 0)
    endpoints = {"soniox": Provider(up=True), "assemblyai": Provider(up=True)}

    async def websocket_connect(uri, **_kwargs):
        return await endpoints["soniox" if "soniox" in uri else "assemblyai"].connect()

    monkeypatch.setattr("pipecat.services.websocket_service.websocket_connect", websocket_connect)
    return endpoints


def failover_stt():
    settings = Settings(
        _env_file=None,
        WEB_APP_ORIGIN="http://localhost:4500",
        VOICE_CONTROL_API_KEY="c" * 32,
        VOICE_TOKEN_SECRET="t" * 32,
        VOICE_EVENT_INGEST_URL="http://localhost:4500/api/internal/voice/events",
        VOICE_EVENT_INGEST_KEY="e" * 32,
        VOICE_AGENT_LLM_API_KEY="test-llm-key",
        VOICE_INPUT_PROFILE="soniox_native,assemblyai_native",
        SONIOX_API_KEY="test-soniox-key",
        ASSEMBLYAI_API_KEY="test-assemblyai-key",
    )
    return create_stt(settings)


class RunningPipeline:
    def __init__(self, processor) -> None:
        self.worker = PipelineWorker(Pipeline([processor]), processor_unusable_policy=ProcessorUnusablePolicy.END)
        self.errors: list = []

        @self.worker.event_handler("on_pipeline_error")
        async def on_pipeline_error(_worker, frame) -> None:
            self.errors.append(frame)

    async def __aenter__(self):
        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(self.worker)
        self.running = asyncio.create_task(runner.run())
        self.runner = runner
        return self

    async def __aexit__(self, *_exc) -> None:
        if not self.running.done():
            await self.worker.queue_frames([EndFrame()])
            try:
                await asyncio.wait_for(asyncio.shield(self.running), timeout=5)
            except TimeoutError:
                await self.runner.cancel()
                await self.running


@pytest.mark.asyncio
async def test_backup_stays_unconnected_while_the_primary_works(providers):
    stt = failover_stt()
    soniox, assemblyai = stt_services(stt)

    async with RunningPipeline(stt) as pipeline:
        await asyncio.wait_for(providers["soniox"].connected.wait(), timeout=5)
        await asyncio.sleep(0.05)

        assert stt.strategy.active_service is soniox
        assert providers["assemblyai"].connections == []
        assert assemblyai.standby
        assert pipeline.errors == []


@pytest.mark.asyncio
async def test_backup_takes_over_when_the_primary_cannot_connect_at_call_start(providers):
    providers["soniox"].up = False
    stt = failover_stt()
    soniox, assemblyai = stt_services(stt)

    async with RunningPipeline(stt) as pipeline:
        await asyncio.wait_for(providers["assemblyai"].connected.wait(), timeout=5)

        assert not soniox.is_usable
        assert stt.strategy.active_service is assemblyai
        assert not assemblyai.standby
        assert stt.is_usable
        assert pipeline.errors == []
        assert not pipeline.running.done()


@pytest.mark.asyncio
async def test_backup_takes_over_when_the_primary_gives_up_mid_call(providers):
    stt = failover_stt()
    soniox, assemblyai = stt_services(stt)

    async with RunningPipeline(stt) as pipeline:
        await asyncio.wait_for(providers["soniox"].connected.wait(), timeout=5)
        # What the reconnect loop reports once its attempts run out.
        await soniox.push_error("reconnect attempts exhausted", force_treat_as_permanent=True)
        await asyncio.wait_for(providers["assemblyai"].connected.wait(), timeout=5)

        assert stt.strategy.active_service is assemblyai
        assert pipeline.errors == []
        assert not pipeline.running.done()


@pytest.mark.asyncio
async def test_call_ends_when_every_provider_has_failed(providers):
    providers["soniox"].up = False
    providers["assemblyai"].up = False
    stt = failover_stt()

    async with RunningPipeline(stt) as pipeline:
        await asyncio.wait_for(pipeline.running, timeout=10)

        assert not stt.is_usable
        assert [error.processor for error in pipeline.errors] == [stt]
