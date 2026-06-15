"""Krótkożyciowy podpisany token do renderowania stron wydruku przez headless chrome."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time

_DEFAULT_SECRET = secrets.token_urlsafe(32)


def make_render_token(secret: str | None = None, ttl: int = 60) -> str:
    secret = secret or _DEFAULT_SECRET
    exp = int(time.time()) + ttl
    sig = hmac.new(secret.encode(), str(exp).encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def verify_render_token(token: str, secret: str | None = None) -> bool:
    secret = secret or _DEFAULT_SECRET
    try:
        exp_str, sig = token.split(".", 1)
        exp = int(exp_str)
    except (ValueError, AttributeError):
        return False
    if exp < int(time.time()):
        return False
    expected = hmac.new(secret.encode(), exp_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)
