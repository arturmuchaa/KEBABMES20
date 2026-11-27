"""Projektor etykiet kebabów (PROTRIMA): szablony A4/Zebra, import PRN, dobór dla planu.

Prefiks bez własnej reguły w `auth/permissions.py` — domyślnie konta biura.
"""
from fastapi import APIRouter, Request

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


@router.put("")
def save_design(dto: LabelDesignSave, request: Request):
    return svc.save_design(dto.model_dump(), _operator(request))


@router.get("/{design_id}")
def get_design(design_id: str):
    return svc.get_design(design_id)


@router.delete("/{design_id}")
def delete_design(design_id: str):
    return svc.delete_design(design_id)
