import pytest
from pipecat.audio.filters.aic_filter import AICFilter
from pydantic import ValidationError

from src.salescoach_voice.config import Settings
from src.salescoach_voice.providers import audio_filter
from src.salescoach_voice.providers.audio_filter import (
    acquire_aic_model,
    create_audio_in_filter,
    release_aic_model,
)


def make_settings(**overrides):
    return Settings(
        _env_file=None,
        WEB_APP_ORIGIN="http://localhost:4500",
        VOICE_CONTROL_API_KEY="c" * 32,
        VOICE_TOKEN_SECRET="t" * 32,
        VOICE_EVENT_INGEST_URL="http://localhost:4500/api/internal/voice/events",
        VOICE_EVENT_INGEST_KEY="e" * 32,
        VOICE_AGENT_LLM_API_KEY="test-llm-key",
        SONIOX_API_KEY="test-soniox-key",
        **overrides,
    )


def test_voice_focus_is_off_by_default():
    assert create_audio_in_filter(make_settings()) is None


def test_voice_focus_requires_a_license_key():
    with pytest.raises(ValidationError, match="AIC_LICENSE_KEY"):
        make_settings(AIC_VOICE_FOCUS_ENABLED=True)


@pytest.mark.parametrize("level", [-0.1, 1.1])
def test_enhancement_level_stays_in_range(level):
    with pytest.raises(ValidationError):
        make_settings(AIC_VOICE_FOCUS_ENABLED=True, AIC_LICENSE_KEY="key", AIC_ENHANCEMENT_LEVEL=level)


def test_enabled_voice_focus_filters_with_configured_model():
    settings = make_settings(
        AIC_VOICE_FOCUS_ENABLED=True,
        AIC_LICENSE_KEY="test-aic-key",
        AIC_MODEL_ID="quail-vf-2.2-s-16khz",
        AIC_ENHANCEMENT_LEVEL=0.7,
    )

    audio_in_filter = create_audio_in_filter(settings)

    assert isinstance(audio_in_filter, AICFilter)
    assert audio_in_filter._license_key == "test-aic-key"
    assert audio_in_filter._model_id == "quail-vf-2.2-s-16khz"
    assert audio_in_filter._model_download_dir == audio_filter.AIC_MODEL_DIR
    assert audio_in_filter._enhancement_level == 0.7


@pytest.mark.asyncio
async def test_disabled_voice_focus_loads_no_model(monkeypatch):
    async def fail_acquire(**_kwargs):
        raise AssertionError("model loaded while Voice Focus is off")

    monkeypatch.setattr(audio_filter.AICModelManager, "acquire", fail_acquire)

    assert await acquire_aic_model(make_settings()) is None
    release_aic_model(None)


@pytest.mark.asyncio
async def test_startup_holds_the_shared_model_until_release(monkeypatch):
    calls = []

    async def acquire(**kwargs):
        calls.append(("acquire", kwargs))
        return object(), "model-key"

    monkeypatch.setattr(audio_filter.AICModelManager, "acquire", acquire)
    monkeypatch.setattr(audio_filter.AICModelManager, "release", lambda key: calls.append(("release", key)))
    settings = make_settings(AIC_VOICE_FOCUS_ENABLED=True, AIC_LICENSE_KEY="key")

    key = await acquire_aic_model(settings)
    release_aic_model(key)

    assert calls == [
        ("acquire", {"model_id": "quail-vf-2.2-l-16khz", "model_download_dir": audio_filter.AIC_MODEL_DIR}),
        ("release", "model-key"),
    ]
