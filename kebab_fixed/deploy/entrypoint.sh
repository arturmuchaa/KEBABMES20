#!/usr/bin/env sh
# Start backendu w kontenerze: czeka na bazę → init_db (idempotentne) → gunicorn.
# Migracje schematu i tak lecą przy starcie aplikacji (app.main lifespan).
set -e

echo "[entrypoint] czekam aż Postgres będzie gotowy…"
python - <<'PY'
import os, time, sys
import psycopg2
url = os.environ["DATABASE_URL"]
for _ in range(60):
    try:
        psycopg2.connect(url).close()
        print("[entrypoint] baza dostępna")
        sys.exit(0)
    except Exception:
        time.sleep(1)
print("[entrypoint] BŁĄD: baza niedostępna po 60s", file=sys.stderr)
sys.exit(1)
PY

echo "[entrypoint] init_db.py (tworzy brakujące tabele bazowe, idempotentne)…"
python init_db.py || echo "[entrypoint] init_db pominięte/niepełne — migracje przy starcie dokończą schemat"

echo "[entrypoint] start gunicorn…"
exec gunicorn app.main:app -c app/gunicorn_conf.py
