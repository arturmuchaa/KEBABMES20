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
