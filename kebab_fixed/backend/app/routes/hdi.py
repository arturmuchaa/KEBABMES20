"""Endpointy HDI."""
from fastapi import APIRouter, Query

from app.services import hdi_service as svc

router = APIRouter(prefix="/api/hdi", tags=["hdi"])


@router.post("/generate")
def generate(order_id: str = Query(...)):
    return svc.generate_hdi(order_id)


@router.get("/{hdi_id}")
def get(hdi_id: str):
    return svc.get_hdi(hdi_id)


@router.get("")
def list_all():
    return svc.list_hdi()
