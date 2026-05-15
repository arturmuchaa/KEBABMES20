"""Vehicle endpoints."""
from fastapi import APIRouter

from app.models.vehicles import VehicleCreate, VehicleUpdate
from app.services import vehicles_service as svc

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])


@router.get("")
def list_vehicles(include_inactive: bool = False):
    return svc.list_vehicles(include_inactive=include_inactive)


@router.post("")
def create_vehicle(dto: VehicleCreate):
    return svc.create_vehicle(dto)


@router.put("/{vehicle_id}")
def update_vehicle(vehicle_id: str, dto: VehicleUpdate):
    return svc.update_vehicle(vehicle_id, dto)


@router.delete("/{vehicle_id}")
def delete_vehicle(vehicle_id: str):
    return svc.delete_vehicle(vehicle_id)
