"""Biuro edytuje rozbiór PO zatwierdzeniu zmiany.

Zatwierdzenie dnia blokuje halę, ale nie może blokować biura — inaczej jedyną
drogą naprawy pomyłki operatora zostaje ręczny SQL, a to już raz skończyło się
nadpisanymi pomiarami (incydent korekt 424). Testy pilnują, że:
  * zmiana partii i dopisanie wpisu przechodzą przez sesję 'approved',
  * ścieżka HMI (bez flagi biurowej) dalej jest twardo zablokowana,
  * każda taka zmiana zostawia ślad w deboning_entry_corrections.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.deboning import DeboningEntryCreate
from app.services.deboning_service import (
    change_deboning_entry_batch,
    create_deboning_entry,
)
from app.utils.ids import cuid, now_iso


def _seed_approved(kg_quarter=195.0, kg_meat=128.0):
    """Zatwierdzona sesja + dwie partie + zakończony wpis Oleha na partii 900."""
    # conftest nie czyści production_sessions ani deboning_entries — sprzątamy
    # własne wiersze, żeby seed był idempotentny między testami.
    execute("DELETE FROM deboning_entries WHERE session_id='s-appr'")
    execute("DELETE FROM production_sessions WHERE id='s-appr'")
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
        "('w-oleh','Oleh','rozbior',0.5) ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO production_sessions (id, session_date, process_type, status,"
        " started_at, created_at) VALUES ('s-appr', CURRENT_DATE, 'deboning',"
        " 'approved', now(), now())"
    )
    for bid, no, avail in (("rb-a", "900", 805.0), ("rb-b", "901", kg_quarter)):
        execute(
            "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
            " supplier_name, kg_received, kg_available, status, material_type_id,"
            " material_name, created_at) VALUES (%s,%s,%s,'Dostawca',1000,%s,'active',"
            " 'mat-cwiartka','Ćwiartka z kurczaka',%s)",
            (bid, no, int(no), avail, now_iso()),
        )
    execute(
        "INSERT INTO meat_stock (id, lot_no, raw_batch_id, raw_batch_no, kg_initial,"
        " kg_available, created_at) VALUES ('ms-a','900','rb-a','900',%s,%s, now())",
        (kg_meat, kg_meat),
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, session_id,"
        " worker_id, worker_name, kg_quarter, kg_meat, yield_pct, status,"
        " created_at, completed_at) VALUES ('e-oleh','rb-a','900','s-appr','w-oleh',"
        " 'Oleh',%s,%s,65.6,'complete', now(), now())",
        (kg_quarter, kg_meat),
    )
    execute(
        "INSERT INTO stock_movements (id, product_type, batch_id, qty, movement_type,"
        " source_type, source_id, created_at) VALUES"
        " (%s,'raw','rb-a',%s,'OUT','deboning','e-oleh',now()),"
        " (%s,'meat','ms-a',%s,'IN','deboning','e-oleh',now())",
        (cuid(), -kg_quarter, cuid(), kg_meat),
    )


def _corrections(entry_id):
    r = query_one(
        "SELECT COUNT(*) AS n FROM deboning_entry_corrections WHERE entry_id=%s",
        (entry_id,),
    )
    return int(r["n"])


def test_zmiana_partii_przechodzi_przez_zatwierdzona_zmiane(db):
    _seed_approved()
    change_deboning_entry_batch("e-oleh", "rb-b", "biuro", "operator wybrał złą partię")

    entry = query_one("SELECT raw_batch_no FROM deboning_entries WHERE id='e-oleh'")
    assert entry["raw_batch_no"] == "901"

    # ćwiartka wróciła na starą partię i zeszła z nowej
    assert float(query_one("SELECT kg_available AS a FROM raw_batches WHERE id='rb-a'")["a"]) == 1000.0
    assert float(query_one("SELECT kg_available AS a FROM raw_batches WHERE id='rb-b'")["a"]) == 0.0

    # mięso przeszło na lot nowej partii
    assert query_one("SELECT id FROM meat_stock WHERE lot_no='900'") is None
    assert float(query_one("SELECT kg_available AS a FROM meat_stock WHERE lot_no='901'")["a"]) == 128.0


def test_zmiana_partii_zostawia_slad_z_powodem(db):
    _seed_approved()
    assert _corrections("e-oleh") == 0
    change_deboning_entry_batch("e-oleh", "rb-b", "biuro", "operator wybrał złą partię")

    row = query_one(
        "SELECT by_subject, reason, changes::text AS ch FROM deboning_entry_corrections"
        " WHERE entry_id='e-oleh'"
    )
    assert row["by_subject"] == "biuro"
    assert "złą partię" in row["reason"]
    assert '"from": "900"' in row["ch"] and '"to": "901"' in row["ch"]


def test_dopisanie_wpisu_z_biura_przechodzi_i_zostawia_slad(db):
    _seed_approved()
    dto = DeboningEntryCreate(
        rawBatchId="rb-a", sessionId="s-appr", workerId="w-oleh", workerName="Oleh",
        kgTaken=15.0, kgMeat=10.0,
    )
    created = create_deboning_entry(
        dto, "biuro", office_correction=True, reason="zapomniane ważenie"
    )
    assert _corrections(created["id"]) == 1
    row = query_one(
        "SELECT reason, changes::text AS ch FROM deboning_entry_corrections WHERE entry_id=%s",
        (created["id"],),
    )
    assert row["reason"] == "zapomniane ważenie"
    assert '"kgMeat": 10.0' in row["ch"]
    # mięso doszło do lotu partii źródłowej
    assert float(query_one("SELECT kg_available AS a FROM meat_stock WHERE lot_no='900'")["a"]) == 138.0


def test_hala_dalej_nie_dopisze_do_zatwierdzonej_zmiany(db):
    _seed_approved()
    dto = DeboningEntryCreate(
        rawBatchId="rb-a", sessionId="s-appr", workerId="w-oleh", workerName="Oleh",
        kgTaken=15.0, kgMeat=10.0,
    )
    with pytest.raises(HTTPException) as exc:
        create_deboning_entry(dto, "kiosk")  # bez flagi biurowej
    assert exc.value.status_code == 400
    assert "zatwierdzona" in str(exc.value.detail)


def test_dopisanie_z_biura_wymaga_powodu(db):
    _seed_approved()
    dto = DeboningEntryCreate(
        rawBatchId="rb-a", sessionId="s-appr", workerId="w-oleh", workerName="Oleh",
        kgTaken=15.0, kgMeat=10.0,
    )
    with pytest.raises(HTTPException) as exc:
        create_deboning_entry(dto, "biuro", office_correction=True, reason="ok")
    assert exc.value.status_code == 400
    assert "Powód" in str(exc.value.detail)
