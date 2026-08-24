"""Materiały dnia produkcyjnego — pobrania, zwroty i zużycie do kosztów."""
from fastapi import APIRouter, Query

from app.services import day_materials_service as svc

router = APIRouter(prefix="/api/production-day-materials", tags=["production-day-materials"])


@router.get("")
def day_materials(date: str = Query(..., description="Dzień produkcyjny RRRR-MM-DD")):
    return svc.day_materials(date)


@router.post("/take")
def take_material(body: dict):
    return svc.take_material(
        str(body.get("workDate") or body.get("work_date") or ""),
        str(body.get("packagingId") or body.get("packaging_id") or ""),
        float(body.get("qty") or 0),
        str(body.get("by") or ""),
    )


@router.post("/return")
def return_material(body: dict):
    return svc.return_material(
        str(body.get("workDate") or body.get("work_date") or ""),
        str(body.get("packagingId") or body.get("packaging_id") or ""),
        float(body.get("qty") or 0),
        str(body.get("by") or ""),
    )
