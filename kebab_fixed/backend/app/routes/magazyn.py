"""Kiosk magazynu — pakowanie kartonów i stan pod kaflami ekranu startowego.

Zapis sztuki idzie przez istniejące ścieżki (`pack_unit_into_pallet`,
`scan_unit_into_carton`) — tu żyje tylko decyzja, DO KTÓREGO kartonu.
"""
from typing import Optional

from fastapi import APIRouter, Request
from app.auth.audit import _subject_label
from app.services.packing_correction_service import undo_pack
from pydantic import BaseModel

from app.services import magazyn_pakowanie_service as svc

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
