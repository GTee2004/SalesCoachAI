import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status

from .config import Settings
from .events import EventSequence
from .models import SessionRegistration
from .persistence import EventSink
from .usage import UsageMeter

# Calls run this much longer at most to give back time lost to an outage. The
# web app accepts usage up to the longest session plus this.
MAX_OUTAGE_EXTENSION_SECONDS = 300


class SessionState(StrEnum):
    AWAITING_CONNECTION = "awaiting_connection"
    ACTIVE = "active"
    ENDING = "ending"
    ENDED = "ended"
    FAILED = "failed"


@dataclass
class StoredUtterance:
    id: UUID
    role: str
    text: str
    interrupted: bool = False


@dataclass
class VoiceSession:
    registration: SessionRegistration
    state: SessionState = SessionState.AWAITING_CONNECTION
    events: EventSequence = field(init=False)
    utterances: list[StoredUtterance] = field(default_factory=list)
    peer_id: str | None = None
    cancel_worker: Callable[[], Awaitable[None]] | None = None
    attempt_id: UUID = field(default_factory=uuid4)
    registered_at: float = field(default_factory=lambda: asyncio.get_running_loop().time())
    last_activity: float | None = None
    last_lease: float = 0
    active_started_at: float | None = None
    active_seconds: int = 0
    end_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Latency of the latest user turn, saved with the bot reply it measured.
    pending_latency: dict[str, Any] | None = None
    # What the attempt's STT, LLM and TTS consumed, reported when it ends.
    usage: UsageMeter = field(default_factory=UsageMeter)
    # Time the learner could not practice because the voice service failed.
    # It is not charged; see `billing_outage_seconds`.
    outage_seconds: float = 0.0
    outage_started_at: float | None = None
    # Set when the attempt ended before the buyer's opening line finished, so
    # the learner never got to practice at all.
    practice_never_started: bool = False

    def begin_outage(self, started_at: float) -> None:
        """Start counting dead time, unless an outage is already being counted."""
        if self.outage_started_at is None:
            self.outage_started_at = started_at

    def outage_so_far(self, now: float) -> float:
        """Dead time counted so far, including an outage still running at `now`."""
        running = now - self.outage_started_at if self.outage_started_at is not None else 0.0
        return self.outage_seconds + max(0.0, running)

    def outage_extension(self, now: float) -> float:
        """How much longer the call may run to give back the time lost to outages."""
        return min(self.outage_so_far(now), MAX_OUTAGE_EXTENSION_SECONDS)

    def end_outage(self) -> None:
        if self.outage_started_at is not None:
            elapsed = asyncio.get_running_loop().time() - self.outage_started_at
            self.outage_seconds += max(0.0, elapsed)
            self.outage_started_at = None

    def billing_outage_seconds(self, active_seconds: int) -> int:
        """Seconds of `active_seconds` that are not charged."""
        self.end_outage()
        if self.practice_never_started:
            return active_seconds
        return min(active_seconds, round(self.outage_seconds))

    def __post_init__(self) -> None:
        self.attempt_id = getattr(self.registration, "attemptId", self.attempt_id)
        self.events = EventSequence(self.registration.sessionId, self.registration.nextSequence)


class SessionRegistry:
    def __init__(self, settings: Settings, sink: EventSink) -> None:
        self._settings = settings
        self._sink = sink
        self._sessions: dict[UUID, VoiceSession] = {}
        self._peer_sessions: dict[str, UUID] = {}
        self._lock = asyncio.Lock()

    async def register(self, registration: SessionRegistration) -> VoiceSession:
        if registration.expiresAt <= datetime.now(UTC):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session expired")
        await self.sweep()
        previous = self._sessions.get(registration.sessionId)
        if (
            previous
            and previous.registration.userId == registration.userId
            and (
                previous.cancel_worker is not None
                or previous.state in {SessionState.ACTIVE, SessionState.ENDING}
                or (
                    previous.state is SessionState.AWAITING_CONNECTION
                    and (
                        getattr(registration, "attemptId", previous.attempt_id) != previous.attempt_id
                        or previous.peer_id is not None
                        or previous.registration.ttsProvider != registration.ttsProvider
                        or previous.registration.buyerGender != registration.buyerGender
                        or previous.registration.micType != registration.micType
                    )
                )
            )
        ):
            await self.end(registration.sessionId, "reconnected", expected_session=previous)
        async with self._lock:
            existing = self._sessions.get(registration.sessionId)
            if existing and (
                existing.state in {SessionState.ENDED, SessionState.FAILED}
                or existing.registration.expiresAt <= datetime.now(UTC)
            ):
                self._sessions.pop(registration.sessionId, None)
                existing = None
            if existing:
                if existing.registration.userId != registration.userId:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session conflict")
                return existing
            active = [
                item for item in self._sessions.values() if item.state not in {SessionState.ENDED, SessionState.FAILED}
            ]
            if len(active) >= self._settings.max_concurrent_sessions:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="At capacity")
            if any(item.registration.userId == registration.userId for item in active):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="User already has an active session",
                )
            voice_session = VoiceSession(registration)
            self._sessions[registration.sessionId] = voice_session
            return voice_session

    def active_count(self) -> int:
        """Sessions that hold a capacity slot, as counted when registering."""
        return sum(item.state not in {SessionState.ENDED, SessionState.FAILED} for item in self._sessions.values())

    def is_current(self, voice_session: VoiceSession) -> bool:
        return self._sessions.get(voice_session.registration.sessionId) is voice_session

    def get(self, session_id: UUID) -> VoiceSession:
        voice_session = self._sessions.get(session_id)
        if not voice_session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return voice_session

    def authorize_offer(self, session_id: UUID, user_id: str) -> VoiceSession:
        voice_session = self.get(session_id)
        if voice_session.registration.userId != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wrong session owner")
        if voice_session.registration.expiresAt <= datetime.now(
            UTC
        ) or asyncio.get_running_loop().time() - voice_session.registered_at >= getattr(
            self._settings, "connection_startup_seconds", 120
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Connection expired")
        if voice_session.state is not SessionState.AWAITING_CONNECTION or voice_session.peer_id is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session cannot connect")
        return voice_session

    def authorize_patch(self, peer_id: str, session_id: UUID, user_id: str) -> VoiceSession:
        voice_session = self.get(session_id)
        if voice_session.registration.userId != user_id or self._peer_sessions.get(peer_id) != session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wrong peer session")
        if voice_session.state not in {
            SessionState.AWAITING_CONNECTION,
            SessionState.ACTIVE,
            SessionState.ENDING,
        }:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is not active")
        return voice_session

    async def bind_peer(self, voice_session: VoiceSession, peer_id: str) -> None:
        async with self._lock:
            if (
                not self.is_current(voice_session)
                or voice_session.state is not SessionState.AWAITING_CONNECTION
                or voice_session.peer_id is not None
            ):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session already ended")
            voice_session.peer_id = peer_id
            self._peer_sessions[peer_id] = voice_session.registration.sessionId

    async def attach_worker(
        self,
        voice_session: VoiceSession,
        peer_id: str,
        cancel_worker: Callable[[], Awaitable[None]],
    ) -> None:
        async with self._lock:
            if (
                not self.is_current(voice_session)
                or voice_session.state is not SessionState.AWAITING_CONNECTION
                or voice_session.peer_id != peer_id
                or voice_session.cancel_worker is not None
            ):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session already ended")
            voice_session.peer_id = peer_id
            voice_session.cancel_worker = cancel_worker
            self._peer_sessions[peer_id] = voice_session.registration.sessionId

    async def detach_worker(self, voice_session: VoiceSession, peer_id: str) -> None:
        async with self._lock:
            if voice_session.peer_id == peer_id:
                voice_session.cancel_worker = None
                # A replacement registration may already own the session ID.
                if self.is_current(voice_session):
                    self._peer_sessions.pop(peer_id, None)

    async def mark_active(self, voice_session: VoiceSession) -> None:
        async with self._lock:
            if not self.is_current(voice_session) or voice_session.state is not SessionState.AWAITING_CONNECTION:
                return
            voice_session.state = SessionState.ACTIVE
            voice_session.active_started_at = asyncio.get_running_loop().time()
        await self._emit(voice_session, "session.state", {"status": "active"})

    async def end(
        self,
        session_id: UUID,
        reason: str,
        *,
        evidence_complete: bool = True,
        expected_session: VoiceSession | None = None,
    ) -> None:
        voice_session = self._sessions.get(session_id)
        if voice_session is None or (expected_session is not None and voice_session is not expected_session):
            return
        async with voice_session.end_lock:
            if voice_session.state in {SessionState.ENDED, SessionState.FAILED}:
                # Browser disconnect can report failure before the End request
                # arrives. Its worker still needs to finish releasing resources.
                if voice_session.cancel_worker:
                    try:
                        await voice_session.cancel_worker()
                    finally:
                        voice_session.cancel_worker = None
                return
            voice_session.state = SessionState.ENDING
            cancel = voice_session.cancel_worker
            try:
                if cancel:
                    await cancel()
            finally:
                voice_session.cancel_worker = None
                voice_session.state = SessionState.ENDED
                if voice_session.peer_id:
                    self._peer_sessions.pop(voice_session.peer_id, None)
                voice_session.peer_id = None
            await self._finish_usage(voice_session)
            await self._emit(
                voice_session,
                "session.state",
                {
                    "status": "ended",
                    "reason": reason,
                    "evidenceComplete": evidence_complete,
                    "reconnectSeconds": getattr(self._settings, "connection_reconnect_seconds", 60),
                },
            )

    async def fail(self, session_id: UUID, reason: str, *, expected_session: VoiceSession | None = None) -> None:
        if expected_session is not None and not self.is_current(expected_session):
            return
        voice_session = self.get(session_id)
        if voice_session.state in {SessionState.ENDING, SessionState.ENDED, SessionState.FAILED}:
            return
        voice_session.state = SessionState.FAILED
        if voice_session.peer_id:
            self._peer_sessions.pop(voice_session.peer_id, None)
        await self._finish_usage(voice_session)
        await self._emit(
            voice_session,
            "session.state",
            {
                "status": "failed",
                "reason": reason,
                "evidenceComplete": False,
                "reconnectSeconds": getattr(self._settings, "connection_reconnect_seconds", 60),
            },
        )

    async def emit(self, voice_session: VoiceSession, event_type: str, payload: dict) -> None:
        await self._emit(voice_session, event_type, payload)

    def enqueue(self, voice_session: VoiceSession, event_type: str, payload: dict) -> None:
        """Queue an event behind the session's earlier ones without waiting for delivery."""
        self._sink.enqueue(self._event(voice_session, event_type, payload))

    async def _emit(self, voice_session: VoiceSession, event_type: str, payload: dict) -> None:
        await self._sink.emit(self._event(voice_session, event_type, payload))

    @staticmethod
    def _event(voice_session: VoiceSession, event_type: str, payload: dict):
        event = voice_session.events.next_event(event_type, payload)
        event.attemptId = voice_session.attempt_id
        return event

    async def _finish_usage(self, voice_session: VoiceSession) -> None:
        if voice_session.active_started_at is not None:
            elapsed = asyncio.get_running_loop().time() - voice_session.active_started_at
            voice_session.active_seconds += max(0, int(elapsed))
            voice_session.active_started_at = None
        # A call that lost time to an outage may run past its allowance by that
        # much, so the gross time can exceed maxDurationSeconds; the charged
        # time (active minus outage) cannot.
        outage_seconds = voice_session.billing_outage_seconds(voice_session.active_seconds)
        active_seconds = min(
            voice_session.active_seconds,
            voice_session.registration.maxDurationSeconds + min(outage_seconds, MAX_OUTAGE_EXTENSION_SECONDS),
        )
        await self._emit(
            voice_session,
            "usage.recorded",
            {
                # Gross time; a web app that predates outageSeconds charges all of it.
                "activeSeconds": active_seconds,
                "outageSeconds": min(outage_seconds, active_seconds),
                "services": voice_session.usage.summary(),
            },
        )

    def touch(self, voice_session: VoiceSession, attempt_id: str) -> bool:
        """Only authenticated messages on the current peer renew its lifetime."""
        if (
            not self.is_current(voice_session)
            or str(voice_session.attempt_id) != attempt_id
            or voice_session.state not in {SessionState.ACTIVE, SessionState.AWAITING_CONNECTION}
        ):
            return False
        voice_session.last_activity = asyncio.get_running_loop().time()
        return True

    async def sweep(self) -> None:
        # Snapshot identity is checked again before each action. Never hold the
        # registry lock while waiting for worker/network cleanup.
        now = asyncio.get_running_loop().time()

        async def inspect(item: VoiceSession) -> None:
            if not self.is_current(item):
                return
            if item.state in {SessionState.ENDED, SessionState.FAILED}:
                if item.cancel_worker:
                    await self.end(item.registration.sessionId, "cleanup", expected_session=item)
                if item.registration.expiresAt <= datetime.now(UTC):
                    if self.is_current(item):
                        self._sessions.pop(item.registration.sessionId, None)
                return
            if item.state is SessionState.ENDING:
                return
            elapsed_active = item.active_seconds
            if item.active_started_at is not None:
                elapsed_active += max(0, int(now - item.active_started_at))
            # Time lost to an outage is not charged, so it does not use up the allowance.
            if elapsed_active - item.outage_extension(now) >= item.registration.maxDurationSeconds:
                await self.end(item.registration.sessionId, "credit_limit", expected_session=item)
                return
            if item.last_activity is None:
                expired = now - item.registered_at >= getattr(self._settings, "connection_startup_seconds", 120) or (
                    item.state is SessionState.AWAITING_CONNECTION and item.registration.expiresAt <= datetime.now(UTC)
                )
                reason = "connection_startup_timeout"
            else:
                expired = now - item.last_activity >= getattr(self._settings, "connection_heartbeat_seconds", 30)
                reason = "heartbeat_timeout"
            if expired:
                await self.end(item.registration.sessionId, reason, evidence_complete=False, expected_session=item)
                if item.registration.expiresAt <= datetime.now(UTC) and self.is_current(item):
                    self._sessions.pop(item.registration.sessionId, None)
            elif item.last_activity is not None and now - item.last_lease >= 10:
                item.last_lease = now
                remaining = max(
                    0, getattr(self._settings, "connection_heartbeat_seconds", 30) - (now - item.last_activity)
                )
                await self._emit(
                    item,
                    "session.lease",
                    {
                        "leaseUntil": (datetime.now(UTC) + timedelta(seconds=remaining + 10)).isoformat(),
                        "reconnectSeconds": getattr(self._settings, "connection_reconnect_seconds", 60),
                    },
                )

        results = await asyncio.gather(
            *(inspect(item) for item in list(self._sessions.values())), return_exceptions=True
        )
        for result in results:
            if isinstance(result, BaseException):
                # Propagate after all sessions were inspected; one broken sink
                # must not prevent other workers from being stopped.
                raise result
