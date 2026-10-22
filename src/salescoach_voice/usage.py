"""What each AI service consumed, reported to the web app so it can price a call.

Services report usage as pipecat metrics. The meter reads them as each service
pushes them, not through a pipeline observer: observers are fed from a queue that
is dropped when the pipeline stops, and the STT services report their trailing
audio exactly then.
"""

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

from pipecat.frames.frames import Frame, MetricsFrame
from pipecat.metrics.metrics import (
    LLMTokenUsage,
    LLMUsageMetricsData,
    STTUsageMetricsData,
    TTSUsageMetricsData,
)
from pipecat.processors.frame_processor import FrameProcessor

ServiceKind = Literal["stt", "llm", "tts"]


def llm_provider(base_url: str) -> str:
    """The provider billing an OpenAI-compatible endpoint, named by its host."""
    host = urlparse(base_url).hostname or "unknown"
    return "openrouter" if host == "openrouter.ai" else host


@dataclass
class ServiceUsage:
    service: ServiceKind
    provider: str
    model: str
    audio_seconds: float = 0.0
    characters: int = 0
    # Input tokens include the cached ones, as OpenAI-compatible APIs report them.
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0

    def payload(self) -> dict[str, Any]:
        item: dict[str, Any] = {"service": self.service, "provider": self.provider, "model": self.model}
        if self.service == "stt":
            item["audioSeconds"] = round(self.audio_seconds, 3)
        elif self.service == "tts":
            item["characters"] = self.characters
        else:
            item["inputTokens"] = self.input_tokens
            item["cachedInputTokens"] = self.cached_input_tokens
            item["outputTokens"] = self.output_tokens
        return item


class UsageMeter:
    """Sums usage per service, provider and model."""

    def __init__(self) -> None:
        self._items: dict[tuple[str, str, str], ServiceUsage] = {}

    def _item(self, service: ServiceKind, provider: str, model: str) -> ServiceUsage:
        key = (service, provider, model)
        if key not in self._items:
            self._items[key] = ServiceUsage(service, provider, model)
        return self._items[key]

    def add_stt(self, provider: str, model: str, audio_seconds: float) -> None:
        self._item("stt", provider, model).audio_seconds += max(0.0, audio_seconds)

    def add_tts(self, provider: str, model: str, characters: int) -> None:
        self._item("tts", provider, model).characters += max(0, characters)

    def add_llm(self, provider: str, model: str, *, input_tokens: int, cached_input_tokens: int, output_tokens: int):
        item = self._item("llm", provider, model)
        item.input_tokens += max(0, input_tokens)
        item.cached_input_tokens += max(0, cached_input_tokens)
        item.output_tokens += max(0, output_tokens)

    def add_llm_tokens(self, provider: str, model: str, tokens: LLMTokenUsage) -> None:
        self.add_llm(
            provider,
            model,
            input_tokens=tokens.prompt_tokens,
            cached_input_tokens=tokens.cache_read_input_tokens or 0,
            output_tokens=tokens.completion_tokens,
        )

    def track(self, processor: FrameProcessor, provider: str) -> None:
        """Count the usage `processor` itself reports, under `provider`.

        Metrics of services earlier in the pipeline pass through `processor`
        too; they carry the name of the service that reported them.
        """

        @processor.event_handler("on_before_push_frame")
        async def record(_processor: FrameProcessor, frame: Frame) -> None:
            if not isinstance(frame, MetricsFrame):
                return
            for data in frame.data:
                if data.processor != processor.name:
                    continue
                reported_model = data.model or "unknown"
                if isinstance(data, STTUsageMetricsData):
                    self.add_stt(provider, reported_model, data.value.audio_seconds)
                elif isinstance(data, TTSUsageMetricsData):
                    self.add_tts(provider, reported_model, data.value)
                elif isinstance(data, LLMUsageMetricsData):
                    self.add_llm_tokens(provider, reported_model, data.value)

    def summary(self) -> list[dict[str, Any]]:
        return [item.payload() for item in self._items.values()]
