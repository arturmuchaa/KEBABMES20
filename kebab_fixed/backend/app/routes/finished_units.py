"""Endpointy finished_units — QR per sztuka."""
from fastapi import APIRouter

from app.models.finished_units import GenerateUnitsRequest, ScanProducedRequest
from app.services import finished_units_service as svc

router = APIRouter(prefix="/api/finished-units", tags=["finished-units"])


@router.post("/from-plan-line")
def generate_from_plan_line(dto: GenerateUnitsRequest):
    return svc.generate_units_from_plan_line(dto.plan_line_id)


@router.post("/scan-produced")
def scan_produced(dto: ScanProducedRequest):
    return svc.scan_produced(dto.code, dto.trolley_id)


@router.get("/lookup")
def lookup(code: str):
    return svc.lookup_unit(code)
