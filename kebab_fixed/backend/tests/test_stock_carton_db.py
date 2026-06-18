"""Testy DB: tworzenie kartonu magazynowego z ręki + przypisanie do zamówienia.

Karton magazynowy = wpis finished_goods na magazyn (client_order_no puste) z
globalnym carton_no. Przypisanie stempluje client_order_no = order_no.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.production import StockCartonCreate
from app.services.finished_goods_service import (
    assign_stock_carton_to_order,
    create_stock_carton,
)


def _seed_client(cid):
    execute("INSERT INTO clients (id, code, name) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (cid, cid, cid))


def _seed_packaging(pid="pak1", qty=1000):
    execute(
        "INSERT INTO packaging (id, code, name, type, unit, kg_initial, kg_available) "
        "VALUES (%s,%s,%s,'tuleja','szt',%s,%s) ON CONFLICT (id) DO NOTHING",
        (pid, pid, "METAL 50CM", qty, qty),
    )


def _seed_order(order_id="ord1", order_no="ZAM/1", client_id="c1", client_name="ZAGROS"):
    _seed_client(client_id)
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name) "
        "VALUES (%s,%s,%s,%s)",
        (order_id, order_no, client_id, client_name),
    )


def _dto(**kw):
    base = dict(client_id="c1", client_name="ZAGROS", recipe_id="r1", recipe_name="Gold",
                product_type_id="p1", product_type_name="MIX 70/30",
                packaging_id="pak1", packaging_name="METAL 50CM", qty=15, kg_per_unit=50.0)
    base.update(kw)
    return StockCartonCreate(**base)


# ── Tworzenie kartonu z ręki ───────────────────────────────────────────
def test_create_stock_carton_assigns_carton_no_and_is_stock(db):
    _seed_packaging()
    row = create_stock_carton(_dto())
    assert row["carton_no"] is not None
    assert row["client_id"] == "c1"
    assert (row.get("client_order_no") or "") == ""   # na magazyn
    assert row["qty"] == 15
    assert float(row["qty_available"]) == 15


def test_two_stock_cartons_get_distinct_sequential_numbers(db):
    _seed_packaging()
    a = create_stock_carton(_dto())
    b = create_stock_carton(_dto())
    assert b["carton_no"] == a["carton_no"] + 1


# ── Przypisanie do zamówienia ──────────────────────────────────────────
def test_assign_stamps_client_order_no(db):
    _seed_packaging()
    _seed_order(order_no="ZAM/7")
    carton = create_stock_carton(_dto())
    assign_stock_carton_to_order(carton["id"], "ord1")
    fg = query_one("SELECT client_order_no FROM finished_goods WHERE id=%s", (carton["id"],))
    assert fg["client_order_no"] == "ZAM/7"


def test_assign_rejects_spec_mismatch(db):
    # Zamówienie innego klienta → niezgodność → 409, bez stempla.
    _seed_packaging()
    _seed_client("c1")
    _seed_order(order_no="ZAM/9", client_id="INNY")
    carton = create_stock_carton(_dto(client_id="c1"))
    with pytest.raises(HTTPException) as exc:
        assign_stock_carton_to_order(carton["id"], "ord1")
    assert exc.value.status_code == 409
    fg = query_one("SELECT client_order_no FROM finished_goods WHERE id=%s", (carton["id"],))
    assert (fg["client_order_no"] or "") == ""
