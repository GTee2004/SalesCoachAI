from typing import Any, Literal
from uuid import uuid4

from pipecat.frames.frames import (
    Frame,
    InterruptionFrame,
    TranscriptionFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from .opening import OpeningCoordinator
from .sessions import SessionRegistry, StoredUtterance, VoiceSession


class TranscriptPersistenceProcessor(FrameProcessor):
    """Capture one speaker at the appropriate point in the voice pipeline.

    User capture belongs after STT, before the user aggregator consumes its
    transcription frames. Assistant capture belongs after transport output so
    only text associated with playback is saved.

    Turns are queued for delivery rather than awaited, so a slow or failing web
    app never delays or drops the frame on its way to the LLM. The opening line
    is the exception: its delivery decides whether the practice can start.
    """

    def __init__(
        self,
        registry: SessionRegistry,
        voice_session: VoiceSession,
        *,
        role: Literal["user", "assistant"],
        opening: OpeningCoordinator | None = None,
    ) -> None:
        super().__init__()
        self._registry = registry
        self._session = voice_session
        self._role = role
        self._opening = opening if role == "assistant" else None
        self._assistant_words: list[str] = []
        self._assistant_id = None

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if direction is not FrameDirection.DOWNSTREAM:
            await self.push_frame(frame, direction)
            return
        if self._role == "user":
            if isinstance(frame, TranscriptionFrame) and frame.text.strip():
                utterance = StoredUtterance(uuid4(), "user", frame.text.strip())
                self._session.utterances.append(utterance)
                self._persist(utterance)
        elif isinstance(frame, TTSTextFrame):
            self._assistant_id = self._assistant_id or uuid4()
            self._assistant_words.append(frame.text)
        elif isinstance(frame, TTSStoppedFrame):
            await self._commit_assistant(interrupted=False)
        elif isinstance(frame, InterruptionFrame):
            await self._commit_assistant(interrupted=True)
        await self.push_frame(frame, direction)

    async def _commit_assistant(self, *, interrupted: bool) -> None:
        if self._opening and self._opening.phase == "opening":
            return
        if self._opening and self._opening.phase == "failed":
            self._discard_assistant()
            return
        await self._persist_assistant(interrupted=interrupted)

    async def resolve_opening(self, *, completed: bool) -> None:
        if self._opening is None:
            return
        if completed:
            await self._persist_assistant(interrupted=False, wait=True)
        else:
            self._discard_assistant()

    def _discard_assistant(self) -> None:
        self._assistant_words = []
        self._assistant_id = None
        # A latency belongs to the reply it measured, never to a later one.
        self._session.pending_latency = None

    async def _persist_assistant(self, *, interrupted: bool, wait: bool = False) -> None:
        text = " ".join(self._assistant_words).strip()
        if not text or not self._assistant_id:
            self._discard_assistant()
            return
        # Set by the latency observer when this reply started playing. The opener
        # and replies that never played have none.
        latency = getattr(self._session, "pending_latency", None)
        self._session.pending_latency = None
        utterance = StoredUtterance(self._assistant_id, "assistant", text, interrupted)
        self._session.utterances.append(utterance)
        if wait:
            await self._registry.emit(self._session, "transcript.final", self._payload(utterance, latency))
        else:
            self._persist(utterance, latency=latency)
        if interrupted:
            self._registry.enqueue(
                self._session,
                "assistant.interrupted",
                {"utteranceId": str(utterance.id)},
            )
        self._assistant_words = []
        self._assistant_id = None

    def _persist(self, utterance: StoredUtterance, *, latency: dict[str, Any] | None = None) -> None:
        self._registry.enqueue(self._session, "transcript.final", self._payload(utterance, latency))

    @staticmethod
    def _payload(utterance: StoredUtterance, latency: dict[str, Any] | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "utteranceId": str(utterance.id),
            "role": utterance.role,
            "text": utterance.text,
            "interrupted": utterance.interrupted,
            "playbackStatus": "partial" if utterance.interrupted else "completed",
        }
        if latency is not None:
            payload["latency"] = latency
        return payload
