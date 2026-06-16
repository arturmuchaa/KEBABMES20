"""Buduje schemat bazy testowej dla testów integracyjnych (init_db.SCHEMA + migracje).

Baza musi już istnieć i być OSOBNA od prod (nazwa zawiera 'kebab_mes_test').
Tworzenie samej bazy (wymaga superusera), np. w kontenerze:
    docker exec kebab-op psql -U postgres -c "CREATE DATABASE kebab_mes_test"

Następnie:
    export TEST_DATABASE_URL="postgresql://postgres:PASS@localhost:55437/kebab_mes_test"
    python3 build_test_db.py
    python3 -m pytest tests/   # testy *_db.py użyją TEST_DATABASE_URL
"""
import os
import sys

import psycopg2

import init_db  # noqa: E402  (skrypt w katalogu backend/)


def main() -> int:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        print("Ustaw TEST_DATABASE_URL (osobna baza testowa).", file=sys.stderr)
        return 2
    if "kebab_mes_test" not in url:
        print("ODMOWA: TEST_DATABASE_URL nie wskazuje bazy 'kebab_mes_test' "
              "(ochrona prod).", file=sys.stderr)
        return 2

    conn = psycopg2.connect(url)
    conn.autocommit = True
    conn.cursor().execute(init_db.SCHEMA)
    conn.close()
    print("schemat bazowy OK (init_db.SCHEMA)")

    os.environ["DATABASE_URL"] = url
    from app.migrations import run_migrations
    run_migrations()
    print("migracje OK — baza testowa gotowa")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
