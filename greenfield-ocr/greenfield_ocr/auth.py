"""Pure authentication helpers — password hashing (PBKDF2-HMAC-SHA256) and a
minimal HS256 JWT — implemented on the standard library only.

Kept free of FastAPI / database imports so the security-critical logic can be
unit-tested offline (no API key, no DB). ``api.py`` wires these into HTTP
endpoints and translates :class:`TokenError` into the right HTTP responses.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

PBKDF2_ITERATIONS = 200_000


class TokenError(Exception):
    """Raised when a token is malformed, badly signed, or expired."""


# ── password hashing ─────────────────────────────────────────────────────────
def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${dk.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = encoded.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# ── JWT (HS256) ──────────────────────────────────────────────────────────────
def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64url_decode(seg: str) -> bytes:
    return base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))


def make_token(user_id: str, email: str, secret: str, ttl_seconds: int, now: int | None = None) -> str:
    now = int(time.time()) if now is None else now
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": user_id, "email": email, "iat": now, "exp": now + ttl_seconds}
    signing_input = (
        _b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64url(json.dumps(payload, separators=(",", ":")).encode())
    )
    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + _b64url(sig)


def decode_token(token: str, secret: str, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    try:
        signing_input, sig_seg = token.rsplit(".", 1)
        expected = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url(expected), sig_seg):
            raise TokenError("bad signature")
        payload = json.loads(_b64url_decode(signing_input.split(".", 1)[1]))
    except TokenError:
        raise
    except Exception as exc:  # malformed structure / bad base64 / bad json
        raise TokenError("malformed token") from exc
    if int(payload.get("exp", 0)) < now:
        raise TokenError("token expired")
    return payload
