"""Token renderowania PDF otwiera tylko ODCZYT.

Znalezione w próbie PROTRIMA (30.10.2026): ważny render_token przepuszczał przez uwierzytelnienie
każde żądanie /api dowolną metodą (sprawdzone: DELETE przechodził). Headless Chrome tylko czyta dane
strony wydruku — token ma działać wyłącznie dla GET/HEAD; zapis wymaga zwykłej sesji.
"""
import asyncio

import httpx
from fastapi import FastAPI

from app.auth import middleware
from app.auth.render_token import make_render_token


def _app(monkeypatch):
    monkeypatch.setattr(middleware.auth_service, "resolve_session", lambda token: None)
    app = FastAPI()
    app.middleware("http")(middleware.auth_middleware)

    @app.get("/api/wz/{wz_id}")
    def pokaz(wz_id: str):
        return {"id": wz_id}

    @app.delete("/api/wz/{wz_id}")
    def usun(wz_id: str):
        return {"usunieto": wz_id}

    return app


def _run(app, fn):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://srv") as c:
            return await fn(c)
    return asyncio.run(go())


def test_token_wydruku_czyta_dane_strony(monkeypatch):
    app = _app(monkeypatch)
    tok = make_render_token(ttl=60)
    r = _run(app, lambda c: c.get("/api/wz/1", headers={"x-render-token": tok}))
    assert r.status_code == 200


def test_token_wydruku_nie_otwiera_zapisu(monkeypatch):
    app = _app(monkeypatch)
    tok = make_render_token(ttl=60)
    naglowek = _run(app, lambda c: c.delete("/api/wz/1", headers={"x-render-token": tok}))
    w_adresie = _run(app, lambda c: c.delete(f"/api/wz/1?render_token={tok}"))
    assert naglowek.status_code == 401
    assert w_adresie.status_code == 401
