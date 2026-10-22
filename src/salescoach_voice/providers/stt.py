import logging
from collections.abc import Sequence
from typing import Literal

from pipecat.pipeline.service_switcher import ServiceSwitcher, ServiceSwitcherStrategyFailover
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.assemblyai.stt import AssemblyAISTTService
from pipecat.services.soniox.stt import SonioxSTTService
from pipecat.services.stt_service import STTService
from pipecat.transcriptions.language import Language

from ..config import Settings, VoiceFocusMode, VoiceInputProfile
from ..models import MicType
from .soniox import AuthenticatedSonioxSTTService
from .websocket import FirstConnectRequired, ResilientWebsocket

logger = logging.getLogger("uvicorn.error.salescoach_voice")


class SwitchableSTT(FirstConnectRequired):
    """Mixin for the STT services; list it ahead of ``ResilientWebsocket``.

    A service on standby opens no connection until ``take_over`` is called, so
    a backup costs nothing on calls that never need it.
    """

    def __init__(self, *args, standby: bool = False, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.standby = standby

    async def take_over(self) -> None:
        """Connect a service that was on standby."""
        if not self.standby:
            return
        self.standby = False
        await self._connect()

    async def _connect(self) -> None:
        if not self.standby:
            await super()._connect()


class ResilientAssemblyAISTTService(SwitchableSTT, ResilientWebsocket, AssemblyAISTTService):
    pass


class ResilientSonioxSTTService(SwitchableSTT, AuthenticatedSonioxSTTService):
    pass


# Vocabulary every practice shares; scenarios add their own names on top.
_DOMAIN_TERMS = ("căn hộ", "3,2 tỷ", "2,5 tỷ", "trả góp", "lãi suất")
# AssemblyAI streaming key-term limits; Soniox accepts more but gains little.
_MAX_TERMS = 100
_MAX_TERM_CHARS = 50

_VOICE_FOCUS_BY_MIC_TYPE: dict[MicType, Literal["near-field", "far-field"]] = {
    "worn": "near-field",
    "built_in": "far-field",
}


def mic_type_selectable(settings: Settings) -> bool:
    """Whether the learner's mic type changes transcription for this deployment.

    AssemblyAI uses it even as a backup, since a call may end up there.
    """
    return (
        VoiceInputProfile.ASSEMBLYAI_NATIVE in settings.voice_input_profiles
        and settings.assemblyai_voice_focus is VoiceFocusMode.AUTO
    )


def assemblyai_voice_focus(settings: Settings, mic_type: MicType | None) -> dict:
    """Voice Focus connection settings, or none when it should stay off.

    Sessions registered without a mic type keep Voice Focus off under AUTO.
    """
    mode = settings.assemblyai_voice_focus
    if mode is VoiceFocusMode.OFF:
        return {}
    if mode is VoiceFocusMode.AUTO:
        if mic_type is None:
            return {}
        variant = _VOICE_FOCUS_BY_MIC_TYPE[mic_type]
    else:
        variant = mode.value
    focus: dict = {"voice_focus": variant}
    if settings.assemblyai_voice_focus_threshold is not None:
        focus["voice_focus_threshold"] = settings.assemblyai_voice_focus_threshold
    return focus


def stt_services(stt: FrameProcessor) -> list[FrameProcessor]:
    """The transcription services behind what ``create_stt`` returned."""
    return list(stt.services) if isinstance(stt, ServiceSwitcher) else [stt]


def stt_provider(service: FrameProcessor) -> str:
    """Who bills the transcription done by ``service``."""
    return "assemblyai" if isinstance(service, AssemblyAISTTService) else "soniox"


def transcription_terms(scenario_terms: Sequence[str] = ()) -> list[str]:
    """Shared domain vocabulary plus the scenario's names, without duplicates.

    Learners pronounce English project names with a Vietnamese accent; biasing
    the recognizer toward the exact spelling keeps those names intact.
    """
    terms = (term.strip() for term in (*_DOMAIN_TERMS, *scenario_terms))
    return list(dict.fromkeys(term for term in terms if 0 < len(term) <= _MAX_TERM_CHARS))[:_MAX_TERMS]


def create_stt(
    settings: Settings,
    mic_type: MicType | None = None,
    scenario_terms: Sequence[str] = (),
) -> STTService | ServiceSwitcher:
    """The call's transcription: one service, or several that fail over in order.

    Backups stay on standby, unconnected, until the services ahead of them fail.
    """
    terms = transcription_terms(scenario_terms)
    services = [
        _create_profile_stt(settings, profile, mic_type, terms, standby=index > 0)
        for index, profile in enumerate(settings.voice_input_profiles)
    ]
    if len(services) == 1:
        return services[0]

    switcher = ServiceSwitcher(services=services, strategy_type=ServiceSwitcherStrategyFailover)

    @switcher.strategy.event_handler("on_service_switched")
    async def on_service_switched(_strategy, service: SwitchableSTT) -> None:
        logger.warning("Speech recognition switched to %s", service)
        # Connect in the background: this runs inside the failed service's
        # error report, which shouldn't wait out the connect retries.
        service.create_task(service.take_over(), name="take_over")

    return switcher


def _create_profile_stt(
    settings: Settings,
    profile: VoiceInputProfile,
    mic_type: MicType | None,
    terms: list[str],
    *,
    standby: bool,
) -> STTService:
    if profile is VoiceInputProfile.ASSEMBLYAI_NATIVE:
        return ResilientAssemblyAISTTService(
            api_key=settings.assemblyai_api_key.get_secret_value(),  # type: ignore[union-attr]
            vad_force_turn_endpoint=False,
            standby=standby,
            settings=AssemblyAISTTService.Settings(
                model="universal-3-6-pro",
                language_codes=[Language.VI],
                min_turn_silence=128,
                max_turn_silence=640,
                keyterms_prompt=terms,
                **assemblyai_voice_focus(settings, mic_type),
            ),
        )
    return ResilientSonioxSTTService(
        api_key=settings.soniox_api_key.get_secret_value(),  # type: ignore[union-attr]
        url=settings.soniox_stt_url,
        vad_force_turn_endpoint=False,
        standby=standby,
        settings=SonioxSTTService.Settings(
            model=settings.soniox_model,
            language_hints=[Language.VI],
            language_hints_strict=True,
            context={"terms": terms},
        ),
    )
