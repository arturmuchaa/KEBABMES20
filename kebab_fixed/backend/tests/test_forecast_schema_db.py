"""Schemat prognozy zakończenia produkcji — tabele i ustawienia startowe.

Migracje są idempotentne i chodzą przy każdym starcie, więc test pilnuje, że
tabele istnieją i mają kolumny, na których stoi uczenie. Wymaga
TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import query_all, query_one


def _kolumny(tabela):
    return {
        r["column_name"]
        for r in query_all(
            "SELECT column_name FROM information_schema.columns WHERE table_name=%s",
            (tabela,),
        )
    }


def test_tabela_zdarzen_ma_czym_uczyc(db):
    kol = _kolumny("production_work_events")
    assert {"plan_id", "plan_line_id", "recipe_id", "kg_per_unit",
            "pieces_delta", "worker_id", "crew_size", "at"} <= kol


def test_tabela_przerw_pozwala_na_trwajaca_przerwe(db):
    kol = _kolumny("production_breaks")
    assert {"plan_id", "started_at", "ended_at"} <= kol
    nullable = query_one(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name='production_breaks' AND column_name='ended_at'"
    )
    assert nullable["is_nullable"] == "YES"


def test_probki_sa_jedna_na_dzien_i_recepture(db):
    kol = _kolumny("production_rate_samples")
    assert {"plan_id", "recipe_id", "plan_date", "kg", "person_hours"} <= kol


def test_ziarno_tempa_stoi_w_ustawieniach(db):
    from app.migrations import run_migrations
    run_migrations()
    row = query_one(
        "SELECT value FROM app_settings WHERE key='production.seed_kg_per_person_hour'"
    )
    assert row is not None
    assert float(row["value"]) == 120.0
