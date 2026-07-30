"""Korekta z biura, która wyczerpuje partię, musi ją domknąć jak HMI.

Prod 2026-07-30 (partia 444): korekty biurowe zbiły kg_available do zera,
ale nie wywołały _auto_finish_exhausted. Partia zniknęła z HMI — nie była
już aktywna (0 kg), a kafla ubocznych nie dostała (finished_at NULL).
"""
from app.db import execute, query_one
from app.services.batch_byproducts_service import pending
from app.services.deboning_service import (
    change_deboning_entry_batch,
    correct_deboning_entry,
)
from app.utils.ids import cuid, now_iso


def _batch(bid, no, kg, left):
    execute("INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name, "
            "kg_received, kg_available, status, material_type_id, material_name, created_at) "
            "VALUES (%s,%s,%s,'KOKO',%s,%s,'active','mat-cwiartka','Ćwiartka',%s)",
            (bid, no, int(no), kg, left, now_iso()))


def _worker(wid="w1", name="IVAN"):
    execute("INSERT INTO workers (id, name, role, active, created_at) "
            "VALUES (%s,%s,'WORKER_DEBONING',true,%s) ON CONFLICT (id) DO NOTHING",
            (wid, name, now_iso()))
    return wid


def _entry(eid, bid, no, kg_q, kg_m, wid="w1", worker="IVAN"):
    execute("INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, "
            "worker_name, kg_quarter, kg_meat, yield_pct, status, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'complete',now())",
            (eid, bid, no, wid, worker, kg_q, kg_m, round(kg_m / kg_q * 100, 2)))


def test_korekta_kg_domykajaca_partie_wystawia_kafel_ubocznych(db):
    _worker()
    _batch("b1", "444", 1000, 15)
    _entry("e1", "b1", "444", 985, 650)
    assert pending() == [], "przed korektą partia jeszcze ma zapas"

    # Biuro podnosi pobranie o brakujące 15 kg — partia schodzi do zera.
    correct_deboning_entry(entry_id="e1", worker_id=None, kg_quarter=1000.0,
                           kg_meat=None, reason="Karta rozbioru", by_subject="biuro")

    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='b1'")
                 ["kg_available"]) == 0
    assert [p["rawBatchNo"] for p in pending()] == ["444"], \
        "wyczerpana partia musi dostać kafel ważenia ubocznych"


def test_przeniesienie_wpisu_domyka_partie_docelowa(db):
    _worker()
    _batch("b1", "444", 1000, 165)
    _batch("b2", "445", 1000, 835)
    _entry("e1", "b1", "444", 835, 550)
    _entry("e2", "b2", "445", 165, 108)

    # Wpis 165 kg trafił do złej partii — przenosimy do 444, która przez to
    # schodzi do zera.
    change_deboning_entry_batch("e2", "b1")

    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='b1'")
                 ["kg_available"]) == 0
    assert "444" in [p["rawBatchNo"] for p in pending()]


def test_korekta_nie_domyka_partii_z_zapasem(db):
    _worker()
    _batch("b1", "444", 1000, 200)
    _entry("e1", "b1", "444", 800, 530)
    correct_deboning_entry(entry_id="e1", worker_id=None, kg_quarter=850.0,
                           kg_meat=None, reason="Karta rozbioru", by_subject="biuro")
    assert pending() == [], "partia z zapasem zostaje aktywna, bez kafla ubocznych"
