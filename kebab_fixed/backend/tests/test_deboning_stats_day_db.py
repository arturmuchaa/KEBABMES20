"""Przypisanie wpisu do dnia w statystykach biura = dzień POLSKI (Europe/
Warsaw), nie data UTC. Baza chodzi w UTC (zegar bazy UTC), a payroll
(workers_service.get_worker_days) już liczy po strefie PL — statystyki
muszą mierzyć tak samo, inaczej biuro↔płaca↔HMI rozjeżdżają się na
wpisach z wieczora. Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.deboning_service import deboning_stats
from app.utils.ids import cuid, now_iso


def _seed_entry_at(created_at_utc: str, internal_no="850"):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, created_at)"
        " VALUES ('rb-tz',%s,%s,'Dostawca',1000,800,'active','mat-cwiartka',"
        " 'Ćwiartka z kurczaka',%s)",
        (internal_no, int(internal_no), now_iso()),
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no,"
        " worker_id, worker_name, kg_quarter, kg_meat, yield_pct,"
        " created_at, completed_at)"
        " VALUES (%s,'rb-tz',%s,'w1','Jan',200,132,66.0,%s,%s)",
        (cuid(), internal_no, created_at_utc, created_at_utc),
    )


def test_wpis_wieczorny_liczy_sie_w_dniu_polskim(db):
    # 2026-07-21 23:30 UTC = 2026-07-22 01:30 czasu PL (lato, UTC+2)
    _seed_entry_at("2026-07-21T23:30:00+00:00")
    s21 = deboning_stats("2026-07-21", "2026-07-21")
    s22 = deboning_stats("2026-07-22", "2026-07-22")
    assert s21["summary"]["quarters"] == 0, "wpis nie należy do 21.07 (PL)"
    assert s22["summary"]["quarters"] == 1, "wpis należy do 22.07 (PL)"
    assert s22["byDay"][0]["date"] == "2026-07-22"
