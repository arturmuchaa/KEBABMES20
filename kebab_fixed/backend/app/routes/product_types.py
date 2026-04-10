"""Product types endpoints."""
from fastapi import APIRouter

from app.models.product_types import ProductTypeCreate
from app.services import product_types_service as svc

router = APIRouter(prefix="/api/product-types", tags=["product-types"])


@router.get("")
def list_product_types():
    return svc.list_product_types()


@router.post("")
def create_product_type(dto: ProductTypeCreate):
    return svc.create_product_type(dto)


@router.put("/{type_id}")
def update_product_type(type_id: str, dto: ProductTypeCreate):
    return svc.update_product_type(type_id, dto)


@router.patch("/{type_id}/deactivate")
def deactivate_product_type(type_id: str):
    return svc.deactivate_product_type(type_id)
