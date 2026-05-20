"""Deboning endpoints."""
from fastapi import APIRouter, Query

from app.models.deboning import DeboningEntryCreate, DeboningEntryUpdate
from app.services import deboning_service as svc

router = APIRouter(tags=["deboning"])


# IMPORTANT: /entries/trace/{id} and /entries MUST be before /deboning/{id}
# to prevent "entries" from being captured as a path parameter.

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


@router.get("/api/deboning")
def list_deboning_sessions():
    return svc.list_deboning_sessions()


@router.post("/api/deboning")
def create_deboning_session_alias(dto: DeboningEntryCreate):
    return svc.create_deboning_entry(dto)
