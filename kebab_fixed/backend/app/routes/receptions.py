"""Przyjęcia surowca — dokument całej dostawy (numer 12/08/2026).

Partie (numery porządkowe) tworzy i edytuje `/api/raw-batches`; tutaj żyje
dokument, który je spina, i partie DOSTAWCY pod każdym numerem porządkowym.
"""
from fastapi import APIRouter, Query

from app.models.receptions import ReceptionCreate
from app.services import receptions_service as svc

router = APIRouter(prefix="/api/receptions", tags=["receptions"])


# UWAGA: /next-number musi stać PRZED /{reception_id}
@router.get("/next-number")
def next_number(when: str = Query("", alias="date")):
    """Podpowiedź numeru przyjęcia dla dnia (domyślnie dziś)."""
    return svc.next_delivery_number(when)


@router.get("")
def list_receptions(
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    limit: int = Query(200),
):
    return svc.list_receptions(date_from=date_from, date_to=date_to, limit=limit)


@router.post("")
def create_reception(dto: ReceptionCreate):
    """Cała dostawa naraz: dokument + wszystkie numery porządkowe."""
    return svc.create_reception(dto)


@router.get("/{reception_id}")
def get_reception(reception_id: str):
    """Po id albo po numerze („12/08/2026")."""
    return svc.get_reception(reception_id)
