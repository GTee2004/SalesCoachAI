import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.salescoach_voice.sessions import SessionRegistry, SessionState


def make_registry():
    return SessionRegistry(
        SimpleNamespace(max_concurrent_sessions=6),
        SimpleNamespace(emit=AsyncMock()),
    )


def registration():
    return SimpleNamespace(
        sessionId=uuid4(),
        userId="learner",
        expiresAt=datetime.now(UTC) + timedelta(minutes=5),
        ttsProvider="soniox",
        buyerGender="female",
        micType=None,
        nextSequence=1,
        maxDurationSeconds=900,
    )


@pytest.mark.asyncio
async def test_retry_stops_pending_worker_and_replaces_registration():
    registry = make_registry()
    request = registration()
    previous = await registry.register(request)
    await registry.bind_peer(previous, "old-peer")
    stopped = AsyncMock()
    await registry.attach_worker(previous, "old-peer", stopped)

    current = await registry.register(request)

    stopped.assert_awaited_once()
    assert current is not previous
    assert previous.cancel_worker is None
    assert "old-peer" not in registry._peer_sessions
    await registry.bind_peer(current, "new-peer")
    assert registry.authorize_patch("new-peer", request.sessionId, request.userId) is current


@pytest.mark.asyncio
async def test_duplicate_offer_cannot_overwrite_peer_or_worker():
    registry = make_registry()
    session = await registry.register(registration())
    await registry.bind_peer(session, "first-peer")
    stopped = AsyncMock()
    await registry.attach_worker(session, "first-peer", stopped)

    with pytest.raises(HTTPException) as error:
        registry.authorize_offer(session.registration.sessionId, session.registration.userId)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        await registry.bind_peer(session, "second-peer")
    with pytest.raises(HTTPException):
        await registry.attach_worker(session, "first-peer", AsyncMock())
    assert session.cancel_worker is stopped
    assert session.peer_id == "first-peer"


@pytest.mark.asyncio
async def test_end_waits_for_worker_cleanup_and_does_not_become_failed():
    registry = make_registry()
    session = await registry.register(registration())
    await registry.bind_peer(session, "peer")
    stopping = asyncio.Event()
    cleanup_finished = asyncio.Event()

    async def stop_worker():
        stopping.set()
        await cleanup_finished.wait()

    await registry.attach_worker(session, "peer", stop_worker)
    ending = asyncio.create_task(registry.end(session.registration.sessionId, "user_ended"))
    try:
        await asyncio.wait_for(stopping.wait(), 1)
        assert session.state is SessionState.ENDING
        assert not ending.done()
        await registry.fail(session.registration.sessionId, "client_disconnected")
        assert session.state is SessionState.ENDING
        await registry.detach_worker(session, "peer")
        cleanup_finished.set()
        await asyncio.wait_for(ending, 1)
        assert session.state is SessionState.ENDED
        assert session.cancel_worker is None
        assert "peer" not in registry._peer_sessions
    finally:
        cleanup_finished.set()
        await ending


@pytest.mark.asyncio
async def test_stale_worker_cannot_attach_to_replacement_session():
    registry = make_registry()
    request = registration()
    stale = await registry.register(request)
    await registry.end(request.sessionId, "retry")
    current = await registry.register(request)
    await registry.bind_peer(current, "new-peer")

    with pytest.raises(HTTPException):
        await registry.bind_peer(stale, "stale-peer")
    with pytest.raises(HTTPException):
        await registry.attach_worker(stale, "stale-peer", AsyncMock())
    await registry.detach_worker(stale, "new-peer")
    assert registry.authorize_patch("new-peer", request.sessionId, request.userId) is current


@pytest.mark.asyncio
async def test_retry_waits_for_failed_worker_to_stop_before_replacement():
    registry = make_registry()
    request = registration()
    previous = await registry.register(request)
    await registry.bind_peer(previous, "old-peer")
    stopped = AsyncMock()
    await registry.attach_worker(previous, "old-peer", stopped)
    await registry.fail(request.sessionId, "client_disconnected")

    current = await registry.register(request)

    stopped.assert_awaited_once()
    assert current is not previous
    assert previous.cancel_worker is None
    assert current.state is SessionState.AWAITING_CONNECTION


@pytest.mark.asyncio
async def test_unconnected_registration_is_replaced_when_mic_type_changes():
    registry = make_registry()
    request = registration()
    request.micType = "built_in"
    previous = await registry.register(request)
    assert await registry.register(request) is previous

    changed = SimpleNamespace(**{**vars(request), "micType": "worn"})
    current = await registry.register(changed)

    assert current is not previous
    assert previous.state is SessionState.ENDED
    assert current.registration.micType == "worn"


@pytest.mark.asyncio
async def test_expired_unconnected_registration_releases_user_and_capacity():
    registry = make_registry()
    registry._settings.max_concurrent_sessions = 1
    old = await registry.register(registration())
    old.registration.expiresAt = datetime.now(UTC) - timedelta(seconds=1)
    current = await registry.register(registration())
    assert current is not old
    assert not registry.is_current(old)
    assert old.state is SessionState.ENDED


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["soniox", "gemini", "elevenlabs"])
@pytest.mark.parametrize("ready", [False, True])
async def test_connection_deadlines_stop_all_providers_without_end(provider, ready):
    registry = make_registry()
    request = registration()
    request.ttsProvider = provider
    session = await registry.register(request)
    await registry.bind_peer(session, "peer")
    stopped = AsyncMock()
    await registry.attach_worker(session, "peer", stopped)
    await registry.mark_active(session)
    if ready:
        assert registry.touch(session, str(session.attempt_id))
        session.last_activity -= 31
    else:
        session.registered_at -= 121
    await registry.sweep()
    stopped.assert_awaited_once()
    assert session.state is SessionState.ENDED
    assert session.cancel_worker is None
    assert "peer" not in registry._peer_sessions
    event = registry._sink.emit.await_args.args[0]
    assert event.attemptId == session.attempt_id
    assert event.payload["reason"] == ("heartbeat_timeout" if ready else "connection_startup_timeout")
    assert event.payload["evidenceComplete"] is False


@pytest.mark.asyncio
async def test_stale_heartbeats_and_expired_connection_tokens_cannot_renew_attempt():
    registry = make_registry()
    request = registration()
    request.attemptId = uuid4()
    old = await registry.register(request)
    replacement = SimpleNamespace(**vars(request))
    replacement.attemptId = uuid4()
    current = await registry.register(replacement)
    assert current is not old
    assert not registry.touch(old, str(old.attempt_id))
    assert not registry.touch(current, str(old.attempt_id))
    assert registry.touch(current, str(current.attempt_id))
    current.registered_at -= 121
    with pytest.raises(HTTPException) as error:
        registry.authorize_offer(current.registration.sessionId, current.registration.userId)
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_connected_session_outlives_offer_token_and_duplicate_end_is_safe():
    registry = make_registry()
    session = await registry.register(registration())
    await registry.bind_peer(session, "peer")
    stopped = AsyncMock()
    await registry.attach_worker(session, "peer", stopped)
    await registry.mark_active(session)
    session.registration.expiresAt = datetime.now(UTC) - timedelta(seconds=1)
    assert registry.touch(session, str(session.attempt_id))
    await registry.sweep()
    assert session.state is SessionState.ACTIVE
    await asyncio.gather(registry.end(session.registration.sessionId, "user_ended"), registry.sweep())
    await registry.end(session.registration.sessionId, "user_ended")
    stopped.assert_awaited_once()


@pytest.mark.asyncio
async def test_ingestion_failure_does_not_prevent_other_expired_workers_stopping():
    registry = make_registry()
    registry._sink.emit.side_effect = RuntimeError("ingest unavailable")
    stopped = []
    # Registration sweeps the first session, so expire only once both exist.
    for user in ["first", "second"]:
        request = registration()
        request.userId = user
        session = await registry.register(request)
        await registry.bind_peer(session, user)
        stop = AsyncMock()
        await registry.attach_worker(session, user, stop)
        stopped.append((session, stop))
    for session, _ in stopped:
        session.registered_at -= 121
    with pytest.raises(RuntimeError):
        await registry.sweep()
    for session, stop in stopped:
        stop.assert_awaited_once()
        assert session.state is SessionState.ENDED


@pytest.mark.asyncio
async def test_old_terminal_callback_cannot_stop_replacement_worker():
    registry = make_registry()
    request = registration()
    old = await registry.register(request)
    await registry.end(request.sessionId, "reconnected")
    current = await registry.register(request)
    await registry.bind_peer(current, "new-peer")
    stopped = AsyncMock()
    await registry.attach_worker(current, "new-peer", stopped)
    await registry.end(request.sessionId, "duration_limit", expected_session=old)
    await registry.fail(request.sessionId, "client_disconnected", expected_session=old)
    stopped.assert_not_awaited()
    assert current.state is SessionState.AWAITING_CONNECTION


@pytest.mark.asyncio
async def test_disconnect_error_does_not_retain_capacity_or_worker_callback():
    registry = make_registry()
    session = await registry.register(registration())
    await registry.bind_peer(session, "peer")
    await registry.attach_worker(session, "peer", AsyncMock(side_effect=RuntimeError("close failed")))
    with pytest.raises(RuntimeError):
        await registry.end(session.registration.sessionId, "user_ended")
    assert session.state is SessionState.ENDED
    assert session.cancel_worker is None
    assert session.peer_id is None
    assert "peer" not in registry._peer_sessions
    await registry.end(session.registration.sessionId, "user_ended")
