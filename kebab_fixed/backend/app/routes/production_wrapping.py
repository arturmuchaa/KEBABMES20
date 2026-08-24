"""Foliowanie — kilogramy zafoliowane per osoba i dzień."""
from fastapi import APIRouter, Query

from app.services import production_wrapping_service as svc

router = APIRouter(prefix="/api/production-wrapping", tags=["production-wrapping"])


@router.get("")
def day_wrapping(date: str = Query(..., description="Dzień produkcyjny RRRR-MM-DD")):
    return svc.day_wrapping(date)


@router.post("")
def save_wrapping(body: dict):
    return svc.save_wrapping(
        str(body.get("workDate") or body.get("work_date") or ""),
        body.get("entries") or [],
        str(body.get("by") or ""),
    )
