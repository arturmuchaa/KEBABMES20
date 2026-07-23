"""Korekta teoria↔fizyka partii przyprawionego — pojedyncza partia i zbiorcze
zamknięcie dnia produkcji (grupa recipe_id + production_day).

Testy DB — bez TEST_DATABASE_URL cicho pomijane (fixture `db`)."""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.seasoned_meat_service import (
    list_day_reconciliation_history,
    list_production_days,
    reconcile_production_day,
    reconcile_seasoned_batch,
)
from app.utils.ids import now_iso


def _seed_batch(id="sm1", recipe_id="r1", recipe_name="Gold", production_day="2026-07-20",
                 kg_produced=100.0, kg_available=100.0, kg_reserved=0.0, status="available"):
    execute(
        "INSERT INTO recipes (id, name) VALUES (%s,%s) ON CONFLICT (id) DO NOTHING",
        (recipe_id, recipe_name),
    )
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, kg_produced,"
        " kg_available, kg_used, kg_reserved, status, production_day, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)",
        (id, id, recipe_id, recipe_name, kg_produced, kg_available, kg_reserved,
         status, production_day, now_iso()),
    )


def _seed_second_batch(id="sm2", recipe_id="r1", recipe_name="Gold",
                        production_day="2026-07-23", kg_available=50.0,
                        kg_reserved=0.0, expiry_date="2026-07-30"):
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name,"
        " kg_produced, kg_available, kg_used, kg_reserved, status,"
        " production_day, expiry_date, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,0,%s,'available',%s,%s,%s)",
        (id, id, recipe_id, recipe_name, kg_available, kg_available,
         kg_reserved, production_day, expiry_date, now_iso()),
    )


# ─── Charakteryzacja reconcile_seasoned_batch (siatka bezpieczeństwa przed refaktorem) ───

def test_podbicie_wagi_gdy_teoria_zanizona(db):
    _seed_batch(kg_produced=119.0, kg_available=119.0)
    row = reconcile_seasoned_batch("sm1", 120.0, "zaniżona teoria")
    assert float(row["kg_available"]) == 120.0
    saved = query_one("SELECT kg_available, kg_produced, status FROM seasoned_meat WHERE id='sm1'")
    assert float(saved["kg_available"]) == 120.0
    assert float(saved["kg_produced"]) == 120.0
    assert saved["status"] == "available"


def test_zamkniecie_do_zera_ustawia_status_closed(db):
    _seed_batch(kg_produced=12.0, kg_available=12.0)
    reconcile_seasoned_batch("sm1", 0, "resztka technologiczna", close=True)
    saved = query_one("SELECT kg_available, status FROM seasoned_meat WHERE id='sm1'")
    assert float(saved["kg_available"]) == 0.0
    assert saved["status"] == "closed"


def test_blokada_ponizej_rezerwacji(db):
    _seed_batch(kg_available=100.0, kg_reserved=40.0)
    with pytest.raises(HTTPException) as exc:
        reconcile_seasoned_batch("sm1", 30.0, "test")
    assert exc.value.status_code == 400


def test_brak_zmiany_wagi_odrzucone(db):
    _seed_batch(kg_available=100.0)
    with pytest.raises(HTTPException) as exc:
        reconcile_seasoned_batch("sm1", 100.0, "test")
    assert exc.value.status_code == 400


def test_tworzy_ruch_magazynowy_audytowy(db):
    _seed_batch(kg_available=100.0)
    reconcile_seasoned_batch("sm1", 92.0, "strata / odpad")
    mv = query_one(
        "SELECT movement_type, qty, source_type FROM stock_movements"
        " WHERE batch_id='sm1' ORDER BY created_at DESC LIMIT 1"
    )
    assert mv["movement_type"] == "OUT"
    assert float(mv["qty"]) == -8.0  # OUT zapisany jako ujemny (create_stock_movement)
    assert mv["source_type"] == "reconcile"


# ─── reconcile_production_day — jedna partia w grupie ───

def test_jedna_partia_w_grupie_dziala_jak_pojedyncza_korekta(db):
    _seed_batch(kg_produced=244.0, kg_available=244.0, production_day="2026-07-23")
    out = reconcile_production_day("r1", "2026-07-23", 229.0, "ścinki / resztki z produkcji")
    assert out["theoreticalKg"] == 244.0
    assert out["actualKg"] == 229.0
    assert out["delta"] == -15.0
    assert len(out["affectedBatches"]) == 1
    assert out["affectedBatches"][0]["batchNo"] == "sm1"
    saved = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm1'")
    assert float(saved["kg_available"]) == 229.0


def test_blokada_ponizej_sumy_rezerwacji_grupy(db):
    _seed_batch(kg_available=100.0, kg_reserved=40.0, production_day="2026-07-23")
    with pytest.raises(HTTPException) as exc:
        reconcile_production_day("r1", "2026-07-23", 30.0, "test")
    assert exc.value.status_code == 400


def test_brak_zmiany_odrzucone_grupa(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    with pytest.raises(HTTPException) as exc:
        reconcile_production_day("r1", "2026-07-23", 100.0, "test")
    assert exc.value.status_code == 400


def test_delta_dodatnia_tworzy_ruch_in(db):
    _seed_batch(kg_produced=100.0, kg_available=100.0, production_day="2026-07-23")
    reconcile_production_day("r1", "2026-07-23", 105.0, "zaniżona teoria")
    mv = query_one(
        "SELECT movement_type, qty FROM stock_movements"
        " WHERE batch_id='sm1' ORDER BY created_at DESC LIMIT 1"
    )
    assert mv["movement_type"] == "IN"
    assert float(mv["qty"]) == 5.0


# ─── reconcile_production_day — rozkład delty na wiele partii (FEFO) ───

def test_delta_ujemna_przechodzi_na_druga_partie_gdy_pierwsza_zarezerwowana(db):
    _seed_batch(kg_available=100.0, kg_reserved=100.0, production_day="2026-07-23")
    execute("UPDATE seasoned_meat SET expiry_date='2026-07-25' WHERE id='sm1'")
    _seed_second_batch(kg_available=50.0, kg_reserved=0.0, expiry_date="2026-07-30")

    out = reconcile_production_day("r1", "2026-07-23", 130.0, "ścinki / resztki z produkcji")
    assert out["theoreticalKg"] == 150.0
    assert out["delta"] == -20.0
    sm1 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm1'")
    sm2 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm2'")
    assert float(sm1["kg_available"]) == 100.0
    assert float(sm2["kg_available"]) == 30.0
    assert len(out["affectedBatches"]) == 1
    assert out["affectedBatches"][0]["batchNo"] == "sm2"


def test_delta_ujemna_rozklada_sie_gdy_pierwsza_nie_wystarcza(db):
    _seed_batch(kg_available=100.0, kg_reserved=90.0, production_day="2026-07-23")
    execute("UPDATE seasoned_meat SET expiry_date='2026-07-25' WHERE id='sm1'")
    _seed_second_batch(kg_available=50.0, kg_reserved=0.0, expiry_date="2026-07-30")

    out = reconcile_production_day("r1", "2026-07-23", 100.0, "ścinki / resztki z produkcji")
    assert out["delta"] == -50.0
    sm1 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm1'")
    sm2 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm2'")
    assert float(sm1["kg_available"]) == 90.0
    assert float(sm2["kg_available"]) == 10.0
    assert len(out["affectedBatches"]) == 2


# ─── reconcile_production_day — SC{n}, brak żywej partii w grupie ───

def test_brak_zywych_partii_tworzy_pule_sc(db):
    _seed_batch(kg_available=0.0, status="closed", production_day="2026-07-23")
    out = reconcile_production_day("r1", "2026-07-23", 18.0, "ścinki / resztki z produkcji")
    assert out["theoreticalKg"] == 0.0
    assert out["actualKg"] == 18.0
    assert out["delta"] == 18.0
    assert len(out["affectedBatches"]) == 1
    assert out["affectedBatches"][0]["batchNo"] == "SC1"

    new_row = query_one("SELECT * FROM seasoned_meat WHERE batch_no='SC1'")
    assert new_row is not None
    assert float(new_row["kg_available"]) == 18.0
    assert float(new_row["kg_produced"]) == 18.0
    assert new_row["recipe_id"] == "r1"
    assert new_row["recipe_name"] == "Gold"
    assert str(new_row["production_day"]) == "2026-07-23"
    assert new_row["status"] == "available"

    mv = query_one(
        "SELECT movement_type, qty FROM stock_movements"
        " WHERE batch_id=%s ORDER BY created_at DESC LIMIT 1",
        (new_row["id"],),
    )
    assert mv["movement_type"] == "IN"
    assert float(mv["qty"]) == 18.0


def test_brak_zywych_partii_i_actual_zero_no_op(db):
    _seed_batch(kg_available=0.0, status="closed", production_day="2026-07-23")
    out = reconcile_production_day("r1", "2026-07-23", 0.0, "sprawdzone, zgadza się")
    assert out == {"theoreticalKg": 0.0, "actualKg": 0.0, "delta": 0.0, "affectedBatches": []}
    count = query_one("SELECT count(*) AS n FROM seasoned_meat WHERE recipe_id='r1'")
    assert count["n"] == 1


def test_druga_pula_sc_tego_samego_dnia_dostaje_kolejny_numer(db):
    _seed_batch(kg_available=0.0, status="closed", production_day="2026-07-23")
    reconcile_production_day("r1", "2026-07-23", 10.0, "ścinki")
    execute("UPDATE seasoned_meat SET status='closed' WHERE batch_no='SC1'")
    out = reconcile_production_day("r1", "2026-07-23", 5.0, "ścinki, druga tura")
    assert out["affectedBatches"][0]["batchNo"] == "SC2"


# ─── list_production_days ───

def test_list_production_days_czyta_z_bazy(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    _seed_second_batch(kg_available=50.0, production_day="2026-07-23")
    groups = list_production_days("2026-07-23")
    assert len(groups) == 1
    assert groups[0]["recipeId"] == "r1"
    assert groups[0]["theoreticalKg"] == 150.0
    assert groups[0]["batchCount"] == 2


def test_list_production_days_inny_dzien_pusty(db):
    _seed_batch(production_day="2026-07-23")
    assert list_production_days("2026-07-22") == []


# ─── list_day_reconciliation_history ───

def test_historia_czyta_ruchy_reconcile_z_kontekstem_partii(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    reconcile_production_day("r1", "2026-07-23", 85.0, "ścinki / resztki z produkcji")
    history = list_day_reconciliation_history(limit=10)
    assert len(history) == 1
    entry = history[0]
    assert entry["batchNo"] == "sm1"
    assert entry["recipeName"] == "Gold"
    assert entry["productionDay"] == "2026-07-23"
    assert entry["movementType"] == "OUT"
    assert entry["qty"] == 15.0
    assert entry["reason"] == "ścinki / resztki z produkcji"
    assert entry["createdAt"]


def test_historia_ignoruje_ruchy_spoza_reconcile(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    execute(
        "INSERT INTO stock_movements (id, product_type, batch_id, qty,"
        " movement_type, source_type, source_id, created_at)"
        " VALUES ('mv1','seasoned','sm1',10,'OUT','finish_day','plan1', now())"
    )
    assert list_day_reconciliation_history(limit=10) == []
