"""Manifest aktualizacji dla samodzielnego kiosku Tauri "Rozbiór HMI v10".

Kopia wzorca z app/routes/desktop_updates.py, celowo NIE reużywa tego samego
pliku/katalogu meta — kiosk to osobny produkt (osobny identifier w Tauri
config, osobny cykl wydań rozbior-v10-*.tag), więc musi mieć własny manifest.
Gdyby współdzielił /api/desktop-updates/latest.json z główną aplikacją,
kiosk pobrałby i zainstalował PEŁNĄ aplikację (z routerem/przełącznikiem
wersji) zamiast własnej kolejnej wersji — to właśnie miał uniknąć wyłączony
wcześniej auto-updater w kiosku.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse

from app.config import settings
from app.logging_config import get_logger
from app.utils.auth import require_admin

logger = get_logger(__name__)

router = APIRouter(tags=["desktop-updates-rozbior-v10"])

_UPDATES_DIR = settings.desktop_updates_dir / "rozbior-v10"
_META_FILE = _UPDATES_DIR / "latest-meta.json"


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
        logger.exception("desktop_updates_rozbior_v10.meta_invalid", extra={"error": str(exc)})
        raise HTTPException(500, "Uszkodzone metadane aktualizacji")


def _manifest_payload(request: Request, meta: dict) -> dict:
    return {
        "version": meta["version"],
        "notes": meta.get("notes", ""),
        "pub_date": meta.get("pub_date"),
        "url": str(request.url_for("desktop_update_rozbior_v10_download", filename=meta["filename"])),
        "signature": meta["signature"],
    }


@router.get("/api/desktop-updates/rozbior-v10/latest.json")
def desktop_update_rozbior_v10_manifest(request: Request):
    meta = _load_meta()
    if not meta:
        return Response(status_code=204)
    bundle = _UPDATES_DIR / meta["filename"]
    if not bundle.is_file():
        logger.warning("desktop_updates_rozbior_v10.bundle_missing", extra={"filename": meta["filename"]})
        return Response(status_code=204)
    return _manifest_payload(request, meta)


@router.get("/api/desktop-updates/rozbior-v10/latest-installer")
def desktop_update_rozbior_v10_latest_installer(request: Request):
    meta = _load_meta()
    if not meta:
        raise HTTPException(404, "Brak opublikowanej aktualizacji")
    return RedirectResponse(url=str(request.url_for("desktop_update_rozbior_v10_download", filename=meta["filename"])))


@router.get("/api/desktop-updates/rozbior-v10/download/{filename}", name="desktop_update_rozbior_v10_download")
def desktop_update_rozbior_v10_download(filename: str):
    safe_name = _safe_name(filename)
    bundle = (_UPDATES_DIR / safe_name).resolve()
    root = _UPDATES_DIR.resolve()
    if root not in bundle.parents or not bundle.is_file():
        raise HTTPException(404, "Instalator nie istnieje")
    return FileResponse(bundle, media_type="application/octet-stream", filename=safe_name)


@router.post("/api/admin/desktop-updates/rozbior-v10/publish", dependencies=[Depends(require_admin)])
async def publish_desktop_update_rozbior_v10(
    request: Request,
    version: str = Query(...),
    signature: str = Query(...),
    filename: str = Query(...),
    notes: str = Query("Nowa wersja HMI Rozbiór v10"),
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
    target = _UPDATES_DIR / safe_name
    with target.open("wb") as fh:
        fh.write(payload)

    meta = {
        "version": version.strip(),
        "signature": signature.strip(),
        "filename": safe_name,
        "notes": notes.strip() or f"Nowa wersja HMI Rozbiór v10 {version.strip()}",
        "pub_date": pub_date.strip(),
    }
    _META_FILE.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")
    logger.info("desktop_updates_rozbior_v10.published", extra={"version": meta["version"], "installer": safe_name})
    return {
        "ok": True,
        "manifest": _manifest_payload(request, meta),
        "downloadUrl": str(request.url_for("desktop_update_rozbior_v10_latest_installer")),
    }
