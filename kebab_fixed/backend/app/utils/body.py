"""Helpers for dealing with legacy snake_case/camelCase request bodies."""
from __future__ import annotations

from typing import Any, Dict


def body_get(body: Dict[str, Any], snake_key: str, default: Any = None) -> Any:
    """Read a value from a dict accepting both snake_case and camelCase."""
    if snake_key in body:
        return body[snake_key]
    parts = snake_key.split("_")
    camel = parts[0] + "".join(p.title() for p in parts[1:])
    return body.get(camel, default)
