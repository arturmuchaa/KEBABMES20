"""Globalne endpointy palet — skan QR, lookup po kodzie, aktywne zamówienia."""
from fastapi import APIRouter, Query

from app.models.orders import PackUnitRequest, PalletScanRequest
from app.services import pallets_service

router = APIRouter(prefix="/api/pallets", tags=["pallets"])


@router.post("/scan")
def scan(body: PalletScanRequest):
    return pallets_service.scan(
        body.code,
        body.action,
        operator=body.operator or "",
        vehicle_id=body.vehicle_id or None,
    )


@router.get("/lookup")
def lookup(code: str = Query(...)):
    return pallets_service.lookup(code)


@router.get("/active-loading")
def active_loading():
    return pallets_service.active_orders_for_loading()


@router.get("/in-cold-storage")
def in_cold_storage():
    return pallets_service.pallets_in_cold_storage()


@router.get("/to-pack")
def to_pack():
    return pallets_service.pallets_to_pack()


@router.get("/by-id/{pallet_id}")
def by_id(pallet_id: str):
    return pallets_service.pallet_detail_by_id(pallet_id)


# Trasy z parametrem {pallet_id} — po trasach stałych, żeby nie kolidowały.
@router.post("/{pallet_id}/pack")
def pack_unit(pallet_id: str, body: PackUnitRequest):
    return pallets_service.pack_unit_into_pallet(pallet_id, body.code)


@router.get("/{pallet_id}/batch-breakdown")
def batch_breakdown_route(pallet_id: str):
    return pallets_service.batch_breakdown(pallet_id)
