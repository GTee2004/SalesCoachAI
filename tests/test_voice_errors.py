from unittest.mock import AsyncMock

import pipecat.processors.frameworks.rtvi.models as rtvi
import pytest
from pipecat.frames.frames import ErrorFrame, OutputTransportMessageUrgentFrame

from src.salescoach_voice.rtvi import ClientRTVIProcessor


@pytest.mark.asyncio
@pytest.mark.parametrize("fatal", [False, True])
async def test_pipeline_errors_send_safe_codes_without_modifying_diagnostics(fatal):
    processor = ClientRTVIProcessor()
    processor.push_frame = AsyncMock()
    diagnostic = "GeminiTTSService#1: TTS context private-context-id completed with no audio"
    frame = ErrorFrame(error=diagnostic, fatal=fatal)

    await processor._send_error_frame(frame)

    sent = processor.push_frame.call_args.args[0]
    assert isinstance(sent, OutputTransportMessageUrgentFrame)
    assert sent.message["type"] == "error"
    assert sent.message["data"] == {
        "error": "voice_session_failed" if fatal else "voice_service_unavailable",
        "fatal": fatal,
    }
    assert diagnostic not in str(sent.message)
    assert frame.error == diagnostic
    assert frame.fatal == fatal


@pytest.mark.asyncio
async def test_error_responses_preserve_request_id_without_sending_diagnostics():
    processor = ClientRTVIProcessor()
    processor.push_frame = AsyncMock()
    message = rtvi.ErrorResponse(
        id="client-request-1",
        data=rtvi.ErrorResponseData(error="Provider exception: private-token"),
    )

    await processor.create_rtvi_observer().send_rtvi_message(message)

    sent = processor.push_frame.call_args.args[0]
    assert sent.message["type"] == "error-response"
    assert sent.message["id"] == "client-request-1"
    assert sent.message["data"] == {"error": "voice_service_unavailable"}
    assert message.data.error == "Provider exception: private-token"


@pytest.mark.asyncio
async def test_non_error_messages_are_preserved():
    processor = ClientRTVIProcessor()
    processor.push_frame = AsyncMock()
    message = rtvi.ServerMessage(data={"status": "ready"})

    await processor.push_transport_message(message)

    sent = processor.push_frame.call_args.args[0]
    assert sent.message == message.model_dump(exclude_none=True)
