"""Kanał aktualizacji PROTRIMA (program biura, pl.protrima.biuro).

Do 0.6.x każda wersja PROTRIMA była ręczną instalacją artefaktu z GitHuba (ważnego 30 dni) —
przy kilku komputerach biura nie do utrzymania. Kanał działa jak kanały kiosków, z jedną różnicą:
przywrócenie wersji też wymaga tokenu administratora serwera (biuro nie ma kodu serwisowego hali,
a kanał jest publiczny dla updatera).
"""
import asyncio
from dataclasses import replace

import httpx
from fastapi import FastAPI

from app.config import settings
from app.routes import desktop_updates_protrima as kanal
from app.utils import auth

TOKEN = "tajny-token-ci"


def _app(monkeypatch, tmp_path):
    monkeypatch.setattr(kanal, "_UPDATES_DIR", tmp_path)
    monkeypatch.setattr(kanal, "_META_FILE", tmp_path / "latest-meta.json")
    monkeypatch.setattr(auth, "settings", replace(settings, admin_token=TOKEN))
    app = FastAPI()
    app.include_router(kanal.router)
    return app


def _run(app, fn):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://srv") as c:
            return await fn(c)
    return asyncio.run(go())


def _publikuj(c, wersja, token=TOKEN):
    return c.post(
        "/api/admin/desktop-updates/protrima/publish",
        params={"version": wersja, "signature": f"podpis-{wersja}", "filename": f"PROTRIMA_{wersja}_x64-setup.exe"},
        headers={"X-Admin-Token": token} if token else {},
        content=b"MZ-instalator",
    )


def test_bez_publikacji_manifest_pusty(monkeypatch, tmp_path):
    app = _app(monkeypatch, tmp_path)
    r = _run(app, lambda c: c.get("/api/desktop-updates/protrima/latest.json"))
    assert r.status_code == 204


def test_publikacja_tylko_z_tokenem_i_manifest_dla_updatera(monkeypatch, tmp_path):
    app = _app(monkeypatch, tmp_path)

    async def scenariusz(c):
        bez = await _publikuj(c, "0.7.0", token=None)
        zly = await _publikuj(c, "0.7.0", token="zly")
        ok = await _publikuj(c, "0.7.0")
        manifest = await c.get("/api/desktop-updates/protrima/latest.json")
        plik = await c.get(manifest.json()["url"].replace("http://srv", ""))
        return bez, zly, ok, manifest, plik

    bez, zly, ok, manifest, plik = _run(app, scenariusz)
    assert bez.status_code in (401, 403) and zly.status_code in (401, 403)
    assert ok.status_code == 200
    m = manifest.json()
    assert m["version"] == "0.7.0" and m["signature"] == "podpis-0.7.0"
    assert m["url"].endswith("/api/desktop-updates/protrima/download/PROTRIMA_0.7.0_x64-setup.exe")
    assert plik.status_code == 200 and plik.content == b"MZ-instalator"


def test_przywrocenie_wersji_tylko_z_tokenem(monkeypatch, tmp_path):
    app = _app(monkeypatch, tmp_path)

    async def scenariusz(c):
        await _publikuj(c, "0.7.0")
        await _publikuj(c, "0.7.1")
        wersje = await c.get("/api/desktop-updates/protrima/versions")
        bez = await c.post("/api/admin/desktop-updates/protrima/rollback", json={"version": "0.7.0"})
        ok = await c.post("/api/admin/desktop-updates/protrima/rollback", json={"version": "0.7.0"}, headers={"X-Admin-Token": TOKEN})
        manifest = await c.get("/api/desktop-updates/protrima/latest.json")
        return wersje, bez, ok, manifest

    wersje, bez, ok, manifest = _run(app, scenariusz)
    assert wersje.json()["current"] == "0.7.1"
    assert [v["version"] for v in wersje.json()["versions"]] == ["0.7.1", "0.7.0"]
    assert bez.status_code in (401, 403)
    assert ok.status_code == 200
    assert manifest.json()["version"] == "0.7.0"


def test_pobieranie_poza_katalogiem_kanalu_odrzucone(monkeypatch, tmp_path):
    app = _app(monkeypatch, tmp_path)
    (tmp_path.parent / "sekret.txt").write_text("x")
    r = _run(app, lambda c: c.get("/api/desktop-updates/protrima/download/..%2Fsekret.txt"))
    assert r.status_code == 404
