# ruff: noqa: N815
# Field names are the shared JSON wire contract.
from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from .config import TTSProvider


class Scenario(BaseModel):
    systemPrompt: str
    firstUtterance: str = ""
    # Spoken when the buyer's reply failed, so the learner knows to repeat.
    repairUtterance: str = ""
    # Spoken when the learner stays silent after the buyer spoke, then before
    # the buyer hangs up on that silence.
    checkInUtterance: str = ""
    hangUpUtterance: str = ""
    # Names the learner is likely to say (project, developer, district) for
    # biasing speech recognition. The STT factory trims to provider limits.
    sttTerms: list[str] = Field(default_factory=list, max_length=100)


MicType = Literal["worn", "built_in"]


class SessionRegistration(BaseModel):
    sessionId: UUID
    attemptId: UUID = Field(default_factory=uuid4)
    userId: str = Field(min_length=1, max_length=256)
    ttsProvider: TTSProvider
    # Tried in order when ttsProvider is not configured. Registration resolves
    # them into ttsProvider, so a registered session never carries fallbacks.
    ttsFallbacks: list[TTSProvider] = Field(default_factory=list, max_length=len(TTSProvider))
    buyerGender: Literal["male", "female"]
    micType: MicType | None = None
    expiresAt: datetime
    scenario: Scenario
    nextSequence: int = Field(default=1, gt=0)
    maxDurationSeconds: int = Field(default=900, gt=0, le=900)


class EndSessionRequest(BaseModel):
    reason: str = Field(default="user_ended", min_length=1, max_length=128)


class EvaluationRequest(BaseModel):
    practice: dict[str, Any]
    agentConfig: dict[str, Any]
    competencies: list[dict[str, Any]]
    turns: list[dict[str, Any]]


class VoiceEvent(BaseModel):
    schemaVersion: Literal[1] = 1
    eventId: UUID
    sessionId: UUID
    attemptId: UUID | None = None
    sequence: int = Field(gt=0)
    type: Literal[
        "session.state",
        "session.lease",
        "session.reconcile",
        "transcript.final",
        "assistant.interrupted",
        "session.error",
        "usage.recorded",
    ]
    occurredAt: datetime
    payload: dict[str, Any]
