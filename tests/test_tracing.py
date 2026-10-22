import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from src.salescoach_voice import tracing
from src.salescoach_voice.providers.ttfb import stop_tts_ttfb


def test_llm_span_gets_ttft_attributes():
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(tracing._wrap_exporter(memory)))
    with provider.get_tracer("t").start_as_current_span("llm") as span:
        span.set_attribute("metrics.ttfb", 0.42)
    attrs = memory.get_finished_spans()[0].attributes
    assert attrs["llm.ttft_ms"] == 420.0
    assert "langfuse.observation.completion_start_time" in attrs


def test_session_id_reaches_every_span_of_the_conversation():
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(tracing._session_propagator())
    provider.add_span_processor(SimpleSpanProcessor(memory))
    tracer = provider.get_tracer("t")
    # Like pipecat: the session id is set after the root starts, and children are
    # parented through id-only spans.
    conversation = tracer.start_span("conversation")
    conversation.set_attribute("langfuse.session.id", "session-1")
    turn_parent = trace.set_span_in_context(trace.NonRecordingSpan(conversation.get_span_context()))
    turn = tracer.start_span("turn", context=turn_parent)
    llm_parent = trace.set_span_in_context(trace.NonRecordingSpan(turn.get_span_context()))
    tracer.start_span("llm", context=llm_parent).end()
    turn.end()
    conversation.end()
    other = tracer.start_span("conversation")
    tracer.start_span("turn", context=trace.set_span_in_context(other)).end()
    other.end()

    sessions = [(span.name, span.attributes.get("langfuse.session.id")) for span in memory.get_finished_spans()]
    assert sessions == [
        ("llm", "session-1"),
        ("turn", "session-1"),
        ("conversation", "session-1"),
        ("turn", None),
        ("conversation", None),
    ]


def _tts_service(ttfb: float):
    span = SimpleNamespace(values={}, set_attribute=lambda k, v: span.values.setdefault(k, []).append(v))
    service = SimpleNamespace(
        _tracing_enabled=True,
        _metrics=SimpleNamespace(ttfb=ttfb),
        _tts_spans={"c1": {"span": span, "ttfb_recorded": False}},
        stop_ttfb_metrics=AsyncMock(),
    )
    return service, span


@pytest.mark.asyncio
async def test_stop_tts_ttfb_records_pipecat_value_once_per_context():
    service, span = _tts_service(ttfb=0.31)
    await stop_tts_ttfb(service, "c1")
    service._metrics.ttfb = 0.9
    await stop_tts_ttfb(service, "c1")
    assert service.stop_ttfb_metrics.await_count == 2
    assert span.values["metrics.ttfb"] == [0.31]


@pytest.mark.asyncio
async def test_stop_tts_ttfb_skips_span_when_tracing_off():
    service, span = _tts_service(ttfb=0.31)
    service._tracing_enabled = False
    await stop_tts_ttfb(service, "c1")
    service.stop_ttfb_metrics.assert_awaited_once()
    assert span.values == {}


def test_tracing_cannot_be_re_enabled_after_shutdown(monkeypatch):
    monkeypatch.setattr(tracing, "_enabled", True)
    monkeypatch.setattr(tracing, "_shut_down", False)
    tracing.shutdown_tracing()
    assert not tracing.is_tracing_enabled()
    settings = SimpleNamespace(enable_tracing=True, langfuse_public_key="pk", langfuse_secret_key="sk")
    assert tracing.init_tracing(settings) is False


def test_exported_spans_have_personal_identifiers_masked():
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(tracing._wrap_exporter(memory)))
    tracer = provider.get_tracer("t")
    with tracer.start_as_current_span("stt") as span:
        span.set_attribute("transcript", "Số anh là 0912 345 678, mail an@mocato.vn")
    with tracer.start_as_current_span("llm") as span:
        span.set_attribute("input", json.dumps([{"role": "user", "content": "Gọi số0912345678 nhé"}]))
        span.set_attribute("output", "Dạ em ghi số +84 912 345 678 rồi")
        span.set_attribute("metrics.ttfb", 0.42)
    stt, llm = (s.attributes for s in memory.get_finished_spans())
    assert stt["transcript"] == "Số anh là [PHONE], mail [EMAIL]"
    assert json.loads(llm["input"]) == [{"role": "user", "content": "Gọi số[PHONE] nhé"}]
    assert llm["output"] == "Dạ em ghi số [PHONE] rồi"
    assert llm["llm.ttft_ms"] == 420.0


def test_span_text_is_dropped_when_redaction_fails(monkeypatch):
    def fail(_text):
        raise RuntimeError("boom")

    monkeypatch.setattr(tracing, "redact_serialized", fail)
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(tracing._wrap_exporter(memory)))
    with provider.get_tracer("t").start_as_current_span("tts") as span:
        span.set_attribute("text", "0912345678")
    assert memory.get_finished_spans()[0].attributes["text"] == "[REDACTION_FAILED]"
