from typing import Literal

# Used when the web app sent no line of its own. The web app builds lines that
# address the learner as the buyer would.
CHECK_IN_UTTERANCE = "Alo, còn ở đó không?"
HANG_UP_UTTERANCE = "Cúp máy nhé."
# How long the goodbye may take to play before the call ends without it.
HANG_UP_PLAYBACK_SECONDS = 15.0


class LearnerSilence:
    """What the buyer does each time the learner stays silent after the buyer spoke.

    The first silence gets one check-in, and a silence right after it ends the
    call. Anything the learner says starts this over.
    """

    def __init__(self) -> None:
        self.checked_in = False
        self.hanging_up = False

    def on_silence(self) -> Literal["check_in", "hang_up"] | None:
        if self.hanging_up:
            return None
        if not self.checked_in:
            self.checked_in = True
            return "check_in"
        self.hanging_up = True
        return "hang_up"

    def learner_spoke(self) -> bool:
        """Start over. Returns whether a check-in was waiting for an answer."""
        if self.hanging_up or not self.checked_in:
            return False
        self.checked_in = False
        return True
