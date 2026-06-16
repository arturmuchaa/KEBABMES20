"""Czysta logika rezerwacji partii masowania (mixing_service).

Pokrywa decyzyjną część `_reserve_order_lots_cx` / `replace_order_meat_lots`
wydzieloną do czystych funkcji — bez DB (zgodnie ze wzorcem pozostałych testów).
Sama orkiestracja SQL (FOR UPDATE / INSERT / UPDATE / release) wymaga fixture
bazy i jest poza zakresem tych testów jednostkowych.
"""
import pytest
from fastapi import HTTPException

from app.services.mixing_service import (
    normalize_reservation_lots,
    free_kg,
    has_enough_free,
    RESERVE_TOLERANCE_KG,
)


# ── normalize_reservation_lots ──────────────────────────────────────────

def test_normalize_accepts_camel_and_snake_keys():
    out = normalize_reservation_lots([
        {"meatLotId": "a", "kgPlanned": 10},
        {"meat_lot_id": "b", "kg_planned": 20},
    ])
    assert out == [("a", 10.0), ("b", 20.0)]


def test_normalize_skips_empty_id_and_nonpositive_kg():
    out = normalize_reservation_lots([
        {"meatLotId": "", "kgPlanned": 10},      # brak id
        {"meatLotId": "x", "kgPlanned": 0},       # zero kg
        {"meatLotId": "y", "kgPlanned": -5},      # ujemne kg
        {"meatLotId": "z", "kgPlanned": 7},       # OK
    ])
    assert out == [("z", 7.0)]


def test_normalize_sorts_by_id_deterministically():
    # Stała kolejność blokad = anty-deadlock; ta sama kolejność niezależnie od wejścia.
    a = normalize_reservation_lots([
        {"meatLotId": "m3", "kgPlanned": 1},
        {"meatLotId": "m1", "kgPlanned": 2},
        {"meatLotId": "m2", "kgPlanned": 3},
    ])
    b = normalize_reservation_lots([
        {"meatLotId": "m2", "kgPlanned": 3},
        {"meatLotId": "m3", "kgPlanned": 1},
        {"meatLotId": "m1", "kgPlanned": 2},
    ])
    assert a == b == [("m1", 2.0), ("m2", 3.0), ("m3", 1.0)]


def test_normalize_empty_input():
    assert normalize_reservation_lots([]) == []


# ── free_kg ─────────────────────────────────────────────────────────────

def test_free_kg_basic():
    assert free_kg(100, 30) == 70.0


def test_free_kg_handles_none():
    assert free_kg(None, None) == 0.0
    assert free_kg(50, None) == 50.0


# ── has_enough_free (kluczowa walidacja rezerwacji) ─────────────────────

def test_has_enough_free_when_plenty():
    assert has_enough_free(available=100, reserved=20, kg_needed=50) is True


def test_has_enough_free_exact_match():
    assert has_enough_free(available=50, reserved=0, kg_needed=50) is True


def test_has_enough_free_false_when_short():
    # wolne 30, potrzeba 50 → za mało
    assert has_enough_free(available=100, reserved=70, kg_needed=50) is False


def test_has_enough_free_tolerance_boundary():
    # Tolerancja zaokrągleń wag = 0.1 kg: brakujące 0.1 jest jeszcze OK, 0.2 już nie.
    assert RESERVE_TOLERANCE_KG == 0.1
    assert has_enough_free(available=49.9, reserved=0, kg_needed=50.0) is True
    assert has_enough_free(available=49.8, reserved=0, kg_needed=50.0) is False


# ── Scenariusz: podmiana partii (warstwa 2 — replace_order_meat_lots) ───

def test_batch_swap_produces_new_reservation_plan():
    # Plan zaplanował partię "old", operator podmienia na "new" ze stanu.
    # Po podmianie plan rezerwacji dotyczy nowej partii, nie starej.
    old_plan = normalize_reservation_lots([{"meatLotId": "old", "kgPlanned": 200}])
    new_plan = normalize_reservation_lots([{"meat_lot_id": "new", "kg_planned": 200}])
    assert old_plan == [("old", 200.0)]
    assert new_plan == [("new", 200.0)]
    assert old_plan != new_plan


def test_batch_swap_to_insufficient_stock_is_rejected():
    # Operator chce podmienić na partię, której na stanie jest za mało → blokada.
    # (ta sama bramka has_enough_free, której używa _reserve_order_lots_cx)
    substitute = {"kg_available": 120, "kg_reserved": 0}
    assert has_enough_free(substitute["kg_available"], substitute["kg_reserved"], 200) is False
    assert has_enough_free(substitute["kg_available"], substitute["kg_reserved"], 100) is True


def test_reservation_raises_is_http_400_shape():
    # Dokumentuje kontrakt: niewystarczające kg → HTTPException 400 w warstwie DB.
    # (tu sprawdzamy tylko że bramka zwraca False — DB rzuca 400 na tej podstawie)
    with pytest.raises(HTTPException) as exc:
        if not has_enough_free(10, 0, 50):
            raise HTTPException(400, "Niewystarczające kg")
    assert exc.value.status_code == 400
