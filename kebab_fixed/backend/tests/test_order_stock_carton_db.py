"""Reconciliacja dokumentów: sztuki spakowane do kartonu powiązanego z zamówieniem
NIE są liczone drugi raz w FIFO finished_goods (anty-dublowanie)."""
from app.db import execute
from app.services.order_stock_service import stock_portions_for_order
from app.utils.ids import now_iso


def _seed_order(order_id="ord1", order_no="ZAM/1", client_id="c1"):
    execute("INSERT INTO clients (id, code, name) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (client_id, client_id, client_id))
    execute("INSERT INTO client_orders (id, order_no, client_id) VALUES (%s,%s,%s)",
            (order_id, order_no, client_id))


def _seed_fg(fid="fg1", qty=50, recipe="r1", kg=10.0):
    execute(
        "INSERT INTO finished_goods "
        "(id, batch_no, recipe_id, recipe_name, product_type_name, kg_per_unit, "
        " qty, qty_available, qty_shipped, client_order_no, client_name, produced_date, created_at) "
        "VALUES (%s,'180626 1',%s,'Gold','UDO',%s,%s,%s,0,'','',%s,%s)",
        (fid, recipe, kg, qty, qty, "2026-06-10", now_iso()),
    )


def _seed_linked_carton(order_id="ord1", n=20, recipe="r1", kg=10.0):
    execute(
        "INSERT INTO stock_cartons (id, carton_no, client_id, kg_per_unit, target_qty, "
        " packed_qty, status, linked_order_id, created_at) "
        "VALUES ('sc1', 999, 'c1', %s, %s, %s, 'packed', %s, %s)",
        (kg, n, n, order_id, now_iso()),
    )
    for i in range(n):
        execute(
            "INSERT INTO finished_units "
            "(id, qr_code, status, recipe_id, product_type_id, tuleja, weight_kg, "
            " batch_no, carton_id, created_at) "
            "VALUES (%s,%s,'packed',%s,'p1','T',%s,'180626 1','sc1',%s)",
            (f"fu{i}", f"U|fu{i}", recipe, kg, now_iso()),
        )


def test_portions_exclude_cartoned_units(db):
    _seed_order()
    _seed_fg(qty=50)              # 50 szt dostępne w finished_goods
    _seed_linked_carton(n=20)     # 20 szt już w kartonie pod to zamówienie
    order_lines = [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}]
    portions = stock_portions_for_order("ord1", "ZAM/1", order_lines, {})
    # brak 50 − 20 (karton) = 30 do dobrania z finished_goods
    assert sum(p["take"] for p in portions) == 30
