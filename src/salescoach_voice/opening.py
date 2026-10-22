from collections.abc import Awaitable, Callable
from typing import Literal

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EagerTranscriptionFrame,
    Frame,
    InputAudioRawFrame,
    InputTextRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    TranscriptionFrame,
    TTSStoppedFrame,
    UserSpeakingFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

OpeningPhase = Literal["opening", "listening", "failed"]

_USER_FRAMES = (
    InputAudioRawFrame,
    InputTextRawFrame,
    InterruptionFrame,
    TranscriptionFrame,
    InterimTranscriptionFrame,
    EagerTranscriptionFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    UserSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)


class OpeningCoordinator:
    def __init__(
        self,
        first_utterance: str,
        on_transition: Callable[[OpeningPhase], Awaitable[None]] | None = None,
    ) -> None:
        self.first_utterance = first_utterance.strip()
        self.phase: OpeningPhase = "opening" if self.first_utterance else "listening"
        self._cutoff = -1
        self._started = False
        self._stopped = False
        self._synthesis_stopped = False
        self._committed = False
        self._releasing = False
        self._bot_speaking = False
        self.on_transition = on_transition

    def admits(self, frame: Frame) -> bool:
        # Frame ids are assigned before a processor queues them, so audio from
        # bot playback stays rejected even if processed after playback stops.
        return self.phase == "listening" and not self._bot_speaking and frame.id > self._cutoff

    async def assistant_committed(self, text: str, *, interrupted: bool = False) -> None:
        if text.strip() and not interrupted:
            self._committed = True
            await self._maybe_release()

    async def playback_started(self) -> None:
        self._bot_speaking = True
        if self.phase == "opening":
            self._started = True
            self._stopped = False

    async def playback_stopped(self) -> None:
        if not self._bot_speaking:
            return
        self._bot_speaking = False
        self._cutoff = Frame().id
        if self.phase == "opening" and self._started:
            self._stopped = True
            await self._maybe_release()

    async def synthesis_stopped(self) -> None:
        self._synthesis_stopped = True
        await self._maybe_release()

    async def fail(self) -> None:
        if self.phase == "opening":
            self.phase = "failed"
            if self.on_transition:
                await self.on_transition(self.phase)

    async def _maybe_release(self) -> None:
        if self.phase != "opening" or self._releasing:
            return
        if self._committed and self._synthesis_stopped and self._started and self._stopped:
            self._releasing = True
            try:
                if self.on_transition:
                    await self.on_transition("listening")
                if self.phase == "opening":
                    self._cutoff = Frame().id
                    self.phase = "listening"
            finally:
                self._releasing = False


class OpeningInputGate(FrameProcessor):
    def __init__(self, opening: OpeningCoordinator) -> None:
        super().__init__()
        self._opening = opening

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if (
            direction is FrameDirection.DOWNSTREAM
            and isinstance(frame, _USER_FRAMES)
            and not self._opening.admits(frame)
        ):
            return
        await self.push_frame(frame, direction)


class PlaybackObserver(FrameProcessor):
    def __init__(
        self,
        opening: OpeningCoordinator,
        on_playback_started: Callable[[], None] | None = None,
        on_playback_stopped: Callable[[], None] | None = None,
    ) -> None:
        super().__init__()
        self._opening = opening
        self._on_playback_started = on_playback_started
        self._on_playback_stopped = on_playback_stopped

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if direction is FrameDirection.DOWNSTREAM:
            if isinstance(frame, BotStartedSpeakingFrame):
                if self._on_playback_started:
                    self._on_playback_started()
                await self._opening.playback_started()
            elif isinstance(frame, BotStoppedSpeakingFrame):
                if self._on_playback_stopped:
                    self._on_playback_stopped()
                await self._opening.playback_stopped()
            elif isinstance(frame, TTSStoppedFrame):
                await self._opening.synthesis_stopped()
        await self.push_frame(frame, direction)
