"""Ewidencja godzin pracowników ogólnych — schemat i CRUD.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import query_all


def _cols(table):
    return {r["column_name"] for r in query_all(
        "SELECT column_name FROM information_schema.columns WHERE table_name=%s",
        (table,),
    )}


def test_schemat_godzin_i_potracen_istnieje(db):
    assert {"id", "worker_id", "work_date", "status", "time_from", "time_to",
            "hours", "note"} <= _cols("worker_hours")
    assert {"id", "worker_id", "deduction_date", "description", "amount",
            "source_type", "source_id", "status", "settlement_id"} <= _cols("worker_deductions")
    assert "rate_per_hour" in _cols("workers")
    assert {"hours_total", "rate_per_hour", "basis"} <= _cols("payroll_settlements")


def test_jeden_wpis_godzin_na_dzien(db):
    """UNIQUE (worker_id, work_date) — dzień ma jedną zmianę, druga to UPDATE.

    Uwaga: tabela ma też UNIQUE z PRIMARY KEY na `id`, więc szukamy indeksu
    obejmującego OBIE kolumny, a nie pierwszego z brzegu."""
    defs = [r["indexdef"] for r in query_all(
        "SELECT indexdef FROM pg_indexes "
        "WHERE tablename='worker_hours' AND position('UNIQUE' in indexdef) > 0"
    )]
    assert any("worker_id" in d and "work_date" in d for d in defs), defs


# ── CRUD ──────────────────────────────────────────────────────────────

import pytest
from fastapi import HTTPException

from app.db import execute
from app.models.work_hours import WorkHoursDto
from app.services.work_hours_service import (
    delete_hours, list_hours, upsert_hours,
)


def _gen(wid="w-gen", name="ADRIAN", rate=25.0, active=True):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, active) "
        "VALUES (%s,%s,'WORKER_GENERAL',%s,%s) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_GENERAL', "
        "rate_per_hour=EXCLUDED.rate_per_hour, active=EXCLUDED.active",
        (wid, name, rate, active),
    )
    return wid


def _dto(**kw):
    base = dict(worker_id="w-gen", work_date="2026-08-03", status="work",
                time_from="6:00", time_to=None, note="", seq=1)
    base.update(kw)
    return WorkHoursDto(**base)


def test_sam_start_zapisuje_sie_jako_zmiana_otwarta(db):
    """Rano znamy tylko 6:00 — wpis ma czekać, a nie zostać odrzucony."""
    _gen()
    row = upsert_hours(_dto())
    assert row["timeFrom"] == "6:00"
    assert row["timeTo"] == ""
    assert row["hours"] is None


def test_domkniecie_dnia_liczy_godziny(db):
    _gen()
    upsert_hours(_dto())
    row = upsert_hours(_dto(time_to="15:00"))
    assert row["hours"] == 9.0
    assert len(list_hours("2026-08-03", "2026-08-03")) == 1, "drugi zapis to UPDATE, nie nowy wiersz"


def test_znacznik_kasuje_godziny(db):
    """Wolne/urlop/chorobowe to 0 h i żadnych czasów."""
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    row = upsert_hours(_dto(status="vacation"))
    assert row["status"] == "vacation"
    assert row["timeFrom"] == "" and row["timeTo"] == ""
    assert row["hours"] is None


def test_godzin_nie_wpisuje_sie_pracownikowi_rozbioru(db):
    execute(
        "INSERT INTO workers (id, name, role, active) VALUES ('w-deb','VADYM','WORKER_DEBONING',true) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_DEBONING'"
    )
    with pytest.raises(HTTPException) as exc:
        upsert_hours(_dto(worker_id="w-deb"))
    assert exc.value.status_code == 400


def test_dzien_rozliczony_jest_zamkniety(db):
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-gen','2026-08-03','s1')"
    )
    with pytest.raises(HTTPException) as exc:
        upsert_hours(_dto(time_to="16:00"))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        delete_hours("w-gen", "2026-08-03")
    # Siatka musi wiedzieć, że dzień jest zamknięty — inaczej rysowałaby
    # edytowalne pola, które i tak odbiją się od backendu.
    assert list_hours("2026-08-03", "2026-08-03")[0]["settled"] is True


def test_lista_obejmuje_tylko_aktywnych_ogolnych_w_zakresie(db):
    _gen("w-gen", "ADRIAN")
    _gen("w-arch", "ZWOLNIONY", active=False)
    upsert_hours(_dto(worker_id="w-gen", work_date="2026-08-03", time_to="15:00"))
    upsert_hours(_dto(worker_id="w-gen", work_date="2026-08-10", time_to="15:00"))
    rows = list_hours("2026-08-03", "2026-08-09")
    assert [r["workDate"] for r in rows] == ["2026-08-03"]


def test_czyszczenie_komorki(db):
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    delete_hours("w-gen", "2026-08-03")
    assert list_hours("2026-08-03", "2026-08-03") == []


def _tylko_ci_aktywni():
    """`workers` nie jest w _TRUNCATE (inne testy seedują je przez ON CONFLICT),
    więc pracownicy z poprzednich testów zostają w bazie. Stempel działa na
    WSZYSTKICH aktywnych ogólnych, więc bez tego licznik `changed` liczyłby
    cudze rekordy. Kolejne _gen() z powrotem aktywuje tych, których chcemy."""
    execute("UPDATE workers SET active=false")





# ── Druga zmiana w tym samym dniu ─────────────────────────────────────

def test_druga_zmiana_nie_nadpisuje_pierwszej(db):
    """6:00-15:00, potem powrót 18:00-20:00. Sporadyczne, ale musi wejść
    jako OSOBNA zmiana, a nie podmienić tej pierwszej."""
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    upsert_hours(_dto(seq=2, time_from="18:00", time_to="20:00"))

    rows = sorted(list_hours("2026-08-03", "2026-08-03"), key=lambda r: r["seq"])
    assert [r["seq"] for r in rows] == [1, 2]
    assert [(r["timeFrom"], r["timeTo"]) for r in rows] == [("6:00", "15:00"), ("18:00", "20:00")]
    assert [r["hours"] for r in rows] == [9.0, 2.0]


def test_dzien_z_dwiema_zmianami_sumuje_godziny(db):
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    upsert_hours(_dto(seq=2, time_from="18:00", time_to="20:00"))

    from app.services.workers_service import get_worker_days
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-03")[0]
    assert day["hours"] == 11.0
    assert [s["timeFrom"] for s in day["shifts"]] == ["6:00", "18:00"]


def test_kasowanie_drugiej_zmiany_zostawia_pierwsza(db):
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    upsert_hours(_dto(seq=2, time_from="18:00", time_to="20:00"))
    delete_hours("w-gen", "2026-08-03", seq=2)

    rows = list_hours("2026-08-03", "2026-08-03")
    assert [r["seq"] for r in rows] == [1]



