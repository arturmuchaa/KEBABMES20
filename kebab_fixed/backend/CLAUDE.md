# 🏭 KEBAB MES — BACKEND (operacyjne HOW)

> Reguły domenowe (traceability, stock_movement, CORE = LOCKED) są w
> `../CLAUDE.md`. Ten plik to TYLKO komendy i fakty operacyjne.

## Stack
- **FastAPI** (ASGI) + **psycopg2** (RealDictCursor), Postgres.
- Kanoniczny kod: pakiet **`app/`** (`app/main.py` = factory `create_app()`,
  cel uvicorn/gunicorn = **`app.main:app`**).
  - `app/routes/`  — warstwa API (cienka)
  - `app/services/` — logika biznesowa (tu żyje stock/traceability)
  - `app/models/`  — modele
  - `app/migrations.py` — migracje odpalane **automatycznie przy starcie**
    (lifespan → `run_migrations()`).
- **`server_pg.py`** — USUNIĘTY (2026-06-15). Był to legacy monolit BEZ
  uwierzytelniania (100 tras, CORS `*`) — ryzyko jeśli ktoś go uruchomił.
  Jedyny entrypoint to `app.main:app`.

## Uruchomienie (dev, z katalogu `backend/`)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # raz
pip install -r requirements_dev.txt                  # prod + pytest
cp .env.example .env   # ustaw DATABASE_URL (lokalnie Postgres :5432)
uvicorn app.main:app --reload --port 8000
```
Frontend (vite, osobny terminal w katalogu repo): `npm run dev` → :5173,
proxy `/api` → `http://localhost:8000` (patrz `vite.config.ts`).

## Testy
```bash
cd backend
pytest                              # cały zestaw (pytest.ini: testpaths=tests, -q)
pytest tests/test_finished_units.py -v        # jeden plik
pytest -k traceability -v                     # po nazwie
```
Testy importują `from app.services...` → **uruchamiać z katalogu `backend/`**.
Każda zmiana w `services/` dotykająca stocku/partii MUSI mieć test
(kontrakt: `1000 kg → use 200 → expect 800`, trace raw↔finished).

## Konfiguracja (env)
Ładowane w `app/config.py` w kolejności:
1. **prod:** `/opt/kebab/config/.env`
2. **dev:** `backend/.env`

Kluczowe zmienne:
| zmienna | dev default | prod (VPS) |
|---|---|---|
| `DATABASE_URL` | `…@localhost:5432/kebab_mes` | port **5433** |
| `BIND` | `127.0.0.1:8000` | **`127.0.0.1:8010`** |
| `CORS_ORIGINS` | `*` | konkretne origin |
| `DATAPORT_API_KEY` | — (GUS lookup → 503 bez klucza) | wymagany |
| `ADMIN_TOKEN` | pusty = soft-mode | ustawić = hard-fail `/api/admin/*` |

## Produkcja (VPS)
```bash
gunicorn app.main:app -c app/gunicorn_conf.py     # BIND z env → 127.0.0.1:8010
```
- Worker: `uvicorn.workers.UvicornWorker`, `preload_app`, proc `kebab-mes`.
- Serwowane przez systemd unit **`kebab-mes`**, za nginx.
- Deploy = clone + `cp app/` + restart (pliki kopiowane, NIE git pull). Baza :5433.
- Frontend `dist/` szukany w `/opt/kebab/app/dist` (prod) lub `../dist` (dev).

## Inicjalizacja / utrzymanie bazy
- `python init_db.py` — świeża baza.
- `python migrate_batch_numbers.py`, `python cleanup_legacy_batches.py` — skrypty
  jednorazowe (czytać przed odpaleniem!).

## Logowanie — pułapka
`app/logging_config.py` używa `logger.*(..., extra={...})`. **Nie** używać
zarezerwowanych kluczy LogRecord (`created`, `filename`, `module`, `name`, …)
w `extra=` → `KeyError` → 500.
