# Przyprawione — rozdzielenie partii per (produkt+surowiec+dzień) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zmasowane mięso różnych produktów z tej samej partii surowca tego samego dnia ma trafiać do magazynu przyprawionego jako OSOBNE partie (nie zlewać się), z jednorazową korektą istniejącego zlanego wiersza `364`.

**Architecture:** Tożsamość partii przyprawionego = `(recipe_id, batch_no, production_day)`. Migracja DB dodaje kolumnę `production_day` i zamienia `UNIQUE(batch_no)` na `UNIQUE(recipe_id, batch_no, production_day)`. `finish_mixing_session` robi jawny upsert po tym kluczu zamiast `ON CONFLICT(batch_no)`. Produkcja kebaba wybiera przyprawione po `material_type_id`+`id` (FEFO), nie po `batch_no`, więc wiele wierszy o tym samym `batch_no` jest bezpieczne. Korekta danych = czysta funkcja grupująca sesje + jednorazowy skrypt.

**Tech Stack:** FastAPI + psycopg + PostgreSQL. Migracje = lista SQL w `backend/app/migrations.py` (idempotentne, run_migrations() przy starcie). Testy = pytest (czyste funkcje, bez DB). Gate regresji = pełny `pytest -q`.

**Spec:** `docs/superpowers/specs/2026-06-16-przyprawione-rozdzielenie-partii-design.md`

---

## File Structure

- **Modify** `backend/app/migrations.py` — dodać DDL: kolumna `production_day`, backfill, swap unikalności.
- **Modify** `backend/app/services/mixing_service.py` — `finish_mixing_session`: jawny upsert po `(recipe_id, batch_no, production_day)`.
- **Modify** `backend/app/services/seasoned_meat_service.py` — czysta funkcja `split_seasoned_sessions` (logika korekty).
- **Create** `backend/tests/test_seasoned_split.py` — testy `split_seasoned_sessions`.
- **Create** `backend/fix_seasoned_split_364.py` — jednorazowy skrypt korekty (idempotentny).

---

## Task 1: Migracja DB — production_day + swap unikalności

**Files:**
- Modify: `backend/app/migrations.py` (lista `_DDL`)

- [ ] **Step 1: Dodaj DDL na końcu listy `_DDL`**

Znajdź koniec listy `_DDL` (ostatni element przed `]`) i dodaj nową sekcję:

```python
    # ── Przyprawione: rozdzielenie partii per (produkt + surowiec + dzień) ──
    "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS production_day date DEFAULT CURRENT_DATE",
    "UPDATE seasoned_meat SET production_day = created_at::date WHERE production_day IS NULL",
    "ALTER TABLE seasoned_meat DROP CONSTRAINT IF EXISTS seasoned_meat_batch_no_key",
    "CREATE UNIQUE INDEX IF NOT EXISTS seasoned_meat_recipe_batch_day_key "
    "ON seasoned_meat (recipe_id, batch_no, production_day)",
```

- [ ] **Step 2: Sprawdź składnię modułu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import ast; ast.parse(open('app/migrations.py').read()); print('syntax OK')"`
Expected: `syntax OK`

- [ ] **Step 3: Pełny pytest (brak regresji od zmiany modułu)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q 2>&1 | tail -3`
Expected: same kropki, brak FAILED.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/migrations.py
git commit -m "feat(przyprawione): migracja — production_day + UNIQUE(recipe_id,batch_no,production_day)"
```

---

## Task 2: `finish_mixing_session` — jawny upsert po tożsamości partii

**Files:**
- Modify: `backend/app/services/mixing_service.py` (blok INSERT seasoned_meat, ~686–712)

**Kontekst:** Dziś jest `INSERT … ON CONFLICT (batch_no) DO UPDATE`. Zmieniamy na: wyznacz dzień z `now_iso()` (spójny z `created_at`), znajdź istniejącą partię po `(recipe_id, batch_no, production_day)` z `FOR UPDATE`, dolej kg lub wstaw nową.

- [ ] **Step 1: Zamień blok INSERT…ON CONFLICT**

Znajdź dokładnie ten blok (linie ~686–712):

```python
        cx_execute(
            conn,
            """
            INSERT INTO seasoned_meat
                (id, batch_no, recipe_id, recipe_name, mixing_order_no,
                 kg_produced, kg_available, kg_used, machine_id,
                 expiry_date, status, material_type_id, material_name, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,'available',%s,%s,%s)
            ON CONFLICT (batch_no) DO UPDATE
            SET kg_produced  = seasoned_meat.kg_produced  + EXCLUDED.kg_produced,
                kg_available = seasoned_meat.kg_available + EXCLUDED.kg_available
            """,
            (
                cuid(),
                batch_no,
                order.get("recipe_id", ""),
                order.get("recipe_name", ""),
                order.get("order_no", ""),
                kg_output,
                kg_output,
                machine_id,
                expiry,
                mat_id,
                mat_name,
                now_iso(),
            ),
        )
```

Zamień na:

```python
        # Tożsamość partii przyprawionego = (recipe_id, batch_no, dzień produkcji).
        # Różne receptury z tej samej partii surowca = osobne partie (nie zlewamy).
        # production_day liczony z now_iso() — spójny z created_at (bez dryfu TZ).
        recipe_id_val = order.get("recipe_id", "")
        prod_iso = now_iso()
        production_day = prod_iso[:10]  # 'YYYY-MM-DD'
        existing = cx_query_one(
            conn,
            """
            SELECT id FROM seasoned_meat
            WHERE recipe_id = %s AND batch_no = %s AND production_day = %s
            FOR UPDATE
            """,
            (recipe_id_val, batch_no, production_day),
        )
        if existing:
            cx_execute(
                conn,
                """
                UPDATE seasoned_meat
                SET kg_produced  = kg_produced  + %s,
                    kg_available = kg_available + %s
                WHERE id = %s
                """,
                (kg_output, kg_output, existing["id"]),
            )
        else:
            cx_execute(
                conn,
                """
                INSERT INTO seasoned_meat
                    (id, batch_no, recipe_id, recipe_name, mixing_order_no,
                     kg_produced, kg_available, kg_used, machine_id,
                     expiry_date, status, material_type_id, material_name,
                     production_day, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,'available',%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    batch_no,
                    recipe_id_val,
                    order.get("recipe_name", ""),
                    order.get("order_no", ""),
                    kg_output,
                    kg_output,
                    machine_id,
                    expiry,
                    mat_id,
                    mat_name,
                    production_day,
                    prod_iso,
                ),
            )
```

- [ ] **Step 2: Sprawdź składnię**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import ast; ast.parse(open('app/services/mixing_service.py').read()); print('syntax OK')"`
Expected: `syntax OK`

- [ ] **Step 3: Pełny pytest — brak regresji**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q 2>&1 | tail -4`
Expected: brak FAILED. (Lineage/finished-goods testy zielone — `WHERE batch_no` nadal poprawny, bo wszystkie wiersze tego samego `batch_no` dzielą ten sam wsad surowca.)

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/mixing_service.py
git commit -m "feat(przyprawione): jawny upsert po (recipe_id,batch_no,dzień) zamiast ON CONFLICT(batch_no)"
```

---

## Task 3: Czysta funkcja korekty `split_seasoned_sessions` + testy

**Files:**
- Modify: `backend/app/services/seasoned_meat_service.py` (dodać funkcję)
- Create: `backend/tests/test_seasoned_split.py`

- [ ] **Step 1: Napisz failing test**

Plik `backend/tests/test_seasoned_split.py`:

```python
"""Czysta logika rozdzielenia zlanej partii przyprawionego (korekta danych 364)."""
from app.services.seasoned_meat_service import split_seasoned_sessions


# Dane z produkcji dla batch_no='364' (recipe_name, dzień, kg_output)
SESSIONS_364 = [
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-12", "kg_output": 720.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 720.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 240.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 2880.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 240.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-16", "kg_output": 360.0},
    {"recipe_id": "gk", "recipe_name": "GOLD KEBAB", "day": "2026-06-16", "kg_output": 250.2},
    {"recipe_id": "gk", "recipe_name": "GOLD KEBAB", "day": "2026-06-16", "kg_output": 250.2},
]


def test_groups_by_recipe_and_day():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=720.0)
    summary = [(g["recipe_name"], g["production_day"], g["kg_produced"]) for g in groups]
    assert summary == [
        ("Gold2", "2026-06-12", 720.0),
        ("Gold2", "2026-06-13", 4080.0),
        ("Gold2", "2026-06-16", 360.0),
        ("GOLD KEBAB", "2026-06-16", 500.4),
    ]


def test_used_attributed_fefo_earliest_day_first():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=720.0)
    avail = {(g["recipe_name"], g["production_day"]): g["kg_available"] for g in groups}
    used = {(g["recipe_name"], g["production_day"]): g["kg_used"] for g in groups}
    # 720 zużyte schodzi z najstarszej partii (Gold2/12.06)
    assert used[("Gold2", "2026-06-12")] == 720.0
    assert avail[("Gold2", "2026-06-12")] == 0.0
    assert avail[("Gold2", "2026-06-13")] == 4080.0
    assert avail[("GOLD KEBAB", "2026-06-16")] == 500.4


def test_sum_available_matches_total():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=720.0)
    assert round(sum(g["kg_available"] for g in groups), 3) == 4940.4
    assert round(sum(g["kg_produced"] for g in groups), 3) == 5660.4


def test_no_used_leaves_all_available():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=0.0)
    assert all(g["kg_used"] == 0.0 for g in groups)
    assert round(sum(g["kg_available"] for g in groups), 3) == 5660.4
```

- [ ] **Step 2: Uruchom test — ma FAIL (brak funkcji)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_seasoned_split.py -q 2>&1 | tail -5`
Expected: FAIL / ImportError `split_seasoned_sessions`.

- [ ] **Step 3: Dodaj funkcję do `seasoned_meat_service.py`**

Dodaj na końcu pliku `backend/app/services/seasoned_meat_service.py`:

```python
def split_seasoned_sessions(sessions, kg_used_total):
    """Czysta korekta: zlane sesje jednej partii (batch_no) → grupy
    per (recipe_id, dzień). Zużyte kg przypisane FEFO (najstarszy dzień
    pierwszy). Zwraca listę dict-ów posortowaną FEFO:
    {recipe_id, recipe_name, production_day, kg_produced, kg_used, kg_available}.

    sessions: [{recipe_id, recipe_name, day('YYYY-MM-DD'), kg_output}].
    """
    groups: dict = {}
    for s in sessions:
        key = (s["recipe_id"], s["day"])
        g = groups.setdefault(key, {
            "recipe_id": s["recipe_id"],
            "recipe_name": s["recipe_name"],
            "production_day": s["day"],
            "kg_produced": 0.0,
        })
        g["kg_produced"] += float(s["kg_output"] or 0)

    ordered = sorted(groups.values(), key=lambda g: (g["production_day"], g["recipe_id"]))
    remaining = float(kg_used_total or 0)
    for g in ordered:
        take = min(remaining, g["kg_produced"])
        g["kg_used"] = round(take, 3)
        g["kg_available"] = round(g["kg_produced"] - take, 3)
        g["kg_produced"] = round(g["kg_produced"], 3)
        remaining -= take
    return ordered
```

- [ ] **Step 4: Uruchom test — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_seasoned_split.py -q 2>&1 | tail -4`
Expected: 4 passed.

- [ ] **Step 5: Pełny pytest**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q 2>&1 | tail -3`
Expected: brak FAILED.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/seasoned_meat_service.py backend/tests/test_seasoned_split.py
git commit -m "test(przyprawione): split_seasoned_sessions — grupowanie per recept+dzień, FEFO zużycia"
```

---

## Task 4: Jednorazowy skrypt korekty `fix_seasoned_split_364.py`

**Files:**
- Create: `backend/fix_seasoned_split_364.py`

**Kontekst:** Uruchamiany RĘCZNIE na produkcji PO wdrożeniu migracji (Task 1) i kodu. Idempotentny: jeśli partia już rozdzielona (>1 wiersz `364`) — nic nie robi. Zachowuje `id` oryginalnego wiersza dla najstarszej pod-partii (referencje zużytych 720 kg).

- [ ] **Step 1: Utwórz skrypt**

Plik `backend/fix_seasoned_split_364.py`:

```python
"""Jednorazowa korekta: rozdziel zlany wiersz seasoned_meat batch_no='364'
na partie per (recipe_id, dzień). Idempotentny. Uruchom RĘCZNIE na prod:

    set -a; . /opt/kebab/config/.env; set +a
    cd /opt/kebab/app/backend && python3 fix_seasoned_split_364.py
"""
from app.db import transaction, cx_query_one, cx_query_all, cx_execute
from app.services.seasoned_meat_service import split_seasoned_sessions
from app.utils.ids import cuid

BATCH_NO = "364"


def main():
    with transaction() as conn:
        rows = cx_query_all(
            conn, "SELECT * FROM seasoned_meat WHERE batch_no=%s ORDER BY created_at", (BATCH_NO,)
        )
        if len(rows) == 0:
            print(f"Brak wiersza batch_no={BATCH_NO} — nic do zrobienia.")
            return
        if len(rows) > 1:
            print(f"batch_no={BATCH_NO} już rozdzielony ({len(rows)} wierszy) — pomijam (idempotentne).")
            return

        orig = rows[0]
        kg_used_total = float(orig.get("kg_used") or 0)
        mat_id = orig.get("material_type_id")
        mat_name = orig.get("material_name")
        expiry = orig.get("expiry_date")

        sessions = cx_query_all(
            conn,
            """
            SELECT mo.recipe_id, mo.recipe_name,
                   ms.started_at::date::text AS day, ms.kg_output
            FROM mixing_sessions ms
            JOIN mixing_orders mo ON mo.id = ms.order_id
            WHERE ms.batch_no = %s
            """,
            (BATCH_NO,),
        )
        if not sessions:
            print("Brak sesji dla 364 — nie mogę odtworzyć podziału. Przerywam.")
            return

        groups = split_seasoned_sessions(sessions, kg_used_total)

        # Asercja spójności kg przed zapisem
        sum_prod = round(sum(g["kg_produced"] for g in groups), 3)
        sum_avail = round(sum(g["kg_available"] for g in groups), 3)
        orig_prod = round(float(orig.get("kg_produced") or 0), 3)
        orig_avail = round(float(orig.get("kg_available") or 0), 3)
        assert sum_prod == orig_prod, f"kg_produced nie zgadza się: {sum_prod} != {orig_prod}"
        assert sum_avail == orig_avail, f"kg_available nie zgadza się: {sum_avail} != {orig_avail}"

        # Pierwsza (najstarsza, FEFO) grupa → UPDATE oryginalnego wiersza (zachowanie id)
        first, rest = groups[0], groups[1:]
        cx_execute(
            conn,
            """
            UPDATE seasoned_meat
            SET recipe_id=%s, recipe_name=%s, production_day=%s,
                kg_produced=%s, kg_available=%s, kg_used=%s
            WHERE id=%s
            """,
            (first["recipe_id"], first["recipe_name"], first["production_day"],
             first["kg_produced"], first["kg_available"], first["kg_used"], orig["id"]),
        )
        # Pozostałe grupy → INSERT nowe wiersze (ten sam batch_no, inny dzień/recept)
        for g in rest:
            cx_execute(
                conn,
                """
                INSERT INTO seasoned_meat
                    (id, batch_no, recipe_id, recipe_name, mixing_order_no,
                     kg_produced, kg_available, kg_used, machine_id,
                     expiry_date, status, material_type_id, material_name,
                     production_day, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s,'available',%s,%s,%s, (%s::date)::timestamptz)
                """,
                (cuid(), BATCH_NO, g["recipe_id"], g["recipe_name"], orig.get("mixing_order_no") or "",
                 g["kg_produced"], g["kg_available"], g["kg_used"],
                 expiry, mat_id, mat_name, g["production_day"], g["production_day"]),
            )
        print(f"Rozdzielono 364 na {len(groups)} partii: "
              + ", ".join(f'{g["recipe_name"]}/{g["production_day"]}={g["kg_available"]}kg' for g in groups))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Sprawdź składnię**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import ast; ast.parse(open('fix_seasoned_split_364.py').read()); print('syntax OK')"`
Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/fix_seasoned_split_364.py
git commit -m "feat(przyprawione): jednorazowy skrypt korekty zlanej partii 364 (idempotentny)"
```

---

## Task 5: Deploy na prod + migracja + korekta + weryfikacja

**Files:** brak (deploy + uruchomienie)

- [ ] **Step 1: Wgraj zmienione pliki backendu i zrestartuj (migracja odpali się przy starcie)**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed && \
cp backend/app/migrations.py /opt/kebab/app/backend/app/migrations.py && \
cp backend/app/services/mixing_service.py /opt/kebab/app/backend/app/services/mixing_service.py && \
cp backend/app/services/seasoned_meat_service.py /opt/kebab/app/backend/app/services/seasoned_meat_service.py && \
cp backend/fix_seasoned_split_364.py /opt/kebab/app/backend/fix_seasoned_split_364.py && \
systemctl restart kebab-mes && sleep 3 && curl -s 127.0.0.1:8010/api/health
```
Expected: `true`.

- [ ] **Step 2: Potwierdź, że migracja zadziałała (kolumna + indeks)**

Run:
```bash
set -a; . /opt/kebab/config/.env; set +a
psql "$DATABASE_URL" -P pager=off -c "SELECT column_name FROM information_schema.columns WHERE table_name='seasoned_meat' AND column_name='production_day';"
psql "$DATABASE_URL" -P pager=off -c "SELECT indexname FROM pg_indexes WHERE tablename='seasoned_meat' AND indexname='seasoned_meat_recipe_batch_day_key';"
```
Expected: kolumna `production_day` istnieje; indeks `seasoned_meat_recipe_batch_day_key` istnieje.

- [ ] **Step 3: Uruchom korektę danych**

Run:
```bash
set -a; . /opt/kebab/config/.env; set +a
cd /opt/kebab/app/backend && python3 fix_seasoned_split_364.py
```
Expected: `Rozdzielono 364 na 4 partii: Gold2/2026-06-12=0.0kg, Gold2/2026-06-13=4080.0kg, Gold2/2026-06-16=360.0kg, GOLD KEBAB/2026-06-16=500.4kg`

- [ ] **Step 4: Weryfikacja magazynu**

Run:
```bash
set -a; . /opt/kebab/config/.env; set +a
psql "$DATABASE_URL" -P pager=off -c "SELECT batch_no, recipe_name, production_day, kg_produced, kg_available, kg_used FROM seasoned_meat WHERE batch_no='364' ORDER BY production_day, recipe_name;"
```
Expected: 4 wiersze (Gold2 12.06=0, Gold2 13.06=4080, Gold2 16.06=360, GOLD KEBAB 16.06=500.4). Suma available=4940.4.

- [ ] **Step 5: Weryfikacja w UI**

Otwórz `http://204.168.166.34:8080` → Biuro → Magazyn → Mięso przyprawione. Sprawdź, że GOLD KEBAB z 16.06 jest osobną partią obok Gold2. (Twarde odświeżenie.)

- [ ] **Step 6: Smoke nowego masowania (opcjonalnie)**

Zmasuj próbnie dwa różne produkty z tej samej partii surowca → potwierdź dwa osobne wiersze w magazynie przyprawionego.

---

## Notatki / ryzyka

- **Reverse-trace (`finished_goods … WHERE batch_no=%s`) NIE jest zmieniany:** wszystkie wiersze o tym samym `batch_no` dzielą ten sam wsad surowca, więc ślad surowca pozostaje poprawny. Gdyby jakiś test lineage padł w Task 2 Step 3 — wtedy zaadresować (query_one→agregacja), inaczej zostawić (YAGNI).
- **CREATE UNIQUE INDEX** zadziała, bo prod ma 1 wiersz `364` przed korektą, a po korekcie klucze `(recipe_id, batch_no, production_day)` są różne. Gdyby istniały inne duplikaty — indeks by się nie utworzył (do sprawdzenia w Step 2).
- **Korekta jest „w przód" idempotentna** — drugie uruchomienie wykryje >1 wiersz i pominie.
- Deploy backendu = kopiowanie plików [[kebab-vps-deploy]]; migracja odpala się sama przy `systemctl restart kebab-mes`.
