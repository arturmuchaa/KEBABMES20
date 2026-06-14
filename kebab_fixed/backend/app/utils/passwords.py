"""Hashowanie sekretów (hasła biura, PIN-y operatorów) — bcrypt."""
from __future__ import annotations

import bcrypt


def hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_secret(secret: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(secret.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError, AttributeError):
        return False
