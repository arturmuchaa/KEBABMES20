"""Globalne endpointy palet — skan QR, lookup po kodzie, aktywne zamówienia."""
from fastapi import APIRouter, Query

from app.models.orders import PackUnitRequest, PalletScanRequest
from app.services import loading_service, pallets_service

router = APIRouter(prefix="/api/pallets", tags=["pallets"])


@router.post("/finalize-loading")
def finalize_loading(body: dict):
    """Zamknięcie załadunku pojazdu: sztuki→shipped, WZ (weryfikacja
    istniejącego albo utworzenie + rozchód), HDI z nr rejestracyjnym."""
    return loading_service.finalize_loading(
        vehicle_id=(body.get("vehicle_id") or "").strip(),
        order_ids=[str(x) for x in (body.get("order_ids") or []) if x],
        operator=body.get("operator") or "",
        plate=body.get("plate") or "",
    )


@router.post("/loading-document")
def loading_document(body: dict):
    """Dokument wydania dla kierowcy (dane do renderu po stronie mobile)."""
    return loading_service.loading_document(
        vehicle_id=(body.get("vehicle_id") or "").strip(),
        order_ids=[str(x) for x in (body.get("order_ids") or []) if x],
    )


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


@router.get("/zaladunki/do-wydruku")
def zaladunki_do_wydruku():
    """Kursy zakończone, których biuro jeszcze nie wydrukowało (pulpit)."""
    return loading_service.zaladunki_do_wydruku()


@router.get("/zaladunki/{loading_id}")
def zaladunek(loading_id: str):
    return loading_service.zaladunek(loading_id)


@router.post("/zaladunki/{loading_id}/wydrukowano")
def zaladunek_wydrukowano(loading_id: str, body: dict | None = None):
    return loading_service.oznacz_wydrukowany(
        loading_id, operator=((body or {}).get("operator") or ""))


@router.get("/on-vehicle/{vehicle_id}")
def on_vehicle(vehicle_id: str):
    """Zamówienia stojące na tym aucie — wspólna lista dla wszystkich skanerów."""
    return pallets_service.orders_on_vehicle(vehicle_id)


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
