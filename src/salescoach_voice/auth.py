import hmac
import time
from dataclasses import dataclass, field

import jwt
from fastapi import Header, HTTPException, status

from .config import Settings


def verify_control_key(settings: Settings, authorization: str | None) -> None:
    prefix = "Bearer "
    supplied = authorization[len(prefix) :] if authorization and authorization.startswith(prefix) else ""
    expected = settings.voice_control_api_key.get_secret_value()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@dataclass
class NonceStore:
    _used: dict[str, int] = field(default_factory=dict)

    def consume(self, nonce: str, expires_at: int) -> bool:
        now = int(time.time())
        self._used = {key: expiry for key, expiry in self._used.items() if expiry > now}
        if nonce in self._used:
            return False
        self._used[nonce] = expires_at
        return True


def verify_connection_token(
    token: str, settings: Settings, nonces: NonceStore, *, consume_nonce: bool = True
) -> dict[str, str]:
    try:
        payload = jwt.decode(
            token,
            settings.voice_token_secret.get_secret_value(),
            algorithms=["HS256"],
            audience="salescoach-voice",
            options={"require": ["sub", "sid", "nonce", "iat", "exp", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    if consume_nonce and not nonces.consume(str(payload["nonce"]), int(payload["exp"])):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Token nonce already used")
    return {
        "user_id": str(payload["sub"]),
        "session_id": str(payload["sid"]),
        "attempt_id": str(payload.get("aid", "")),
    }


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return authorization[7:]
