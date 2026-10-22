import pipecat.processors.frameworks.rtvi.models as rtvi
from pipecat import version as pipecat_version
from pipecat.processors.frameworks.rtvi import RTVIProcessor
from pydantic import BaseModel

from .opening import OpeningCoordinator


class ClientRTVIProcessor(RTVIProcessor):
    """Keep internal error diagnostics out of client transport messages."""

    def __init__(self, opening: OpeningCoordinator | None = None) -> None:
        super().__init__()
        self._opening = opening

    async def set_bot_ready(self, about=None) -> None:
        if self._opening:
            about = {
                **(about or {"library": "pipecat-ai", "library_version": pipecat_version()}),
                "voiceInputState": self._opening.phase,
            }
        await super().set_bot_ready(about)

    async def push_transport_message(self, model: BaseModel, exclude_none: bool = True):
        if isinstance(model, rtvi.Error):
            model = model.model_copy(
                update={
                    "data": rtvi.ErrorData(
                        error="voice_session_failed" if model.data.fatal else "voice_service_unavailable",
                        fatal=model.data.fatal,
                    )
                }
            )
        elif isinstance(model, rtvi.ErrorResponse):
            model = model.model_copy(update={"data": rtvi.ErrorResponseData(error="voice_service_unavailable")})
        await super().push_transport_message(model, exclude_none)
