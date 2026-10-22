from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Self
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class VoiceInputProfile(StrEnum):
    """A transcription provider, with the provider deciding when the learner's turn ends."""

    SONIOX_NATIVE = "soniox_native"
    ASSEMBLYAI_NATIVE = "assemblyai_native"


class VoiceFocusMode(StrEnum):
    # AUTO follows the learner's mic type; OFF and the fixed variants override it.
    AUTO = "auto"
    OFF = "off"
    NEAR_FIELD = "near-field"
    FAR_FIELD = "far-field"


class TTSProvider(StrEnum):
    SONIOX = "soniox"
    GEMINI = "gemini"
    ELEVENLABS = "elevenlabs"


class GeminiTtsAggregationMode(StrEnum):
    FULL_REPLY = "full_reply"
    SENTENCE = "sentence"


class SonioxRegion(StrEnum):
    US = "us"
    EU = "eu"
    JP = "jp"
    IN = "in"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    web_app_origin: str = Field(alias="WEB_APP_ORIGIN")
    voice_control_api_key: SecretStr = Field(alias="VOICE_CONTROL_API_KEY", min_length=32)
    voice_token_secret: SecretStr = Field(alias="VOICE_TOKEN_SECRET", min_length=32)
    voice_event_ingest_url: str = Field(alias="VOICE_EVENT_INGEST_URL")
    voice_event_ingest_key: SecretStr = Field(alias="VOICE_EVENT_INGEST_KEY", min_length=32)

    # Comma-separated, in order of preference. Each later profile takes over
    # only when the one before can no longer transcribe.
    voice_input_profiles: Annotated[list[VoiceInputProfile], NoDecode] = Field(
        default=[VoiceInputProfile.SONIOX_NATIVE], alias="VOICE_INPUT_PROFILE", min_length=1
    )
    soniox_api_key: SecretStr | None = Field(default=None, alias="SONIOX_API_KEY")
    soniox_region: SonioxRegion = Field(default=SonioxRegion.JP, alias="SONIOX_REGION")
    soniox_model: str = Field(default="stt-rt-v5", alias="SONIOX_MODEL")
    assemblyai_api_key: SecretStr | None = Field(default=None, alias="ASSEMBLYAI_API_KEY")
    assemblyai_voice_focus: VoiceFocusMode = Field(default=VoiceFocusMode.OFF, alias="ASSEMBLYAI_VOICE_FOCUS")
    assemblyai_voice_focus_threshold: float | None = Field(
        default=None, ge=0, le=1, alias="ASSEMBLYAI_VOICE_FOCUS_THRESHOLD"
    )
    # ai-coustics Voice Focus isolates the learner's voice from background noise
    # and other speakers before STT, for every input profile.
    aic_voice_focus_enabled: bool = Field(default=False, alias="AIC_VOICE_FOCUS_ENABLED")
    aic_license_key: SecretStr | None = Field(default=None, alias="AIC_LICENSE_KEY")
    aic_model_id: str = Field(default="quail-vf-2.2-l-16khz", alias="AIC_MODEL_ID")
    aic_enhancement_level: float | None = Field(default=None, ge=0, le=1, alias="AIC_ENHANCEMENT_LEVEL")

    voice_agent_llm_api_key: SecretStr | None = Field(default=None, alias="VOICE_AGENT_LLM_API_KEY")
    voice_agent_llm_base_url: str = Field(default="https://openrouter.ai/api/v1", alias="VOICE_AGENT_LLM_BASE_URL")
    voice_agent_llm_model: str = Field(default="openai/gpt-6-luna", alias="VOICE_AGENT_LLM_MODEL")
    # Answers a buyer reply the primary model left without text past the first-token
    # deadline. Pick one from another upstream vendor that answers without reasoning;
    # unset, the primary model is asked again.
    voice_agent_llm_fallback_model: str | None = Field(default=None, alias="VOICE_AGENT_LLM_FALLBACK_MODEL")
    # A buyer reply with no text after this long is re-issued once, then reported.
    voice_agent_llm_first_token_seconds: float = Field(
        default=5, gt=0, le=30, alias="VOICE_AGENT_LLM_FIRST_TOKEN_SECONDS"
    )
    # Spoken buyer replies are a few sentences. The cap stops a runaway reply
    # from talking for minutes; reasoning models spend part of it thinking.
    voice_agent_llm_max_tokens: int = Field(default=400, ge=50, le=4000, alias="VOICE_AGENT_LLM_MAX_TOKENS")
    voice_evaluation_llm_model: str | None = Field(default="openai/gpt-6-luna", alias="VOICE_EVALUATION_LLM_MODEL")
    voice_evaluation_llm_timeout_seconds: float = Field(default=20, alias="VOICE_EVALUATION_LLM_TIMEOUT_SECONDS")

    enable_tracing: bool = Field(default=False, alias="ENABLE_TRACING")
    langfuse_public_key: str | None = Field(default=None, alias="LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key: SecretStr | None = Field(default=None, alias="LANGFUSE_SECRET_KEY")
    langfuse_base_url: str = Field(default="https://cloud.langfuse.com", alias="LANGFUSE_BASE_URL")

    soniox_tts_model: str = Field(default="tts-rt-v2", alias="SONIOX_TTS_MODEL")
    soniox_tts_voice_female: str = Field(default="Huong", alias="SONIOX_TTS_VOICE_FEMALE")
    soniox_tts_voice_male: str = Field(default="Bernardo", alias="SONIOX_TTS_VOICE_MALE")
    gemini_tts_voice_female: str = Field(default="Kore", alias="GEMINI_TTS_VOICE_FEMALE")
    gemini_tts_voice_male: str = Field(default="Charon", alias="GEMINI_TTS_VOICE_MALE")
    gemini_tts_aggregation_mode: GeminiTtsAggregationMode = Field(
        default=GeminiTtsAggregationMode.FULL_REPLY, alias="GEMINI_TTS_AGGREGATION_MODE"
    )
    elevenlabs_api_key: SecretStr | None = Field(default=None, alias="ELEVENLABS_API_KEY")
    elevenlabs_tts_model: str = Field(default="eleven_flash_v2_5", alias="ELEVENLABS_TTS_MODEL")
    elevenlabs_tts_voice_female: str | None = Field(default=None, alias="ELEVENLABS_TTS_VOICE_FEMALE")
    elevenlabs_tts_voice_male: str | None = Field(default=None, alias="ELEVENLABS_TTS_VOICE_MALE")
    # Speak the same model and voice through OpenRouter once ElevenLabs can't
    # connect or gives up reconnecting. Needs VOICE_AGENT_LLM_BASE_URL to point at OpenRouter.
    elevenlabs_tts_openrouter_fallback: bool = Field(default=True, alias="ELEVENLABS_TTS_OPENROUTER_FALLBACK")

    max_concurrent_sessions: int = Field(default=6, ge=1, alias="MAX_CONCURRENT_SESSIONS")
    session_max_seconds: int = Field(default=900, ge=60, le=3600, alias="SESSION_MAX_SECONDS")
    opening_timeout_seconds: float = Field(default=60, gt=0, alias="OPENING_TIMEOUT_SECONDS")
    connection_startup_seconds: float = Field(default=120, gt=0, alias="CONNECTION_STARTUP_SECONDS")
    connection_heartbeat_seconds: float = Field(default=30, gt=5, alias="CONNECTION_HEARTBEAT_SECONDS")
    connection_reconnect_seconds: float = Field(default=60, gt=0, le=300, alias="CONNECTION_RECONNECT_SECONDS")
    # Silence after the buyer finishes speaking: the buyer checks in once, then
    # hangs up if the learner stays silent. 0 turns both off.
    learner_idle_check_in_seconds: float = Field(default=20, ge=0, alias="LEARNER_IDLE_CHECK_IN_SECONDS")
    learner_idle_hang_up_seconds: float = Field(default=15, gt=0, alias="LEARNER_IDLE_HANG_UP_SECONDS")
    webrtc_ice_servers: str = Field(default="stun:stun.l.google.com:19302", alias="WEBRTC_ICE_SERVERS")

    @property
    def ice_server_urls(self) -> list[str]:
        return [url.strip() for url in self.webrtc_ice_servers.split(",") if url.strip()]

    @property
    def soniox_stt_url(self) -> str:
        suffix = "" if self.soniox_region is SonioxRegion.US else f".{self.soniox_region.value}"
        return f"wss://stt-rt{suffix}.soniox.com/transcribe-websocket"

    @property
    def soniox_tts_url(self) -> str:
        suffix = "" if self.soniox_region is SonioxRegion.US else f".{self.soniox_region.value}"
        return f"wss://tts-rt{suffix}.soniox.com/tts-websocket"

    @property
    def elevenlabs_tts_available(self) -> bool:
        return bool(self.elevenlabs_api_key and self.elevenlabs_tts_voice_female and self.elevenlabs_tts_voice_male)

    def tts_available(self, provider: TTSProvider) -> bool:
        """Whether ``provider`` is configured well enough for create_tts to build it."""
        if provider is TTSProvider.ELEVENLABS:
            return self.elevenlabs_tts_available
        if provider is TTSProvider.GEMINI:
            return bool(self.voice_agent_llm_api_key)
        return bool(self.soniox_api_key)

    @field_validator("voice_input_profiles", mode="before")
    @classmethod
    def split_profiles(cls, value: object) -> object:
        if isinstance(value, str):
            return [profile.strip() for profile in value.split(",") if profile.strip()]
        return value

    @model_validator(mode="after")
    def validate_profile(self) -> Self:
        if len(set(self.voice_input_profiles)) != len(self.voice_input_profiles):
            raise ValueError("VOICE_INPUT_PROFILE lists a profile more than once")
        if VoiceInputProfile.SONIOX_NATIVE in self.voice_input_profiles and not self.soniox_api_key:
            raise ValueError("SONIOX_API_KEY is required for the selected voice input profile")
        if VoiceInputProfile.ASSEMBLYAI_NATIVE in self.voice_input_profiles and not self.assemblyai_api_key:
            raise ValueError("ASSEMBLYAI_API_KEY is required for the selected voice input profile")
        if self.aic_voice_focus_enabled and not self.aic_license_key:
            raise ValueError("AIC_LICENSE_KEY is required when AIC_VOICE_FOCUS_ENABLED is true")
        if not self.voice_agent_llm_api_key:
            raise ValueError("VOICE_AGENT_LLM_API_KEY is required")
        for name, value in {
            "WEB_APP_ORIGIN": self.web_app_origin,
            "VOICE_EVENT_INGEST_URL": self.voice_event_ingest_url,
            "VOICE_AGENT_LLM_BASE_URL": self.voice_agent_llm_base_url,
        }.items():
            parsed = urlparse(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"{name} must be an absolute HTTP(S) URL")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
