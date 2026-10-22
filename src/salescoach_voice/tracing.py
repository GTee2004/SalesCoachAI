import base64
import logging
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from .config import Settings
from .redaction import redact_serialized

logger = logging.getLogger("uvicorn.error.salescoach_voice")

_enabled = False
# OpenTelemetry allows one global tracer provider per process, so once it is shut down
# tracing cannot be turned back on.
_shut_down = False


# Span attributes where pipecat puts what was said: STT transcripts, TTS text and the
# LLM's message list and reply.
_CONVERSATION_ATTRIBUTES = ("transcript", "text", "text_output", "input", "output")


def _with_attributes(span, attributes):
    from opentelemetry.sdk.trace import ReadableSpan

    return ReadableSpan(
        name=span.name,
        context=span.context,
        parent=span.parent,
        resource=span.resource,
        attributes=attributes,
        events=span.events,
        links=span.links,
        kind=span.kind,
        status=span.status,
        start_time=span.start_time,
        end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


def _add_llm_ttft(span):
    """Return ``span`` with LLM time-to-first-token attributes added (or unchanged).

    Pipecat records the LLM TTFT as ``metrics.ttfb`` when the LLM call finishes, so the
    first-token timestamp is only known once the span is complete. At export it is also
    exposed as ``llm.ttft_ms`` and as Langfuse's ``completion_start_time``, which makes
    Langfuse show "time to first token" natively on the generation.
    """
    try:
        attrs = span.attributes or {}
        ttfb = attrs.get("metrics.ttfb")
        if span.name != "llm" or ttfb is None or span.start_time is None:
            return span
        start = datetime.fromtimestamp(span.start_time / 1e9, tz=UTC)
        first_token = start + timedelta(seconds=float(ttfb))
        new_attrs = {
            **attrs,
            "llm.ttft_ms": round(float(ttfb) * 1000, 1),
            "langfuse.observation.completion_start_time": first_token.isoformat(),
        }
        return _with_attributes(span, new_attrs)
    except Exception:
        logger.debug("Could not add LLM TTFT attributes", exc_info=True)
        return span


def _redact(span):
    """Return ``span`` with personal identifiers masked in what was said.

    Should masking fail, the conversation text is dropped rather than exported as is.
    """
    attrs = span.attributes or {}
    keys = [key for key in _CONVERSATION_ATTRIBUTES if isinstance(attrs.get(key), str)]
    if not keys:
        return span
    try:
        redacted = {key: redact_serialized(attrs[key]) for key in keys}
    except Exception:
        logger.warning("Could not redact span %s; dropping its conversation text", span.name, exc_info=True)
        redacted = dict.fromkeys(keys, "[REDACTION_FAILED]")
    return _with_attributes(span, {**attrs, **redacted})


def _wrap_exporter(inner):
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

    class LangfuseExporter(SpanExporter):
        def export(self, spans: Sequence) -> SpanExportResult:
            return inner.export([_redact(_add_llm_ttft(s)) for s in spans])

        def shutdown(self) -> None:
            inner.shutdown()

        def force_flush(self, timeout_millis: int = 30000) -> bool:
            return inner.force_flush(timeout_millis)

    return LangfuseExporter()


# Langfuse lists an observation under a session only when the observation itself
# carries the session id, but pipecat sets extra attributes on the conversation span
# alone.
_SESSION_ATTRIBUTE = "langfuse.session.id"


def _session_propagator():
    """Return a span processor that copies the session id from a trace's root to every span.

    Pipecat parents turn and service spans with ids only (``NonRecordingSpan``), so a child
    cannot read its parent's attributes. The root (``conversation``) span is kept per trace
    instead: pipecat sets the session id right after starting it, before any child starts.
    """
    from opentelemetry.sdk.trace import SpanProcessor

    class SessionPropagator(SpanProcessor):
        def __init__(self) -> None:
            self._roots: dict[int, object] = {}

        def on_start(self, span, parent_context=None) -> None:
            try:
                trace_id = span.context.trace_id
                if span.parent is None:
                    self._roots[trace_id] = span
                    return
                root = self._roots.get(trace_id)
                session_id = (getattr(root, "attributes", None) or {}).get(_SESSION_ATTRIBUTE)
                if session_id is not None:
                    span.set_attribute(_SESSION_ATTRIBUTE, session_id)
            except Exception:
                logger.debug("Could not propagate the Langfuse session id", exc_info=True)

        def on_end(self, span) -> None:
            if span.parent is None:
                self._roots.pop(span.context.trace_id, None)

    return SessionPropagator()


def init_tracing(settings: Settings) -> bool:
    """Install the OpenTelemetry tracer provider that exports spans to Langfuse.

    Call once at process start. Returns False (tracing stays off) when disabled or
    misconfigured; the voice pipeline works the same either way.
    """
    global _enabled
    if _enabled:
        return True
    if not settings.enable_tracing:
        return False
    if _shut_down:
        logger.warning("Tracing was shut down earlier in this process and cannot be re-enabled")
        return False
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        logger.warning("ENABLE_TRACING=true but LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are missing; tracing disabled")
        return False
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from pipecat.utils.tracing.setup import setup_tracing

        token = base64.b64encode(
            f"{settings.langfuse_public_key}:{settings.langfuse_secret_key.get_secret_value()}".encode()
        ).decode()
        exporter = OTLPSpanExporter(
            # An explicit endpoint is used as-is, so the signal path must be included.
            endpoint=f"{settings.langfuse_base_url.rstrip('/')}/api/public/otel/v1/traces",
            headers={
                "Authorization": f"Basic {token}",
                "x-langfuse-ingestion-version": "4",
            },
        )
        _enabled = bool(setup_tracing(service_name="salescoach-voice", exporter=_wrap_exporter(exporter)))
        if _enabled:
            from opentelemetry import trace

            add_processor = getattr(trace.get_tracer_provider(), "add_span_processor", None)
            if add_processor:
                add_processor(_session_propagator())
            else:
                logger.warning("No SDK tracer provider; Langfuse sessions will list the conversation span only")
    except Exception:
        logger.exception("Tracing setup failed; continuing without tracing")
        return False
    logger.info("OpenTelemetry tracing enabled=%s host=%s", _enabled, settings.langfuse_base_url)
    return _enabled


def is_tracing_enabled() -> bool:
    return _enabled


def shutdown_tracing() -> None:
    """Flush pending spans. Safe to call when tracing was never enabled."""
    global _enabled, _shut_down
    if not _enabled:
        return
    _enabled = False
    _shut_down = True
    try:
        from opentelemetry import trace

        provider = trace.get_tracer_provider()
        flush = getattr(provider, "shutdown", None)
        if flush:
            flush()
    except Exception:
        logger.exception("Tracing shutdown failed")
