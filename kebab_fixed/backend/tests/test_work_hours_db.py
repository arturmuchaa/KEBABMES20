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
