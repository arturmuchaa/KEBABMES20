"""Seasoned meat endpoints."""
from fastapi import APIRouter

from app.services import seasoned_meat_service as svc

router = APIRouter(prefix="/api/seasoned-meat", tags=["seasoned-meat"])


@router.get("/all")
def list_all_seasoned():
    return svc.list_all_seasoned()


@router.get("")
def list_seasoned():
    return svc.list_seasoned()


@router.get("/{batch_id}/trace")
def seasoned_trace(batch_id: str):
    return svc.seasoned_trace(batch_id)


@router.post("/from-order/{order_id}")
def seasoned_from_order(order_id: str, body: dict):
    return svc.seasoned_from_order(order_id, body)
