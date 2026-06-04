from fastapi import APIRouter

from app.models.carriers import CarrierCreate
from app.services import carriers_service as svc

router = APIRouter(prefix="/api/carriers", tags=["carriers"])


@router.get("")
def list_all():
    return svc.list_carriers()


@router.post("")
def create(dto: CarrierCreate):
    return svc.create_carrier(dto)


@router.put("/{carrier_id}")
def update(carrier_id: str, dto: CarrierCreate):
    return svc.update_carrier(carrier_id, dto)


@router.patch("/{carrier_id}/deactivate")
def deactivate(carrier_id: str):
    svc.deactivate_carrier(carrier_id)
    return {"ok": True}
