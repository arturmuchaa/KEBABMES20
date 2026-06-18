"""Client orders endpoints."""
from fastapi import APIRouter, Query

from app.models.orders import ClientOrderCreate, PalletsRequest
from app.services import orders_service as svc
from app.services import pallets_service
from app.services import stock_carton_match_service
from app.services import stock_cartons_service

router = APIRouter(prefix="/api/client-orders", tags=["client-orders"])


@router.get("")
def list_orders(status: str = Query("")):
    return svc.list_orders(status or None)


@router.get("/{order_id}")
def get_order(order_id: str):
    return svc.get_order(order_id)


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


@router.get("/{order_id}/production-progress")
def production_progress(order_id: str):
    return svc.production_progress(order_id)


@router.get("/{order_id}/quantity-chain")
def quantity_chain(order_id: str):
    """Raport rozjazdu: łańcuch ilości zamówiono→…→dokument per pozycja."""
    return svc.quantity_chain(order_id)


# ── Palety wydania ────────────────────────────────────────────────
@router.get("/{order_id}/pallets")
def list_pallets(order_id: str):
    return pallets_service.list_pallets(order_id)


@router.put("/{order_id}/pallets")
def save_pallets(order_id: str, body: PalletsRequest):
    return pallets_service.save_pallets(order_id, body.pallets)


@router.get("/{order_id}/loading-status")
def loading_status(order_id: str):
    return pallets_service.loading_status(order_id)


@router.post("/{order_id}/pallets/{pallet_no}/reset")
def reset_pallet(order_id: str, pallet_no: int):
    return pallets_service.reset_pallet(order_id, pallet_no)


@router.get("/{order_id}/stock-carton-suggestions")
def stock_carton_suggestions(order_id: str):
    """Pasujące kartony magazynowe do tego zamówienia (klient+receptura+rodzaj+tuleja+waga)."""
    return stock_carton_match_service.suggestions_for_order(order_id)


@router.post("/{order_id}/assign-stock-carton")
def assign_stock_carton(order_id: str, body: dict):
    """Powiąż wskazany karton magazynowy z zamówieniem (biuro zatwierdza)."""
    carton_id = (body or {}).get("carton_id") or (body or {}).get("cartonId") or ""
    return stock_cartons_service.assign_carton_to_order(carton_id, order_id)
