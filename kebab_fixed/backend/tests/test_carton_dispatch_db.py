"""Wysyłka kartonu magazynowego przez wyjazd (dispatches): ad-hoc i pod zamówienie."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.production import StockCartonCreate, StockCartonLineDto
from app.services.stock_cartons_service import create_stock_carton, scan_unit_into_carton
from app.services.dispatches_service import (
    create_dispatch, scan_carton_into_dispatch)
from app.utils.ids import now_iso
from app.utils.unit_codes import unit_qr


def _seed_unit(uid, *, recipe="r1", ptype="p1", tuleja="METAL 40", kg=10.0, client="Zagros"):
    execute(
        "INSERT INTO finished_units "
        "(id, qr_code, status, recipe_id, product_type_id, tuleja, weight_kg, "
        " client_name, batch_no, created_at) "
        "VALUES (%s,%s,'produced',%s,%s,%s,%s,%s,'180626 1',%s)",
        (uid, unit_qr(uid), recipe, ptype, tuleja, kg, client, now_iso()),
    )


def _packed_carton(client_name="Zagros", n=2):
    carton = create_stock_carton(StockCartonCreate(client_id="c1", client_name=client_name, lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="p1", packaging_name="METAL 40",
                           kg_per_unit=10.0, qty=n)]))
    for i in range(n):
        uid = f"cd_{client_name}_{i}"
        _seed_unit(uid, client=client_name)
        scan_unit_into_carton(carton["id"], unit_qr(uid))
    return carton


def test_carton_dispatch_assigns_all_units(db):
    """Skan kartonu na wyjazd przypina wszystkie spakowane sztuki kartonu do wydania.
    (Przejście packed→shipped realizuje close_dispatch — pokryte w testach wydania.)"""
    carton = _packed_carton("Zagros", n=2)
    disp = create_dispatch({"client_name": "Zagros"})
    res = scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    assert res["added"] == 2
    u0 = query_one("SELECT dispatch_id FROM finished_units WHERE id='cd_Zagros_0'")
    u1 = query_one("SELECT dispatch_id FROM finished_units WHERE id='cd_Zagros_1'")
    assert u0["dispatch_id"] == disp["id"] and u1["dispatch_id"] == disp["id"]


def test_carton_dispatch_idempotent(db):
    carton = _packed_carton("Zagros", n=2)
    disp = create_dispatch({"client_name": "Zagros"})
    scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    res2 = scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    assert res2["added"] == 0 and res2["qty"] == 2


def test_carton_dispatch_rejects_other_client(db):
    carton = _packed_carton("Zagros", n=1)
    disp = create_dispatch({"client_name": "Inny"})
    with pytest.raises(HTTPException) as e:
        scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    assert e.value.status_code == 409


def test_carton_dispatch_ad_hoc_no_client_ok(db):
    carton = _packed_carton("Zagros", n=2)
    disp = create_dispatch({})  # wyjazd bez klienta — ad-hoc
    res = scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    assert res["added"] == 2
