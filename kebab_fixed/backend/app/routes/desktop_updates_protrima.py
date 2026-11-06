"""Kanał aktualizacji PROTRIMA — programu biura (pl.protrima.biuro).

Osobny manifest i katalog, jak kanały kiosków: PROTRIMA ma własny instalator
(`tauri.protrima.conf.json`, workflow `tauri-protrima.yml`). Gdyby współdzieliła
/api/desktop-updates/latest.json ze starym programem biura, jeden program
zainstalowałby się w miejsce drugiego.

Różnica względem kiosków: przywrócenie wersji wymaga tokenu administratora
serwera (`X-Admin-Token`, jak publikacja z CI). Biuro nie ma kodu serwisowego
hali, a trasy `/api/desktop-updates/*` są publiczne (updater nie ma konta).

Trasy wymagane przez `tests/test_kanaly_aktualizacji.py` (kanał z workflowu
musi mieć publikację i manifest, inaczej zielony build przy 405).
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse

from app.config import settings
from app.logging_config import get_logger
from app.utils.auth import require_admin

logger = get_logger(__name__)

router = APIRouter(tags=["desktop-updates-protrima"])

_UPDATES_DIR = settings.desktop_updates_dir / "protrima"
_META_FILE = _UPDATES_DIR / "latest-meta.json"


def _version_meta_file(version: str) -> Path:
    safe = version.strip().replace("/", "").replace("\\", "").replace("..", "")
    return _UPDATES_DIR / f"meta-{safe}.json"


def _load_version_meta(version: str) -> dict | None:
    f = _version_meta_file(version)
    if not f.is_file():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None


def _safe_name(name: str) -> str:
    cleaned = Path(name or "").name.strip().replace(" ", ".")
    if not cleaned:
        raise HTTPException(400, "Brak nazwy instalatora")
    return cleaned


def _load_meta() -> dict | None:
    if not _META_FILE.is_file():
        return None
    try:
        return json.loads(_META_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.exception("desktop_updates_protrima.meta_invalid", extra={"error": str(exc)})
        raise HTTPException(500, "Uszkodzone metadane aktualizacji")


def _manifest_payload(request: Request, meta: dict) -> dict:
    return {
        "version": meta["version"],
        "notes": meta.get("notes", ""),
        "pub_date": meta.get("pub_date"),
        "url": str(request.url_for("desktop_update_protrima_download", filename=meta["filename"])),
        "signature": meta["signature"],
    }


@router.get("/api/desktop-updates/protrima/latest.json")
def desktop_update_protrima_manifest(request: Request):
    meta = _load_meta()
    if not meta:
        return Response(status_code=204)
    if not (_UPDATES_DIR / meta["filename"]).is_file():
        logger.warning("desktop_updates_protrima.bundle_missing", extra={"bundle": meta["filename"]})
        return Response(status_code=204)
    return _manifest_payload(request, meta)


@router.get("/api/desktop-updates/protrima/latest-installer")
def desktop_update_protrima_latest_installer(request: Request):
    """Stały link do najnowszego instalatora — pierwsza instalacja na nowym komputerze biura."""
    meta = _load_meta()
    if not meta:
        raise HTTPException(404, "Brak opublikowanej wersji PROTRIMA")
    return RedirectResponse(url=str(request.url_for("desktop_update_protrima_download", filename=meta["filename"])))


@router.get("/api/desktop-updates/protrima/download/{filename}", name="desktop_update_protrima_download")
def desktop_update_protrima_download(filename: str):
    safe_name = _safe_name(filename)
    bundle = (_UPDATES_DIR / safe_name).resolve()
    root = _UPDATES_DIR.resolve()
    if root not in bundle.parents or not bundle.is_file():
        raise HTTPException(404, "Instalator nie istnieje")
    return FileResponse(bundle, media_type="application/octet-stream", filename=safe_name)


@router.post("/api/admin/desktop-updates/protrima/publish", dependencies=[Depends(require_admin)])
async def publish_desktop_update_protrima(
    request: Request,
    version: str = Query(...),
    signature: str = Query(...),
    filename: str = Query(...),
    notes: str = Query("Nowa wersja PROTRIMA"),
    pub_date: str = Query(""),
):
    safe_name = _safe_name(filename)
    if not version.strip():
        raise HTTPException(400, "Brak wersji aktualizacji")
    if not signature.strip():
        raise HTTPException(400, "Brak podpisu aktualizacji")
    payload = await request.body()
    if not payload:
        raise HTTPException(400, "Brak pliku instalatora")

    _UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    (_UPDATES_DIR / safe_name).write_bytes(payload)

    meta = {
        "version": version.strip(),
        "signature": signature.strip(),
        "filename": safe_name,
        "notes": notes.strip() or f"Nowa wersja PROTRIMA {version.strip()}",
        "pub_date": pub_date.strip(),
    }
    _META_FILE.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")
    # Manifest per wersja — przywrócenie dowolnej wcześniejszej wersji bez utraty podpisu.
    _version_meta_file(meta["version"]).write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")
    logger.info("desktop_updates_protrima.published", extra={"version": meta["version"], "installer": safe_name})
    return {
        "ok": True,
        "manifest": _manifest_payload(request, meta),
        "downloadUrl": str(request.url_for("desktop_update_protrima_latest_installer")),
    }


@router.get("/api/desktop-updates/protrima/versions")
def desktop_update_protrima_versions():
    """Wersje możliwe do przywrócenia (manifest per wersja + plik instalatora)."""
    current = (_load_meta() or {}).get("version")
    out = []
    for f in _UPDATES_DIR.glob("meta-*.json"):
        try:
            m = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if (_UPDATES_DIR / m.get("filename", "")).is_file():
            out.append({"version": m["version"], "pubDate": m.get("pub_date", "")})
    out.sort(key=lambda x: [int(p) for p in x["version"].split(".") if p.isdigit()], reverse=True)
    return {"current": current, "versions": out}


@router.post("/api/admin/desktop-updates/protrima/rollback", dependencies=[Depends(require_admin)])
def desktop_update_protrima_rollback(body: dict = Body(...)):
    """Przywróć wskazaną wersję jako `latest` (zła aktualizacja). Program biura instaluje
    każdą INNĄ wersję niż własna, więc przywrócona starsza wersja też do niego trafi."""
    version = str(body.get("version") or "").strip()
    if not version:
        raise HTTPException(400, "Brak wersji do przywrócenia")
    meta = _load_version_meta(version)
    if not meta:
        raise HTTPException(404, f"Brak manifestu wersji {version}")
    if not (_UPDATES_DIR / meta["filename"]).is_file():
        raise HTTPException(404, f"Brak instalatora {meta['filename']} na serwerze")
    meta = {**meta, "notes": f"PRZYWRÓCONA wersja {version}"}
    _META_FILE.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")
    logger.warning("desktop_updates_protrima.rollback", extra={"restored": version})
    return {"ok": True, "version": version}
