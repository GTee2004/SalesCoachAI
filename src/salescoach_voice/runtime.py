import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Request
from pipecat.transports.smallwebrtc.connection import IceServer
from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCRequestHandler

from .auth import NonceStore
from .config import Settings, TTSProvider, get_settings
from .evaluation import Evaluator
from .models import VoiceEvent
from .persistence import EventSink
from .providers.audio_filter import acquire_aic_model, release_aic_model
from .providers.tts import elevenlabs_refusal
from .sessions import SessionRegistry
from .tracing import init_tracing, shutdown_tracing

logger = logging.getLogger("uvicorn.error.salescoach_voice")


class Runtime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.sink = EventSink(settings)
        self.registry = SessionRegistry(settings, self.sink)
        self.evaluator = Evaluator(settings)
        self.nonces = NonceStore()
        self.webrtc = SmallWebRTCRequestHandler(ice_servers=[IceServer(urls=url) for url in settings.ice_server_urls])
        # Every TTS provider is remote, so there is nothing to warm up. Cleared
        # on shutdown so no new session starts on a closing runtime.
        self.ready = True
        # Why ElevenLabs refused the key or voices at startup, if it did.
        self.elevenlabs_refusal: str | None = None
        self.tasks: set[asyncio.Task] = set()

    def tts_available(self, provider: TTSProvider) -> bool:
        """Whether new sessions can use ``provider``."""
        if provider is TTSProvider.ELEVENLABS and self.elevenlabs_refusal:
            return False
        return self.settings.tts_available(provider)

    async def check_elevenlabs(self) -> None:
        try:
            refusal = await elevenlabs_refusal(self.settings)
        except httpx.HTTPError as error:
            logger.warning("Could not check the ElevenLabs key at startup: %r", error)
            return
        if refusal:
            self.elevenlabs_refusal = refusal
            logger.error(
                "ElevenLabs refused this deployment (%s). New sessions skip ElevenLabs until "
                "ELEVENLABS_API_KEY or the voice IDs are fixed and the backend restarts.",
                refusal,
            )

    async def maintain_sessions(self) -> None:
        while True:
            try:
                await self.registry.sweep()
            except Exception:
                logger.exception("Voice session cleanup failed")
            self.sink.retry_pending()
            try:
                # The database keeps leases across backend restarts. This
                # authenticated tick reconciles leases even with an empty registry.
                await self.sink.send(
                    VoiceEvent(
                        eventId=uuid4(),
                        sessionId=UUID(int=0),
                        sequence=1,
                        type="session.reconcile",
                        occurredAt=datetime.now(UTC),
                        payload={},
                    )
                )
            except Exception:
                logger.exception("Voice lease reconciliation unavailable")
            await asyncio.sleep(5)

    async def close(self) -> None:
        self.ready = False
        await self.webrtc.close()
        for task in self.tasks:
            task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.sink.close()


@asynccontextmanager
async def voice_lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    init_tracing(settings)
    current = Runtime(settings)
    try:
        aic_model_key = await acquire_aic_model(settings)
    except Exception:
        # Each session's filter retries the download when it starts.
        logger.exception("ai-coustics Voice Focus model unavailable at startup")
        aic_model_key = None
    app.state.salescoach_voice = current
    maintenance = asyncio.create_task(current.maintain_sessions(), name="voice-session-maintenance")
    current.tasks.add(maintenance)
    maintenance.add_done_callback(current.tasks.discard)
    maintenance.add_done_callback(observe_task_failure)
    elevenlabs_check = asyncio.create_task(current.check_elevenlabs(), name="elevenlabs-check")
    current.tasks.add(elevenlabs_check)
    elevenlabs_check.add_done_callback(current.tasks.discard)
    elevenlabs_check.add_done_callback(observe_task_failure)
    try:
        yield
    finally:
        try:
            await current.close()
        finally:
            release_aic_model(aic_model_key)
            # Flush buffered spans (blocking network call) without stalling the loop.
            await asyncio.to_thread(shutdown_tracing)


def get_runtime(request: Request) -> Runtime:
    return request.app.state.salescoach_voice


def observe_task_failure(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    task.exception()
