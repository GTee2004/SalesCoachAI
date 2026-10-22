import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from pydantic import SecretStr

from src.salescoach_voice.providers.llm import create_llm, reply_params


def settings(
    model: str,
    base_url: str = "https://openrouter.ai/api/v1",
    *,
    fallback_model: str | None = None,
    first_token_seconds: float = 5,
):
    return SimpleNamespace(
        voice_agent_llm_api_key=SecretStr("sk-test"),
        voice_agent_llm_base_url=base_url,
        voice_agent_llm_model=model,
        voice_agent_llm_fallback_model=fallback_model,
        voice_agent_llm_first_token_seconds=first_token_seconds,
        voice_agent_llm_max_tokens=400,
    )


def test_luna_replies_without_reasoning_on_endpoints_that_honor_it():
    llm = create_llm(settings("openai/gpt-6-luna"), "Bạn là khách hàng.")
    params = llm.build_chat_completion_params({"messages": []})
    assert params["reasoning_effort"] == "none"
    assert params["extra_body"] == {"provider": {"require_parameters": True}}


def test_reasoning_parameter_is_only_sent_where_it_applies():
    assert reply_params("gpt-6-luna", "https://api.openai.com/v1") == {"reasoning_effort": "none"}
    assert reply_params("openai/gpt-4.1-mini", "https://openrouter.ai/api/v1") == {}


def test_buyer_replies_are_capped():
    llm = create_llm(settings("openai/gpt-6-luna"), "Bạn là khách hàng.")
    assert llm.build_chat_completion_params({"messages": []})["max_tokens"] == 400


# --- Fallback model ----------------------------------------------------------


def chunk(text: str | None, usage=None):
    delta = SimpleNamespace(content=text, tool_calls=None)
    choices = [SimpleNamespace(delta=delta)] if text is not None else []
    return SimpleNamespace(choices=choices, usage=usage, model=None)


class FakeStream:
    def __init__(self, *steps):
        # Each step is a chunk, or a number of seconds to stall before the next one.
        self._steps = steps

    def __aiter__(self):
        return self._chunks()

    async def _chunks(self):
        for step in self._steps:
            if isinstance(step, (int, float)):
                await asyncio.sleep(step)
            else:
                yield step

    async def close(self):
        pass


def stalled_then_answered(llm):
    """Make the first request stall and the next one answer; return the mock."""
    create = AsyncMock(side_effect=[FakeStream(5), FakeStream(chunk("Dạ"), chunk(" vâng"))])
    llm._client.chat.completions.create = create
    return create


async def reply_text(llm) -> str:
    context = LLMContext(messages=[{"role": "user", "content": "Chào anh"}])
    stream = await llm.get_chat_completions(context)
    return "".join([c.choices[0].delta.content async for c in stream if c.choices])


@pytest.mark.asyncio
async def test_reply_that_misses_the_deadline_is_reissued_to_the_fallback_model():
    llm = create_llm(
        settings("openai/gpt-6-luna", fallback_model="google/gemini-flash", first_token_seconds=0.05),
        "Bạn là khách hàng.",
    )
    create = stalled_then_answered(llm)

    assert await reply_text(llm) == "Dạ vâng"

    primary, fallback = (call.kwargs for call in create.call_args_list)
    assert primary["model"] == "openai/gpt-6-luna"
    assert fallback["model"] == "google/gemini-flash"
    # Same conversation and cap, without Luna's reasoning parameters.
    assert fallback["messages"] == primary["messages"]
    assert fallback["max_tokens"] == 400
    assert "reasoning_effort" not in fallback and "extra_body" not in fallback
    # Usage and TTFB of the fallback reply are attributed to the fallback model.
    assert llm._metrics._model_name() == "google/gemini-flash"


@pytest.mark.asyncio
async def test_fallback_model_gets_its_own_reply_parameters():
    llm = create_llm(
        settings("openai/gpt-4.1-mini", fallback_model="openai/gpt-6-luna", first_token_seconds=0.05),
        "Bạn là khách hàng.",
    )
    create = stalled_then_answered(llm)

    await reply_text(llm)

    primary, fallback = (call.kwargs for call in create.call_args_list)
    assert "reasoning_effort" not in primary
    assert fallback["reasoning_effort"] == "none"
    assert fallback["extra_body"] == {"provider": {"require_parameters": True}}


@pytest.mark.asyncio
async def test_fallback_usage_is_reported_under_its_model_and_the_next_reply_under_the_primary(monkeypatch):
    llm = create_llm(
        settings("openai/gpt-6-luna", fallback_model="google/gemini-flash", first_token_seconds=0.05),
        "Bạn là khách hàng.",
    )
    usage = SimpleNamespace(
        prompt_tokens=20,
        completion_tokens=2,
        total_tokens=22,
        prompt_tokens_details=None,
        completion_tokens_details=None,
    )
    llm._client.chat.completions.create = AsyncMock(
        side_effect=[FakeStream(5), FakeStream(chunk("Dạ"), chunk(None, usage=usage))]
    )
    reported_models = []

    async def record_usage(_tokens):
        reported_models.append(llm._metrics._model_name())

    monkeypatch.setattr(llm, "push_frame", AsyncMock())
    monkeypatch.setattr(llm, "start_llm_usage_metrics", record_usage)

    await llm._process_context(LLMContext(messages=[{"role": "user", "content": "Chào anh"}]))

    assert reported_models == ["google/gemini-flash"]
    assert llm._metrics._model_name() == "openai/gpt-6-luna"


@pytest.mark.asyncio
@pytest.mark.parametrize("fallback_model", [None, "openai/gpt-6-luna"])
async def test_without_a_distinct_fallback_the_primary_model_is_asked_again(fallback_model):
    llm = create_llm(
        settings("openai/gpt-6-luna", fallback_model=fallback_model, first_token_seconds=0.05),
        "Bạn là khách hàng.",
    )
    create = stalled_then_answered(llm)

    assert await reply_text(llm) == "Dạ vâng"
    assert [call.kwargs["model"] for call in create.call_args_list] == ["openai/gpt-6-luna"] * 2
    assert all(call.kwargs["reasoning_effort"] == "none" for call in create.call_args_list)
