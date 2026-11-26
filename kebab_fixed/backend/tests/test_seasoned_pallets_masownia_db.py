"""Paleta mięsa przyprawionego powstaje przy odbiorze z masownicy (plan A, zad. 1–2)."""
import pytest

from app.db import execute, query_one
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
