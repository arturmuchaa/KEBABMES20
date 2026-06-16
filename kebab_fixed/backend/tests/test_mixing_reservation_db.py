"""Testy INTEGRACYJNE rezerwacji partii masowania (prawdziwy SQL na bazie testowej).

Pokrywają to, czego nie złapią czyste testy: faktyczne UPDATE meat_stock.kg_reserved,
INSERT mixing_order_lots, rollback przy braku kg, release rezerwacji. To ścieżka
krytyczna dla śladu partii — błąd = błędna alokacja surowca.

Wymaga TEST_DATABASE_URL (patrz conftest). Bez niej testy są pomijane.
"""
import pytest
from fastapi import HTTPException

from app.db import transaction, query_one, execute
from app.services.mixing_service import _reserve_order_lots_cx, _release_order_lots_cx


def _seed_order(order_id="o1", order_no="MAS/TEST/1"):
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, status) "
        "VALUES (%s,%s,%s,%s,'planned')",
        (order_id, order_no, "r1", "Test"),
    )


def _seed_stock(ms_id, lot_no, kg_available, kg_reserved=0):
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_available, kg_reserved, status) "
        "VALUES (%s,%s,%s,%s,'AVAILABLE')",
        (ms_id, lot_no, kg_available, kg_reserved),
    )


def test_reserve_increases_kg_reserved_and_inserts_lot(db):
    _seed_order()
    _seed_stock("ms1", "LOT-1", 100)
    with transaction() as conn:
        _reserve_order_lots_cx(conn, "o1", [{"meatLotId": "ms1", "kgPlanned": 30}])

    ms = query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s", ("ms1",))
    assert float(ms["kg_reserved"]) == 30.0
    lot = query_one(
        "SELECT kg_planned FROM mixing_order_lots WHERE order_id=%s AND meat_stock_id=%s",
        ("o1", "ms1"),
    )
    assert lot is not None and float(lot["kg_planned"]) == 30.0


def test_reserve_insufficient_raises_400_and_rolls_back(db):
    _seed_order()
    _seed_stock("ms1", "LOT-1", kg_available=10)
    with pytest.raises(HTTPException) as exc:
        with transaction() as conn:
            _reserve_order_lots_cx(conn, "o1", [{"meatLotId": "ms1", "kgPlanned": 50}])
    assert exc.value.status_code == 400
    # rollback — nic nie zarezerwowane
    ms = query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s", ("ms1",))
    assert float(ms["kg_reserved"]) == 0.0


def test_reserve_respects_existing_reservation(db):
    _seed_order()
    # wolne = 100 - 80 = 20; prośba o 50 → za mało
    _seed_stock("ms1", "LOT-1", kg_available=100, kg_reserved=80)
    with pytest.raises(HTTPException):
        with transaction() as conn:
            _reserve_order_lots_cx(conn, "o1", [{"meatLotId": "ms1", "kgPlanned": 50}])


def test_reserve_tolerance_allows_0_1_kg_rounding(db):
    _seed_order()
    _seed_stock("ms1", "LOT-1", kg_available=49.95)  # brakuje 0.05 < tolerancja 0.1
    with transaction() as conn:
        _reserve_order_lots_cx(conn, "o1", [{"meatLotId": "ms1", "kgPlanned": 50}])
    ms = query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s", ("ms1",))
    assert float(ms["kg_reserved"]) == 50.0


def test_missing_stock_raises_400(db):
    _seed_order()
    with pytest.raises(HTTPException) as exc:
        with transaction() as conn:
            _reserve_order_lots_cx(conn, "o1", [{"meatLotId": "nope", "kgPlanned": 5}])
    assert exc.value.status_code == 400


def test_release_zeroes_reservation_and_deletes_lots(db):
    _seed_order()
    _seed_stock("ms1", "LOT-1", kg_available=100)
    with transaction() as conn:
        _reserve_order_lots_cx(conn, "o1", [{"meatLotId": "ms1", "kgPlanned": 40}])
    with transaction() as conn:
        _release_order_lots_cx(conn, "o1")

    ms = query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s", ("ms1",))
    assert float(ms["kg_reserved"]) == 0.0
    lot = query_one("SELECT id FROM mixing_order_lots WHERE order_id=%s", ("o1",))
    assert lot is None


def test_reserve_two_lots_sums_independently(db):
    _seed_order()
    _seed_stock("ms1", "LOT-1", kg_available=100)
    _seed_stock("ms2", "LOT-2", kg_available=200)
    with transaction() as conn:
        _reserve_order_lots_cx(conn, "o1", [
            {"meatLotId": "ms1", "kgPlanned": 30},
            {"meatLotId": "ms2", "kgPlanned": 120},
        ])
    a = query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s", ("ms1",))
    b = query_one("SELECT kg_reserved FROM meat_stock WHERE id=%s", ("ms2",))
    assert float(a["kg_reserved"]) == 30.0
    assert float(b["kg_reserved"]) == 120.0
