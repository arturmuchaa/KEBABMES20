"""Globalne endpointy palet — skan QR, lookup po kodzie, aktywne zamówienia."""
from fastapi import APIRouter, Query

from app.models.orders import PalletScanRequest
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
