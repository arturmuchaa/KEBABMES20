"""Testy: karta sztuki (lookup_unit) niesie dane do wyznaczenia lokalizacji —
globalny numer kartonu (z palety) oraz klient. Plus podsumowanie lokalizacji
per partia dla biura.

Testy DB wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute
from app.services.finished_units_service import lookup_unit, location_summary_by_batch
from app.utils.ids import now_iso
from app.utils.unit_codes import unit_qr


def _seed_unit(uid, status, *, batch_no="000123", pallet_id=None,
               client_name="", tuleja="METAL 60CM"):
    execute(
        "INSERT INTO finished_units "
        "(id, qr_code, status, batch_no, client_name, tuleja, pallet_id, weight_kg, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,1.0,%s)",
        (uid, unit_qr(uid), status, batch_no, client_name, tuleja, pallet_id, now_iso()),
    )


def _seed_pallet(pid, carton_no, order_id="ord1"):
    execute(
        "INSERT INTO client_orders (id, order_no) VALUES (%s,%s) ON CONFLICT (id) DO NOTHING",
        (order_id, "ZAM/" + order_id),
    )
    execute(
        "INSERT INTO order_pallets (id, order_id, pallet_no, carton_no) VALUES (%s,%s,1,%s)",
        (pid, order_id, carton_no),
    )


# ── lookup_unit: numer kartonu dla spakowanej sztuki ───────────────────
def test_lookup_returns_formatted_carton_no_for_packed_unit(db):
    _seed_pallet("pal1", 42)
    _seed_unit("u_packed", "packed", pallet_id="pal1")
    card = lookup_unit(unit_qr("u_packed"))
    assert card["cartonNo"] == "000042"
    assert card["status"] == "packed"
    assert card["tuleja"] == "METAL 60CM"


def test_lookup_returns_empty_carton_for_unpacked_unit(db):
    _seed_unit("u_prod", "produced")
    card = lookup_unit(unit_qr("u_prod"))
    assert card["cartonNo"] == ""
    assert card["status"] == "produced"


def test_lookup_returns_client_for_shipped_unit(db):
    _seed_unit("u_ship", "shipped", client_name="ZAGROS")
    card = lookup_unit(unit_qr("u_ship"))
    assert card["clientName"] == "ZAGROS"


# ── Podsumowanie lokalizacji per partia (biuro) ────────────────────────
def test_location_summary_counts_by_status(db):
    _seed_pallet("palA", 7)
    _seed_unit("a1", "produced", batch_no="000500")
    _seed_unit("a2", "produced", batch_no="000500")
    _seed_unit("a3", "packed",   batch_no="000500", pallet_id="palA")
    _seed_unit("a4", "shipped",  batch_no="000500", client_name="ZAGROS")
    summ = location_summary_by_batch("000500")
    assert summ["produced"] == 2
    assert summ["packed"] == 1
    assert summ["shipped"] == 1
    assert summ["planned"] == 0
    # numery kartonów obecne dla spakowanych
    assert "000007" in summ["cartons"]
