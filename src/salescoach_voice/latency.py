import logging
from collections import defaultdict
from typing import Any

from pipecat.observers.user_bot_latency_observer import (
    LatencyBreakdown,
    MeasuredFrom,
    UserBotLatencyObserver,
)

from .sessions import VoiceSession

logger = logging.getLogger("uvicorn.error")
SLOW_TURN_THRESHOLD_MS = 2000


def turn_latency(breakdown: LatencyBreakdown) -> dict[str, Any]:
    """Per-turn latency as saved with the bot's reply: the total and each stage in ms.

    Stage keys are pipecat's stable contribution keys; their durations sum to the total.
    """
    stages_ms: defaultdict[str, float] = defaultdict(float)
    for contribution in breakdown.contributions:
        stages_ms[contribution.key] += contribution.duration_secs * 1_000
    return {
        "totalMs": round(breakdown.total_secs * 1_000),
        "stages": {key: round(duration_ms) for key, duration_ms in stages_ms.items()},
    }


def create_latency_observer(voice_session: VoiceSession) -> UserBotLatencyObserver:
    """Log one stage-by-stage latency summary for every completed user turn.

    The summary is also kept on the session until the reply it measured is persisted,
    so the admin dashboard can aggregate latency from the transcript.
    """
    session_id = voice_session.registration.sessionId
    observer = UserBotLatencyObserver()

    @observer.event_handler("on_latency_breakdown")
    async def on_latency_breakdown(
        _observer: UserBotLatencyObserver,
        breakdown: LatencyBreakdown,
    ) -> None:
        if breakdown.measured_from is not MeasuredFrom.USER_SILENCE:
            return

        latency = turn_latency(breakdown)
        voice_session.pending_latency = latency
        total_ms = breakdown.total_secs * 1_000
        ordered_stages = " ".join(
            f"{name}_ms={duration_ms}"
            for name, duration_ms in sorted(latency["stages"].items(), key=lambda item: item[1], reverse=True)
        )
        logger.info(
            "voice_turn_latency session_id=%s total_ms=%.0f slow=%s threshold_ms=%d %s",
            session_id,
            total_ms,
            str(total_ms > SLOW_TURN_THRESHOLD_MS).lower(),
            SLOW_TURN_THRESHOLD_MS,
            ordered_stages,
        )

    return observer
