"""Zamówienia z biura (PROTRIMA) — kurs, wyjazd kartonem, przeniesienie sztuk i palet, usunięcie kartonu.

Prefiks `/api/biuro` nie ma własnej reguły w `auth/permissions.py`, więc
obowiązuje domyślna: wyłącznie konta biura.
"""
from typing import List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.auth.audit import _subject_label
from app.services import biuro_zamowienia_service as svc

router = APIRouter(prefix="/api/biuro", tags=["biuro"])


def _operator(request: Request) -> str:
    s = getattr(request.state, "subject", None)
    if isinstance(s, dict) and s.get("name"):
        return str(s["name"])
    return _subject_label(s) or "biuro"


class ZakonczKurs(BaseModel):
    partial_confirmation: Optional[str] = None


class Wyjazd(BaseModel):
    vehicle_id: str
    container_ids: List[str]
    partial_confirmation: Optional[str] = None


class PozycjaPrzeniesienia(BaseModel):
    line_id: str
    qty: int = Field(ge=0)
    target_line_id: str = ""
    change_packaging: bool = False


class PrzeniesieniePalet(BaseModel):
    pallet_ids: List[str]
    target_order_id: str = ""
    new_delivery_date: str = ""


class Przeniesienie(BaseModel):
    target_order_id: str
    zrodlo: str
    items: List[PozycjaPrzeniesienia]


@router.get("/kursy-otwarte")
def kursy_otwarte():
    return svc.kursy_otwarte()


@router.get("/zaladunek-na-zywo")
def zaladunek_na_zywo():
    return svc.zaladunek_na_zywo()


@router.post("/kursy/{vehicle_id}/zakoncz")
def zakoncz_kurs(vehicle_id: str, body: ZakonczKurs, request: Request):
    return svc.zakoncz_kurs(vehicle_id, _operator(request), body.partial_confirmation)


@router.get("/zamowienia/{order_id}/kartony-do-wyjazdu")
def kartony_do_wyjazdu(order_id: str):
    return svc.kartony_do_wyjazdu(order_id)


@router.post("/zamowienia/{order_id}/wyjazd")
def wyjazd(order_id: str, body: Wyjazd, request: Request):
    return svc.wyjazd_z_biura(order_id, body.vehicle_id, body.container_ids,
                              _operator(request), body.partial_confirmation)


@router.get("/palety/{pallet_id}/przeniesienie")
def cele_przeniesienia(pallet_id: str):
    return svc.cele_przeniesienia(pallet_id)


@router.post("/palety/{pallet_id}/przeniesienie")
def przenies(pallet_id: str, body: Przeniesienie, request: Request):
    return svc.przenies_sztuki(pallet_id, body.target_order_id,
                               [i.model_dump() for i in body.items], body.zrodlo, _operator(request))


@router.post("/zamowienia/{order_id}/przenies-palety")
def przenies_palety(order_id: str, body: PrzeniesieniePalet, request: Request):
    """Całe palety (także zważone) do innego zamówienia klienta albo do nowego — kartki działają dalej."""
    from app.services.order_pallet_move_service import przenies_palety as przenies_cale
    return przenies_cale(order_id, body.pallet_ids, body.target_order_id, body.new_delivery_date, _operator(request))


@router.delete("/kartony-magazynowe/{carton_id}")
def usun_karton(carton_id: str, request: Request):
    return svc.usun_karton_magazynowy(carton_id, _operator(request))
