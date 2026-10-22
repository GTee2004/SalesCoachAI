import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from typing import Any
from urllib.parse import urlparse

from openai import Timeout
from openai.types.chat import ChatCompletionChunk
from pipecat.metrics.metrics import MetricsData
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.openai.llm import OpenAILLMService

from ..config import Settings

logger = logging.getLogger("uvicorn.error.salescoach_voice")

# A buyer reply streams in well under a second per chunk. The SDK defaults
# (600 s per read, two retries) left a stalled request silent for minutes.
LLM_CONNECT_TIMEOUT_SECONDS = 3.0
LLM_READ_TIMEOUT_SECONDS = 10.0
LLM_WRITE_TIMEOUT_SECONDS = 5.0
LLM_POOL_TIMEOUT_SECONDS = 3.0
LLM_MAX_SDK_RETRIES = 1
# Requests that produced no reply text are re-issued this many times, to the
# fallback model when one is configured.
LLM_FIRST_TOKEN_RETRIES = 1


def reply_params(model: str, base_url: str) -> dict[str, Any]:
    """Extra request parameters that keep the buyer's first token fast.

    Luna reasons before answering by default, which added 3-4 s before the first
    token on live calls. Other models take no reasoning parameter. On OpenRouter,
    require_parameters keeps requests off endpoints that would ignore it.
    """
    if model.removeprefix("openai/") != "gpt-6-luna":
        return {}
    params: dict[str, Any] = {"reasoning_effort": "none"}
    if urlparse(base_url).hostname == "openrouter.ai":
        params["extra_body"] = {"provider": {"require_parameters": True}}
    return params


def _has_reply(chunk: ChatCompletionChunk) -> bool:
    """Whether the chunk carries reply text or a tool call, not just metadata."""
    return any(choice.delta and (choice.delta.content or choice.delta.tool_calls) for choice in chunk.choices or ())


class FirstTokenDeadlineStream:
    """A completion stream that must start replying within a deadline.

    The deadline covers the request and every chunk before the first one with
    reply text. Server keep-alives (OpenRouter streams SSE comments while an
    upstream provider queues the request) never reach this iterator, so they
    cannot extend it. A request that misses it is closed and the next attempt is
    opened, which is safe only because nothing of it has reached TTS yet. Once
    reply text flows, chunks pass through unchanged and the client's read
    timeout bounds stalls.
    """

    def __init__(
        self,
        attempts: Sequence[Callable[[], Awaitable[Any]]],
        *,
        timeout: float,
    ) -> None:
        self._attempts = attempts
        self._timeout = timeout
        self._stream: Any = None

    def __aiter__(self) -> AsyncIterator[ChatCompletionChunk]:
        return self._chunks()

    async def close(self) -> None:
        stream, self._stream = self._stream, None
        if stream is not None:
            await stream.close()

    async def _chunks(self) -> AsyncIterator[ChatCompletionChunk]:
        try:
            for attempt, open_stream in enumerate(self._attempts):
                received: list[ChatCompletionChunk] = []
                try:
                    async with asyncio.timeout(self._timeout):
                        self._stream = await open_stream()
                        chunks = self._stream.__aiter__()
                        while not (received and _has_reply(received[-1])):
                            try:
                                received.append(await anext(chunks))
                            except StopAsyncIteration:
                                break
                except TimeoutError:
                    await self.close()
                    logger.warning(
                        "LLM produced no reply within %.1fs (attempt %d of %d)",
                        self._timeout,
                        attempt + 1,
                        len(self._attempts),
                    )
                    continue
                for chunk in received:
                    yield chunk
                if received and _has_reply(received[-1]):
                    async for chunk in chunks:
                        yield chunk
                return
            raise TimeoutError(
                f"LLM produced no reply within {self._timeout:.1f}s after {len(self._attempts)} attempts"
            )
        finally:
            await self.close()


class ResilientOpenAILLMService(OpenAILLMService):
    """OpenAI-compatible LLM with deadlines sized for a live voice turn.

    A request that misses the first-token deadline is re-issued to
    `fallback_model` when one is set. The primary model is usually slow because
    its upstream is overloaded, so asking it again tends to miss the deadline
    too. Only that turn falls back; the next one starts on the primary again.
    """

    def __init__(
        self,
        *,
        first_token_timeout: float,
        fallback_model: str | None = None,
        fallback_params: dict[str, Any] | None = None,
        **kwargs,
    ) -> None:
        self._first_token_timeout = first_token_timeout
        self._fallback_model = fallback_model
        self._fallback_params = fallback_params or {}
        super().__init__(**kwargs)

    def create_client(
        self, api_key=None, base_url=None, organization=None, project=None, default_headers=None, **kwargs
    ):
        client = super().create_client(
            api_key=api_key,
            base_url=base_url,
            organization=organization,
            project=project,
            default_headers=default_headers,
            **kwargs,
        )
        return client.with_options(
            timeout=Timeout(
                connect=LLM_CONNECT_TIMEOUT_SECONDS,
                read=LLM_READ_TIMEOUT_SECONDS,
                write=LLM_WRITE_TIMEOUT_SECONDS,
                pool=LLM_POOL_TIMEOUT_SECONDS,
            ),
            max_retries=LLM_MAX_SDK_RETRIES,
        )

    async def get_chat_completions(self, context: LLMContext):
        open_primary = super().get_chat_completions

        def primary():
            return open_primary(context)

        def fallback():
            return self._open_fallback(context)

        retry = fallback if self._fallback_model else primary
        return FirstTokenDeadlineStream(
            [primary, *[retry] * LLM_FIRST_TOKEN_RETRIES],
            timeout=self._first_token_timeout,
        )

    async def _open_fallback(self, context: LLMContext):
        model = self._fallback_model
        assert model is not None
        logger.warning("LLM retrying the reply on fallback model %s", model)
        params_from_context = self.get_llm_adapter().get_llm_invocation_params(
            context,
            system_instruction=self._settings.system_instruction,
            convert_developer_to_user=not self.supports_developer_role,
        )
        params = self.build_chat_completion_params(params_from_context)
        # The primary model's extra parameters may not apply to the fallback.
        for key in self._settings.extra:
            params.pop(key, None)
        params.update(self._fallback_params, model=model)
        # Usage and TTFB of this reply are billed and traced as the fallback's.
        self.set_core_metrics_data(MetricsData(processor=self.name, model=model))
        return await self._client.chat.completions.create(**params)

    async def _process_context(self, context: LLMContext):
        try:
            await super()._process_context(context)
        finally:
            self._sync_model_name_to_metrics()


def create_llm(settings: Settings, system_prompt: str) -> OpenAILLMService:
    model = settings.voice_agent_llm_model
    base_url = settings.voice_agent_llm_base_url
    # A fallback naming the primary model is the same as none: retry the primary.
    fallback_model = settings.voice_agent_llm_fallback_model
    if fallback_model == model:
        fallback_model = None
    return ResilientOpenAILLMService(
        api_key=settings.voice_agent_llm_api_key.get_secret_value(),  # type: ignore[union-attr]
        base_url=base_url,
        first_token_timeout=settings.voice_agent_llm_first_token_seconds,
        fallback_model=fallback_model,
        fallback_params=reply_params(fallback_model, base_url) if fallback_model else None,
        settings=OpenAILLMService.Settings(
            model=model,
            system_instruction=system_prompt,
            # max_tokens, not max_completion_tokens: OpenRouter maps it for
            # every provider, so require_parameters never filters endpoints on it.
            max_tokens=settings.voice_agent_llm_max_tokens,
            extra=reply_params(model, base_url),
        ),
    )
