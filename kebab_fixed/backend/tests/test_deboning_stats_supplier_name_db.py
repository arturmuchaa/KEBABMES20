"""Nazwa dostawcy w raporcie = nazwa WYŚWIETLANA, nie pełna nazwa rejestrowa.

„KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" powtórzone w 28 wierszach
zawijało się na dwie linie i rozpychało tabelę partii na dwie strony —
w kartotece dostawcy jest już do tego pole `display_name` („KOKO").

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.deboning_service import deboning_stats
from app.utils.ids import cuid, now_iso


def _supplier(sid, name, display):
    execute(
        "INSERT INTO suppliers (id, code, name, display_name, active, created_at)"
        " VALUES (%s,%s,%s,%s,true,%s)",
        (sid, sid[:6], name, display, now_iso()),
    )


def _batch_with_entry(bid, no, supplier_id, supplier_name):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_id,"
        " supplier_name, kg_received, kg_available, status, material_type_id, material_name,"
        " price_per_kg, created_at)"
        " VALUES (%s,%s,%s,%s,%s,1000,0,'used','mat-cwiartka','Ćwiartka z kurczaka',10,%s)",
        (bid, no, int(no), supplier_id, supplier_name, now_iso()),
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,%s,%s,'w1','OLHA',1000,660,66.0,'complete',%s,%s)",
        (cuid(), bid, no, "2026-07-06T08:00:00+00:00", "2026-07-06T10:00:00+00:00"),
    )


def _batch(stats, no):
    return next(b for b in stats["byBatch"] if b["batchNo"] == no)


def test_raport_pokazuje_nazwe_wyswietlana_dostawcy(db):
    _supplier("sup-koko", "KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", "KOKO")
    _batch_with_entry("rb1", "700", "sup-koko", "KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")

    st = deboning_stats("2026-07-01", "2026-07-31")
    assert _batch(st, "700")["supplierName"] == "KOKO"


def test_pusta_nazwa_wyswietlana_wraca_do_pelnej(db):
    """Dostawca bez wypełnionego display_name nie może zniknąć z raportu."""
    _supplier("sup-x", "ADAM WĄSIK", "")
    _batch_with_entry("rb1", "701", "sup-x", "ADAM WĄSIK")
    assert _batch(deboning_stats("2026-07-01", "2026-07-31"), "701")["supplierName"] == "ADAM WĄSIK"


def test_partia_bez_powiazanego_dostawcy_uzywa_nazwy_z_partii(db):
    """Stare przyjęcia mają samą nazwę tekstową, bez supplier_id."""
    _batch_with_entry("rb1", "702", None, "DOSTAWCA HISTORYCZNY")
    assert _batch(deboning_stats("2026-07-01", "2026-07-31"), "702")["supplierName"] == "DOSTAWCA HISTORYCZNY"
