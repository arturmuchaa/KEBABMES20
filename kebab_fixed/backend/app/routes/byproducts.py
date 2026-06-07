"""Produkty uboczne rozbioru (ABP) — lista + rejestracja utylizacji."""
from fastapi import APIRouter, Query

from app.services import byproducts_service as svc

router = APIRouter(prefix="/api/byproducts", tags=["byproducts"])


@router.get("")
def list_byproducts(status: str = Query("")):
    return svc.list_byproducts(status or None)


@router.post("/{lot_id}/dispose")
def dispose(lot_id: str, body: dict):
    return svc.dispose_byproduct(
        lot_id, body.get("destination", ""), body.get("docRef", "") or body.get("doc_ref", "")
    )
