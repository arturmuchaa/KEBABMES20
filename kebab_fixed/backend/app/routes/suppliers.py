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
