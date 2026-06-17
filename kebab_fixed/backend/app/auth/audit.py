"""Middleware audytu — loguje żądania zmieniające stan (kto/co/kiedy).

Best-effort: zapis do `audit_log` NIGDY nie może wywrócić żądania użytkownika.
Loguje POST/PUT/PATCH/DELETE na /api/ (poza /health). Subject pochodzi z
sesji ustawionej przez auth_middleware (request.state.subject).
"""
from __future__ import annotations

from fastapi import Request

from app.db import execute
from app.logging_config import get_logger

logger = get_logger(__name__)

_AUDITED_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def _subject_label(subject) -> str | None:
    if isinstance(subject, dict):
        return (subject.get("login") or subject.get("subject")
                or subject.get("user_id") or subject.get("id"))
    return str(subject) if subject else None


async def audit_middleware(request: Request, call_next):
    response = await call_next(request)
    try:
        method = request.method
        path = request.url.path
        if (method in _AUDITED_METHODS
                and path.startswith("/api/")
                and "/health" not in path):
            subject = getattr(request.state, "subject", None)
            ip = request.client.host if request.client else None
            execute(
                "INSERT INTO audit_log (subject, method, path, status, ip) "
                "VALUES (%s,%s,%s,%s,%s)",
                (_subject_label(subject), method, path,
                 getattr(response, "status_code", None), ip),
            )
    except Exception:
        logger.warning("audit.log.write_failed", exc_info=True)
    return response
