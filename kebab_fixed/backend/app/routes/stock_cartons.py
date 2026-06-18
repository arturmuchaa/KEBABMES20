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


@router.get("/{carton_id}/eligible-by-line")
def eligible_by_line(carton_id: str):
    """Snapshot uprawnionych sztuk per pozycja (+ remaining) — walidacja offline per pozycja."""
    return svc.eligible_by_line(carton_id)


@router.get("/lines/{line_id}/eligible-units")
def line_eligible(line_id: str):
    """Sztuki uprawnione do konkretnej pozycji kartonu (podgląd w biurze)."""
    return svc.eligible_units_for_line(line_id)


@router.post("/{carton_id}/lines/{line_id}/add")
def line_add(carton_id: str, line_id: str, body: dict):
    """Biuro: dorzuć N uprawnionych sztuk z magazynu do pozycji (FIFO)."""
    return svc.add_units_to_carton_line(carton_id, line_id, int((body or {}).get("qty") or 0))


@router.get("/{carton_id}")
def get(carton_id: str):
    return svc.get_carton(carton_id)


@router.post("/{carton_id}/scan")
def scan(carton_id: str, body: dict):
    code = (body or {}).get("code") or ""
    return svc.scan_unit_into_carton(carton_id, code)
