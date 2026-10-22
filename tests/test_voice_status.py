from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from src.salescoach_voice.api import router
from src.salescoach_voice.config import VoiceFocusMode, VoiceInputProfile
from src.salescoach_voice.runtime import get_runtime
from src.salescoach_voice.sessions import SessionRegistry

CONTROL_KEY = "c" * 32


def make_runtime(ready=True):
    settings = SimpleNamespace(
        voice_control_api_key=SecretStr(CONTROL_KEY),
        max_concurrent_sessions=6,
        voice_input_profiles=[VoiceInputProfile.SONIOX_NATIVE],
        assemblyai_voice_focus=VoiceFocusMode.AUTO,
    )
    return SimpleNamespace(
        ready=ready,
        settings=settings,
        registry=SessionRegistry(settings, SimpleNamespace(emit=AsyncMock())),
    )


def registration(user_id):
    return SimpleNamespace(
        sessionId=uuid4(),
        userId=user_id,
        expiresAt=datetime.now(UTC) + timedelta(minutes=5),
        ttsProvider="soniox",
        buyerGender="female",
        micType=None,
        nextSequence=1,
        maxDurationSeconds=900,
    )


async def get_status(current, key=CONTROL_KEY):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.get("/internal/status", headers={"authorization": f"Bearer {key}"})


@pytest.mark.asyncio
async def test_status_requires_the_control_key():
    response = await get_status(make_runtime(), key="w" * 32)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_status_counts_only_sessions_that_hold_a_capacity_slot():
    current = make_runtime()
    await current.registry.register(registration("first-learner"))
    ended = await current.registry.register(registration("second-learner"))
    await current.registry.end(ended.registration.sessionId, "user_ended")

    response = await get_status(current)

    assert response.status_code == 200
    assert response.json() == {
        "ready": True,
        "activeSessions": 1,
        "maxConcurrentSessions": 6,
        "micTypeSelectable": False,
    }


@pytest.mark.asyncio
async def test_status_reports_models_that_are_still_loading():
    response = await get_status(make_runtime(ready=False))
    assert response.json()["ready"] is False
