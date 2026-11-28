"""Kontrahenci — poprawa adresów w kartotece (propozycje do zatwierdzenia)."""
from fastapi import APIRouter

from app.services import kontrahenci_adresy_service as svc

router = APIRouter(prefix="/api/kontrahenci", tags=["kontrahenci"])


@router.get("/propozycje-adresow")
def propozycje_adresow():
    return svc.propozycje()


@router.post("/zastosuj-adresy")
def zastosuj_adresy(body: dict):
    return svc.zastosuj((body or {}).get("zmiany") or [])
