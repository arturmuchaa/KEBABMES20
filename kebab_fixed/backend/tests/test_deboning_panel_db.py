"""Panel rozbioru (biuro): partie z aktywnością rozbioru + agregaty do kontroli
i korekt. Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.deboning_service import deboning_panel, list_deboning_entries
from app.utils.ids import cuid, now_iso


def _seed_batch(bid: str, no: str, supplier="Dostawca", kg_received=1000.0, kg_available=200.0):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (bid, no, int(no), supplier, kg_received, kg_available, now_iso()),
    )


def _entry(bid: str, no: str, worker="Jan", kg_q=100.0, kg_m=66.0,
           status="complete", days_ago=0):
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_name,"
        " kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,66.0,%s, now() - (%s || ' days')::interval,"
        "         now() - (%s || ' days')::interval)",
        (cuid(), bid, no, worker, kg_q, kg_m, status, days_ago, days_ago),
    )


def test_panel_agreguje_wpisy_wielodniowej_partii_w_jeden_wiersz(db):
    """Partia 411 szła 2 dni — panel myśli partiami, nie dniami."""
    _seed_batch("rb1", "910")
    _entry("rb1", "910", kg_q=100.0, kg_m=66.0, days_ago=1)
    _entry("rb1", "910", kg_q=50.0, kg_m=33.0, days_ago=0)
    rows = deboning_panel()
    row = next(r for r in rows if r["batchNo"] == "910")
    assert row["entriesCount"] == 2
    assert row["kgQuarter"] == 150.0
    assert row["kgMeat"] == 99.0
    assert row["firstAt"] < row["lastAt"]


def test_panel_dolicza_zbiorcze_uboczne_i_bilans(db):
    _seed_batch("rb1", "911")
    _entry("rb1", "911", kg_q=200.0, kg_m=132.0)
    execute(
        "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg,"
        " backs_kg, bones_kg) VALUES ('rb1','911',200,40,20)"
    )
    row = next(r for r in deboning_panel() if r["batchNo"] == "911")
    assert row["backsKg"] == 40.0 and row["bonesKg"] == 20.0
    # bilans: (132+40+20)/200 = 96%
    assert row["balancePct"] == 96.0


def test_panel_pomija_partie_bez_rozbioru(db):
    _seed_batch("rb1", "912")
    _seed_batch("rb2", "913")
    _entry("rb1", "912")
    nos = [r["batchNo"] for r in deboning_panel()]
    assert "912" in nos and "913" not in nos


def test_panel_pending_nie_zawyza_sum_kg(db):
    """Otwarte pobranie (niezważone mięso) liczy się w pendingCount, ale jego
    kg nie wchodzi do sum — inaczej bilans partii kłamie w trakcie dnia."""
    _seed_batch("rb1", "914")
    _entry("rb1", "914", kg_q=100.0, kg_m=66.0, status="complete")
    _entry("rb1", "914", kg_q=80.0, kg_m=0.0, status="pending")
    row = next(r for r in deboning_panel() if r["batchNo"] == "914")
    assert row["entriesCount"] == 1
    assert row["pendingCount"] == 1
    assert row["kgQuarter"] == 100.0


def test_entries_filtr_po_partii(db):
    _seed_batch("rb1", "915")
    _seed_batch("rb2", "916")
    _entry("rb1", "915", worker="Adam")
    _entry("rb2", "916", worker="Ewa")
    out = list_deboning_entries(None, raw_batch_id="rb1")
    assert len(out) == 1 and out[0]["workerName"] == "Adam"
