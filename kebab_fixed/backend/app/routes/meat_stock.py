"""Meat stock endpoint."""
from fastapi import APIRouter, Request

from app.models.raw_batches import MeatLotAdjust
from app.services import raw_batches_service as svc

router = APIRouter(prefix="/api/meat-stock", tags=["meat-stock"])


@router.get("")
def list_meat_stock(include_reserved: bool = False):
    return svc.list_meat_stock(include_reserved=include_reserved)


@router.post("/{lot_id}/adjust")
def adjust_meat_lot(lot_id: str, dto: MeatLotAdjust, request: Request):
    """Inwentaryzacja partii mięsa — korekta stanu po przeliczeniu chłodni.

    Osobna ścieżka od edycji przyjęcia: przeliczenie wychodzi w trakcie pracy
    magazynu, a nie przy dokumencie dostawy. Powód obowiązkowy, ruch ADJUST
    zostaje w księdze.
    """
    subject = getattr(request.state, "subject", None) or {}
    kto = str(subject.get("username") or subject.get("name") or subject.get("id") or "")
    return svc.adjust_meat_lot(lot_id, dto, kto)
