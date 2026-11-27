"""Projektor etykiet kebabów (PROTRIMA): szablony A4/Zebra, import PRN, dobór dla planu.

Prefiks bez własnej reguły w `auth/permissions.py` — domyślnie konta biura.
"""
from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.auth.audit import _subject_label
from app.models.label_designs import LabelDesignSave
from app.services import label_designs_service as svc

router = APIRouter(prefix="/api/label-designs", tags=["label-designs"])


def _operator(request: Request) -> str:
    s = getattr(request.state, "subject", None)
    if isinstance(s, dict) and s.get("name"):
        return str(s["name"])
    return _subject_label(s) or "biuro"


@router.get("")
def list_designs():
    return {"data": svc.list_designs()}


@router.post("/import-prn")
async def import_prn(file: UploadFile = File(...), roll_width_mm: float = 0, roll_height_mm: float = 0):
    """Plik .prn z ZebraDesigner → tło etykiety (nic nie idzie do drukarki)."""
    from starlette.concurrency import run_in_threadpool
    from app.services.label_prn_import import MAX_BYTES, PrnImportError, import_prn as importuj
    try:
        dane = await file.read(MAX_BYTES + 1)
        rolka = (roll_width_mm, roll_height_mm) if roll_width_mm > 0 and roll_height_mm > 0 else None
        return await run_in_threadpool(lambda: importuj(dane, roll_mm=rolka))
    except PrnImportError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        await file.close()


@router.put("")
def save_design(dto: LabelDesignSave, request: Request):
    return svc.save_design(dto.model_dump(), _operator(request))


@router.get("/{design_id}")
def get_design(design_id: str):
    return svc.get_design(design_id)


@router.delete("/{design_id}")
def delete_design(design_id: str):
    return svc.delete_design(design_id)
