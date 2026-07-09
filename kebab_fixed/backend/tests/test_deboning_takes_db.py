"""Dwufazowy rozbiór: pobranie (pending) → domknięcie mięsem → storno.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.deboning import DeboningTakeCreate, DeboningTakeComplete, DeboningTakeUpdate
from app.services.deboning_service import (
    create_deboning_take,
    complete_deboning_take,
    delete_deboning_entry,
    deboning_stats,
    update_deboning_take,
)
from app.utils.ids import now_iso


def _seed_cwiartka_batch(batch_id="rb1", internal_no="700", kg=100.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "Dostawca", kg, kg, now_iso()),
    )


# ── Faza 1: pobranie ──────────────────────────────────────────────────
def test_take_tworzy_wpis_pending_bez_miesa(db):
    _seed_cwiartka_batch(internal_no="700", kg=100.0)
    entry = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    assert entry["status"] == "pending"
    assert entry["kgTaken"] == 60.0
    assert entry["kgMeat"] == 0
    row = query_one("SELECT status, kg_meat FROM deboning_entries WHERE id=%s", (entry["id"],))
    assert row["status"] == "pending"


def test_take_zdejmuje_surowiec_z_partii(db):
    _seed_cwiartka_batch(internal_no="701", kg=100.0)
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 40.0


def test_take_nie_tworzy_lotu_miesa(db):
    _seed_cwiartka_batch(internal_no="702", kg=100.0)
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    ms = query_one("SELECT id FROM meat_stock WHERE lot_no='702'")
    assert ms is None


# ── Faza 2: domknięcie mięsem ─────────────────────────────────────────
def test_complete_domyka_wpis_i_tworzy_lot_miesa(db):
    _seed_cwiartka_batch(internal_no="710", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    done = complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    assert done["status"] == "complete"
    assert done["kgMeat"] == 70.0
    ms = query_one("SELECT kg_available FROM meat_stock WHERE lot_no='710'")
    assert ms and float(ms["kg_available"]) == 70.0


def test_complete_nie_rusza_surowca_drugi_raz(db):
    _seed_cwiartka_batch(internal_no="711", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 0.0  # zeszło raz przy pobraniu


def test_complete_zla_wydajnosc_blokuje(db):
    _seed_cwiartka_batch(internal_no="712", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    with pytest.raises(HTTPException) as ei:
        complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=20.0))
    assert ei.value.status_code == 400


def test_podwojne_domkniecie_odrzucone(db):
    _seed_cwiartka_batch(internal_no="713", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    with pytest.raises(HTTPException) as ei:
        complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=60.0))
    assert ei.value.status_code == 409


# ── Storno pending + statystyki ───────────────────────────────────────
def test_storno_pending_oddaje_surowiec(db):
    _seed_cwiartka_batch(internal_no="720", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    delete_deboning_entry(take["id"])
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 100.0
    row = query_one("SELECT id FROM deboning_entries WHERE id=%s", (take["id"],))
    assert row is None


def test_stats_pomija_pending(db):
    _seed_cwiartka_batch(internal_no="721", kg=200.0)
    # pending: 60 kg ćwiartki, 0 mięsa — nie może zaniżyć wydajności
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    today = date.today().isoformat()
    stats = deboning_stats(today, today)
    assert stats["summary"]["kgMeat"] == 0.0
    assert stats["summary"]["quarters"] == 0  # pending nie liczy się jako sztuka
    assert stats["byBatch"] == []  # uzysk per partia też bez pending


def test_dobranie_scala_sie_w_jedno_pobranie(db):
    """Anatoli 135 + 300 ma być JEDNYM pobraniem 435 (prod 2026-07-09)."""
    _seed_cwiartka_batch(internal_no="740", kg=500.0)
    t1 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli", kg_taken=135.0,
    ))
    t2 = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Anatoli", kg_taken=300.0,
    ))
    assert t2["id"] == t1["id"]
    assert t2["kgTaken"] == 435.0
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 65.0
    # jeden ruch OUT o łącznej masie
    mv = query_one(
        "SELECT COUNT(*) AS c, COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE source_type='deboning' AND source_id=%s AND movement_type='OUT'",
        (t1["id"],),
    )
    assert int(mv["c"]) == 1 and float(mv["q"]) == -435.0  # OUT = ujemne kg
    # storno scalonego pobrania oddaje CAŁOŚĆ
    delete_deboning_entry(t1["id"])
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 500.0


def test_edycja_pobrania_koryguje_partie(db):
    _seed_cwiartka_batch(internal_no="741", kg=500.0)
    t = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_id="w1", worker_name="Jan", kg_taken=200.0,
    ))
    upd = update_deboning_take(t["id"], DeboningTakeUpdate(kg_taken=150.0))
    assert upd["kgTaken"] == 150.0
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 350.0  # 500 - 150
    mv = query_one(
        "SELECT qty FROM stock_movements WHERE source_type='deboning' AND source_id=%s "
        "AND movement_type='OUT'", (t["id"],),
    )
    assert float(mv["qty"]) == -150.0  # OUT = ujemne kg
    # edycja ponad dostępność blokuje
    with pytest.raises(HTTPException) as ei:
        update_deboning_take(t["id"], DeboningTakeUpdate(kg_taken=999.0))
    assert ei.value.status_code == 400


def test_backfill_abp_pomija_pending(db):
    """Backfill ABP nie może wygenerować lotu 'other' z całej ćwiartki
    pending — zablokowałoby to poprawne loty przy domknięciu (idempotencja)."""
    from app.services.byproducts_service import backfill_byproduct_lots

    _seed_cwiartka_batch(internal_no="730", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    backfill_byproduct_lots()
    lots = query_one(
        "SELECT COUNT(*) AS c FROM byproduct_lots WHERE deboning_entry_id=%s",
        (take["id"],),
    )
    assert int(lots["c"]) == 0  # pending nietknięty
    # po domknięciu powstają właściwe loty ABP
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    lots = query_one(
        "SELECT COUNT(*) AS c FROM byproduct_lots WHERE deboning_entry_id=%s",
        (take["id"],),
    )
    assert int(lots["c"]) > 0
