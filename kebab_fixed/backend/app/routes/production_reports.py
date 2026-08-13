"""Karta 2.5.1 — ZALECENIE PRODUKCYJNE (raport z realizacji produkcji)."""
from fastapi import APIRouter

from app.services import production_report_service as svc

router = APIRouter(prefix="/api/zalecenia-produkcyjne", tags=["zalecenia-produkcyjne"])


@router.get("")
def list_days(limit: int = 60):
    """Dni produkcji z recepturami — po jednej karcie na recepturę."""
    return svc.list_report_days(limit)


# Po trasie statycznej (""), żeby jej nie przechwyciło.
@router.get("/{plan_date}/{recipe_id}")
def get_report(plan_date: str, recipe_id: str):
    return svc.get_report(plan_date, recipe_id)
