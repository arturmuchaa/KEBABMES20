"""Kontrola HACCP dostawy — kolumny f-k karty 1.1.1.

Osobny router od `receptions`, bo to osobny byt: wpis powstaje po zapisaniu
dostawy i docelowo w innym miejscu (kiosk przy rampie).
"""
from fastapi import APIRouter, HTTPException, Query

from app.db import query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services import reception_checks_service as svc

router = APIRouter(prefix="/api/receptions", tags=["reception-checks"])


# UWAGA: /haccp-pending MUSI stać przed /{reception_id}/check — inaczej
# „haccp-pending" wpadnie jako identyfikator dostawy (ta sama pułapka co
# /next-number w routes/receptions.py).
@router.get("/haccp-pending")
def haccp_pending(days: int = Query(14, ge=1, le=365)):
    return svc.pending(days)


@router.get("/{reception_id}/check")
def get_check(reception_id: str):
    if not query_one("SELECT id FROM receptions WHERE id=%s", (reception_id,)):
        raise HTTPException(404, "Przyjęcie nie istnieje")
    return svc.get_check(reception_id)


@router.put("/{reception_id}/check")
def put_check(reception_id: str, dto: ReceptionCheckIn):
    if not query_one("SELECT id FROM receptions WHERE id=%s", (reception_id,)):
        raise HTTPException(404, "Przyjęcie nie istnieje")
    return svc.save_check(reception_id, dto)
