"""Katalog wyrobów — karta 0 cennika i wymiany z księgowością."""
from typing import Any, Dict

from fastapi import APIRouter

from app.services import product_catalog_service as svc

router = APIRouter(prefix="/api/product-catalog", tags=["product-catalog"])


@router.get("")
def list_catalog(only_active: bool = False):
    return svc.list_product_catalog(only_active)


@router.post("/refresh")
def refresh_catalog():
    """Dociąga kombinacje, które pojawiły się od ostatniego odświeżenia."""
    return svc.refresh_product_catalog()


@router.patch("/{entry_id}")
def update_entry(entry_id: str, body: Dict[str, Any]):
    return svc.update_product_catalog_entry(entry_id, body)
