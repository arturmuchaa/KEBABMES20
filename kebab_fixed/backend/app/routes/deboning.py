"""Deboning endpoints."""
from fastapi import APIRouter, HTTPException, Query

from app.models.deboning import DeboningEntryCreate, DeboningEntryUpdate
from app.services import deboning_service as svc
from app.services import settings_service

router = APIRouter(tags=["deboning"])


# IMPORTANT: /entries/trace/{id} and /entries MUST be before /deboning/{id}
# to prevent "entries" from being captured as a path parameter.

# Tary wózków (ważenie RS232 w HMI v10): GET czyta panel hali, PUT tylko
# biuro (rozdział ról w app/auth/permissions.py).

@router.get("/api/deboning/cart-tares")
def get_cart_tares():
    return {"cartTares": settings_service.get_cart_tares()}


@router.put("/api/deboning/cart-tares")
def save_cart_tares(body: dict):
    try:
        tares = settings_service.save_cart_tares(body.get("cartTares"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"cartTares": tares}

@router.get("/api/deboning/entries/trace/{batch_id}")
def deboning_trace(batch_id: str):
    return svc.deboning_trace(batch_id)


@router.get("/api/deboning/entries")
def list_deboning_entries(session_id: str = Query(None, alias="session_id")):
    return svc.list_deboning_entries(session_id)


@router.post("/api/deboning/entries")
def create_deboning_entry(dto: DeboningEntryCreate):
    return svc.create_deboning_entry(dto)


@router.patch("/api/deboning/entries/{entry_id}")
def update_deboning_entry(entry_id: str, dto: DeboningEntryUpdate):
    return svc.update_deboning_entry(entry_id, dto)


@router.delete("/api/deboning/entries/{entry_id}")
def delete_deboning_entry(entry_id: str):
    return svc.delete_deboning_entry(entry_id)


@router.get("/api/deboning")
def list_deboning_sessions():
    return svc.list_deboning_sessions()


@router.post("/api/deboning")
def create_deboning_session_alias(dto: DeboningEntryCreate):
    return svc.create_deboning_entry(dto)
