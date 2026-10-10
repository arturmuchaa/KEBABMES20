"""Regresja 09.10.2026: przesunięte kartki YALCIN po usunięciu palety.

Testujemy prawdziwy zapis i lookup/skan papierowego QR, nie sam licznik.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import HTTPException

from app.db import cx_execute, execute, query_all, query_one, transaction
from app.models.orders import PalletDto
from app.services import pallets_service as service


def _new(qty=10):
    return PalletDto(items=[{"order_line_id": "l1", "qty": qty}])


def _dto(p, **changes):
    return PalletDto.model_validate({**p, **changes})


def _seed():
    execute("INSERT INTO client_orders (id,order_no) VALUES ('o1','YALCIN/Z/2/10/26')")
    execute("INSERT INTO client_order_lines (id,order_id,qty,kg_per_unit,total_kg) "
            "VALUES ('l1','o1',100,25,2500)")
    return service.save_pallets("o1", [_new(10), _new(20), _new(30)])


def test_delete_first_does_not_move_cartons_or_qr(db):
    a, b, c = _seed()
    saved = service.save_pallets("o1", [_dto(b), _dto(c)])
    assert saved == [b, c]  # id, nr kartonu, nr QR, pozycje i timestamp bez zmian
    assert service.lookup("PAL|o1|2")["id"] == b["id"]
    assert service.lookup("http://tauri.localhost/m/p/o1/3")["carton_no"] == c["carton_no"]
    with pytest.raises(HTTPException) as err:
        service.lookup("PAL|o1|1")
    assert err.value.status_code == 404


def test_reorder_request_is_not_reorder_of_printed_identities(db):
    a, b, c = _seed()
    assert service.save_pallets("o1", [_dto(c), _dto(a), _dto(b)]) == [a, b, c]


def test_edit_keeps_id_carton_qr_and_created_at(db):
    a, b, c = _seed()
    edited = _dto(b, notes="korekta", items=[{"order_line_id": "l1", "qty": 21}])
    saved = service.save_pallets("o1", [_dto(a), edited, _dto(c)])
    for field in ("id", "carton_no", "pallet_no", "created_at"):
        assert saved[1][field] == b[field]
    assert saved[1]["items"][0]["qty"] == 21
    assert saved[0] == a and saved[2] == c


def test_legacy_edit_with_zero_number_fails_instead_of_replacing_carton(db):
    a, b, c = _seed()
    with pytest.raises(HTTPException) as err:
        service.save_pallets("o1", [_dto(a), _new(21), _dto(c)])
    assert err.value.status_code == 409
    assert service.list_pallets("o1") == [a, b, c]


def test_pallet_number_only_is_supported_for_older_clients(db):
    before = _seed()
    dtos = [_dto(p, id="") for p in before]
    assert service.save_pallets("o1", dtos) == before


def test_deleted_last_number_never_gets_reused(db):
    a, b, c = _seed()
    service.save_pallets("o1", [_dto(a), _dto(b)])
    saved = service.save_pallets("o1", [_dto(a), _dto(b), _new()])
    assert saved[-1]["pallet_no"] == 4
    assert saved[-1]["carton_no"] > c["carton_no"]
    # Także po usunięciu CAŁEGO rozpisu (nie zostaje żaden MAX).
    service.save_pallets("o1", [])
    saved = service.save_pallets("o1", [_new()])
    assert saved[0]["pallet_no"] == 5
    with pytest.raises(HTTPException):
        service.lookup("PAL|o1|3")


@pytest.mark.parametrize("bad", [
    {"id": "nieistniejaca", "pallet_no": 1},
    {"pallet_no": 99},
])
def test_stale_or_unknown_identity_rejected_atomically(db, bad):
    before = _seed()
    with pytest.raises(HTTPException) as err:
        service.save_pallets("o1", [_dto(before[0], **bad), *map(_dto, before[1:])])
    assert err.value.status_code == 409
    assert service.list_pallets("o1") == before


def test_mismatched_id_and_number_or_duplicate_rejected(db):
    a, b, c = _seed()
    for incoming in ([_dto(a, pallet_no=2), _dto(b), _dto(c)],
                     [_dto(a), _dto(a), _dto(b), _dto(c)]):
        with pytest.raises(HTTPException):
            service.save_pallets("o1", incoming)
        assert service.list_pallets("o1") == [a, b, c]


def test_deletion_before_loaded_pallet_preserves_history_and_scan_target(db):
    a, b, c = _seed()
    execute("INSERT INTO vehicles (id,name,plate) VALUES ('identity-v','Solówka','KRA613FC') "
            "ON CONFLICT (id) DO NOTHING")
    from app.services.vehicle_loading_service import add_order
    add_order("identity-v", "o1")
    service.scan("PAL|o1|2", "loaded", vehicle_id="identity-v")
    b = service.list_pallets("o1")[1]
    history = query_all("SELECT * FROM pallet_scans WHERE pallet_id=%s", (b["id"],))
    assert service.save_pallets("o1", [_dto(b), _dto(c)]) == [b, c]
    assert service.scan("PAL|o1|2", "loaded", vehicle_id="identity-v")["result"] == "ALREADY_SCANNED"
    assert query_all("SELECT * FROM pallet_scans WHERE pallet_id=%s", (b["id"],)) == history


def test_undo_does_not_allow_deleting_scan_history(db):
    a, b, c = _seed()
    service.scan("PAL|o1|2", "cold_storage")
    service.scan("PAL|o1|2", "undo")
    with pytest.raises(HTTPException) as err:
        service.save_pallets("o1", [_dto(a), _dto(c)])
    assert err.value.status_code == 409
    assert query_one("SELECT COUNT(*) n FROM pallet_scans WHERE pallet_id=%s", (b["id"],))["n"] == 2


def test_save_waits_for_scan_and_validates_locked_state(db, monkeypatch):
    a, b, c = _seed()
    reached = Event()
    real_query = service.cx_query_all

    def watched(conn, sql, params=None):
        if "FROM order_pallets" in sql and "FOR UPDATE" in sql:
            reached.set()
        return real_query(conn, sql, params)

    monkeypatch.setattr(service, "cx_query_all", watched)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction() as conn:
            cx_execute(conn, "UPDATE order_pallets SET status='loaded' WHERE id=%s", (b["id"],))
            saving = pool.submit(service.save_pallets, "o1", [_dto(a), _dto(c)])
            assert reached.wait(timeout=5)
        with pytest.raises(HTTPException) as err:
            saving.result(timeout=5)
        assert err.value.status_code == 409
    assert service.lookup("PAL|o1|2")["id"] == b["id"]


def test_existing_alias_address_is_not_reused(db):
    _seed()
    execute("INSERT INTO pallet_label_aliases (order_id,pallet_no,target_order_id,target_pallet_no) "
            "VALUES ('o1',9,'other',4), ('other',8,'o1',12)")
    before = service.list_pallets("o1")
    saved = service.save_pallets("o1", [*map(_dto, before), _new()])
    assert saved[-1]["pallet_no"] == 13
