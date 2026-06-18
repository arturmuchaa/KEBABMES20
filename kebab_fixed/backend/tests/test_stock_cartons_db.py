"""Testy: karton magazynowy = jednostka pakowa (bez zamówienia).

Biuro tworzy karton (spec + carton_no); magazynier skanuje WYPRODUKOWANE sztuki
do kartonu (finished_units.carton_id). Zgodne z łańcuchem co do sztuki.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.production import StockCartonCreate, StockCartonLineDto
from app.services.stock_cartons_service import (
    add_units_to_carton_line,
    assign_carton_to_order,
    create_stock_carton,
    eligible_units_for_carton,
    get_carton,
    scan_unit_into_carton,
)
from app.services.stock_carton_match_service import suggestions_for_order
from app.utils.ids import now_iso
from app.utils.unit_codes import unit_qr


def _dto(**kw):
    base = dict(client_id="c1", client_name="GOLD", recipe_id="r1", recipe_name="Gold",
                product_type_id="p1", product_type_name="UDO 100%",
                packaging_id="pak1", packaging_name="METAL 40", qty=18, kg_per_unit=40.0)
    base.update(kw)
    return StockCartonCreate(**base)


def _seed_unit(uid, *, status="produced", recipe="r1", ptype="p1",
               tuleja="METAL 40", kg=40.0, client="GOLD", carton_id=None):
    execute(
        "INSERT INTO finished_units "
        "(id, qr_code, status, recipe_id, product_type_id, tuleja, weight_kg, "
        " client_name, batch_no, carton_id, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'180626 1',%s,%s)",
        (uid, unit_qr(uid), status, recipe, ptype, tuleja, kg, client, carton_id, now_iso()),
    )


# ── Tworzenie kartonu ──────────────────────────────────────────────────
def test_create_assigns_carton_no_open(db):
    c = create_stock_carton(_dto())
    assert c["carton_no"] is not None
    assert c["status"] == "open"
    assert c["packed_qty"] == 0
    assert c["target_qty"] == 18


def test_create_blocks_duplicate_open_carton(db):
    create_stock_carton(_dto())
    with pytest.raises(HTTPException) as exc:
        create_stock_carton(_dto())   # ten sam spec, otwarty → blokada
    assert exc.value.status_code == 409


def test_create_allows_after_first_packed(db):
    c = create_stock_carton(_dto(qty=1))
    _seed_unit("ud1"); scan_unit_into_carton(c["id"], unit_qr("ud1"))  # pierwszy spakowany
    # ten sam spec, ale poprzedni już spakowany → wolno utworzyć kolejny
    c2 = create_stock_carton(_dto(qty=1))
    assert c2["carton_no"] != c["carton_no"]


# ── Karton mieszany (wiele pozycji) ────────────────────────────────────
def test_create_mixed_carton_has_two_lines(db):
    dto = StockCartonCreate(client_id="c1", client_name="Zagros", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tuleja A", kg_per_unit=10.0, qty=30),
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tuleja B", kg_per_unit=15.0, qty=20),
    ])
    carton = create_stock_carton(dto)
    assert carton["target_qty"] == 50
    lines = query_all("SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit", (carton["id"],))
    assert len(lines) == 2
    assert int(lines[0]["target_qty"]) == 30 and float(lines[0]["kg_per_unit"]) == 10.0
    assert int(lines[1]["target_qty"]) == 20 and float(lines[1]["kg_per_unit"]) == 15.0


def test_scan_mixed_carton_full_after_all_lines(db):
    carton = create_stock_carton(StockCartonCreate(client_id="c1", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="p1", packaging_name="METAL 40", kg_per_unit=10.0, qty=1),
        StockCartonLineDto(recipe_id="r1", product_type_id="p1", packaging_name="METAL 40", kg_per_unit=15.0, qty=1),
    ]))
    _seed_unit("m10", kg=10.0)
    _seed_unit("m15", kg=15.0)
    r1 = scan_unit_into_carton(carton["id"], unit_qr("m10"))
    assert r1["full"] is False
    r2 = scan_unit_into_carton(carton["id"], unit_qr("m15"))
    assert r2["full"] is True and r2["targetQty"] == 2 and r2["packedQty"] == 2


def test_get_carton_returns_lines(db):
    carton = create_stock_carton(StockCartonCreate(client_id="c1", lines=[
        StockCartonLineDto(recipe_id="r1", recipe_name="Gold", product_type_id="p1",
                           product_type_name="UDO", packaging_name="METAL 40", kg_per_unit=10.0, qty=3),
        StockCartonLineDto(recipe_id="r1", product_type_id="p1", packaging_name="METAL 40", kg_per_unit=15.0, qty=2),
    ]))
    detail = get_carton(carton["id"])
    assert len(detail["lines"]) == 2
    assert {int(l["target_qty"]) for l in detail["lines"]} == {3, 2}


# ── Ręczne dodanie sztuk z magazynu (biuro) ────────────────────────────
def test_add_units_to_line_packs_fifo(db):
    carton = create_stock_carton(StockCartonCreate(client_id="c1", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="p1", packaging_name="METAL 40", kg_per_unit=40.0, qty=5)]))
    line = query_one("SELECT id FROM stock_carton_lines WHERE carton_id=%s", (carton["id"],))
    for i in range(3):
        _seed_unit(f"add{i}")
    res = add_units_to_carton_line(carton["id"], line["id"], 2)
    assert res["added"] == 2
    packed = query_one("SELECT packed_qty FROM stock_carton_lines WHERE id=%s", (line["id"],))
    assert int(packed["packed_qty"]) == 2


# ── Skan sztuki do kartonu ─────────────────────────────────────────────
def test_scan_packs_matching_produced_unit(db):
    c = create_stock_carton(_dto())
    _seed_unit("u1")
    res = scan_unit_into_carton(c["id"], unit_qr("u1"))
    assert res["packedQty"] == 1
    u = query_one("SELECT carton_id, status FROM finished_units WHERE id='u1'")
    assert u["carton_id"] == c["id"]
    assert u["status"] == "packed"
    cc = query_one("SELECT packed_qty FROM stock_cartons WHERE id=%s", (c["id"],))
    assert cc["packed_qty"] == 1


def test_scan_same_unit_into_same_carton_is_idempotent(db):
    # Ponowny skan tej samej sztuki do TEGO kartonu (retry/dubel z kolejki offline)
    # → OK, bez podwojenia i bez błędu.
    c = create_stock_carton(_dto())
    _seed_unit("uidem")
    r1 = scan_unit_into_carton(c["id"], unit_qr("uidem"))
    r2 = scan_unit_into_carton(c["id"], unit_qr("uidem"))
    assert r1["packedQty"] == 1 and r2["packedQty"] == 1
    cc = query_one("SELECT packed_qty FROM stock_cartons WHERE id=%s", (c["id"],))
    assert cc["packed_qty"] == 1


def test_scan_rejects_wrong_spec(db):
    c = create_stock_carton(_dto())
    _seed_unit("u2", ptype="INNY")
    with pytest.raises(HTTPException) as exc:
        scan_unit_into_carton(c["id"], unit_qr("u2"))
    assert exc.value.status_code == 409


def test_scan_rejects_wrong_weight(db):
    c = create_stock_carton(_dto())
    _seed_unit("u2b", kg=30.0)
    with pytest.raises(HTTPException) as exc:
        scan_unit_into_carton(c["id"], unit_qr("u2b"))
    assert exc.value.status_code == 409


def test_scan_rejects_unproduced_unit(db):
    c = create_stock_carton(_dto())
    _seed_unit("u3", status="planned")
    with pytest.raises(HTTPException) as exc:
        scan_unit_into_carton(c["id"], unit_qr("u3"))
    assert exc.value.status_code == 409


def test_scan_rejects_already_packed_unit(db):
    c = create_stock_carton(_dto())
    _seed_unit("u4", status="packed", carton_id="other")
    with pytest.raises(HTTPException) as exc:
        scan_unit_into_carton(c["id"], unit_qr("u4"))
    assert exc.value.status_code == 409


def test_scan_rejects_when_carton_full(db):
    c = create_stock_carton(_dto(qty=1))
    _seed_unit("u5"); _seed_unit("u6")
    scan_unit_into_carton(c["id"], unit_qr("u5"))
    with pytest.raises(HTTPException) as exc:
        scan_unit_into_carton(c["id"], unit_qr("u6"))
    assert exc.value.status_code == 409
    cc = query_one("SELECT status FROM stock_cartons WHERE id=%s", (c["id"],))
    assert cc["status"] == "packed"  # osiągnięto target → zamknięty


# ── Walidacja lokalna offline: lista uprawnionych sztuk ────────────────
def test_eligible_units_returns_matching_produced_unpacked(db):
    c = create_stock_carton(_dto())
    _seed_unit("e1")                              # pasuje
    _seed_unit("e2")                              # pasuje
    _seed_unit("e3", ptype="INNY")                # zła spec
    _seed_unit("e4", status="planned")            # nie wyprodukowana
    _seed_unit("e5", carton_id="x", status="packed")  # już spakowana
    codes = {u["code"] for u in eligible_units_for_carton(c["id"])}
    assert codes == {unit_qr("e1"), unit_qr("e2")}


# ── Faza 2: dopasowanie + przypisanie do zamówienia ────────────────────
def _seed_client_order(order_id="ord1", order_no="ZAM/1", client_id="c1"):
    execute("INSERT INTO clients (id, code, name) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (client_id, client_id, client_id))
    execute("INSERT INTO client_orders (id, order_no, client_id) VALUES (%s,%s,%s)",
            (order_id, order_no, client_id))
    execute(
        "INSERT INTO client_order_lines "
        "(id, order_id, qty, kg_per_unit, recipe_id, product_type_id, packaging_id) "
        "VALUES ('l1',%s,18,40.0,'r1','p1','pak1')",
        (order_id,),
    )


def test_suggestions_match_packed_carton(db):
    c = create_stock_carton(_dto())
    _seed_unit("us1"); scan_unit_into_carton(c["id"], unit_qr("us1"))
    _seed_client_order(client_id="c1")
    sugg = suggestions_for_order("ord1")
    assert any(s["cartonId"] == c["id"] for s in sugg)


def test_assign_links_carton_and_validates_client(db):
    c = create_stock_carton(_dto(client_id="c1"))
    _seed_unit("ua1"); scan_unit_into_carton(c["id"], unit_qr("ua1"))
    _seed_client_order(client_id="c1", order_no="ZAM/5")
    assign_carton_to_order(c["id"], "ord1")
    cc = query_one("SELECT linked_order_no FROM stock_cartons WHERE id=%s", (c["id"],))
    assert cc["linked_order_no"] == "ZAM/5"
    u = query_one("SELECT order_id FROM finished_units WHERE id='ua1'")
    assert u["order_id"] == "ord1"


def test_assign_rejects_empty_carton(db):
    c = create_stock_carton(_dto(client_id="c1"))  # nic nie spakowane
    _seed_client_order(client_id="c1", order_no="ZAM/7")
    with pytest.raises(HTTPException) as exc:
        assign_carton_to_order(c["id"], "ord1")
    assert exc.value.status_code == 409


def test_assign_rejects_other_client(db):
    c = create_stock_carton(_dto(client_id="c1"))
    _seed_unit("ub1"); scan_unit_into_carton(c["id"], unit_qr("ub1"))
    _seed_client_order(client_id="INNY", order_no="ZAM/9")
    with pytest.raises(HTTPException) as exc:
        assign_carton_to_order(c["id"], "ord1")
    assert exc.value.status_code == 409
