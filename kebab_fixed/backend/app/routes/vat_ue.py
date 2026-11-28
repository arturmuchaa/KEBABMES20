"""Kontrola VAT UE odbiorców (VIES) — sprawdzenie, przy kursie, historia."""
from typing import Optional

from fastapi import APIRouter, Body, Request

from app.auth.audit import _subject_label
from app.services import vat_ue_service as svc

router = APIRouter(prefix="/api/vat-ue", tags=["vat-ue"])

_KONTEKSTY = {"reczne", "kartoteka", "wz", "kurs"}


def _operator(request: Request) -> str:
    return _subject_label(getattr(request.state, "subject", None)) or ""


@router.post("/sprawdz-klienta/{client_id}")
def sprawdz_klienta(client_id: str, body: Optional[dict] = Body(None), request: Request = None):
    b = body or {}
    kontekst = b.get("context") if b.get("context") in _KONTEKSTY else "reczne"
    return svc.sprawdz_klienta(client_id, context=kontekst, order_id=b.get("order_id") or None,
                               wz_id=b.get("wz_id") or None, operator=_operator(request))


@router.post("/sprawdz-kurs/{loading_id}")
def sprawdz_kurs(loading_id: str, request: Request):
    return svc.sprawdz_kurs(loading_id, operator=_operator(request))


@router.get("/historia/{client_id}")
def historia(client_id: str):
    return svc.historia(client_id)
