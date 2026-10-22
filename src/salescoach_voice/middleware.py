from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from .runtime import Runtime


class VoiceOriginMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if path != "/api/offer" and not path.startswith("/api/offer/"):
            return await call_next(request)

        current: Runtime = request.app.state.salescoach_voice
        allowed_origin = current.settings.web_app_origin.rstrip("/")
        origin = request.headers.get("origin")
        if origin and origin != allowed_origin:
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)

        response = Response(status_code=204) if request.method == "OPTIONS" else await call_next(request)
        if origin and origin == allowed_origin:
            response.headers["access-control-allow-origin"] = allowed_origin
            response.headers["vary"] = "Origin"
            response.headers["access-control-allow-methods"] = "POST, PATCH, OPTIONS"
            response.headers["access-control-allow-headers"] = "authorization, content-type"
            if "access-control-allow-credentials" in response.headers:
                del response.headers["access-control-allow-credentials"]
        return response
