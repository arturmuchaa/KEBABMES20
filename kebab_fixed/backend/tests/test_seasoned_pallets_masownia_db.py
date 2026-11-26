"""Paleta mięsa przyprawionego powstaje przy odbiorze z masownicy (plan A, zad. 1–2)."""
import pytest

from app.db import execute, query_all, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=1000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,%s,%s,%s,0,'confirmed')",
        (oid, "MAS/26/11/26", "r1", meat_kg),
    )
    return oid


def _partia(lot_no, kg=1000.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms_id, lot_no, kg, kg, "2026-11-25", "2026-12-05"),
    )
    return ms_id


def test_odbior_tworzy_palete_z_waga_z_paleciaka():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=240)]))
    svc.start_charge(ch["id"])
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=236.4))

    assert out["pallet_qr"] == "SP|" + out["pallet_id"]
    p = query_one("SELECT * FROM seasoned_pallets WHERE id=%s", (out["pallet_id"],))
    assert float(p["kg_weighed"]) == 236.4
    assert p["batch_no"] == "511"
    assert p["status"] == "in_cold"
    assert p["pallet_no"] == out["out_pallet_no"]
    assert p["charge_id"] == ch["id"]
    sm = query_one("SELECT id FROM seasoned_meat WHERE batch_no='511'")
    assert p["seasoned_meat_id"] == sm["id"]


def test_dzisiejsze_wsady_niosa_qr_palety_do_dodruku():
    oid, ms = _zlecenie(), _partia("512")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="512", meatStockId=ms, kg=200)]))
    svc.start_charge(ch["id"])
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=240))
    [dzis] = svc.list_charges_today()
    assert dzis["pallet_id"] == out["pallet_id"]
    assert dzis["pallet_qr"] == out["pallet_qr"]


def test_backfill_zaklada_palete_dla_zywej_partii_bez_palety():
    from app.migrations import run_migrations
    sm = cuid()
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, kg_produced, "
        "kg_available, kg_used, status, created_at) "
        "VALUES (%s,'700','r1','KIRMIZI',120,120,0,'available',now())", (sm,))
    run_migrations()
    run_migrations()
    rows = query_all("SELECT * FROM seasoned_pallets WHERE seasoned_meat_id=%s", (sm,))
    assert len(rows) == 1
    assert float(rows[0]["kg_weighed"]) == 120.0
    assert rows[0]["batch_no"] == "700" and rows[0]["status"] == "in_cold"
    assert rows[0]["pallet_no"] > 0 and rows[0]["charge_id"] is None
