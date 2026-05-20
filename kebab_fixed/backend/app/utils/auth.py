"""Authentication helpers.

Currently provides only :func:`require_admin`, a FastAPI dependency that
guards endpoints under ``/api/admin/*``.

Soft mode (``settings.admin_token`` empty): every call logs a warning but
proceeds — preserves backward compatibility while production sets the env.
Hard mode (token configured): missing or mismatched ``X-Admin-Token``
returns 401.
"""
from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(__name__)


def require_admin(x_admin_token: str | None = Header(default=None, alias="X-Admin-Token")) -> None:
    """FastAPI dependency: validate the admin token on protected endpoints."""
    configured = (settings.admin_token or "").strip()
    if not configured:
        logger.warning(
            "admin.auth.soft_mode",
            extra={"hint": "ADMIN_TOKEN env not set — admin endpoints unprotected"},
        )
        return
    if not x_admin_token or x_admin_token != configured:
        logger.warning(
            "admin.auth.denied",
            extra={"has_header": bool(x_admin_token)},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nieprawidłowy token administratora",
        )
