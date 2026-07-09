"""Zbiorcze ważenie ubocznych: ważenie w trakcie rozbioru (ensure_record),
domknięcie partii z przeliczeniem %, widoczność w statystykach biura.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date

from app.db import execute, query_one
from app.services.batch_byproducts_service import (
    ensure_record,
    finish_batch,
    pending,
    record,
    today_totals,
)
from app.services.deboning_service import deboning_stats
from app.utils.ids import now_iso, cuid


def _seed_batch_with_entries(batch_id="rb1", internal_no="800", quarter_each=100.0, n=2):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "Dostawca", quarter_each * n, 0, now_iso()),
    )
    for i in range(n):
        execute(
            "INSERT INTO deboning_entries "
            "(id, raw_batch_id, raw_batch_no, worker_name, kg_quarter, kg_meat, yield_pct, created_at) "
            "VALUES (%s,%s,%s,'Jan',%s,%s,66.0, now())",
            (cuid(), batch_id, internal_no, quarter_each, quarter_each * 0.66),
        )


# ── Ważenie w trakcie rozbioru ────────────────────────────────────────
def test_ensure_record_bez_finished_at_i_poza_pending(db):
    _seed_batch_with_entries(internal_no="800")
    rec = ensure_record("rb1")
    assert rec["finishedAt"] is None
    assert rec["quarterKg"] == 200.0
    # partia NIE trafia na szare kafle — nadal aktywna
    assert all(p["rawBatchId"] != "rb1" for p in pending())


def test_finish_po_ensure_stempluje_i_przelicza_procent(db):
    _seed_batch_with_entries(internal_no="801", quarter_each=100.0, n=1)  # 100 kg
    ensure_record("rb1")
    record("rb1", "backs", 20.0, [])  # % liczony z częściowej bazy 100 kg
    # dochodzi druga sztuka — pełna ćwiartka 200 kg
    execute(
        "INSERT INTO deboning_entries "
        "(id, raw_batch_id, raw_batch_no, worker_name, kg_quarter, kg_meat, yield_pct, created_at) "
        "VALUES (%s,'rb1','801','Jan',100,66,66.0, now())",
        (cuid(),),
    )
    rec = finish_batch("rb1")
    assert rec["finishedAt"] is not None
    assert rec["quarterKg"] == 200.0
    assert rec["backsPct"] == 10.0  # przeliczone: 20/200, nie 20/100
    # teraz partia czeka na kości → pending
    assert any(p["rawBatchId"] == "rb1" for p in pending())


def test_weigh_zwraca_palety_do_doladowania(db):
    _seed_batch_with_entries(internal_no="802")
    ensure_record("rb1")
    pal = [{"tareLabel": "H1", "tareKg": 18, "containers": 10, "gross": 138, "net": 100}]
    rec = record("rb1", "backs", 100.0, pal)
    assert rec["backsPallets"] and rec["backsPallets"][0]["net"] == 100


# ── Widoczność w biurze / na HMI ──────────────────────────────────────
def test_stats_biura_widza_zbiorcze_grzbiety_i_kosci(db):
    _seed_batch_with_entries(internal_no="803")
    finish_batch("rb1")
    record("rb1", "backs", 40.0, [])
    record("rb1", "bones", 30.0, [])
    today = date.today().isoformat()
    stats = deboning_stats(today, today)
    assert stats["summary"]["kgBacks"] == 40.0
    assert stats["summary"]["kgBones"] == 30.0


def test_today_totals_sumuje_dzisiejsze_wazenia(db):
    _seed_batch_with_entries(internal_no="804")
    ensure_record("rb1")
    record("rb1", "backs", 55.5, [])
    t = today_totals()
    assert t["backsKg"] == 55.5
    assert t["bonesKg"] == 0.0
