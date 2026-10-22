"""Connection authentication shim for Pipecat 1.12's Soniox services.

Remove the header override once Pipecat sends Authorization headers itself.
Soniox accepts the same key in the header and Pipecat's config message.
"""

from pipecat.services.soniox.stt import SonioxSTTService
from pipecat.services.soniox.tts import SonioxTTSService
from websockets.datastructures import Headers

from .websocket import ResilientWebsocket


class AuthenticatedSonioxSTTService(ResilientWebsocket, SonioxSTTService):
    async def _websocket_connect(self, uri: str, **kwargs):
        headers = Headers(kwargs.get("additional_headers") or {})
        headers.pop("Authorization", None)
        headers["Authorization"] = f"Bearer {self._api_key}"
        kwargs["additional_headers"] = headers
        return await super()._websocket_connect(uri, **kwargs)


class AuthenticatedSonioxTTSService(ResilientWebsocket, SonioxTTSService):
    async def _websocket_connect(self, uri: str, **kwargs):
        headers = Headers(kwargs.get("additional_headers") or {})
        headers.pop("Authorization", None)
        headers["Authorization"] = f"Bearer {self._api_key}"
        kwargs["additional_headers"] = headers
        return await super()._websocket_connect(uri, **kwargs)
