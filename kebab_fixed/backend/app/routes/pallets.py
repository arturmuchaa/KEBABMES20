"""Globalne endpointy palet — skan QR, lookup po kodzie, aktywne zamówienia."""
from fastapi import APIRouter, Query

from app.models.orders import PackUnitRequest, PalletScanRequest
from app.services import loading_service, pallets_service, vehicle_loading_service

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
def active_loading(include_done: bool = False):
    """Zamówienia do załadunku. Domyślnie BEZ zrealizowanych i anulowanych —
    główny ekran odpowiada na pytanie „co mam teraz załadować?".
    `include_done=true` obsługuje osobną zakładkę Historia."""
    return pallets_service.active_orders_for_loading(include_done=include_done)


@router.get("/zaladunki/do-wydruku")
def zaladunki_do_wydruku():
    """Kursy zakończone, których biuro jeszcze nie wydrukowało (pulpit)."""
    return loading_service.zaladunki_do_wydruku()


@router.get("/zaladunki/{loading_id}")
def zaladunek(loading_id: str):
    return loading_service.zaladunek(loading_id)


@router.post("/zaladunki/{loading_id}/wystaw")
def zaladunek_wystaw(loading_id: str, body: dict):
    """Biuro wystawia komplet dla kursu — decyzja per odbiorca.

    `orders`: [{"order_id", "cel_kg", "invoice_no"}] — `cel_kg` to kilogramy
    NA FAKTURĘ („całość na fakturę" to `cel_kg` równe całemu zamówieniu),
    a `invoice_no` to numer faktury TEGO odbiorcy na jego CMR-ach. Przewoźnik
    i auto idą w `cmr` — są wspólne dla kursu, faktura nie jest.
    """
    return loading_service.wystaw_z_kursu(
        loading_id,
        (body or {}).get("orders") or [],
        (body or {}).get("cmr") or {},
        bool((body or {}).get("hdi_fv")),
    )


@router.post("/zaladunki/{loading_id}/wydrukowano")
def zaladunek_wydrukowano(loading_id: str, body: dict | None = None):
    return loading_service.oznacz_wydrukowany(
        loading_id, operator=((body or {}).get("operator") or ""))


@router.get("/on-vehicle/{vehicle_id}")
def on_vehicle(vehicle_id: str):
    """Zamówienia stojące na tym aucie — wspólna lista dla wszystkich skanerów."""
    return pallets_service.orders_on_vehicle(vehicle_id)


# ── Wspólny stan auta ─────────────────────────────────────────────────────
# Trasy STAŁE — muszą stać przed `/{pallet_id}/...` na dole pliku, inaczej
# „vehicle-state" zostałoby wzięte za identyfikator palety.
@router.get("/vehicle-state/{vehicle_id}")
def vehicle_state(vehicle_id: str):
    """CAŁY stan załadunku auta w jednym spójnym odczycie.

    Zastępuje składanie ekranu z N+1 odpowiedzi (`on-vehicle` + `loading-status`
    per zamówienie), przy którym nagłówek i lista palet mogły pochodzić
    z dwóch różnych chwil.
    """
    return vehicle_loading_service.vehicle_state(vehicle_id)


@router.post("/vehicle-state/{vehicle_id}/orders")
def vehicle_add_order(vehicle_id: str, body: dict):
    return vehicle_loading_service.add_order(
        vehicle_id,
        (body.get("order_id") or "").strip(),
        operator=body.get("operator") or "")


@router.delete("/vehicle-state/{vehicle_id}/orders/{order_id}")
def vehicle_remove_order(vehicle_id: str, order_id: str):
    return vehicle_loading_service.remove_order(vehicle_id, order_id)


@router.post("/vehicle-state/{vehicle_id}/reorder")
def vehicle_reorder(vehicle_id: str, body: dict):
    return vehicle_loading_service.reorder(
        vehicle_id, [str(x) for x in (body.get("order_ids") or []) if x])


@router.post("/vehicle-state/{vehicle_id}/clear")
def vehicle_clear(vehicle_id: str, body: dict | None = None):
    return vehicle_loading_service.clear_vehicle(
        vehicle_id, operator=((body or {}).get("operator") or ""))


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
