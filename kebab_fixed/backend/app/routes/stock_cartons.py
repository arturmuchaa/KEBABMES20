"""Karton magazynowy = jednostka pakowa (bez zamówienia)."""
from fastapi import APIRouter

from app.models.production import StockCartonCreate
from app.services import stock_cartons_service as svc

router = APIRouter(prefix="/api/stock-cartons", tags=["stock-cartons"])


@router.post("")
def create(dto: StockCartonCreate):
    return svc.create_stock_carton(dto)


@router.get("")
def list_all():
    return svc.list_cartons()


@router.get("/open")
def list_open():
    return svc.list_open_cartons()


@router.get("/{carton_id}/eligible-units")
def eligible_units(carton_id: str):
    """Sztuki uprawnione do kartonu — prefetch do walidacji lokalnej offline."""
    return svc.eligible_units_for_carton(carton_id)


@router.get("/{carton_id}")
def get(carton_id: str):
    return svc.get_carton(carton_id)


@router.post("/{carton_id}/scan")
def scan(carton_id: str, body: dict):
    code = (body or {}).get("code") or ""
    return svc.scan_unit_into_carton(carton_id, code)
