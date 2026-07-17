"""Anulowanie przyjęcia ćwiartki: zeruje stan i partia znika z magazynu/WZ.

Duch partii 415 (prod 2026-07-16): anulowana dostawa wisiała z 5010 kg na
magazynie surowca i w pickerze WZ, bo cancel_batch nie zerował kg_available,
a stock_raw() filtrował tylko po kg_available > 0 — bez statusu.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from app.db import execute, query_one
from app.services.raw_batches_service import cancel_batch
from app.services.wz_service import stock_raw
from app.utils.ids import now_iso


def _seed_raw(batch_id="rbc1", internal_no="415", kg=5010.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "KOKO", kg, kg, now_iso()),
    )


def test_cancel_zeruje_stan_i_partia_znika_z_magazynu(db):
    _seed_raw()
    assert any(r["internal_batch_no"] == "415" for r in stock_raw())

    cancel_batch("rbc1")

    row = query_one("SELECT status, kg_available FROM raw_batches WHERE id='rbc1'")
    assert row["status"] == "cancelled"
    assert float(row["kg_available"] or 0) == 0.0
    assert not any(r["internal_batch_no"] == "415" for r in stock_raw())


def test_stock_raw_pomija_cancelled_nawet_ze_stanem(db):
    # Partie anulowane PRZED fixem mogły zostać ze stanem (jak 415 na prod) —
    # filtr w czytniku chroni niezależnie od zerowania przy anulowaniu.
    _seed_raw(batch_id="rbc2", internal_no="416")
    execute("UPDATE raw_batches SET status='cancelled' WHERE id='rbc2'")

    assert not any(r["internal_batch_no"] == "416" for r in stock_raw())
