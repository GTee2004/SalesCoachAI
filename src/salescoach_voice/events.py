from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from .models import VoiceEvent


class EventSequence:
    def __init__(self, session_id: UUID, next_sequence: int = 1) -> None:
        self._session_id = session_id
        self._next = next_sequence

    def next_event(self, event_type: str, payload: dict[str, Any]) -> VoiceEvent:
        """Number the next event. Synchronous, so numbering follows call order."""
        event = VoiceEvent(
            eventId=uuid4(),
            sessionId=self._session_id,
            sequence=self._next,
            type=event_type,
            occurredAt=datetime.now(UTC),
            payload=payload,
        )
        self._next += 1
        return event

    async def create(self, event_type: str, payload: dict[str, Any]) -> VoiceEvent:
        return self.next_event(event_type, payload)
