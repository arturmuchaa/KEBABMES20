"""Client orders endpoints."""
from fastapi import APIRouter, Query

from app.models.orders import ClientOrderCreate
from app.services import orders_service as svc

router = APIRouter(prefix="/api/client-orders", tags=["client-orders"])


@router.get("")
def list_orders(status: str = Query("")):
    return svc.list_orders(status or None)


@router.post("")
def create_order(dto: ClientOrderCreate):
    return svc.create_order(dto)


@router.patch("/{order_id}/status")
def update_order_status(order_id: str, body: dict):
    return svc.update_order_status(order_id, body["status"])


@router.delete("/{order_id}")
def delete_order(order_id: str):
    return svc.delete_order(order_id)


@router.put("/{order_id}")
def update_order(order_id: str, dto: ClientOrderCreate):
    return svc.update_order(order_id, dto)
