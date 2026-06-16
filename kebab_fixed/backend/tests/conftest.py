"""Fixture testowej bazy dla testów INTEGRACYJNYCH (dotykających SQL).

Bezpieczeństwo: testy DB uruchamiają się TYLKO gdy ustawiony `TEST_DATABASE_URL`
wskazujący na OSOBNĄ bazę testową (nazwa musi zawierać `kebab_mes_test`).
Bez tej zmiennej testy z fixture `db` są pomijane (`skip`), więc domyślne
`pytest` (czyste funkcje) działa bez bazy. NIGDY nie dotyka prod (5433).

Budowa schematu bazy testowej (jednorazowo, poza pytest):
    docker exec kebab-op psql -U postgres -c "CREATE DATABASE kebab_mes_test"
    export TEST_DATABASE_URL="postgresql://postgres:PASS@localhost:55437/kebab_mes_test"
    python3 -c "import psycopg2, init_db; c=psycopg2.connect('$TEST_DATABASE_URL'); \
        c.autocommit=True; c.cursor().execute(init_db.SCHEMA)"
    DATABASE_URL="$TEST_DATABASE_URL" python3 -c "from app.migrations import run_migrations; run_migrations()"
Uruchomienie: `TEST_DATABASE_URL=... python3 -m pytest tests/test_*_db.py`
"""
import os
import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
# Przekieruj pulę aplikacji na bazę testową ZANIM zaimportujemy app.* w testach.
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL

# Tabele czyszczone przed każdym testem integracyjnym (CASCADE łapie zależne).
_TRUNCATE = [
    "stock_movements", "seasoned_meat", "mixing_sessions", "mixing_order_lots",
    "mixing_orders", "meat_stock", "raw_batches", "recipe_ingredients", "recipes",
    "product_types", "machine_locks", "sequences", "suppliers", "ingredients",
]


@pytest.fixture
def db():
    """Czysta baza testowa per test. Pomija się bez TEST_DATABASE_URL."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL nie ustawiony — testy integracyjne DB pominięte")
    # BEZPIECZNIK: nigdy nie odpalaj TRUNCATE na bazie, która nie jest testową.
    assert "kebab_mes_test" in TEST_DATABASE_URL, (
        "TEST_DATABASE_URL nie wskazuje bazy 'kebab_mes_test' — przerwano dla bezpieczeństwa prod"
    )
    from app.db import execute
    execute("TRUNCATE " + ", ".join(_TRUNCATE) + " RESTART IDENTITY CASCADE")
    yield
