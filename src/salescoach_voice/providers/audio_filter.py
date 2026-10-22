from pathlib import Path

from pipecat.audio.filters.aic_filter import AICFilter, AICModelManager

from ..config import Settings

AIC_MODEL_DIR = Path.home() / ".cache" / "pipecat" / "aic-models"


def create_audio_in_filter(settings: Settings) -> AICFilter | None:
    """The learner mic filter, or none when Voice Focus is off for this deployment."""
    if not settings.aic_voice_focus_enabled:
        return None
    return AICFilter(
        license_key=settings.aic_license_key.get_secret_value(),  # type: ignore[union-attr]
        model_id=settings.aic_model_id,
        model_download_dir=AIC_MODEL_DIR,
        enhancement_level=settings.aic_enhancement_level,
    )


async def acquire_aic_model(settings: Settings) -> str | None:
    """Download and load the Voice Focus model before the first session needs it.

    Returns the cache key to release on shutdown. Holding this reference keeps
    the shared model loaded between sessions instead of reloading it per call.
    """
    if not settings.aic_voice_focus_enabled:
        return None
    _model, key = await AICModelManager.acquire(model_id=settings.aic_model_id, model_download_dir=AIC_MODEL_DIR)
    return key


def release_aic_model(key: str | None) -> None:
    if key is not None:
        AICModelManager.release(key)
