"""Supplier endpoints."""
from fastapi import APIRouter

from app.models.suppliers import SupplierCreate
from app.services import suppliers_service as svc

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


@router.get("")
def list_suppliers():
    return svc.list_suppliers()


@router.post("")
def create_supplier(dto: SupplierCreate):
    return svc.create_supplier(dto)


@router.put("/{supplier_id}")
def update_supplier(supplier_id: str, dto: SupplierCreate):
    return svc.update_supplier(supplier_id, dto)


@router.patch("/{supplier_id}/uklad-palety")
def set_pallet_layout(supplier_id: str, body: dict):
    """Ile pojemników wchodzi na paletę u tego dostawcy (null = jak zwykle).

    Ustawia je biuro na ekranie zawieszek — stąd osobny endpoint zamiast
    pełnego PUT, który wymagałby całej kartoteki dostawcy.
    """
    return svc.set_containers_per_pallet(supplier_id, body.get("containersPerPallet"))


@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: str):
    return svc.delete_supplier(supplier_id)
