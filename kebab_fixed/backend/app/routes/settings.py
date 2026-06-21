"""App-wide settings endpoints (klucz–wartość)."""
from fastapi import APIRouter

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
    return svc.save_deboning_yield_pct(float(body.get("pct", 70.0)))
