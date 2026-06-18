"""Middleware HTTP: egzekwuje uprawnienia wg mapy prefiks→dostęp."""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.auth.permissions import can_access, permission_for_path
from app.auth.render_token import verify_render_token
from app.services import auth_service


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    return auth[7:] if auth.lower().startswith("bearer ") else ""


async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Tylko API podlega kontroli; SPA/asset/print przepuszczamy do routingu niżej
    if not path.startswith("/api/"):
        return await call_next(request)

    # Preflight CORS musi dojść do CORSMiddleware (inaczej brak naglowkow CORS → SPA pada)
    if request.method == "OPTIONS":
        return await call_next(request)

    required = permission_for_path(path, request.method)
    request.state.subject = None

    if required == "public":
        return await call_next(request)

    # Token renderowania PDF (headless chrome) — dostęp do stron danych dla wydruku
    rtok = request.headers.get("x-render-token") or request.query_params.get("render_token")
    if rtok and verify_render_token(rtok):
        return await call_next(request)

    subject = auth_service.resolve_session(_bearer(request))
    request.state.subject = subject

    if not can_access(subject, required):
        code = 401 if subject is None else 403
        return JSONResponse({"detail": "Brak dostępu"}, status_code=code)

    return await call_next(request)
