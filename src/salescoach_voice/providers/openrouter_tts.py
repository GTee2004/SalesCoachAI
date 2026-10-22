"""Speech from OpenRouter's OpenAI-compatible ``/audio/speech`` endpoint.

One request per sentence (or per reply). OpenRouter sends the audio only once
the provider has finished it, so the wait for the first audio grows with the
length of the text.
"""

import asyncio
import random
from collections.abc import AsyncGenerator, AsyncIterator

import httpx
from pipecat.frames.frames import CancelFrame, ErrorFrame, Frame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TextAggregationMode, TTSService
from pipecat.utils.text.base_text_aggregator import Aggregation, BaseTextAggregator
from pipecat.utils.tracing.service_decorators import traced_tts

from .ttfb import stop_tts_ttfb

SAMPLE_RATE = 24_000
CONNECT_TIMEOUT_SECONDS = 3.0
# A failed request is repeated once, and only before any of its audio played.
ATTEMPTS = 2


def retryable_request_error(error: httpx.HTTPError) -> bool:
    """Whether the same request could succeed if sent again shortly."""
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        return status in {408, 429} or status >= 500
    return isinstance(error, httpx.TransportError)


class FullReplyAggregator(BaseTextAggregator):
    """Hold LLM text until Pipecat flushes it at the end of the reply."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    @property
    def text(self) -> Aggregation:
        return Aggregation(text="".join(self._parts).strip(), type=self.aggregation_type)

    async def aggregate(self, text: str) -> AsyncIterator[Aggregation]:
        if text:
            self._parts.append(text)
        return
        yield  # Keep the async iterator contract without emitting partial replies.

    async def flush(self) -> Aggregation | None:
        result = self.text
        await self.reset()
        return result if result.text else None

    async def handle_interruption(self) -> None:
        await self.reset()

    async def reset(self) -> None:
        self._parts.clear()


class OpenRouterTTSService(TTSService):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        voice: str,
        request_timeout_seconds: float,
        label: str,
        full_reply: bool = False,
        provider_options: dict | None = None,
    ) -> None:
        """``label`` names the service in the errors it reports to the pipeline.

        ``provider_options`` go to OpenRouter as ``provider.options``, keyed by
        the provider's slug, which forwards the matching provider's to it.
        """
        super().__init__(
            settings=TTSSettings(model=model, voice=voice, language=None),
            sample_rate=SAMPLE_RATE,
            text_aggregation_mode=TextAggregationMode.SENTENCE,
            push_start_frame=True,
            push_stop_frames=True,
            stop_frame_timeout_s=request_timeout_seconds + 1,
        )
        if full_reply:
            # Pipecat 1.11 has no full-response mode or public aggregator setter.
            # Its end-of-response flush and interruption handling own this buffer.
            self._text_aggregator = FullReplyAggregator()
        self._label = label
        self._provider_options = provider_options
        self._request_timeout_seconds = request_timeout_seconds
        self._speech_url = f"{base_url.rstrip('/')}/audio/speech"
        self._client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(request_timeout_seconds, connect=CONNECT_TIMEOUT_SECONDS),
        )

    def can_generate_metrics(self) -> bool:
        return True

    async def cancel(self, frame: CancelFrame) -> None:
        await self._text_aggregator.reset()
        await super().cancel(frame)

    async def cleanup(self) -> None:
        try:
            await self._text_aggregator.reset()
            await super().cleanup()
        finally:
            await self._client.aclose()

    def _request(self, text: str) -> dict:
        request = {
            "model": self._settings.model,
            "input": text,
            "voice": self._settings.voice,
            "response_format": "pcm",
        }
        if self._provider_options:
            request["provider"] = {"options": self._provider_options}
        return request

    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        if not text.strip():
            return
        first = True
        try:
            async with asyncio.timeout(self._request_timeout_seconds):
                for attempt in range(1, ATTEMPTS + 1):
                    try:
                        async with self._client.stream("POST", self._speech_url, json=self._request(text)) as response:
                            response.raise_for_status()
                            content_type = response.headers.get("content-type", "").lower()
                            if content_type.split(";", 1)[0].strip() != "audio/pcm":
                                yield ErrorFrame(error=f"{self._label} returned an unsupported audio format")
                                return
                            async for frame in self._stream_audio_frames_from_iterator(
                                response.aiter_bytes(self.chunk_size),
                                in_sample_rate=SAMPLE_RATE,
                                context_id=context_id,
                            ):
                                if first:
                                    await stop_tts_ttfb(self, context_id)
                                    await self.start_tts_usage_metrics(text)
                                    first = False
                                yield frame
                            if first:
                                yield ErrorFrame(error=f"{self._label} returned no audio")
                            return
                    except httpx.HTTPError as exc:
                        # Repeating the request after audio has played would speak it twice.
                        if attempt == ATTEMPTS or not first or not retryable_request_error(exc):
                            raise
                    await asyncio.sleep(random.uniform(0.3, 0.6))
        except httpx.HTTPStatusError as exc:
            yield ErrorFrame(error=f"{self._label} request failed (HTTP {exc.response.status_code})")
        except (TimeoutError, httpx.TimeoutException):
            yield ErrorFrame(error=f"{self._label} request timed out")
        except httpx.HTTPError:
            yield ErrorFrame(error=f"{self._label} connection failed")
        finally:
            await self.stop_ttfb_metrics()
