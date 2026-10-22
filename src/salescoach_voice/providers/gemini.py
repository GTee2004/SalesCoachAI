from ..config import GeminiTtsAggregationMode
from .openrouter_tts import CONNECT_TIMEOUT_SECONDS, OpenRouterTTSService

GEMINI_TTS_MODEL = "google/gemini-3.8-flash-lite-tts"
GEMINI_REQUEST_TIMEOUT_SECONDS = 30.0
GEMINI_CONNECT_TIMEOUT_SECONDS = CONNECT_TIMEOUT_SECONDS


class GeminiTTSService(OpenRouterTTSService):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        voice: str,
        aggregation_mode: GeminiTtsAggregationMode,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            model=GEMINI_TTS_MODEL,
            voice=voice,
            request_timeout_seconds=GEMINI_REQUEST_TIMEOUT_SECONDS,
            label="Gemini TTS",
            full_reply=aggregation_mode is GeminiTtsAggregationMode.FULL_REPLY,
        )
