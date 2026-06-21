"""App-wide settings endpoints (klucz–wartość)."""
from fastapi import APIRouter, HTTPException

from app.models.settings import CompanySettings
from app.services import settings_service as svc

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/company")
def get_company():
    return svc.get_company()


@router.put("/company")
def save_company(dto: CompanySettings):
    return svc.save_company(dto)


@router.get("/deboning-yield")
def get_deboning_yield():
    return {"deboningYieldPct": svc.get_deboning_yield_pct()}


@router.put("/deboning-yield")
def save_deboning_yield(body: dict):
    try:
        pct = float(body.get("pct"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Pole 'pct' musi być liczbą")
    if not (0 < pct <= 100):
        raise HTTPException(400, "Wydajność rozbioru musi być w zakresie (0, 100]")
    return svc.save_deboning_yield_pct(pct)
