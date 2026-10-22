import asyncio
import logging
import random
from collections import deque
from dataclasses import dataclass, field
from uuid import UUID

import httpx

from .config import Settings
from .models import VoiceEvent

logger = logging.getLogger("uvicorn.error.salescoach_voice")

DELIVERY_ATTEMPTS = 3
# Statuses worth repeating within one delivery.
RETRYABLE_STATUSES = frozenset({408, 425, 429})
# Statuses that reject the event itself. Repeating it can only block the
# events queued behind it. Others, such as 401, say the sink is misconfigured
# and keep the event queued instead.
REJECTED_STATUSES = frozenset({400, 404, 409, 413, 422})


def retryable_status(status_code: int) -> bool:
    return status_code in RETRYABLE_STATUSES or status_code >= 500


@dataclass
class _Outbox:
    """One session's undelivered events, kept in sequence order."""

    pending: deque[VoiceEvent] = field(default_factory=deque)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task | None = None


class EventSink:
    """Delivers voice events to the web app, in order within each session.

    Sessions never wait on each other's deliveries. An event the web app
    rejects is logged and dropped so it cannot block its session; one that
    could not be delivered stays queued and is retried before newer events.
    """

    def __init__(self, settings: Settings) -> None:
        self._url = settings.voice_event_ingest_url
        self._key = settings.voice_event_ingest_key.get_secret_value()
        self._client = httpx.AsyncClient(timeout=5)
        self._outboxes: dict[UUID, _Outbox] = {}
        self.rejected: deque[VoiceEvent] = deque(maxlen=100)

    async def emit(self, event: VoiceEvent) -> None:
        """Deliver `event` and everything queued before it for its session.

        Raises when ingestion stays unavailable; the events remain queued.
        """
        outbox = self._outbox(event.sessionId)
        outbox.pending.append(event)
        async with outbox.lock:
            await self._flush_locked(event.sessionId, outbox)

    async def send(self, event: VoiceEvent) -> None:
        """Deliver an event that is worthless once stale. Never queued."""
        await self._deliver(event)

    def enqueue(self, event: VoiceEvent) -> None:
        """Queue `event` and deliver it in the background, without waiting."""
        outbox = self._outbox(event.sessionId)
        outbox.pending.append(event)
        self._schedule(event.sessionId, outbox)

    def retry_pending(self) -> None:
        """Retry sessions whose events are waiting after an ingestion outage."""
        for session_id, outbox in list(self._outboxes.items()):
            if outbox.pending:
                self._schedule(session_id, outbox)

    def _outbox(self, session_id: UUID) -> _Outbox:
        return self._outboxes.setdefault(session_id, _Outbox())

    def _schedule(self, session_id: UUID, outbox: _Outbox) -> None:
        if outbox.task is None or outbox.task.done():
            outbox.task = asyncio.create_task(
                self._flush_in_background(session_id, outbox), name=f"voice-events-{session_id}"
            )

    async def _flush_in_background(self, session_id: UUID, outbox: _Outbox) -> None:
        try:
            async with outbox.lock:
                await self._flush_locked(session_id, outbox)
        except RuntimeError:
            logger.warning(
                "Voice events queued until ingestion recovers session_id=%s pending=%d",
                session_id,
                len(outbox.pending),
            )

    async def _flush_locked(self, session_id: UUID, outbox: _Outbox) -> None:
        while outbox.pending:
            await self._deliver(outbox.pending[0])
            outbox.pending.popleft()
        if self._outboxes.get(session_id) is outbox:
            del self._outboxes[session_id]

    async def _deliver(self, event: VoiceEvent) -> None:
        """Deliver one event, or reject it. Raises if ingestion is unavailable."""
        for attempt in range(DELIVERY_ATTEMPTS):
            if attempt:
                await asyncio.sleep(0.2 * 2**attempt * random.uniform(0.5, 1.0))
            try:
                response = await self._client.post(
                    self._url,
                    headers={"authorization": f"Bearer {self._key}"},
                    content=event.model_dump_json(),
                )
            except httpx.TransportError:
                continue
            if response.is_success:
                return
            if retryable_status(response.status_code):
                continue
            if response.status_code in REJECTED_STATUSES:
                self.rejected.append(event)
                logger.error(
                    "Voice event rejected session_id=%s sequence=%s type=%s status=%s",
                    event.sessionId,
                    event.sequence,
                    event.type,
                    response.status_code,
                )
                return
            break
        raise RuntimeError("Durable event ingestion is unavailable")

    async def close(self) -> None:
        tasks = [outbox.task for outbox in self._outboxes.values() if outbox.task and not outbox.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self._client.aclose()
