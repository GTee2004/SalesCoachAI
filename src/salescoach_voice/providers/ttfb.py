import logging

logger = logging.getLogger("uvicorn.error.salescoach_voice")

_warned_missing_spans = False


async def stop_tts_ttfb(service, context_id: str) -> None:
    """Stop the TTFB timer at the first audio and record it on this context's ``tts`` span.

    ``@traced_tts`` attributes the TTFB ``MetricsFrame`` to the context that is *playing*,
    which misses contexts synthesized ahead of playback. This writes the same value
    pipecat just measured onto the span of the context that produced the audio, so every
    span's ``metrics.ttfb`` has one meaning. Only the first value per audio context counts
    (one span can cover several ``run_tts`` calls). Never raises: tracing must not affect audio.
    """
    await service.stop_ttfb_metrics()
    if not getattr(service, "_tracing_enabled", False):
        return
    try:
        # Private state of pipecat's traced_tts (pinned pipecat version). Warn instead of
        # silently dropping TTS TTFB if an upgrade changes it.
        spans = getattr(service, "_tts_spans", None)
        if spans is None:
            global _warned_missing_spans
            if not _warned_missing_spans:
                _warned_missing_spans = True
                logger.warning("pipecat traced_tts no longer exposes _tts_spans; TTS ttfb is not traced")
            return
        entry = spans.get(context_id)
        ttfb = getattr(getattr(service, "_metrics", None), "ttfb", None)
        if entry and not entry["ttfb_recorded"] and ttfb is not None:
            entry["span"].set_attribute("metrics.ttfb", ttfb)
            entry["ttfb_recorded"] = True
    except Exception:
        logger.debug("Could not record TTS ttfb on span", exc_info=True)
