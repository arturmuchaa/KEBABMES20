"""Endpointy kartonów — pakowanie QR per sztuka."""
from fastapi import APIRouter

from app.models.cartons import CartonScanRequest, CreateCartonRequest
from app.services import cartons_service as svc

router = APIRouter(prefix="/api/cartons", tags=["cartons"])


@router.post("")
def create_carton(dto: CreateCartonRequest):
    return svc.create_carton(dto.model_dump())


@router.post("/{carton_id}/scan")
def scan(carton_id: str, dto: CartonScanRequest):
    return svc.scan_into_carton(carton_id, dto.code)
