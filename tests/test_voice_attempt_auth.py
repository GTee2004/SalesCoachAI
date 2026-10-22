import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import jwt
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from src.salescoach_voice.api import router
from src.salescoach_voice.auth import NonceStore
from src.salescoach_voice.models import SessionRegistration
from src.salescoach_voice.runtime import get_runtime
from src.salescoach_voice.sessions import SessionRegistry, VoiceSession


@pytest.mark.asyncio
@pytest.mark.parametrize("aid", [None, "stale", "current"])
async def test_offer_requires_token_for_current_connection_attempt(aid):
    settings = SimpleNamespace(voice_token_secret=SecretStr("x" * 32))
    session = VoiceSession(
        SessionRegistration(
            sessionId=uuid4(),
            userId="learner",
            ttsProvider="gemini",
            buyerGender="female",
            expiresAt=datetime.now(UTC) + timedelta(minutes=5),
            scenario={"systemPrompt": "buyer"},
        )
    )
    registry = SessionRegistry(settings, SimpleNamespace(emit=AsyncMock()))
    registry._sessions[session.registration.sessionId] = session
    handle = AsyncMock(return_value={"sdp": "answer", "type": "answer"})
    current = SimpleNamespace(
        ready=True,
        settings=settings,
        registry=registry,
        nonces=NonceStore(),
        webrtc=SimpleNamespace(handle_web_request=handle),
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    payload = {
        "sub": "learner",
        "sid": str(session.registration.sessionId),
        "nonce": str(uuid4()),
        "iat": int(time.time()),
        "exp": int(time.time()) + 120,
        "aud": "salescoach-voice",
    }
    if aid:
        payload["aid"] = str(session.attempt_id) if aid == "current" else str(uuid4())
    token = jwt.encode(payload, "x" * 32, algorithm="HS256")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/offer",
            headers={"authorization": f"Bearer {token}"},
            json={"sdp": "offer", "type": "offer", "requestData": {"sessionId": payload["sid"]}},
        )
    assert response.status_code == (200 if aid == "current" else 409)
    assert handle.await_count == (1 if aid == "current" else 0)
