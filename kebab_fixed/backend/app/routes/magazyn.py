"""Kiosk magazynu — pakowanie kartonów i stan pod kaflami ekranu startowego.

Zapis sztuki idzie przez istniejące ścieżki (`pack_unit_into_pallet`,
`scan_unit_into_carton`) — tu żyje tylko decyzja, DO KTÓREGO kartonu.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from app.auth.audit import _subject_label
from app.services.packing_correction_service import undo_pack
from pydantic import BaseModel

from app.services import magazyn_pakowanie_service as svc
from app.services import mroznia_wazenie_service, settings_service

router = APIRouter(prefix="/api/magazyn", tags=["magazyn"])


class SkanSztuki(BaseModel):
    code: str
    active_id: Optional[str] = None


@router.get("/podsumowanie")
def podsumowanie():
    return svc.podsumowanie_kafli()


@router.get("/pakowanie")
def pakowanie():
    return svc.stan_pakowania()


@router.post("/pakowanie/skan")
def pakowanie_skan(body: SkanSztuki):
    return svc.skanuj_sztuke(body.code, body.active_id)


class SkanKodu(BaseModel):
    code: str


class KorektaPakowania(BaseModel):
    code: str
    container_id: str


@router.post("/pakowanie/cofnij")
def cofnij_pakowanie(body: KorektaPakowania, request: Request):
    return undo_pack(body.code, body.container_id,
                     _subject_label(getattr(request.state, "subject", None)) or "")


@router.post("/mroznia/karton")
def mroznia_karton(body: SkanKodu):
    """Karta pełnego kartonu magazynowego = wjazd do mroźni."""
    return svc.wstaw_karton_do_mrozni(body.code)


@router.get("/mroznia/kartony")
def mroznia_kartony():
    return svc.kartony_w_mrozni()


# ── Ważenie pełnego kartonu przy wjeździe do mroźni (29.09.2026) ───────────

def _operator(request: Request) -> str:
    s = getattr(request.state, "subject", None)
    if isinstance(s, dict) and s.get("name"):
        return str(s["name"])
    return _subject_label(s) or ""


class ZapisPalet(BaseModel):
    pallets: list


class Wazenie(BaseModel):
    code: str
    pallet_type_id: str
    gross_kg: float
    mode: str = "auto"


@router.get("/mroznia/palety")
def mroznia_palety():
    return {"pallets": settings_service.get_pallet_types()}


@router.put("/mroznia/palety")
def mroznia_palety_zapis(body: ZapisPalet):
    try:
        return {"pallets": settings_service.save_pallet_types(body.pallets)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/mroznia/sprawdz")
def mroznia_sprawdz(body: SkanKodu):
    """Co to za karton, czy pełny (= ważenie obowiązkowe), netto i skład."""
    return mroznia_wazenie_service.sprawdz(body.code)


@router.post("/mroznia/wazenie")
def mroznia_wazenie(body: Wazenie, request: Request):
    return mroznia_wazenie_service.zwaz_i_wstaw(
        body.code, body.pallet_type_id, body.gross_kg, body.mode, _operator(request))


@router.get("/mroznia/wazenie/{container_id}")
def mroznia_ostatnie_wazenie(container_id: str):
    w = mroznia_wazenie_service.ostatnie_wazenie(container_id)
    if not w:
        raise HTTPException(404, "Ten karton nie był ważony")
    return w
