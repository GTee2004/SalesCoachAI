import json
import logging

import httpx
from pipecat.pipeline.service_switcher import ServiceSwitcher, ServiceSwitcherStrategyFailover
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.elevenlabs.dialogue.tts import ElevenLabsDialogueTTSService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.elevenlabs.tts_base import ELEVENLABS_MODEL_LANGUAGES, ELEVENLABS_V3_LANGUAGES
from pipecat.services.soniox.tts import SonioxTTSService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language

from ..config import Settings, TTSProvider
from ..usage import llm_provider
from .gemini import GeminiTTSService
from .openrouter_tts import OpenRouterTTSService
from .soniox import AuthenticatedSonioxTTSService
from .websocket import FirstConnectRequired, ResilientWebsocket

logger = logging.getLogger("uvicorn.error.salescoach_voice")

# Pipecat 1.12's list of models that take a language code predates V4, so it
# connects V4 without one and warns. V4 accepts and validates it (checked live:
# "vi" speaks, "xx" is refused with unsupported_language). V4 covers at least
# V3's languages, which include Vietnamese.
for _model in ("eleven_v4", "eleven_v4_turbo"):
    ELEVENLABS_MODEL_LANGUAGES.setdefault(_model, ELEVENLABS_V3_LANGUAGES)

# ElevenLabs models OpenRouter also serves, under its own names. OpenRouter hands
# them to ElevenLabs, so the same voice ID keeps the buyer's voice.
OPENROUTER_ELEVENLABS_MODELS = {
    "eleven_v4": "elevenlabs/eleven-v4",
    "eleven_v4_turbo": "elevenlabs/eleven-v4-turbo",
    "eleven_v3": "elevenlabs/eleven-v3",
    "eleven_v3_conversational": "elevenlabs/eleven-v3-conversational",
    "eleven_multilingual_v2": "elevenlabs/eleven-multilingual-v2",
    "eleven_flash_v2_5": "elevenlabs/eleven-flash-v2.5",
    "eleven_flash_v2": "elevenlabs/eleven-flash-v2",
    "eleven_turbo_v2_5": "elevenlabs/eleven-turbo-v2.5",
    "eleven_turbo_v2": "elevenlabs/eleven-turbo-v2",
}
# OpenRouter sends a sentence's audio only once all of it is ready: a few
# seconds for a long sentence, and now and then far longer.
OPENROUTER_ELEVENLABS_TIMEOUT_SECONDS = 15.0


# Errors ElevenLabs sends on an open socket that reconnecting won't fix, from
# https://elevenlabs.io/docs/eleven-api/resources/errors. It closes the socket
# after each, but the next handshake succeeds again.
ELEVENLABS_PERMANENT_ERRORS = frozenset(
    {
        "invalid_api_key",
        "missing_api_key",
        "invalid_authorization_header",
        "unauthorized",
        "forbidden",
        "insufficient_permissions",
        "workspace_access_denied",
        "feature_not_available",
        "subscription_required",
        "voice_access_denied",
        "model_access_denied",
        "insufficient_credits",
        "quota_exceeded",
        "voice_not_found",
        "model_not_found",
    }
)


ELEVENLABS_API_URL = "https://api.elevenlabs.io"
ELEVENLABS_CHECK_TIMEOUT_SECONDS = 10.0


async def elevenlabs_refusal(settings: Settings) -> str | None:
    """Why ElevenLabs refuses this deployment's key or voices, or None if it doesn't.

    Checked at startup, so a wrong key or voice ID turns ElevenLabs sessions
    away instead of being hidden by the OpenRouter fallback in every call. A
    key restricted to text to speech can't read voices; that, and every other
    answer, is left to the calls. Raises ``httpx.HTTPError`` when ElevenLabs
    can't be reached.
    """
    if not settings.elevenlabs_tts_available:
        return None
    async with httpx.AsyncClient(
        base_url=ELEVENLABS_API_URL,
        headers={"xi-api-key": settings.elevenlabs_api_key.get_secret_value()},  # type: ignore[union-attr]
        timeout=ELEVENLABS_CHECK_TIMEOUT_SECONDS,
    ) as client:
        for voice in dict.fromkeys((settings.elevenlabs_tts_voice_female, settings.elevenlabs_tts_voice_male)):
            response = await client.get(f"/v1/voices/{voice}")
            if response.is_success:
                continue
            try:
                detail = response.json().get("detail")
            except (ValueError, AttributeError):
                continue
            if not isinstance(detail, dict):
                continue
            if detail.get("type") == "authentication_error":
                return f"{detail.get('code') or 'authentication_error'}: {detail.get('message', '')}"
            if detail.get("code") == "voice_not_found":
                return f"voice_not_found: {voice}"
    return None


class _WatchedSocket:
    """A provider socket whose received messages are shown to ``on_message`` first."""

    def __init__(self, websocket, on_message) -> None:
        self._websocket = websocket
        self._on_message = on_message

    def __getattr__(self, name):
        return getattr(self._websocket, name)

    async def __aiter__(self):
        async for message in self._websocket:
            await self._on_message(message)
            yield message


class ElevenLabsPermanentErrors:
    """Mixin that marks an ElevenLabs service unusable on an error it can't recover from.

    Pipecat reports these as passing errors, or not at all, and reconnects
    after each, so a backup would never take over.
    """

    def _get_websocket(self):
        return _WatchedSocket(super()._get_websocket(), self._check_message)

    async def _check_message(self, message) -> None:
        try:
            msg = json.loads(message)
        except (TypeError, ValueError):
            return
        if isinstance(msg, dict) and msg.get("error") in ELEVENLABS_PERMANENT_ERRORS and self.is_usable:
            await self.push_error(
                f"ElevenLabs refused the session ({msg['error']}): {msg.get('message', '')}",
                force_treat_as_permanent=True,
            )


class ResilientElevenLabsTTSService(
    ElevenLabsPermanentErrors, FirstConnectRequired, ResilientWebsocket, ElevenLabsTTSService
):
    pass


class ResilientElevenLabsDialogueTTSService(
    ElevenLabsPermanentErrors, FirstConnectRequired, ResilientWebsocket, ElevenLabsDialogueTTSService
):
    pass


def tts_services(tts: FrameProcessor) -> list[FrameProcessor]:
    """The speech services behind what ``create_tts`` returned."""
    return list(tts.services) if isinstance(tts, ServiceSwitcher) else [tts]


def tts_provider(service: FrameProcessor, settings: Settings) -> str:
    """Who bills the speech made by ``service``."""
    if isinstance(service, GeminiTTSService):
        return "gemini"
    if isinstance(service, OpenRouterTTSService):
        return llm_provider(settings.voice_agent_llm_base_url)
    if isinstance(service, ElevenLabsTTSService | ElevenLabsDialogueTTSService):
        return "elevenlabs"
    return "soniox"


def create_tts(settings: Settings, provider: TTSProvider, gender: str) -> TTSService | ServiceSwitcher:
    if gender not in {"male", "female"}:
        raise ValueError(f"Unsupported agent gender: {gender}")
    if provider is TTSProvider.GEMINI:
        if not settings.voice_agent_llm_api_key:
            raise RuntimeError("VOICE_AGENT_LLM_API_KEY is required for Gemini TTS")
        return GeminiTTSService(
            api_key=settings.voice_agent_llm_api_key.get_secret_value(),
            base_url=settings.voice_agent_llm_base_url,
            voice=(settings.gemini_tts_voice_male if gender == "male" else settings.gemini_tts_voice_female),
            aggregation_mode=settings.gemini_tts_aggregation_mode,
        )
    if provider is TTSProvider.ELEVENLABS:
        voice = settings.elevenlabs_tts_voice_male if gender == "male" else settings.elevenlabs_tts_voice_female
        if not settings.elevenlabs_api_key:
            raise RuntimeError("ELEVENLABS_API_KEY is required for ElevenLabs TTS")
        if not voice:
            raise RuntimeError(f"ELEVENLABS_TTS_VOICE_{gender.upper()} is required for ElevenLabs TTS")
        service = (
            ResilientElevenLabsDialogueTTSService
            if settings.elevenlabs_tts_model
            in {"eleven_v3", "eleven_v3_conversational", "eleven_v4", "eleven_v4_turbo"}
            else ResilientElevenLabsTTSService
        )
        elevenlabs = service(
            api_key=settings.elevenlabs_api_key.get_secret_value(),
            settings=service.Settings(
                model=settings.elevenlabs_tts_model,
                voice=voice,
                language=Language.VI,
            ),
        )
        fallback = _create_openrouter_elevenlabs(settings, voice)
        if fallback is None:
            return elevenlabs
        return _failover(elevenlabs, fallback)
    if not settings.soniox_api_key:
        raise RuntimeError("SONIOX_API_KEY is required for Soniox TTS")
    return AuthenticatedSonioxTTSService(
        api_key=settings.soniox_api_key.get_secret_value(),
        url=settings.soniox_tts_url,
        settings=SonioxTTSService.Settings(
            model=settings.soniox_tts_model,
            voice=(settings.soniox_tts_voice_male if gender == "male" else settings.soniox_tts_voice_female),
            language=Language.VI,
        ),
    )


def _create_openrouter_elevenlabs(settings: Settings, voice: str) -> OpenRouterTTSService | None:
    """The same ElevenLabs model and voice through OpenRouter, when it serves them."""
    model = OPENROUTER_ELEVENLABS_MODELS.get(settings.elevenlabs_tts_model)
    if (
        not settings.elevenlabs_tts_openrouter_fallback
        or model is None
        or llm_provider(settings.voice_agent_llm_base_url) != "openrouter"
        or not settings.voice_agent_llm_api_key
    ):
        return None
    return OpenRouterTTSService(
        api_key=settings.voice_agent_llm_api_key.get_secret_value(),
        base_url=settings.voice_agent_llm_base_url,
        model=model,
        voice=voice,
        request_timeout_seconds=OPENROUTER_ELEVENLABS_TIMEOUT_SECONDS,
        label="ElevenLabs TTS via OpenRouter",
        # Undocumented, but OpenRouter hands it to ElevenLabs: it rejects a
        # code the model doesn't support. Matches the WebSocket's language.
        provider_options={"elevenlabs": {"language_code": "vi"}},
    )


def _failover(primary: TTSService, backup: TTSService) -> ServiceSwitcher:
    """Speak through ``backup`` once ``primary`` can no longer speak."""
    switcher = ServiceSwitcher(services=[primary, backup], strategy_type=ServiceSwitcherStrategyFailover)

    @switcher.strategy.event_handler("on_service_switched")
    async def on_service_switched(_strategy, service: TTSService) -> None:
        logger.warning("Speech synthesis switched to %s", service)

    return switcher
