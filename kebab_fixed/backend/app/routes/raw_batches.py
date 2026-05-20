"""Raw batches (quarter carcass) endpoints."""
from fastapi import APIRouter, Query

from app.models.raw_batches import RawBatchCreate, RawBatchUpdate
from app.services import raw_batches_service as svc

router = APIRouter(prefix="/api/raw-batches", tags=["raw-batches"])


# IMPORTANT: /next-number and /all MUST be before /{id} routes
@router.get("/next-number")
def next_batch_number():
    return svc.next_batch_number()


@router.get("/all")
def list_all_batches():
    return svc.list_all_batches()


@router.get("")
def list_batches(
    active_only: bool = Query(True, alias="activeOnly"),
    limit: int = Query(200),
):
    return svc.list_batches(active_only=active_only, limit=limit)


@router.post("")
def create_batch(dto: RawBatchCreate):
    return svc.create_batch(dto)


@router.get("/{batch_id}/history")
def batch_history(batch_id: str):
    return svc.batch_history(batch_id)


@router.patch("/{batch_id}/cancel")
def cancel_batch(batch_id: str):
    return svc.cancel_batch(batch_id)


@router.put("/{batch_id}")
def update_batch(batch_id: str, dto: RawBatchUpdate):
    return svc.update_batch(batch_id, dto)
