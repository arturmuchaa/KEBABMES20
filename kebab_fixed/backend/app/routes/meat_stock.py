"""Meat stock endpoint."""
from fastapi import APIRouter

from app.services import raw_batches_service as svc

router = APIRouter(prefix="/api/meat-stock", tags=["meat-stock"])


@router.get("")
def list_meat_stock(include_reserved: bool = False):
    return svc.list_meat_stock(include_reserved=include_reserved)
