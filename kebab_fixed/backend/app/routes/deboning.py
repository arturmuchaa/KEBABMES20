"""Deboning endpoints."""
from fastapi import APIRouter, HTTPException, Query

from app.models.deboning import (
    DeboningEntryCreate,
    DeboningEntryUpdate,
    DeboningTakeCreate,
    DeboningTakeComplete,
    DeboningTakeUpdate,
)
from app.services import deboning_service as svc
from app.services import batch_byproducts_service as byproducts_svc
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


# ── Ważenie zbiorcze produktów ubocznych (grzbiety + kości) po partii ──
@router.get("/api/deboning/byproducts/pending")
def byproducts_pending():
    return {"pending": byproducts_svc.pending()}


@router.get("/api/deboning/byproducts")
def byproducts_list():
    return {"records": byproducts_svc.list_all()}


@router.get("/api/deboning/byproducts/today")
def byproducts_today():
    return byproducts_svc.today_totals()


@router.get("/api/deboning/byproducts/{raw_batch_id}")
def byproducts_get(raw_batch_id: str):
    return byproducts_svc.get(raw_batch_id) or {}


@router.post("/api/deboning/byproducts/{raw_batch_id}/ensure")
def byproducts_ensure(raw_batch_id: str, body: dict = None):
    """Ważenie ubocznych W TRAKCIE rozbioru — rekord bez finished_at."""
    body = body or {}
    return byproducts_svc.ensure_record(raw_batch_id, (body.get("operator") or "").strip())


@router.post("/api/deboning/byproducts/{raw_batch_id}/finish")
def byproducts_finish(raw_batch_id: str, body: dict = None):
    body = body or {}
    return byproducts_svc.finish_batch(raw_batch_id, (body.get("operator") or "").strip())


@router.post("/api/deboning/byproducts/{raw_batch_id}/weigh")
def byproducts_weigh(raw_batch_id: str, body: dict):
    return byproducts_svc.record(
        raw_batch_id,
        (body.get("kind") or "").strip(),
        float(body.get("kg") or 0),
        body.get("pallets") or [],
    )


@router.get("/api/deboning/stats")
def deboning_stats(
    date_from: str = Query(..., alias="date_from"),
    date_to: str = Query(..., alias="date_to"),
):
    return svc.deboning_stats(date_from, date_to)


@router.get("/api/deboning/entries")
def list_deboning_entries(
    session_id: str = Query(None, alias="session_id"),
    with_open_takes: bool = Query(False, alias="with_open_takes"),
):
    return svc.list_deboning_entries(session_id, with_open_takes=with_open_takes)


@router.post("/api/deboning/entries")
def create_deboning_entry(dto: DeboningEntryCreate):
    return svc.create_deboning_entry(dto)


@router.post("/api/deboning/takes")
def create_deboning_take(dto: DeboningTakeCreate):
    return svc.create_deboning_take(dto)


@router.post("/api/deboning/takes/{entry_id}/complete")
def complete_deboning_take(entry_id: str, dto: DeboningTakeComplete):
    return svc.complete_deboning_take(entry_id, dto)


@router.patch("/api/deboning/takes/{entry_id}")
def update_deboning_take(entry_id: str, dto: DeboningTakeUpdate):
    return svc.update_deboning_take(entry_id, dto)


@router.patch("/api/deboning/entries/{entry_id}")
def update_deboning_entry(entry_id: str, dto: DeboningEntryUpdate):
    return svc.update_deboning_entry(entry_id, dto)


@router.delete("/api/deboning/entries/{entry_id}")
def delete_deboning_entry(entry_id: str):
    return svc.delete_deboning_entry(entry_id)


@router.post("/api/deboning/entries/{entry_id}/change-batch")
def change_deboning_entry_batch(entry_id: str, body: dict):
    """Korekta z biura: przenieś wpis rozbioru na inną partię surowca
    (operator wybrał złą). Wpis zostaje identyczny — zmienia się tylko partia."""
    raw_batch_id = str(body.get("rawBatchId") or body.get("raw_batch_id") or "")
    if not raw_batch_id:
        raise HTTPException(400, "rawBatchId wymagane")
    return svc.change_deboning_entry_batch(entry_id, raw_batch_id)


@router.get("/api/deboning")
def list_deboning_sessions():
    return svc.list_deboning_sessions()


@router.post("/api/deboning")
def create_deboning_session_alias(dto: DeboningEntryCreate):
    return svc.create_deboning_entry(dto)
