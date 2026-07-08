"""Dwufazowy rozbiór: pobranie (pending) → domknięcie mięsem → storno.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.deboning import DeboningTakeCreate, DeboningTakeComplete
from app.services.deboning_service import (
    create_deboning_take,
    complete_deboning_take,
    delete_deboning_entry,
    deboning_stats,
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
