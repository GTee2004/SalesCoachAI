"""Connection timeouts and retries for the websocket STT and TTS services.

Pipecat 1.12's defaults wait 10 s to open a socket, never retry a failed first
connect, reconnect in a fixed 4 s rhythm without jitter, accept a reconnect
before the provider has answered, and let a send block for as long as the OS
keeps a dead connection open. Mix ``ResilientWebsocket`` in ahead of the pipecat
service class to replace those. It relies on pipecat's WebsocketService hooks
(pinned version): ``_websocket_connect``, ``_try_reconnect``,
``_reconnect_websocket`` and ``_verify_connection``.
"""

import asyncio
import logging
import random

from pipecat.services.websocket_service import _BoundedCloseConnection
from pipecat.utils.errors import classify_http_exception
from websockets.protocol import State

logger = logging.getLogger("uvicorn.error.salescoach_voice")

OPEN_TIMEOUT_SECONDS = 5.0
# Opening a socket at session start is retried this many times in all. Later
# connects go through pipecat's reconnect loop instead.
FIRST_CONNECT_ATTEMPTS = 3
# Reconnect attempts after a drop, waiting 1, 2, 4 and 4 s after each failure.
RECONNECT_ATTEMPTS = 4
RECONNECT_MIN_WAIT_SECONDS = 1.0
RECONNECT_MAX_WAIT_SECONDS = 4.0
# Spreads the reconnects of concurrent sessions after a provider blip.
RECONNECT_JITTER_SECONDS = 0.5
PONG_TIMEOUT_SECONDS = 2.0
# Audio is 32 KB/s, so a send only waits this long when the connection has
# stopped accepting data, as a half-open socket does.
SEND_TIMEOUT_SECONDS = 2.0


class SendTimeoutConnection(_BoundedCloseConnection):
    """A connection that drops itself when a send stalls.

    websockets waits without limit for a full send buffer to drain, and its
    keep-alive ping queues behind the same buffer, so a peer that vanished
    without closing is never detected. Aborting the transport ends the receive
    loop with a connection error, which starts pipecat's reconnect.
    """

    async def send(self, message, text=None) -> None:
        try:
            async with asyncio.timeout(SEND_TIMEOUT_SECONDS):
                await super().send(message, text=text)
        except TimeoutError:
            logger.warning("Websocket send stalled for %.0fs; dropping the connection", SEND_TIMEOUT_SECONDS)
            self.transport.abort()
            raise


def transient_connect_error(error: Exception) -> bool:
    """Whether opening the socket again could succeed, e.g. not a rejected key."""
    return not classify_http_exception(error).is_permanent


class ResilientWebsocket:
    """Mixin for pipecat websocket STT/TTS services; list it before the service."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._reconnect_backoff_min_wait = RECONNECT_MIN_WAIT_SECONDS
        self._reconnect_backoff_max_wait = RECONNECT_MAX_WAIT_SECONDS
        self._first_connect_done = False

    async def _websocket_connect(self, uri: str, **kwargs):
        kwargs.setdefault("open_timeout", OPEN_TIMEOUT_SECONDS)
        kwargs.setdefault("create_connection", SendTimeoutConnection)
        # Retry only the session's first connect here. A failed one leaves the
        # service with no receive loop, so nothing else would ever retry it.
        attempts = 1 if self._first_connect_done or self._reconnect_in_progress else FIRST_CONNECT_ATTEMPTS
        self._first_connect_done = True
        for attempt in range(1, attempts + 1):
            try:
                return await super()._websocket_connect(uri, **kwargs)
            except Exception as error:
                if attempt == attempts or not transient_connect_error(error):
                    raise
                logger.warning("%s connect attempt %d failed: %s", self, attempt, error)
                await asyncio.sleep(
                    attempt * RECONNECT_MIN_WAIT_SECONDS / 2 + random.uniform(0, RECONNECT_JITTER_SECONDS)
                )

    async def _try_reconnect(self, max_retries: int = RECONNECT_ATTEMPTS, report_error=None) -> bool:
        return await super()._try_reconnect(max_retries=RECONNECT_ATTEMPTS, report_error=report_error)

    async def _reconnect_websocket(self, attempt_number: int) -> bool:
        await asyncio.sleep(random.uniform(0, RECONNECT_JITTER_SECONDS))
        return await super()._reconnect_websocket(attempt_number)

    async def _verify_connection(self) -> bool:
        """Count a reconnect only once the provider has answered a ping."""
        try:
            if not self._websocket or self._websocket.state is State.CLOSED:
                return False
            pong = await self._websocket.ping()
            await asyncio.wait_for(pong, PONG_TIMEOUT_SECONDS)
            return True
        except Exception as error:
            logger.warning("%s connection verification failed: %r", self, error)
            return False


class FirstConnectRequired:
    """Mixin that marks a service unusable when its first connect fails.

    List it ahead of ``ResilientWebsocket``. With no receive loop nothing would
    ever retry that connect, and saying so lets a backup take over.
    """

    async def _websocket_connect(self, uri: str, **kwargs):
        # Read before ResilientWebsocket marks the first connect as done.
        first_connect = not self._first_connect_done and not self._reconnect_in_progress
        try:
            return await super()._websocket_connect(uri, **kwargs)
        except Exception:
            if first_connect:
                await self.set_usable(False)
            raise
