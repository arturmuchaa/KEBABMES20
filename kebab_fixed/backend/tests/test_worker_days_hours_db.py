"""Podstawa rozliczenia pracownika ogólnego = godziny, nie kilogramy.

Dzień OTWARTY (bez godziny końca) musi być oznaczony, bo wpadłby do
rozliczenia jako 0 h i pracownik dostałby za mało.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.models.work_hours import WorkHoursDto
from app.services.work_hours_service import upsert_hours
from app.services.workers_service import get_worker_days, pending_kg_days
from app.utils.ids import cuid


def _gen(wid="w-gen", name="ADRIAN", rate=25.0):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, active) "
        "VALUES (%s,%s,'WORKER_GENERAL',%s,true) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_GENERAL', active=true",
        (wid, name, rate),
    )


def _h(**kw):
    base = dict(worker_id="w-gen", work_date="2026-08-03", status="work",
                time_from="6:00", time_to="15:00", note="")
    base.update(kw)
    return upsert_hours(WorkHoursDto(**base))


def test_dni_godzinowe_wracaja_z_godzinami(db):
    _gen()
    _h(work_date="2026-08-03")
    _h(work_date="2026-08-04", time_to="14:30")
    days = get_worker_days("w-gen", "2026-08-03", "2026-08-09")
    assert [d["workDate"] for d in days] == ["2026-08-03", "2026-08-04"]
    assert [d["hours"] for d in days] == [9.0, 8.5]
    assert all(d["open"] is False for d in days)


def test_dzien_otwarty_jest_oznaczony(db):
    _gen()
    _h(time_to=None)
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-09")[0]
    assert day["open"] is True
    assert day["hours"] == 0.0


def test_znacznik_to_zero_godzin(db):
    _gen()
    _h(status="sick", time_from=None, time_to=None)
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-09")[0]
    assert day["status"] == "sick"
    assert day["hours"] == 0.0
    assert day["open"] is False


def test_dzien_rozliczony_ma_flage(db):
    _gen()
    _h()
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-gen','2026-08-03','s1')"
    )
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-09")[0]
    assert day["settled"] is True


# ── Osierocony akord po zmianie roli ──────────────────────────────────

def _deb_entry(wid, at, kg):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, price_per_kg, created_at)"
        " VALUES ('rb-h','900',900,'Dostawca',10000,0,'used','mat-cwiartka',"
        "'Ćwiartka z kurczaka',10,now()) ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id,"
        " worker_name, kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,'rb-h','900',%s,'ADRIAN',%s,%s,65,'complete',%s,%s)",
        (cuid(), wid, kg, kg * 0.65, at, at),
    )


def test_nierozliczone_dni_rozbioru_sa_widoczne(db):
    """Pracownik przeniesiony na godziny nie może zgubić starego akordu.

    Prod: ADRIAN zwolnił się z rozbioru i został przestawiony na rolę
    ogólną tylko po to, żeby zniknąć z HMI. Gdyby miał wtedy niezapłacone
    kilogramy, wyparowałyby z ekranu razem ze zmianą roli."""
    _gen()
    _deb_entry("w-gen", "2026-08-03T08:00:00+00:00", 450)
    _deb_entry("w-gen", "2026-08-04T08:00:00+00:00", 300)
    res = pending_kg_days("w-gen", "2026-08-03", "2026-08-09")
    assert res == {"days": 2, "kg": 750.0}


def test_dni_rozbioru_juz_rozliczone_nie_alarmuja(db):
    _gen()
    _deb_entry("w-gen", "2026-08-03T08:00:00+00:00", 450)
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-gen','2026-08-03','s1')"
    )
    assert pending_kg_days("w-gen", "2026-08-03", "2026-08-09") == {"days": 0, "kg": 0.0}
