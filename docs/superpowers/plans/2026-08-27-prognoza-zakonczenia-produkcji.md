# Prognoza zakończenia produkcji — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UWAGA dla tego repo:** subagenty NIE mają prawa zapisu do `backend/` ani większości `src/`. Ten plan wykonuje się INLINE, nie przez subagent-driven-development.

**Goal:** Kafel `Koniec ok. ~15:40` na pasku dnia HMI Produkcji, liczony z tempa hali i poprawiający się z każdą zakończoną produkcją.

**Architecture:** Trzy warstwy wdrażane po kolei. (1) Nagrywanie — każdy zapis sztuk dopisuje zdarzenie do `production_work_events`, przerwy trafiają do `production_breaks`. (2) Uczenie — przy zamknięciu dnia przez halę liczy się kg na roboczogodzinę per receptura i ląduje w `production_rate_samples` (UPSERT, odporny na `tablet_reopen`). (3) Prognoza — czysty moduł frontu czyta tempa z `GET /api/production-rates`, miesza z tempem dzisiejszym i pokazuje godzinę.

**Tech Stack:** FastAPI + psycopg2 (backend, migracje w `app/migrations.py`), React + TypeScript + vitest (front), PostgreSQL 5433 na produkcji.

**Spec:** `docs/superpowers/specs/2026-08-27-prognoza-zakonczenia-produkcji-design.md`

## Global Constraints

- **Ziarno tempa:** 120 kg/h na osobę układającą (wartość od właściciela), klucz `app_settings['production.seed_kg_per_person_hour']`.
- **Planowana przerwa:** 30 min, klucz `app_settings['production.planned_break_minutes']`.
- **`PRZERWA_MAX` w uczeniu:** 30 min — sufit na przerwę, której nikt nie odnotował.
- **Waga kurczenia `k = 2`**, okno próbek **90 dni**.
- **Progi wygaszenia kafla:** 0 układających albo < 20 min zarejestrowanej pracy → `—`.
- **Migracje MUSZĄ być idempotentne** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) — `run_migrations()` chodzi przy każdym starcie.
- **Testy DB wymagają pełnego URL-a:** `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test` — bez tego cicho się pomijają (fałszywe zielone).
- **`%` w SQL psycopg2 to placeholder** — nigdy nie wstawiać go dosłownie.
- **Kolejność ruchów magazynowych** i inne reguły MES bez zmian — ten plan nic nie księguje.
- Komentarze i komunikaty po polsku, jak reszta repo.
- Commit po każdym zadaniu; `git add` ŚCIEŻKAMI, nigdy `git add -A`.

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `backend/app/migrations.py` | 3 nowe tabele + 2 wiersze `app_settings` (modyfikacja) |
| `backend/app/services/production_plans_service.py` | zapis zdarzenia w `update_line_progress`, wywołanie uczenia w `tablet_finish` (modyfikacja) |
| `backend/app/services/production_events_service.py` | **nowy** — zapis zdarzenia + liczenie załogi |
| `backend/app/services/production_breaks_service.py` | **nowy** — start/koniec/lista przerw |
| `backend/app/services/production_rates_service.py` | **nowy** — uczenie z dnia + odczyt temp z kurczeniem |
| `backend/app/routes/production_plans.py` | trasy przerw (modyfikacja) |
| `backend/app/routes/production_rates.py` | **nowy** — `GET /api/production-rates` |
| `backend/app/main.py` | rejestracja routera (modyfikacja) |
| `backend/tests/conftest.py` | nowe tabele w `_TRUNCATE` (modyfikacja) |
| `src/features/production-hmi/finishForecast.ts` | **nowy** — czysta matematyka prognozy |
| `src/features/production-hmi/components/ForecastPanel.tsx` | **nowy** — panel uzasadnienia |
| `src/pages/tablet/ProductionHmiPage.tsx` | kafel, źródło temp, przerwy przez API (modyfikacja) |
| `src/lib/api.ts` | `productionRatesApi`, przerwy (modyfikacja) |

---

### Task 1: Tabele i ustawienia

**Files:**
- Modify: `backend/app/migrations.py` (dopisać do listy `_DDL`, przed zamykającym `]` w linii ~1257)
- Modify: `backend/tests/conftest.py` (lista `_TRUNCATE`)
- Test: `backend/tests/test_forecast_schema_db.py` (nowy)

**Interfaces:**
- Consumes: nic
- Produces: tabele `production_work_events`, `production_breaks`, `production_rate_samples`; klucze `app_settings`: `production.seed_kg_per_person_hour` (120), `production.planned_break_minutes` (30)

- [ ] **Step 1: Napisz test schematu**

`backend/tests/test_forecast_schema_db.py`:

```python
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
```

- [ ] **Step 2: Uruchom test — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_forecast_schema_db.py -q
```

Oczekiwane: FAIL — brak tabel (`_kolumny` zwraca pusty zbiór).

- [ ] **Step 3: Dopisz DDL**

W `backend/app/migrations.py`, na końcu listy `_DDL` (przed `]`):

```python
    # ── Prognoza zakończenia produkcji ────────────────────────────────
    #
    # Log zapisów sztuk. Bez niego po dniu produkcyjnym nie zostaje ŻADEN
    # ślad czasowy: `progress_updated_at` trzyma tylko ostatni zapis, a
    # `worker_entries[].addedAt` tylko pierwszy wpis osoby na pozycji.
    """CREATE TABLE IF NOT EXISTS production_work_events (
        id           TEXT PRIMARY KEY,
        plan_id      TEXT NOT NULL,
        plan_line_id TEXT NOT NULL,
        recipe_id    TEXT,
        recipe_name  TEXT,
        kg_per_unit  NUMERIC NOT NULL DEFAULT 0,
        pieces_delta INTEGER NOT NULL,
        worker_id    TEXT,
        worker_name  TEXT,
        crew_size    INTEGER NOT NULL DEFAULT 0,
        at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_work_events_plan ON production_work_events (plan_id, at)",

    # Przerwy. Do tej pory żyły w `useState` ekranu i ginęły przy odświeżeniu
    # — razem z blokadą zapisu sztuk, która na nich stoi.
    """CREATE TABLE IF NOT EXISTS production_breaks (
        id         TEXT PRIMARY KEY,
        plan_id    TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at   TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_breaks_plan ON production_breaks (plan_id, started_at)",

    # Próbki tempa — JEDNA na (dzień, receptura). Trzymamy próbki, a nie
    # gotową średnią: `tablet_reopen` pozwala cofnąć zamknięcie dnia, a
    # średniej doliczanej przyrostowo nie da się cofnąć.
    """CREATE TABLE IF NOT EXISTS production_rate_samples (
        plan_id      TEXT NOT NULL,
        recipe_id    TEXT NOT NULL DEFAULT '',
        plan_date    DATE,
        kg           NUMERIC NOT NULL DEFAULT 0,
        person_hours NUMERIC NOT NULL DEFAULT 0,
        computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (plan_id, recipe_id)
    )""",

    # Ziarno prognozy: 120 kg/h na osobę układającą (wartość od właściciela,
    # 27.08.2026) i planowana przerwa. W app_settings, żeby biuro mogło je
    # poprawić bez wdrożenia.
    """INSERT INTO app_settings (key, value)
       VALUES ('production.seed_kg_per_person_hour', '120'::jsonb)
       ON CONFLICT (key) DO NOTHING""",
    """INSERT INTO app_settings (key, value)
       VALUES ('production.planned_break_minutes', '30'::jsonb)
       ON CONFLICT (key) DO NOTHING""",
```

- [ ] **Step 4: Dopisz tabele do czyszczenia w testach**

W `backend/tests/conftest.py`, w liście `_TRUNCATE`, obok `production_wrapping`:

```python
    # Prognoza zakończenia — log zapisów, przerwy i próbki tempa przeciekałyby
    # między testami (próbka po (plan_id, recipe_id) trafiałaby na duplikat).
    "production_work_events", "production_breaks", "production_rate_samples",
```

- [ ] **Step 5: Uruchom test — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_forecast_schema_db.py -q
```

Oczekiwane: 4 passed.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/tests/conftest.py \
        kebab_fixed/backend/tests/test_forecast_schema_db.py
git commit -m "feat(prognoza): tabele logu zapisow, przerw i probek tempa"
```

---

### Task 2: Log zapisów sztuk

**Files:**
- Create: `backend/app/services/production_events_service.py`
- Modify: `backend/app/services/production_plans_service.py` (`update_line_progress`, ~linia 1210)
- Test: `backend/tests/test_work_events_db.py` (nowy)

**Interfaces:**
- Consumes: tabela `production_work_events` (Task 1)
- Produces:
  - `crew_size(conn, plan_id: str) -> int`
  - `changed_worker(old_entries: list[dict], new_entries: list[dict]) -> tuple[str, str]` — zwraca `(worker_id, worker_name)` osoby, której liczba sztuk się zmieniła; `("", "")` gdy nie da się wskazać jednej
  - `record_work_event(conn, plan_id: str, line: dict, pieces_delta: int, worker_id: str, worker_name: str) -> None`

- [ ] **Step 1: Napisz test czystej funkcji `changed_worker`**

`backend/tests/test_work_events.py` (bez `_db` — nie dotyka bazy):

```python
from app.services.production_events_service import changed_worker


def test_wskazuje_osobe_ktorej_przybylo_sztuk():
    stare = [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": 9}]
    nowe = [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": 11}]
    assert changed_worker(stare, nowe) == ("w1", "DAWID NOWAK")


def test_wskazuje_osobe_dopisana_do_pozycji():
    stare = [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": 9}]
    nowe = stare + [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 3}]
    assert changed_worker(stare, nowe) == ("w2", "DENYS KOVAL")


def test_wskazuje_osobe_ktorej_ubylo_sztuk():
    stare = [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 3}]
    nowe = [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 1}]
    assert changed_worker(stare, nowe) == ("w2", "DENYS KOVAL")


def test_zdjecie_calego_dorobku_usuwa_wpis_a_osobe_nadal_widac():
    # HMI kasuje wpis na zero, więc osoby nie ma już w nowej liście.
    stare = [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 3}]
    nowe = []
    assert changed_worker(stare, nowe) == ("w2", "DENYS KOVAL")


def test_zmiana_u_dwoch_osob_naraz_nie_wskazuje_nikogo():
    # Przepisanie sztuk (`move_line_pieces`) rusza dwie osoby — to nie jest
    # praca, tylko zmiana przypisania, i nie ma jej kto zaliczyć.
    stare = [{"workerId": "w1", "workerName": "A", "pieces": 9},
             {"workerId": "w2", "workerName": "B", "pieces": 3}]
    nowe = [{"workerId": "w1", "workerName": "A", "pieces": 7},
            {"workerId": "w2", "workerName": "B", "pieces": 5}]
    assert changed_worker(stare, nowe) == ("", "")


def test_brak_zmian_nie_wskazuje_nikogo():
    stare = [{"workerId": "w1", "workerName": "A", "pieces": 9}]
    assert changed_worker(stare, list(stare)) == ("", "")
```

- [ ] **Step 2: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_work_events.py -q
```

Oczekiwane: FAIL — `ModuleNotFoundError: app.services.production_events_service`.

- [ ] **Step 3: Napisz serwis**

`backend/app/services/production_events_service.py`:

```python
"""Log zapisów sztuk — jedyny ślad czasowy przebiegu dnia produkcyjnego.

Bez tego logu po dniu nie zostaje nic, z czego dałoby się liczyć tempo:
`progress_updated_at` trzyma tylko OSTATNI zapis pozycji, a
`worker_entries[].addedAt` tylko PIERWSZY wpis danej osoby na pozycji.

Zdarzenia z ujemną deltą (korekty) też zapisujemy — nie są pracą i nie wchodzą
do uczenia, ale bez nich nie da się później odtworzyć, co się na hali działo.
"""
from typing import Any, Dict, List, Tuple

from app.db import cx_execute, cx_query_one
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def changed_worker(
    old_entries: List[Dict[str, Any]], new_entries: List[Dict[str, Any]]
) -> Tuple[str, str]:
    """Kto stoi za tym zapisem — osoba, której liczba sztuk się zmieniła.

    HMI zmienia przy jednym zapisie DOKŁADNIE jedną osobę, więc różnica list
    wskazuje ją jednoznacznie. Gdy ruszyły się dwie (przepisanie sztuk), nie ma
    komu zaliczyć pracy i zwracamy pustkę — to nie jest praca, tylko zmiana
    przypisania.
    """
    def suma(entries):
        out: Dict[str, Tuple[str, int]] = {}
        for e in entries or []:
            wid = str(e.get("workerId") or "")
            if not wid:
                continue
            nazwa, ile = out.get(wid, ("", 0))
            out[wid] = (str(e.get("workerName") or nazwa), ile + int(e.get("pieces") or 0))
        return out

    a, b = suma(old_entries), suma(new_entries)
    zmienione = [
        wid for wid in set(a) | set(b)
        if a.get(wid, ("", 0))[1] != b.get(wid, ("", 0))[1]
    ]
    if len(zmienione) != 1:
        return ("", "")
    wid = zmienione[0]
    nazwa = b.get(wid, ("", 0))[0] or a.get(wid, ("", 0))[0]
    return (wid, nazwa)


def crew_size(conn, plan_id: str) -> int:
    """Ilu ludzi UKŁADA dziś na tym planie — liczone z żywych wpisów.

    Załoga zmienia się w ciągu dnia (ktoś odchodzi na foliowanie), więc
    prognoza ma płynąć razem z nią, a nie stać na kartotece działu.
    """
    row = cx_query_one(
        conn,
        """
        SELECT count(DISTINCT e->>'workerId') AS n
        FROM production_plan_lines l
        CROSS JOIN LATERAL jsonb_array_elements(l.worker_entries) AS e
        WHERE l.plan_id = %s
          AND COALESCE(e->>'workerId','') <> ''
          AND COALESCE((e->>'pieces')::int, 0) > 0
        """,
        (plan_id,),
    )
    return int((row or {}).get("n") or 0)


def record_work_event(
    conn,
    plan_id: str,
    line: Dict[str, Any],
    pieces_delta: int,
    worker_id: str,
    worker_name: str,
) -> None:
    """Dopisz zdarzenie w TRWAJĄCEJ transakcji zapisu postępu.

    Ta sama transakcja co `qty_done` — inaczej log rozjechałby się z postępem
    przy błędzie zapisu, a uczenie liczyłoby pracę, której nie ma.
    """
    if not pieces_delta:
        return
    cx_execute(
        conn,
        """
        INSERT INTO production_work_events
            (id, plan_id, plan_line_id, recipe_id, recipe_name, kg_per_unit,
             pieces_delta, worker_id, worker_name, crew_size, at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        """,
        (
            cuid(), plan_id, line.get("id"),
            line.get("recipe_id") or "", line.get("recipe_name") or "",
            float(line.get("kg_per_unit") or 0), int(pieces_delta),
            worker_id or "", worker_name or "",
            crew_size(conn, plan_id),
        ),
    )
```

- [ ] **Step 4: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_work_events.py -q
```

Oczekiwane: 6 passed.

- [ ] **Step 5: Napisz test integracyjny zapisu zdarzenia**

`backend/tests/test_work_events_db.py`:

```python
"""Zdarzenie pracy powstaje razem z zapisem sztuk — w jednej transakcji.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all
from app.services.production_plans_service import update_line_progress


def _seed(qty=20, qty_done=0, entries="[]"):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp1','PP/1','2026-08-27','active')"
    )
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, position, qty, qty_done, kg_per_unit, recipe_id, recipe_name, "
        " product_type_id, batch_allocation, seasoned_batch_no, worker_entries, line_status) "
        "VALUES ('pl1','pp1',0,%s,%s,40.0,'r1','WROCLAW','p1','{}'::jsonb,'364',%s::jsonb,'PLANNED')",
        (qty, qty_done, entries),
    )


def _wpisy(pieces, wid="w1", nazwa="DAWID NOWAK"):
    return [{"workerId": wid, "workerName": nazwa, "pieces": pieces, "addedAt": "10:00"}]


def test_dopisanie_sztuk_zostawia_zdarzenie(db):
    _seed()
    update_line_progress("pp1", "pl1", 5, "IN_PROGRESS", _wpisy(5))

    ev = query_all("SELECT * FROM production_work_events WHERE plan_id='pp1'")
    assert len(ev) == 1
    assert ev[0]["pieces_delta"] == 5
    assert ev[0]["recipe_id"] == "r1"
    assert float(ev[0]["kg_per_unit"]) == 40.0
    assert ev[0]["worker_id"] == "w1"
    assert ev[0]["crew_size"] == 1


def test_odjecie_sztuk_zostawia_zdarzenie_UJEMNE(db):
    _seed(qty_done=5, entries='[{"workerId":"w1","workerName":"DAWID NOWAK","pieces":5,"addedAt":"10:00"}]')
    update_line_progress("pp1", "pl1", 3, "IN_PROGRESS", _wpisy(3))

    ev = query_all("SELECT pieces_delta FROM production_work_events WHERE plan_id='pp1'")
    assert [e["pieces_delta"] for e in ev] == [-2]


def test_zapis_bez_zmiany_liczby_sztuk_nie_zostawia_zdarzenia(db):
    _seed(qty_done=5, entries='[{"workerId":"w1","workerName":"DAWID NOWAK","pieces":5,"addedAt":"10:00"}]')
    update_line_progress("pp1", "pl1", 5, "IN_PROGRESS", _wpisy(5))

    assert query_all("SELECT 1 FROM production_work_events WHERE plan_id='pp1'") == []


def test_odrzucony_zapis_NIE_zostawia_zdarzenia(db):
    """Rollback transakcji musi zabrać ze sobą log — inaczej uczenie liczyłoby
    pracę, której nie ma."""
    _seed(qty=20, qty_done=10)
    execute(
        "INSERT INTO finished_units (id, qr_code, qr_seq, plan_line_id, status, created_at) "
        "VALUES ('u1','KEBAB-u1',1,'pl1','produced', now())"
    )
    with pytest.raises(HTTPException):
        update_line_progress("pp1", "pl1", 0, "PLANNED", [])

    assert query_all("SELECT 1 FROM production_work_events WHERE plan_id='pp1'") == []


def test_zalogа_liczona_z_zywych_wpisow(db):
    _seed(qty_done=5, entries='[{"workerId":"w1","workerName":"A","pieces":5,"addedAt":"10:00"}]')
    update_line_progress("pp1", "pl1", 8, "IN_PROGRESS", [
        {"workerId": "w1", "workerName": "A", "pieces": 5, "addedAt": "10:00"},
        {"workerId": "w2", "workerName": "B", "pieces": 3, "addedAt": "11:00"},
    ])

    ev = query_all("SELECT crew_size FROM production_work_events WHERE plan_id='pp1'")
    assert ev[-1]["crew_size"] == 2
```

- [ ] **Step 6: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_work_events_db.py -q
```

Oczekiwane: FAIL — tabela pusta, `update_line_progress` jeszcze nie loguje.

- [ ] **Step 7: Wepnij zapis zdarzenia w `update_line_progress`**

W `backend/app/services/production_plans_service.py`, w `update_line_progress`:

a) w zapytaniu czytającym linię (na początku funkcji) dołóż kolumny potrzebne zdarzeniu:

```python
    line = query_one(
        "SELECT id, plan_id, qty, qty_done, kg_per_unit, recipe_id, recipe_name, "
        "worker_entries, packaging_id, packaging_used "
        "FROM production_plan_lines WHERE id=%s AND plan_id=%s",
        (line_id, plan_id),
    )
```

b) po udanym `UPDATE` (za blokiem `if rowcount == 0:`), wewnątrz `with transaction() as conn:`:

```python
        # Log przebiegu dnia — w TEJ SAMEJ transakcji co postęp. Rollback
        # zapisu musi zabrać zdarzenie ze sobą, inaczej uczenie policzyłoby
        # pracę, której nie ma.
        from app.services.production_events_service import changed_worker, record_work_event
        delta = qty_done - int(line.get("qty_done") or 0)
        kto_id, kto_nazwa = changed_worker(
            list(line.get("worker_entries") or []), worker_entries or []
        )
        record_work_event(conn, plan_id, line, delta, kto_id, kto_nazwa)
```

- [ ] **Step 8: Uruchom oba pliki testów — mają przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_work_events.py tests/test_work_events_db.py -q
```

Oczekiwane: 11 passed.

- [ ] **Step 9: Cały zestaw backendu — nic nie ma się zepsuć**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/ -q 2>&1 | tail -5
```

Oczekiwane: 0 failed.

- [ ] **Step 10: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/production_events_service.py \
        kebab_fixed/backend/app/services/production_plans_service.py \
        kebab_fixed/backend/tests/test_work_events.py \
        kebab_fixed/backend/tests/test_work_events_db.py
git commit -m "feat(prognoza): log zapisow sztuk w tej samej transakcji co postep"
```

---

### Task 3: Przerwy w bazie

**Files:**
- Create: `backend/app/services/production_breaks_service.py`
- Modify: `backend/app/routes/production_plans.py`
- Test: `backend/tests/test_production_breaks_db.py` (nowy)

**Interfaces:**
- Consumes: tabela `production_breaks` (Task 1)
- Produces:
  - `start_break(plan_id: str) -> dict` — `{"ok": True, "breakId": str}`
  - `end_break(plan_id: str) -> dict` — `{"ok": True, "ended": int}`
  - `list_breaks(plan_id: str) -> list[dict]` — `[{"id","startedAt","endedAt"}]`, `endedAt=None` gdy trwa
  - trasy `POST /api/production-plans/{plan_id}/breaks/start`, `/breaks/end`, `GET /api/production-plans/{plan_id}/breaks`

- [ ] **Step 1: Napisz test**

`backend/tests/test_production_breaks_db.py`:

```python
"""Przerwy przeżywają odświeżenie ekranu.

Do 27.08.2026 `BreakState` żył w `useState` HMI i ginął przy odświeżeniu —
a razem z nim blokada zapisu sztuk, która na nim stoi.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all
from app.services.production_breaks_service import end_break, list_breaks, start_break


def _plan():
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp1','PP/1','2026-08-27','active')"
    )


def test_rozpoczeta_przerwa_jest_widoczna_po_ponownym_odczycie(db):
    _plan()
    start_break("pp1")

    przerwy = list_breaks("pp1")
    assert len(przerwy) == 1
    assert przerwy[0]["endedAt"] is None


def test_zakonczenie_domyka_trwajaca_przerwe(db):
    _plan()
    start_break("pp1")
    end_break("pp1")

    przerwy = list_breaks("pp1")
    assert len(przerwy) == 1
    assert przerwy[0]["endedAt"] is not None


def test_druga_przerwa_nie_otwiera_sie_gdy_jedna_trwa(db):
    """Podwójne dotknięcie „Przerwa" nie może zostawić dwóch otwartych —
    czas przerwy liczyłby się podwójnie."""
    _plan()
    start_break("pp1")
    start_break("pp1")

    otwarte = query_all(
        "SELECT 1 FROM production_breaks WHERE plan_id='pp1' AND ended_at IS NULL"
    )
    assert len(otwarte) == 1


def test_zakonczenie_bez_trwajacej_przerwy_nic_nie_psuje(db):
    _plan()
    assert end_break("pp1")["ended"] == 0


def test_kolejne_przerwy_tego_samego_dnia_sa_osobnymi_wierszami(db):
    _plan()
    start_break("pp1"); end_break("pp1")
    start_break("pp1"); end_break("pp1")

    assert len(list_breaks("pp1")) == 2
```

- [ ] **Step 2: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_production_breaks_db.py -q
```

Oczekiwane: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Napisz serwis**

`backend/app/services/production_breaks_service.py`:

```python
"""Przerwy zmiany produkcyjnej — zapisywane, nie tylko pokazywane.

Do 27.08.2026 przerwa żyła wyłącznie w stanie ekranu HMI: odświeżenie kiosku
kasowało ją razem z blokadą zapisu sztuk. Teraz źródłem prawdy jest serwer,
a ekran trzyma kopię tylko po to, żeby zareagować natychmiast.

Czas przerw jest potrzebny dwa razy: odejmuje się go od roboczogodzin przy
uczeniu tempa i dolicza do prognozowanej godziny zakończenia.
"""
from typing import Any, Dict, List

from app.db import cx_execute_rowcount, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def start_break(plan_id: str) -> Dict[str, Any]:
    """Zacznij przerwę. Druga przy trwającej pierwszej nic nie robi —
    podwójne dotknięcie liczyłoby czas przerwy dwa razy."""
    with transaction() as conn:
        trwa = cx_query_one(
            conn,
            "SELECT id FROM production_breaks WHERE plan_id=%s AND ended_at IS NULL "
            "ORDER BY started_at DESC LIMIT 1",
            (plan_id,),
        )
        if trwa:
            return {"ok": True, "breakId": trwa["id"], "alreadyOpen": True}
        bid = cuid()
        cx_execute_rowcount(
            conn,
            "INSERT INTO production_breaks (id, plan_id, started_at) VALUES (%s,%s, now())",
            (bid, plan_id),
        )
    logger.info("production.break_started", extra={"plan_id": plan_id})
    return {"ok": True, "breakId": bid}


def end_break(plan_id: str) -> Dict[str, Any]:
    """Domknij trwającą przerwę. Brak takiej to nie błąd — ekran mógł ją
    domknąć wcześniej, a operator kliknął drugi raz."""
    with transaction() as conn:
        ile = cx_execute_rowcount(
            conn,
            "UPDATE production_breaks SET ended_at = now() "
            "WHERE plan_id=%s AND ended_at IS NULL",
            (plan_id,),
        )
    if ile:
        logger.info("production.break_ended", extra={"plan_id": plan_id})
    return {"ok": True, "ended": int(ile)}


def list_breaks(plan_id: str) -> List[Dict[str, Any]]:
    rows = query_all(
        "SELECT id, started_at, ended_at FROM production_breaks "
        "WHERE plan_id=%s ORDER BY started_at",
        (plan_id,),
    )
    return [
        {
            "id": r["id"],
            "startedAt": r["started_at"].isoformat() if r["started_at"] else None,
            "endedAt": r["ended_at"].isoformat() if r["ended_at"] else None,
        }
        for r in rows
    ]
```

- [ ] **Step 4: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_production_breaks_db.py -q
```

Oczekiwane: 5 passed.

- [ ] **Step 5: Dodaj trasy**

W `backend/app/routes/production_plans.py`, po trasie `move-pieces`:

```python
@router.post("/{plan_id}/breaks/start")
def start_break(plan_id: str):
    """Przerwa zmiany — zapisywana, bo ekran ją gubił przy odświeżeniu."""
    from app.services import production_breaks_service as breaks
    return breaks.start_break(plan_id)


@router.post("/{plan_id}/breaks/end")
def end_break(plan_id: str):
    from app.services import production_breaks_service as breaks
    return breaks.end_break(plan_id)


@router.get("/{plan_id}/breaks")
def list_breaks(plan_id: str):
    from app.services import production_breaks_service as breaks
    return breaks.list_breaks(plan_id)
```

- [ ] **Step 6: Sprawdź, że trasy się rejestrują**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -c "
from app.main import app
sciezki = sorted(r.path for r in app.routes if 'breaks' in r.path)
print(sciezki)
assert len(sciezki) == 3, sciezki
print('OK')
"
```

Oczekiwane: trzy ścieżki + `OK`.

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/production_breaks_service.py \
        kebab_fixed/backend/app/routes/production_plans.py \
        kebab_fixed/backend/tests/test_production_breaks_db.py
git commit -m "feat(prognoza): przerwy zapisywane w bazie zamiast w stanie ekranu"
```

---

### Task 4: Uczenie tempa z zakończonego dnia

**Files:**
- Create: `backend/app/services/production_rates_service.py`
- Modify: `backend/app/services/production_plans_service.py` (`tablet_finish`, ~linia 1398)
- Test: `backend/tests/test_production_rates.py`, `backend/tests/test_production_rates_db.py` (nowe)

**Interfaces:**
- Consumes: `production_work_events`, `production_breaks` (Tasks 1–3)
- Produces:
  - `person_hours_by_recipe(events: list[dict], breaks: list[tuple], max_gap_min: float = 30.0) -> dict[str, dict]` — czysta; `{recipe_id: {"kg": float, "personHours": float}}`
  - `learn_from_plan(plan_id: str) -> dict` — UPSERT do `production_rate_samples`, zwraca `{"ok": True, "recipes": int}`

- [ ] **Step 1: Napisz test czystej matematyki**

`backend/tests/test_production_rates.py`:

```python
"""Przypisanie roboczogodzin do receptury.

Model: praca między dwoma kolejnymi zapisami poszła w to, co WŁAŚNIE zapisano.
Pierwsze zdarzenie dnia tylko ustawia zegar — nie wnosi ani kilogramów, ani
godzin, bo nie wiadomo, kiedy zaczęła się praca, która do niego doprowadziła.
"""
from datetime import datetime, timedelta, timezone

from app.services.production_rates_service import person_hours_by_recipe

T0 = datetime(2026, 8, 27, 6, 0, tzinfo=timezone.utc)


def ev(minuty, recipe, sztuk, kg_szt=40.0, zaloga=2):
    return {"at": T0 + timedelta(minutes=minuty), "recipe_id": recipe,
            "pieces_delta": sztuk, "kg_per_unit": kg_szt, "crew_size": zaloga}


def test_pierwsze_zdarzenie_tylko_ustawia_zegar():
    out = person_hours_by_recipe([ev(0, "r1", 5)], [])
    assert out == {}


def test_drugie_zdarzenie_liczy_sie_od_pierwszego():
    # 30 min × 2 osoby = 1 rbh; 5 szt × 40 kg = 200 kg
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(30, "r1", 5)], [])
    assert out["r1"]["personHours"] == 1.0
    assert out["r1"]["kg"] == 200.0


def test_dwie_receptury_przeplatane_dostaja_swoje_godziny():
    zdarzenia = [ev(0, "r1", 5), ev(30, "r1", 5), ev(60, "r2", 5), ev(75, "r1", 5)]
    out = person_hours_by_recipe(zdarzenia, [])
    assert out["r1"]["personHours"] == 1.0 + 0.5      # 30 min + 15 min, po 2 osoby
    assert out["r2"]["personHours"] == 1.0            # 30 min × 2


def test_przerwa_nie_jest_praca():
    # zapis o 0, przerwa 30 min od 10, zapis o 60 → praca 30 min × 2 = 1 rbh
    przerwy = [(T0 + timedelta(minutes=10), T0 + timedelta(minutes=40))]
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(60, "r1", 5)], przerwy)
    assert out["r1"]["personHours"] == 1.0


def test_nieodnotowana_dziura_jest_ucinana():
    # 4 h bez zapisu (awaria) → liczymy najwyżej 30 min
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(240, "r1", 5)], [])
    assert out["r1"]["personHours"] == 1.0            # 30 min × 2 osoby


def test_korekta_w_dol_nie_jest_praca():
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(30, "r1", -3)], [])
    assert out == {}


def test_zmiana_zalogi_w_ciagu_dnia_wchodzi_do_godzin():
    zdarzenia = [ev(0, "r1", 5, zaloga=2), ev(30, "r1", 5, zaloga=6)]
    out = person_hours_by_recipe(zdarzenia, [])
    assert out["r1"]["personHours"] == 3.0            # 0.5 h × 6 osób


def test_zerowa_zaloga_nie_generuje_godzin():
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(30, "r1", 5, zaloga=0)], [])
    assert out["r1"]["personHours"] == 0.0
```

- [ ] **Step 2: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_production_rates.py -q
```

Oczekiwane: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Napisz czystą matematykę + uczenie**

`backend/app/services/production_rates_service.py`:

```python
"""Tempo produkcji — uczone z zakończonych dni, czytane przez prognozę.

Model przypisania godzin: praca między dwoma kolejnymi zapisami poszła w to,
co WŁAŚNIE zapisano. Pozycje przeplatają się w ciągu dnia, więc z sum dobowych
nie da się rozdzielić godzin między receptury.

Trzymamy PRÓBKI (jedna na dzień i recepturę), a nie gotową średnią wykładniczą:
`tablet_reopen` pozwala cofnąć zamknięcie dnia i zamknąć go ponownie, a średniej
doliczanej przyrostowo nie da się cofnąć — dzień liczyłby się drugi raz.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

from app.db import execute, query_all, query_one
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Sufit na przerwę, której nikt nie odnotował. Bez niego jedna czterogodzinna
#: dziura (awaria, brak surowca) wywraca tempo całego dnia.
MAX_GAP_MIN = 30.0
#: Waga kurczenia do rodzica — przy pierwszym dniu receptura waży 1/3.
K = 2.0
#: Okno próbek. Hala zmienia obsadę i maszyny.
OKNO_DNI = 90
SEED_KEY = "production.seed_kg_per_person_hour"
BREAK_KEY = "production.planned_break_minutes"
DOMYSLNE_ZIARNO = 120.0


def _overlap_min(od: datetime, do: datetime, breaks: List[Tuple]) -> float:
    """Ile minut przedziału [od, do] przypada na przerwy."""
    total = 0.0
    for b_od, b_do in breaks or []:
        if not b_od:
            continue
        koniec = b_do or do
        start = max(od, b_od)
        stop = min(do, koniec)
        if stop > start:
            total += (stop - start).total_seconds() / 60.0
    return total


def person_hours_by_recipe(
    events: List[Dict[str, Any]],
    breaks: List[Tuple],
    max_gap_min: float = MAX_GAP_MIN,
) -> Dict[str, Dict[str, float]]:
    """Kilogramy i roboczogodziny per receptura z jednego dnia."""
    out: Dict[str, Dict[str, float]] = {}
    poprzednie: datetime | None = None
    for e in sorted(events or [], key=lambda x: x["at"]):
        teraz = e["at"]
        if poprzednie is None:
            # Pierwsze zdarzenie tylko ustawia zegar: nie wiadomo, kiedy
            # zaczęła się praca, która do niego doprowadziła.
            poprzednie = teraz
            continue
        sztuk = int(e.get("pieces_delta") or 0)
        if sztuk <= 0:
            poprzednie = teraz          # korekta nie jest pracą, ale zjada czas
            continue
        minut = (teraz - poprzednie).total_seconds() / 60.0
        minut -= _overlap_min(poprzednie, teraz, breaks)
        minut = max(0.0, min(minut, max_gap_min))
        rid = str(e.get("recipe_id") or "")
        wpis = out.setdefault(rid, {"kg": 0.0, "personHours": 0.0})
        wpis["kg"] += sztuk * float(e.get("kg_per_unit") or 0)
        wpis["personHours"] += (minut / 60.0) * int(e.get("crew_size") or 0)
        poprzednie = teraz
    return out


def learn_from_plan(plan_id: str) -> Dict[str, Any]:
    """Policz próbki tempa z zakończonego dnia. UPSERT — odporne na powtórzenie."""
    plan = query_one("SELECT id, plan_date FROM production_plans WHERE id=%s", (plan_id,))
    if not plan:
        return {"ok": False, "recipes": 0}
    events = query_all(
        "SELECT at, recipe_id, pieces_delta, kg_per_unit, crew_size "
        "FROM production_work_events WHERE plan_id=%s ORDER BY at",
        (plan_id,),
    )
    breaks = [
        (r["started_at"], r["ended_at"])
        for r in query_all(
            "SELECT started_at, ended_at FROM production_breaks WHERE plan_id=%s",
            (plan_id,),
        )
    ]
    rozbicie = person_hours_by_recipe(events, breaks)
    ile = 0
    for rid, v in rozbicie.items():
        if v["personHours"] <= 0 or v["kg"] <= 0:
            continue                    # dzielenie przez zero — próbka bezwartościowa
        execute(
            """
            INSERT INTO production_rate_samples
                (plan_id, recipe_id, plan_date, kg, person_hours, computed_at)
            VALUES (%s,%s,%s,%s,%s, now())
            ON CONFLICT (plan_id, recipe_id) DO UPDATE
            SET kg = EXCLUDED.kg,
                person_hours = EXCLUDED.person_hours,
                plan_date = EXCLUDED.plan_date,
                computed_at = now()
            """,
            (plan_id, rid, plan.get("plan_date"), v["kg"], v["personHours"]),
        )
        ile += 1
    logger.info("production.rates_learned", extra={"plan_id": plan_id, "recipes": ile})
    return {"ok": True, "recipes": ile}
```

- [ ] **Step 4: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_production_rates.py -q
```

Oczekiwane: 8 passed.

- [ ] **Step 5: Napisz test uczenia na bazie**

`backend/tests/test_production_rates_db.py`:

```python
"""Uczenie tempa przy zamknięciu dnia przez halę.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all
from app.services.production_plans_service import tablet_finish, tablet_reopen
from app.services.production_rates_service import learn_from_plan


def _dzien():
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp1','PP/1','2026-08-27','active')"
    )
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, position, qty, qty_done, kg_per_unit, recipe_id, recipe_name, "
        " product_type_id, batch_allocation, seasoned_batch_no, worker_entries, line_status) "
        "VALUES ('pl1','pp1',0,20,10,40.0,'r1','WROCLAW','p1','{}'::jsonb,'364','[]'::jsonb,'IN_PROGRESS')"
    )
    # Trzy zapisy co 30 min, po 2 osoby: pierwszy ustawia zegar, dwa kolejne
    # dają po 1 rbh i po 200 kg → 400 kg / 2 rbh = 200 kg/rbh.
    for i, minuty in enumerate((0, 30, 60)):
        execute(
            "INSERT INTO production_work_events "
            "(id, plan_id, plan_line_id, recipe_id, recipe_name, kg_per_unit, "
            " pieces_delta, worker_id, worker_name, crew_size, at) "
            "VALUES (%s,'pp1','pl1','r1','WROCLAW',40.0,5,'w1','A',2, "
            "        timestamptz '2026-08-27 06:00:00+00' + (%s || ' minutes')::interval)",
            (f"e{i}", minuty),
        )


def test_zamkniecie_dnia_zostawia_probke_tempa(db):
    _dzien()
    tablet_finish("pp1", [])

    p = query_all("SELECT * FROM production_rate_samples WHERE plan_id='pp1'")
    assert len(p) == 1
    assert p[0]["recipe_id"] == "r1"
    assert float(p[0]["kg"]) == 400.0
    assert float(p[0]["person_hours"]) == 2.0


def test_cofniecie_i_ponowne_zamkniecie_NIE_liczy_dnia_dwa_razy(db):
    _dzien()
    tablet_finish("pp1", [])
    tablet_reopen("pp1")
    tablet_finish("pp1", [])

    p = query_all("SELECT kg, person_hours FROM production_rate_samples WHERE plan_id='pp1'")
    assert len(p) == 1
    assert float(p[0]["kg"]) == 400.0


def test_dzien_bez_zdarzen_nie_zostawia_probki(db):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp2','PP/2','2026-08-26','active')"
    )
    learn_from_plan("pp2")

    assert query_all("SELECT 1 FROM production_rate_samples WHERE plan_id='pp2'") == []


def test_blad_uczenia_nie_blokuje_zamkniecia_dnia(db, monkeypatch):
    """Hala nie może zostać z niezamkniętym dniem przez statystykę."""
    _dzien()
    import app.services.production_rates_service as rates

    def wybuch(_):
        raise RuntimeError("baza padła")

    monkeypatch.setattr(rates, "learn_from_plan", wybuch)
    wynik = tablet_finish("pp1", [])

    assert wynik["ok"] is True
```

- [ ] **Step 6: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_production_rates_db.py -q
```

Oczekiwane: FAIL — `tablet_finish` jeszcze nie uczy.

- [ ] **Step 7: Wepnij uczenie w `tablet_finish`**

W `backend/app/services/production_plans_service.py`, w `tablet_finish`, po bloku `with transaction() as conn:` a przed `logger.info(...)`:

```python
    # Uczenie tempa — po zamknięciu dnia przez halę, nie przy potwierdzeniu
    # biura: biuro kwituje czasem po kilku dniach, a prognoza ma być lepsza
    # na jutro. Błąd tutaj NIE może zablokować zamknięcia dnia — hala
    # zostałaby z otwartym dniem przez statystykę.
    try:
        from app.services import production_rates_service as rates
        rates.learn_from_plan(plan_id)
    except Exception:
        logger.exception("plan.rates_learn_failed", extra={"plan_id": plan_id})
```

- [ ] **Step 8: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_production_rates.py tests/test_production_rates_db.py -q
```

Oczekiwane: 12 passed.

- [ ] **Step 9: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/production_rates_service.py \
        kebab_fixed/backend/app/services/production_plans_service.py \
        kebab_fixed/backend/tests/test_production_rates.py \
        kebab_fixed/backend/tests/test_production_rates_db.py
git commit -m "feat(prognoza): uczenie tempa per receptura przy zamknieciu dnia"
```

---

### Task 5: Odczyt tempa z kurczeniem do rodzica

**Files:**
- Modify: `backend/app/services/production_rates_service.py`
- Create: `backend/app/routes/production_rates.py`
- Modify: `backend/app/main.py` (rejestracja routera)
- Test: `backend/tests/test_production_rates.py` (dopisać), `backend/tests/test_production_rates_db.py` (dopisać)

**Interfaces:**
- Consumes: `production_rate_samples` (Task 4), `app_settings` (Task 1)
- Produces:
  - `shrink(srednia: float, n: int, rodzic: float, k: float = K) -> float`
  - `current_rates() -> dict` — `{"seed": float, "global": float, "plannedBreakMinutes": float, "byRecipe": {recipe_id: float}}`
  - trasa `GET /api/production-rates`

- [ ] **Step 1: Dopisz test kurczenia**

Na końcu `backend/tests/test_production_rates.py`:

```python
from app.services.production_rates_service import shrink


def test_bez_probek_zostaje_sam_rodzic():
    assert shrink(0.0, 0, 120.0) == 120.0


def test_pierwsza_probka_wazy_jedna_trzecia():
    # (1×180 + 2×120) / 3 = 140
    assert shrink(180.0, 1, 120.0) == 140.0


def test_piec_probek_wazy_piec_siodmych():
    # (5×180 + 2×120) / 7 = 162.857…
    assert round(shrink(180.0, 5, 120.0), 3) == 162.857


def test_kurczenie_nigdy_nie_skacze_miedzy_dniami():
    """Przy każdym kolejnym dniu waga rośnie monotonicznie — bez cliffa,
    który dawałby próg typu „receptura liczy się od 3. dnia"."""
    poprzednie = shrink(180.0, 0, 120.0)
    for n in range(1, 12):
        teraz = shrink(180.0, n, 120.0)
        assert teraz >= poprzednie
        assert abs(teraz - poprzednie) < 25.0
        poprzednie = teraz
```

- [ ] **Step 2: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_production_rates.py -q
```

Oczekiwane: FAIL — `ImportError: cannot import name 'shrink'`.

- [ ] **Step 3: Dopisz `shrink` i `current_rates`**

Na końcu `backend/app/services/production_rates_service.py`:

```python
def shrink(srednia: float, n: int, rodzic: float, k: float = K) -> float:
    """Kurczenie do rodzica: (n·swoje + k·rodzica) / (n + k).

    Wybrane zamiast twardego progu („receptura liczy się od 3. dnia"), bo próg
    dawałby skok prognozy w dniu przejścia. Tu waga rośnie płynnie: przy
    pierwszym dniu receptura waży 1/3, po pięciu 5/7.
    """
    n = max(0, int(n))
    if n <= 0:
        return float(rodzic)
    return (n * float(srednia) + k * float(rodzic)) / (n + k)


def _setting(key: str, domyslne: float) -> float:
    row = query_one("SELECT value FROM app_settings WHERE key=%s", (key,))
    if not row:
        return domyslne
    try:
        return float(row["value"])
    except (TypeError, ValueError):
        return domyslne


def current_rates() -> Dict[str, Any]:
    """Tempa do prognozy: ziarno, globalne i per receptura (już skurczone)."""
    ziarno = _setting(SEED_KEY, DOMYSLNE_ZIARNO)
    granica = (datetime.now() - timedelta(days=OKNO_DNI)).date()
    rows = query_all(
        "SELECT recipe_id, kg, person_hours FROM production_rate_samples "
        "WHERE person_hours > 0 AND (plan_date IS NULL OR plan_date >= %s)",
        (granica,),
    )

    kg_all = sum(float(r["kg"]) for r in rows)
    rbh_all = sum(float(r["person_hours"]) for r in rows)
    globalne = shrink(kg_all / rbh_all if rbh_all > 0 else 0.0, len(rows), ziarno)

    per: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        per.setdefault(str(r["recipe_id"] or ""), []).append(r)

    by_recipe: Dict[str, float] = {}
    for rid, lista in per.items():
        if not rid:
            continue
        kg = sum(float(x["kg"]) for x in lista)
        rbh = sum(float(x["person_hours"]) for x in lista)
        by_recipe[rid] = shrink(kg / rbh if rbh > 0 else 0.0, len(lista), globalne)

    return {
        "seed": ziarno,
        "global": globalne,
        "plannedBreakMinutes": _setting(BREAK_KEY, 30.0),
        "byRecipe": by_recipe,
    }
```

- [ ] **Step 4: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_production_rates.py -q
```

Oczekiwane: 12 passed.

- [ ] **Step 5: Dopisz test odczytu na bazie**

Na końcu `backend/tests/test_production_rates_db.py`:

```python
from app.services.production_rates_service import current_rates


def _probka(plan_id, recipe_id, kg, rbh, data="2026-08-27"):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES (%s,%s,%s,'done') ON CONFLICT (id) DO NOTHING",
        (plan_id, f"PP/{plan_id}", data),
    )
    execute(
        "INSERT INTO production_rate_samples (plan_id, recipe_id, plan_date, kg, person_hours) "
        "VALUES (%s,%s,%s,%s,%s)",
        (plan_id, recipe_id, data, kg, rbh),
    )


def test_bez_probek_tempo_stoi_na_ziarnie(db):
    from app.migrations import run_migrations
    run_migrations()
    r = current_rates()
    assert r["seed"] == 120.0
    assert r["global"] == 120.0
    assert r["byRecipe"] == {}


def test_jedna_probka_ciagnie_tempo_w_swoja_strone_ale_nie_do_konca(db):
    from app.migrations import run_migrations
    run_migrations()
    _probka("p1", "r1", 360.0, 2.0)          # 180 kg/rbh
    r = current_rates()
    assert r["global"] == 140.0              # (1×180 + 2×120)/3
    assert 140.0 < r["byRecipe"]["r1"] <= 180.0


def test_probki_starsze_niz_okno_odpadaja(db):
    from app.migrations import run_migrations
    run_migrations()
    _probka("p1", "r1", 360.0, 2.0, data="2026-01-01")
    r = current_rates()
    assert r["global"] == 120.0
    assert r["byRecipe"] == {}
```

- [ ] **Step 6: Dodaj trasę i zarejestruj router**

`backend/app/routes/production_rates.py`:

```python
"""Tempo produkcji — dla prognozy zakończenia na HMI."""
from fastapi import APIRouter

from app.services import production_rates_service as svc

router = APIRouter(prefix="/api/production-rates", tags=["production-rates"])


@router.get("")
def current_rates():
    """Ziarno, tempo globalne i tempa per receptura (już po kurczeniu)."""
    return svc.current_rates()
```

W `backend/app/main.py` router rejestruje się przez jedną pętlę po module'ach. Nazwa
modułu występuje DWA razy — w imporcie (~linia 141) i w krotce przekazywanej do pętli
(~linia 199). W obu miejscach, zaraz za `production_wrapping,`, dopisz:

```python
        production_rates,
```

Sprawdź obie linie:

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
grep -n "production_rates," app/main.py     # muszą być DWIE
```

- [ ] **Step 7: Uruchom testy i sprawdź trasę**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_production_rates.py tests/test_production_rates_db.py -q
python3 -c "
from app.main import app
assert '/api/production-rates' in [r.path for r in app.routes]
print('trasa OK')
"
```

Oczekiwane: 15 passed + `trasa OK`.

- [ ] **Step 8: Cały backend**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/ -q 2>&1 | tail -5
```

Oczekiwane: 0 failed.

- [ ] **Step 9: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/production_rates_service.py \
        kebab_fixed/backend/app/routes/production_rates.py \
        kebab_fixed/backend/app/main.py \
        kebab_fixed/backend/tests/test_production_rates.py \
        kebab_fixed/backend/tests/test_production_rates_db.py
git commit -m "feat(prognoza): odczyt tempa z kurczeniem do rodzica"
```

---

### Task 6: Matematyka prognozy (czysty moduł frontu)

**Files:**
- Create: `src/features/production-hmi/finishForecast.ts`
- Test: `src/features/production-hmi/finishForecast.test.ts`

**Interfaces:**
- Consumes: nic (czysta funkcja)
- Produces:
```ts
export interface Rates { seed: number; global: number; plannedBreakMinutes: number; byRecipe: Record<string, number> }
export interface ForecastLine { id: string; qty: number; qtyDone: number; kgPerUnit: number; recipeId: string }
export interface ForecastInput {
  lines: readonly ForecastLine[]
  crew: number
  rates: Rates
  /** Kilogramy zrobione dziś i roboczogodziny na nie zużyte — tempo dzisiejsze. */
  todayKg: number
  todayPersonHours: number
  /** Minuty faktycznej pracy dzisiaj (bez przerw) — próg wygaszenia kafla. */
  todayWorkedMin: number
  /** Minuty przerw już wykorzystanych dzisiaj. */
  breakUsedMin: number
  now: string
}
export type Forecast =
  | { kind: 'ready' }
  | { kind: 'unknown'; reason: 'brak-zalogi' | 'za-wczesnie' }
  | { kind: 'eta'; at: string; hhmm: string; remainingKg: number; hours: number
      rateUsed: number; breakAddedMin: number }
export function finishForecast(input: ForecastInput): Forecast
```

- [ ] **Step 1: Napisz test**

`src/features/production-hmi/finishForecast.test.ts`:

```ts
/**
 * Prognoza godziny zakończenia produkcji.
 *
 * Kierownik podejmuje po niej decyzje (drugi kurs auta, nadgodziny), więc
 * liczba musi albo być uczciwa, albo jej nie być wcale — stąd kreska zamiast
 * zgadywania przy pustej hali i na starcie zmiany.
 */
import { describe, it, expect } from 'vitest'

import { finishForecast, type ForecastInput, type Rates } from './finishForecast'

const TEMPA: Rates = { seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} }

const linia = (over: Partial<ForecastInput['lines'][number]> = {}) => ({
  id: 'l1', qty: 20, qtyDone: 0, kgPerUnit: 40, recipeId: 'r1', ...over,
})

const wejscie = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  lines: [linia()], crew: 4, rates: TEMPA,
  todayKg: 0, todayPersonHours: 0, todayWorkedMin: 60, breakUsedMin: 0,
  now: '2026-08-27T08:00:00.000Z', ...over,
})

describe('finishForecast — zimny start na ziarnie', () => {
  it('liczy z ziarna 120 kg/h, gdy nic jeszcze nie wiadomo', () => {
    // 800 kg do zrobienia / (120 kg/h × 4 osoby) = 1.667 h = 100 min
    // + 30 min nierozliczonej przerwy = 130 min → 10:10
    const f = finishForecast(wejscie({ todayPersonHours: 1, todayKg: 0 }))
    expect(f.kind).toBe('eta')
    if (f.kind !== 'eta') return
    expect(f.remainingKg).toBe(800)
    expect(f.rateUsed).toBe(120)
    expect(f.breakAddedMin).toBe(30)
    expect(f.hhmm).toBe('10:10')
  })

  it('tempo receptury bije globalne, gdy jest znane', () => {
    const rates = { ...TEMPA, byRecipe: { r1: 200 } }
    const f = finishForecast(wejscie({ rates, todayPersonHours: 1 }))
    if (f.kind !== 'eta') return
    expect(f.rateUsed).toBe(200)
  })
})

describe('finishForecast — tempo dzisiejsze bije uczone', () => {
  it('po 30 min pracy dzisiejsze tempo wchodzi do mieszanki', () => {
    // dziś: 400 kg na 2 rbh = 200 kg/rbh, uczone 120 → mieszanka w (120, 200)
    const f = finishForecast(wejscie({ todayKg: 400, todayPersonHours: 2 }))
    if (f.kind !== 'eta') return
    expect(f.rateUsed).toBeGreaterThan(120)
    expect(f.rateUsed).toBeLessThanOrEqual(200)
  })

  it('im dłużej trwa dzień, tym mocniej liczy się tempo dzisiejsze', () => {
    const krotki = finishForecast(wejscie({ todayKg: 200, todayPersonHours: 1 }))
    const dlugi  = finishForecast(wejscie({ todayKg: 1600, todayPersonHours: 8 }))
    if (krotki.kind !== 'eta' || dlugi.kind !== 'eta') return
    expect(dlugi.rateUsed).toBeGreaterThan(krotki.rateUsed)
  })
})

describe('finishForecast — kiedy prognozy NIE ma', () => {
  it('bez układających pokazuje kreskę, a nie nieskończoność', () => {
    expect(finishForecast(wejscie({ crew: 0 })).kind).toBe('unknown')
  })

  it('przed 20 minutami pracy nie zgaduje', () => {
    // 4 osoby × 15 min to już 1 rbh — próg musi patrzeć na czas zegarowy,
    // inaczej duża załoga przepycha prognozę po kilku minutach.
    const f = finishForecast(wejscie({ todayWorkedMin: 15, todayPersonHours: 1, todayKg: 200 }))
    expect(f.kind).toBe('unknown')
    if (f.kind !== 'unknown') return
    expect(f.reason).toBe('za-wczesnie')
  })

  it('plan zrobiony w całości melduje koniec, a nie godzinę', () => {
    const f = finishForecast(wejscie({
      lines: [linia({ qtyDone: 20 })], todayPersonHours: 2, todayKg: 800,
    }))
    expect(f.kind).toBe('ready')
  })

  it('pusty plan to też koniec', () => {
    expect(finishForecast(wejscie({ lines: [], todayPersonHours: 2 })).kind).toBe('ready')
  })
})

describe('finishForecast — przerwy i załoga', () => {
  it('wykorzystana przerwa nie dolicza się drugi raz', () => {
    const f = finishForecast(wejscie({ todayPersonHours: 1, breakUsedMin: 30 }))
    if (f.kind !== 'eta') return
    expect(f.breakAddedMin).toBe(0)
    expect(f.hhmm).toBe('09:40')
  })

  it('przekroczona przerwa nie odejmuje czasu od prognozy', () => {
    const f = finishForecast(wejscie({ todayPersonHours: 1, breakUsedMin: 90 }))
    if (f.kind !== 'eta') return
    expect(f.breakAddedMin).toBe(0)
  })

  it('większa załoga kończy wcześniej', () => {
    const male = finishForecast(wejscie({ crew: 2, todayPersonHours: 1 }))
    const duze = finishForecast(wejscie({ crew: 8, todayPersonHours: 1 }))
    if (male.kind !== 'eta' || duze.kind !== 'eta') return
    expect(duze.hours).toBeLessThan(male.hours)
  })

  it('pozycje o różnych recepturach liczą się każda swoim tempem', () => {
    const rates = { ...TEMPA, byRecipe: { r1: 200, r2: 100 } }
    const f = finishForecast(wejscie({
      rates, crew: 1, todayPersonHours: 1,
      lines: [linia({ id: 'l1', recipeId: 'r1' }), linia({ id: 'l2', recipeId: 'r2' })],
    }))
    if (f.kind !== 'eta') return
    // 800/200 + 800/100 = 4 + 8 = 12 h, tempo dzisiejsze nie zna tych receptur
    expect(f.hours).toBeGreaterThan(11)
  })
})
```

- [ ] **Step 2: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/production-hmi/finishForecast.test.ts
```

Oczekiwane: FAIL — `Failed to load url ./finishForecast`.

- [ ] **Step 3: Napisz moduł**

`src/features/production-hmi/finishForecast.ts`:

```ts
/**
 * Przewidywana godzina zakończenia produkcji.
 *
 * Kierownik podejmuje po tej liczbie decyzje (drugi kurs auta, nadgodziny),
 * więc albo jest uczciwa, albo nie ma jej wcale. Stąd `unknown` zamiast
 * zgadywania: przy pustej hali i na starcie zmiany, gdy jeden wpis jednej
 * osoby dałby godzinę 23:40 i zabił zaufanie do kafla na resztę dnia.
 *
 * Tempo bierzemy z trzech źródeł, w tej kolejności ważności:
 *   1. zmierzone DZIŚ (prawda o tej obsadzie i tym dniu),
 *   2. uczone per receptura (z zakończonych dni),
 *   3. ziarno 120 kg/h na osobę (wartość od właściciela, gdy nie ma nic).
 */

export interface Rates {
  seed: number
  global: number
  plannedBreakMinutes: number
  byRecipe: Record<string, number>
}

export interface ForecastLine {
  id: string
  qty: number
  qtyDone: number
  kgPerUnit: number
  recipeId: string
}

export interface ForecastInput {
  lines: readonly ForecastLine[]
  /** Ilu ludzi UKŁADA teraz — z żywych wpisów, nie z kartoteki działu. */
  crew: number
  rates: Rates
  todayKg: number
  todayPersonHours: number
  /** Minuty faktycznej pracy dzisiaj, bez przerw. */
  todayWorkedMin: number
  breakUsedMin: number
  now: string
}

export type Forecast =
  | { kind: 'ready' }
  | { kind: 'unknown'; reason: 'brak-zalogi' | 'za-wczesnie' }
  | {
      kind: 'eta'; at: string; hhmm: string
      remainingKg: number; hours: number; rateUsed: number; breakAddedMin: number
    }

/** Poniżej tylu minut PRACY dzień jest za młody na prognozę. Liczone w czasie
 *  zegarowym, nie w roboczogodzinach: przy dużej załodze roboczogodziny rosną
 *  szybko i próg puszczałby prognozę po kilku minutach. */
const MIN_PRACY_MIN = 20

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Waga tempa dzisiejszego — rośnie z przepracowanymi roboczogodzinami.
 *  Po 4 rbh dzisiejsze waży 4/5; wcześniej podpiera się uczonym. */
const wagaDzis = (rbh: number): number => rbh / (rbh + 1)

export function finishForecast(input: ForecastInput): Forecast {
  const { lines, crew, rates, todayKg, todayPersonHours, todayWorkedMin, breakUsedMin, now } = input

  const zostalo = (lines ?? []).map(l => ({
    kg: Math.max(0, (l.qty ?? 0) - (l.qtyDone ?? 0)) * (l.kgPerUnit ?? 0),
    recipeId: l.recipeId ?? '',
  })).filter(x => x.kg > 0)

  const remainingKg = zostalo.reduce((a, x) => a + x.kg, 0)
  if (remainingKg <= 0) return { kind: 'ready' }
  if (!crew || crew <= 0) return { kind: 'unknown', reason: 'brak-zalogi' }
  if ((todayWorkedMin ?? 0) < MIN_PRACY_MIN) return { kind: 'unknown', reason: 'za-wczesnie' }

  const tempoDzis = todayPersonHours > 0 ? todayKg / todayPersonHours : 0
  const w = tempoDzis > 0 ? wagaDzis(todayPersonHours) : 0

  const tempoDla = (recipeId: string): number => {
    const uczone = rates.byRecipe?.[recipeId] ?? rates.global ?? rates.seed
    const zmieszane = w * tempoDzis + (1 - w) * uczone
    return zmieszane > 0 ? zmieszane : (rates.seed || 1)
  }

  let hours = 0
  for (const x of zostalo) hours += x.kg / (tempoDla(x.recipeId) * crew)

  // Przerwa, która jeszcze dziś będzie. Wykorzystana ponad plan nie odejmuje
  // czasu od prognozy — hala nie odrobi obiadu przez skrócenie roboty.
  const breakAddedMin = Math.max(0, (rates.plannedBreakMinutes ?? 0) - (breakUsedMin ?? 0))

  const at = new Date(new Date(now).getTime() + (hours * 60 + breakAddedMin) * 60_000)
  // Tempo pokazywane w panelu to średnia ważona kilogramami — jedna liczba
  // dla operatora, nawet gdy pozycje mają różne receptury.
  const rateUsed = remainingKg / (hours * crew)

  return {
    kind: 'eta', at: at.toISOString(), hhmm: hhmm(at),
    remainingKg: Math.round(remainingKg * 100) / 100,
    hours: Math.round(hours * 1000) / 1000,
    rateUsed: Math.round(rateUsed * 100) / 100,
    breakAddedMin,
  }
}
```

- [ ] **Step 4: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/production-hmi/finishForecast.test.ts
```

Oczekiwane: 13 passed. Jeśli `hhmm` nie zgadza się o strefę — testy liczą w czasie lokalnym runnera, a `npm test` ustawia `TZ=UTC`; uruchamiaj przez `TZ=UTC npx vitest run ...`.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/production-hmi/finishForecast.ts \
        kebab_fixed/src/features/production-hmi/finishForecast.test.ts
git commit -m "feat(prognoza): matematyka przewidywanej godziny zakonczenia"
```

---

### Task 7: Kafel i panel na HMI + przerwy przez API

**Files:**
- Create: `src/features/production-hmi/components/ForecastPanel.tsx`
- Modify: `src/lib/api.ts`, `src/pages/tablet/ProductionHmiPage.tsx`
- Test: `src/features/production-hmi/components/forecastPanel.test.tsx` (nowy), `src/pages/tablet/productionHmiPage.test.tsx` (dopisać)

**Interfaces:**
- Consumes: `finishForecast` (Task 6), `GET /api/production-rates` (Task 5), trasy przerw (Task 3)
- Produces: kafel `Koniec ok.` na pasku dnia (`data-testid="kafel-prognoza"`), panel `ForecastPanel`

- [ ] **Step 1: Dopisz klienta API**

W `src/lib/api.ts`, obok `productionPlansApi`:

```ts
// ─── Tempo produkcji (prognoza zakończenia) ──────────────────
export interface ProductionRates {
  seed: number
  global: number
  plannedBreakMinutes: number
  byRecipe: Record<string, number>
}

export const productionRatesApi = {
  current: () => get<ProductionRates>('/production-rates'),
}
```

oraz w `productionPlansApi` (przed zamykającym `}`):

```ts
  /** Przerwy zmiany — zapisywane na serwerze, bo ekran gubił je przy odświeżeniu. */
  startBreak: (planId: string) => post<{ ok: boolean }>(`/production-plans/${planId}/breaks/start`, {}),
  endBreak:   (planId: string) => post<{ ok: boolean }>(`/production-plans/${planId}/breaks/end`, {}),
  breaks:     (planId: string) =>
    get<{ id: string; startedAt: string; endedAt: string | null }[]>(`/production-plans/${planId}/breaks`),
```

- [ ] **Step 2: Napisz test panelu**

`src/features/production-hmi/components/forecastPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel uzasadnienia prognozy.
 *
 * Liczba bez uzasadnienia na ścianie hali zostaje zignorowana albo obwiniona
 * o pierwszą pomyłkę — operator musi móc sprawdzić, z czego wyszła.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { ForecastPanel } from './ForecastPanel'

afterEach(cleanup)

const eta = {
  kind: 'eta' as const, at: '2026-08-27T10:10:00.000Z', hhmm: '10:10',
  remainingKg: 800, hours: 1.667, rateUsed: 120, breakAddedMin: 30,
}

describe('ForecastPanel', () => {
  it('mówi, o której i z czego to wyszło', () => {
    render(<ForecastPanel forecast={eta} crew={4} onClose={() => {}} />)
    expect(screen.getByText('10:10')).toBeTruthy()
    expect(screen.getByTestId('prognoza-zostalo').textContent).toMatch(/800/)
    expect(screen.getByTestId('prognoza-zaloga').textContent).toMatch(/4/)
    expect(screen.getByTestId('prognoza-tempo').textContent).toMatch(/120/)
    expect(screen.getByTestId('prognoza-przerwa').textContent).toMatch(/30/)
  })

  it('bez prognozy tłumaczy DLACZEGO jej nie ma', () => {
    render(<ForecastPanel forecast={{ kind: 'unknown', reason: 'za-wczesnie' }} crew={1} onClose={() => {}} />)
    expect(screen.getByText(/za mało pracy/i)).toBeTruthy()
  })

  it('bez załogi mówi wprost, że nikt nie układa', () => {
    render(<ForecastPanel forecast={{ kind: 'unknown', reason: 'brak-zalogi' }} crew={0} onClose={() => {}} />)
    expect(screen.getByText(/nikt jeszcze nie liczy/i)).toBeTruthy()
  })

  it('zamyka się', () => {
    const close = vi.fn()
    render(<ForecastPanel forecast={eta} crew={4} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: /Zamknij/i }))
    expect(close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/production-hmi/components/forecastPanel.test.tsx
```

Oczekiwane: FAIL — brak modułu.

- [ ] **Step 4: Napisz panel**

`src/features/production-hmi/components/ForecastPanel.tsx` — modal w rytmie `ScanPanel` (ta sama rama: `fixed inset-0`, `rgba(15,23,42,.34)`, panel `var(--panel)` z `borderRadius: 14`), z wierszami:

```tsx
import type { Forecast } from '../finishForecast'

export function ForecastPanel({ forecast, crew, onClose }: {
  forecast: Forecast; crew: number; onClose: () => void
}) {
  const wiersz = (testId: string, etykieta: string, wartosc: string) => (
    <div key={testId} data-testid={testId} className="flex items-baseline justify-between"
      style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="text-[15px] font-semibold" style={{ color: 'var(--mut)' }}>{etykieta}</span>
      <b className="hmi-v10-mono text-[19px] font-extrabold">{wartosc}</b>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-4 p-6" style={{
        width: 620, maxWidth: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)',
      }}>
        <h3 className="m-0 text-[22px] font-extrabold">Przewidywane zakończenie</h3>

        {forecast.kind === 'eta' && (
          <>
            <div className="hmi-v10-mono text-[64px] font-extrabold leading-none text-center py-2"
              style={{ color: 'var(--accent)' }}>{forecast.hhmm}</div>
            {wiersz('prognoza-zostalo', 'Zostało do zrobienia', `${forecast.remainingKg} kg`)}
            {wiersz('prognoza-zaloga',  'Układa teraz',         `${crew} os.`)}
            {wiersz('prognoza-tempo',   'Tempo',                `${forecast.rateUsed} kg/h na osobę`)}
            {wiersz('prognoza-przerwa', 'Doliczona przerwa',    `${forecast.breakAddedMin} min`)}
          </>
        )}

        {forecast.kind === 'ready' && (
          <div className="text-[19px] font-bold" style={{ color: 'var(--success)' }}>
            Plan dnia zrobiony w całości.
          </div>
        )}

        {forecast.kind === 'unknown' && (
          <div className="text-[17px] font-semibold" style={{ color: 'var(--mut)' }}>
            {forecast.reason === 'brak-zalogi'
              ? 'Nikt jeszcze nie liczy sztuk — nie ma z czego liczyć tempa.'
              : 'Za mało pracy, żeby liczyć uczciwie. Prognoza pojawi się po ok. 20 minutach.'}
          </div>
        )}

        <button type="button" onClick={onClose} className="text-base font-bold self-end"
          style={{ height: 56, padding: '0 28px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
          Zamknij
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Uruchom — ma przejść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/production-hmi/components/forecastPanel.test.tsx
```

Oczekiwane: 4 passed.

- [ ] **Step 6: Dopisz test okablowania strony**

W `src/pages/tablet/productionHmiPage.test.tsx`:

a) w mocku `@/lib/api` dołóż:

```ts
  productionRatesApi: {
    current: () => Promise.resolve({ seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} }),
  },
```

oraz do `productionPlansApi`:

```ts
    startBreak: (planId: string) => { wolania.przerwy.push({ planId, co: 'start' }); return Promise.resolve({ ok: true }) },
    endBreak:   (planId: string) => { wolania.przerwy.push({ planId, co: 'end' }); return Promise.resolve({ ok: true }) },
    breaks:     () => Promise.resolve(kopia(stan.przerwy)),
```

do `stan`: `przerwy: [] as any[]`, do `wolania`: `przerwy: [] as any[]`, i wyzeruj oba w `beforeEach`.

b) nowy blok testów:

```tsx
describe('ProductionHmiPage — prognoza zakończenia', () => {
  it('na starcie dnia kafel nie zgaduje godziny', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    expect((await screen.findByTestId('kafel-prognoza')).textContent).toMatch(/—/)
  })

  it('dotknięcie kafla otwiera uzasadnienie', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByTestId('kafel-prognoza'))
    expect(await screen.findByText(/Przewidywane zakończenie/i)).toBeTruthy()
  })

  it('przerwa idzie na serwer, a nie tylko w stan ekranu', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('Przerwa'))
    await waitFor(() => expect(wolania.przerwy).toEqual([{ planId: 'p1', co: 'start' }]))
  })
})
```

- [ ] **Step 7: Uruchom — ma paść**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/pages/tablet/productionHmiPage.test.tsx
```

Oczekiwane: FAIL — brak `kafel-prognoza`.

- [ ] **Step 8: Wepnij kafel, panel i przerwy w `ProductionHmiPage`**

1. Importy: `finishForecast`, `type Forecast`, `ForecastPanel`, `productionRatesApi`.
2. Źródło temp: `const ratesData = useApi(() => productionRatesApi.current())` i dołóż `ratesData` do `useLiveRefresh({...})`.
3. Załoga i tempo dzisiejsze — z już liczonych `wpisy`/`stats`:

```tsx
  const uklada = useMemo(
    () => new Set(wpisy.filter(w => w.pieces > 0).map(w => w.worker)).size,
    [wpisy],
  )
  const prognoza: Forecast = useMemo(() => finishForecast({
    lines: linie.map(l => ({
      id: l.id, qty: l.qty, qtyDone: l.qtyDone, kgPerUnit: l.kgPerUnit,
      recipeId: (plan?.lines ?? []).find((x: any) => x.id === l.id)?.recipeId ?? '',
    })),
    crew: uklada,
    rates: ratesData.data ?? { seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} },
    todayKg: stats.total.kg,
    todayPersonHours: (stats.total.workedMs / 3_600_000) * uklada,
    todayWorkedMin: stats.total.workedMs / 60_000,
    breakUsedMin: przerwyMs / 60_000,
    now: teraz,
  }), [linie, plan, uklada, ratesData.data, stats, przerwyMs, teraz])
```

   `przerwyMs` liczy się dziś dopiero w ciele `return` — przenieś tę linię wyżej, nad `prognoza`.

4. Pasek dnia: zmień `grid-cols-7` na `grid-cols-8` i dołóż kafel przed „Statystyki":

```tsx
          { label: 'Koniec ok.', testId: 'kafel-prognoza',
            val: prognoza.kind === 'eta' ? prognoza.hhmm : prognoza.kind === 'ready' ? 'Zrobione' : '—',
            onTap: () => setPrognozaOtwarta(true) },
```

   (kafle z `onTap` renderują się jako `button` — dołóż `data-testid={c.testId}` w tej gałęzi).

5. `const [prognozaOtwarta, setPrognozaOtwarta] = useState(false)` i render panelu obok pozostałych modali:

```tsx
      {prognozaOtwarta && (
        <ForecastPanel forecast={prognoza} crew={uklada} onClose={() => setPrognozaOtwarta(false)} />
      )}
```

6. Przerwy przez API — zamień oba `setPrzerwy(...)` na wywołania, które robią OBA: zapisują na serwerze i aktualizują stan lokalny (ekran ma zareagować natychmiast, serwer jest źródłem prawdy):

```tsx
  const zacznijPrzerwe = useCallback(async () => {
    setPrzerwy(s => breakStarted(s, new Date().toISOString()))
    if (plan?.id) { try { await productionPlansApi.startBreak(plan.id) } catch { /* ekran już stoi */ } }
  }, [plan])

  const zakonczPrzerwe = useCallback(async () => {
    setPrzerwy(s => breakEnded(s, new Date().toISOString()))
    if (plan?.id) { try { await productionPlansApi.endBreak(plan.id) } catch { /* ekran już wrócił */ } }
  }, [plan])
```

- [ ] **Step 9: Uruchom testy strony i panelu**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/pages/tablet/productionHmiPage.test.tsx src/features/production-hmi/
```

Oczekiwane: 0 failed.

- [ ] **Step 10: Cały front + typecheck + build**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run 2>&1 | tail -5
npx tsc --noEmit && echo "TSC OK"
npm run build 2>&1 | tail -3
```

Oczekiwane: 0 failed, `TSC OK`, `built in …`.

- [ ] **Step 11: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/production-hmi/components/ForecastPanel.tsx \
        kebab_fixed/src/features/production-hmi/components/forecastPanel.test.tsx \
        kebab_fixed/src/pages/tablet/ProductionHmiPage.tsx \
        kebab_fixed/src/pages/tablet/productionHmiPage.test.tsx \
        kebab_fixed/src/lib/api.ts
git commit -m "feat(prognoza): kafel przewidywanego zakonczenia na pasku dnia"
```

---

## Wdrożenie

Nagrywanie (Tasks 1–3) można wypuścić osobno i wcześniej — zacznie zbierać dane od
pierwszej pełnej produkcji, a prognoza dojdzie później i od razu ma na czym stać.

Przed deployem obowiązuje reguła: **diff prod ↔ repo**, potem `deploy/deploy.sh` na
produkcji (bramka CI). Ekrany hali wymagają **bumpu wersji** w
`src-tauri/tauri.produkcja.conf.json` i tagu `produkcja-*` — sam deploy dist na VPS
nie zmienia kiosku.
