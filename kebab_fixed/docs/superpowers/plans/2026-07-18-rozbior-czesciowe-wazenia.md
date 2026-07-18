# Częściowe ważenia mięsa + lista ważeń ubocznych — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **UWAGA (repo):** subagenty NIE piszą do `backend/` ani większości `src/` — zadania backendowe wykonuj inline.

**Goal:** Otwarte pobranie ćwiartki na HMI rozbioru można ważyć porcjami (każda porcja od razu wchodzi na Magazyn mięsa), a kafelki „Grzbiety"/„Kości" dolnego paska otwierają listę dzisiejszych ważeń frakcji z sumą.

**Architecture:** Nowa tabela `deboning_take_weighings` (porcja = wiersz) obok niezmienionego `deboning_entries` (wpis zostaje `pending` do domknięcia, wtedy `kg_meat` = suma porcji). Nowy endpoint `weigh-part` + rozszerzone `complete`/storno/edycja. HMI: jeden przycisk ZAPISZ + dialog „część/całość" gdy łączny % < 63. Uboczne: `/byproducts/today` liczy sumę i listę z palet po ich `weighedAt`.

**Tech Stack:** FastAPI + psycopg2 (raw SQL), React + TypeScript (HMI v10), pytest (DB testy na `kebab_mes_test`), vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-rozbior-czesciowe-wazenia-design.md`.
- Komentarze w kodzie po polsku, styl istniejących plików (gęste komentarze „dlaczego").
- Backend: zapisy przez `transaction()`/`cx_*`, `FOR UPDATE` na modyfikowanym wierszu; ruch magazynowy IN przez `create_stock_movement` (REGUŁA kolejności ruchów).
- Stała progu pytania: `PARTIAL_ASK_BELOW_PCT = 63` (frontend, `features/deboning/utils/partialWeighing.ts`).
- Testy DB: `cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/<plik> -v` (bez zmiennej — skip). NIGDY nie kierować testów na 5433 (prod).
- Frontend: `npm test` (vitest, TZ=UTC), `npm run typecheck`.
- Commity po polsku, format `feat|fix|test|docs: ...`.

---

### Task 1: DDL — tabela `deboning_take_weighings`

**Files:**
- Modify: `backend/init_db.py` (SCHEMA, obok bloku `deboning_entry_corrections`, ~linia 680)
- Modify: `backend/app/migrations.py` (`_DDL`, obok wpisu `deboning_entry_corrections`, ~linia 680)

**Interfaces:**
- Produces: tabela `deboning_take_weighings(id TEXT PK, entry_id TEXT FK→deboning_entries ON DELETE CASCADE, kg_meat NUMERIC >0, kg_gross NUMERIC, tare_cart_kg NUMERIC, tare_e2_kg NUMERIC, e2_count INTEGER, weigh_mode TEXT, weighed_at TIMESTAMPTZ default now(), created_at TIMESTAMPTZ default now())` — używana przez Taski 2–5.

- [ ] **Step 1: Dodaj DDL w OBU miejscach** (świeża baza = init_db, istniejące = migrations; pułapka świeżej bazy z pamięci projektu). Ten sam tekst w `init_db.py` (wewnątrz SCHEMA, po `deboning_entry_corrections` + jego indeksie) i jako NOWE elementy listy `_DDL` w `app/migrations.py`:

```sql
CREATE TABLE IF NOT EXISTS deboning_take_weighings (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES deboning_entries(id) ON DELETE CASCADE,
    kg_meat NUMERIC NOT NULL CHECK (kg_meat > 0),
    kg_gross NUMERIC,
    tare_cart_kg NUMERIC,
    tare_e2_kg NUMERIC,
    e2_count INTEGER,
    weigh_mode TEXT,
    weighed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_dtw_entry ON deboning_take_weighings(entry_id);
```

W `migrations.py` to dwa osobne stringi w `_DDL` (komentarz nad nimi: `# Częściowe ważenia mięsa z otwartego pobrania — porcja = wiersz (2026-07-18)`); w `init_db.py` dopisane do SCHEMA w tym samym stylu co `deboning_entry_corrections`.

- [ ] **Step 2: Zastosuj na bazie testowej i zweryfikuj**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend && \
DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
python3 -c "from app.migrations import run_migrations; run_migrations()" && \
PGPASSWORD=p psql -h localhost -p 55437 -U postgres -d kebab_mes_test -c "\d deboning_take_weighings" | head -15
```
Expected: tabela z kolumnami jak w DDL (bez błędów `migrations.statement_failed` dla nowych wpisów).

- [ ] **Step 3: Commit**

```bash
git add backend/init_db.py backend/app/migrations.py
git commit -m "feat: tabela deboning_take_weighings (częściowe ważenia pobrania)"
```

---

### Task 2: Backend — helpery + endpoint `weigh-part`

**Files:**
- Modify: `backend/app/services/deboning_service.py` (helpery przed `create_deboning_take` ~linia 820; `complete_deboning_take` ~linia 1027)
- Modify: `backend/app/routes/deboning.py` (po `complete_deboning_take` ~linia 125)
- Test: `backend/tests/test_deboning_take_weighings_db.py` (nowy)

**Interfaces:**
- Consumes: tabela z Taska 1; istniejące `validate_weighing_consistency`, `create_stock_movement`, `cuid`, `now_iso`.
- Produces:
  - `_sum_take_weighings(conn, entry_id: str) -> float`
  - `_insert_take_weighing(conn, entry_id: str, kg: float, dto) -> None`
  - `_add_meat_to_lot(conn, entry: Dict, kg_meat: float, entry_id: str) -> None` (lot + ruch IN)
  - `_reattach_overnight_session(conn, entry: Dict, entry_id: str) -> None`
  - `weigh_part_deboning_take(entry_id: str, dto) -> Dict` (service) + `POST /api/deboning/takes/{entry_id}/weigh-part` (route, dto = istniejący `DeboningTakeComplete`).
  Taski 3–5 używają tych helperów pod dokładnie tymi nazwami.

- [ ] **Step 1: Napisz padające testy** — nowy plik `backend/tests/test_deboning_take_weighings_db.py`:

```python
"""Częściowe ważenia mięsa z otwartego pobrania (weigh-part): porcja od razu
wchodzi na lot mięsa, pobranie zostaje pending; complete sumuje porcje.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.deboning_service import (
    complete_deboning_take,
    create_deboning_take,
    delete_deboning_entry,
    list_deboning_entries,
    update_deboning_take,
    weigh_part_deboning_take,
)
from app.utils.ids import now_iso


def _seed_batch(batch_id="rb1", internal_no="800", kg=300.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,'Dostawca',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), kg, kg, now_iso()),
    )


def _take_dto(**kw):
    base = dict(raw_batch_id="rb1", worker_id="w1", worker_name="Jan",
                kg_taken=300.0, kg_quarter=None, session_id=None)
    base.update(kw)
    return SimpleNamespace(**base)


def _meat_dto(kg, mode=None):
    return SimpleNamespace(kg_meat=kg, kg_gross=None, tare_cart_kg=None,
                           tare_e2_kg=None, e2_count=None, weigh_mode=mode)


def test_weigh_part_dopisuje_na_magazyn_a_wpis_zostaje_pending(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    row = query_one("SELECT status, kg_meat FROM deboning_entries WHERE id=%s", (entry["id"],))
    assert row["status"] == "pending"
    assert float(row["kg_meat"] or 0) == 0.0  # suma dopiero przy domknięciu
    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE lot_no='800'")
    assert float(lot["kg_available"]) == 100.0
    w = query_one("SELECT COUNT(*) AS n, COALESCE(SUM(kg_meat),0) AS s FROM deboning_take_weighings")
    assert w["n"] == 1 and float(w["s"]) == 100.0
    mv = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE source_type='deboning' AND source_id=%s AND movement_type='IN'",
        (entry["id"],),
    )
    assert float(mv["q"]) == 100.0


def test_weigh_part_suma_nie_moze_przekroczyc_pobrania(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    with pytest.raises(HTTPException) as e:
        weigh_part_deboning_take(entry["id"], _meat_dto(250.0))
    assert e.value.status_code == 400


def test_weigh_part_na_domknietym_wpisie_409(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto(kg_taken=300.0))
    complete_deboning_take(entry["id"], _meat_dto(195.0))
    with pytest.raises(HTTPException) as e:
        weigh_part_deboning_take(entry["id"], _meat_dto(10.0))
    assert e.value.status_code == 409
```

- [ ] **Step 2: Uruchom testy — mają PAŚĆ**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_deboning_take_weighings_db.py -v`
Expected: FAIL/ERROR — `ImportError: cannot import name 'weigh_part_deboning_take'`.

- [ ] **Step 3: Helpery + service.** W `deboning_service.py`, nad `create_deboning_take`, dodaj (kod `_add_meat_to_lot` i `_reattach_overnight_session` to wyniesione 1:1 fragmenty z `complete_deboning_take` — linie ~1041–1067 i ~1104–1142):

```python
def _sum_take_weighings(conn, entry_id: str) -> float:
    r = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_meat),0) AS kg FROM deboning_take_weighings WHERE entry_id=%s",
        (entry_id,),
    )
    return float(r["kg"] or 0)


def _insert_take_weighing(conn, entry_id: str, kg: float, dto) -> None:
    """Jedna porcja mięsa z pobrania = jeden wiersz (pełny audyt wagi per porcja)."""
    cx_execute(
        conn,
        "INSERT INTO deboning_take_weighings "
        "(id, entry_id, kg_meat, kg_gross, tare_cart_kg, tare_e2_kg, e2_count, weigh_mode) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (cuid(), entry_id, kg, dto.kg_gross, dto.tare_cart_kg,
         dto.tare_e2_kg, dto.e2_count, dto.weigh_mode),
    )


def _reattach_overnight_session(conn, entry: Dict, entry_id: str) -> None:
    """Pobranie „przeszło przez noc": sesja z dnia pobrania jest już
    zamknięta/zatwierdzona. Mięso waży się DZIŚ — przepinamy wpis do otwartej
    sesji rozbioru, zamiast blokować na zawsze (kg zeszło z partii, musi dać
    się zważyć). Wyniesione z complete_deboning_take — weigh-part potrzebuje
    identycznego zachowania."""
    if not entry.get("session_id"):
        return
    session_row = cx_query_one(
        conn, "SELECT status FROM production_sessions WHERE id=%s", (entry["session_id"],)
    )
    session_err = validate_session_writable(session_row)
    if not session_err:
        return
    open_s = cx_query_one(
        conn,
        "SELECT id FROM production_sessions WHERE process_type='deboning' "
        "AND status='open' ORDER BY started_at DESC LIMIT 1",
    )
    if not open_s:
        raise HTTPException(400, session_err)
    cx_execute(
        conn, "UPDATE deboning_entries SET session_id=%s WHERE id=%s",
        (open_s["id"], entry_id),
    )
    logger.info(
        "deboning.take.session_reassigned",
        extra={"entry_id": entry_id, "new_session_id": open_s["id"]},
    )


def _add_meat_to_lot(conn, entry: Dict, kg_meat: float, entry_id: str) -> None:
    """Dopisz kg mięsa do lotu partii (lot per numer partii, ON CONFLICT
    dolicza) + ruch IN. Wyniesione z complete_deboning_take, bo częściowe
    ważenie wpuszcza porcję na magazyn OD RAZU (mięso jedzie np. do
    masowania zanim pracownik dowiezie resztę)."""
    batch = cx_query_one(
        conn, "SELECT * FROM raw_batches WHERE id=%s", (entry["raw_batch_id"],)
    )
    recv = batch.get("received_date") if batch else None
    if recv:
        try:
            exp = (datetime.fromisoformat(str(recv)) + timedelta(days=7)).date().isoformat()
        except Exception:
            exp = batch.get("expiry_date") if batch else None
    else:
        exp = batch.get("expiry_date") if batch else None

    meat_lot_no = entry["raw_batch_no"]
    meat_stock_id = cuid()
    cx_execute(
        conn,
        """
        INSERT INTO meat_stock
            (id, lot_no, deboning_session_id, session_no,
             raw_batch_id, raw_batch_no, kg_initial, kg_available,
             production_date, expiry_date, status,
             material_type_id, material_name, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_DATE,%s,'AVAILABLE',%s,%s,%s)
        ON CONFLICT (lot_no) DO UPDATE
        SET kg_initial  = meat_stock.kg_initial  + EXCLUDED.kg_initial,
            kg_available = meat_stock.kg_available + EXCLUDED.kg_available
        """,
        (
            meat_stock_id, meat_lot_no, entry_id, entry["session_no"],
            entry["raw_batch_id"], meat_lot_no, kg_meat, kg_meat, exp,
            "mat-mieso-zs", "Mięso z/s", now_iso(),
        ),
    )
    ms_row = cx_query_one(conn, "SELECT id FROM meat_stock WHERE lot_no=%s", (meat_lot_no,))
    real_ms_id = ms_row["id"] if ms_row else meat_stock_id
    create_stock_movement(
        conn, product_type="meat", batch_id=real_ms_id, qty=kg_meat,
        movement_type="IN", source_type="deboning", source_id=entry_id,
    )


def weigh_part_deboning_take(entry_id: str, dto) -> Dict:
    """Częściowe ważenie mięsa z OTWARTEGO pobrania: porcja od razu wchodzi
    na lot mięsa, pobranie zostaje pending do dowiezienia reszty. Porcji
    może być dowolnie wiele; suma nie może przekroczyć pobranej ćwiartki.
    Surowca i ubocznych nie ruszamy — to robi faza 1 / domknięcie."""
    kg_part = float(dto.kg_meat)
    if kg_part <= 0:
        raise HTTPException(400, "Ilość mięsa musi być > 0")

    with transaction() as conn:
        entry = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not entry:
            raise HTTPException(404, "Pobranie nie znalezione")
        if (entry.get("status") or "complete") != "pending":
            raise HTTPException(409, "Pobranie już domknięte lub nie jest pobraniem")

        _reattach_overnight_session(conn, entry, entry_id)

        if dto.weigh_mode == "auto":
            weighing_err = validate_weighing_consistency(
                dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, kg_part
            )
            if weighing_err:
                raise HTTPException(400, weighing_err)

        kg_taken = float(entry.get("kg_quarter") or 0)
        weighed = _sum_take_weighings(conn, entry_id)
        if weighed + kg_part > kg_taken + 0.01:
            raise HTTPException(
                400,
                f"Mięso łącznie ({round(weighed + kg_part, 2)} kg) nie może "
                f"przekraczać pobranej ćwiartki ({kg_taken} kg)",
            )

        _insert_take_weighing(conn, entry_id, kg_part, dto)
        _add_meat_to_lot(conn, entry, kg_part, entry_id)

    logger.info(
        "deboning.take.part_weighed",
        extra={"entry_id": entry_id, "kg_part": kg_part,
               "kg_weighed_total": round(weighed + kg_part, 2)},
    )
    out = _map_deboning_entry(query_one("SELECT * FROM deboning_entries WHERE id=%s", (entry_id,)))
    out["kgMeatWeighed"] = round(weighed + kg_part, 2)
    return out
```

W `complete_deboning_take` zastąp wyniesione fragmenty wywołaniami: blok sesji (linie ~1041–1067) → `_reattach_overnight_session(conn, entry, entry_id)`; blok lotu+ruchu (linie ~1104–1142) → `_add_meat_to_lot(conn, entry, kg_meat, entry_id)` (zmienna `batch` do `_auto_finish_exhausted` — pobierz ją osobno przed wywołaniem helpera: `batch = cx_query_one(conn, "SELECT * FROM raw_batches WHERE id=%s", (entry["raw_batch_id"],))`).

- [ ] **Step 4: Route.** W `backend/app/routes/deboning.py` po handlerze `complete_deboning_take`:

```python
@router.post("/api/deboning/takes/{entry_id}/weigh-part")
def weigh_part_deboning_take(entry_id: str, dto: DeboningTakeComplete):
    """Częściowe ważenie mięsa — porcja na magazyn, pobranie zostaje otwarte."""
    return svc.weigh_part_deboning_take(entry_id, dto)
```

- [ ] **Step 5: Testy Taska 2 mają przejść** (test `409` używa complete — przechodzi już teraz, bo complete bez porcji działa jak dotąd)

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_deboning_take_weighings_db.py -v`
Expected: 3 passed.

- [ ] **Step 6: Regresja — cały pakiet backendu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/ -q`
Expected: wszystkie przechodzą (refaktor complete nie zmienia zachowania).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/deboning_service.py backend/app/routes/deboning.py backend/tests/test_deboning_take_weighings_db.py
git commit -m "feat: weigh-part — częściowe ważenie mięsa z otwartego pobrania"
```

---

### Task 3: Backend — `complete` sumuje porcje

**Files:**
- Modify: `backend/app/services/deboning_service.py` (`complete_deboning_take`)
- Test: `backend/tests/test_deboning_take_weighings_db.py`

**Interfaces:**
- Consumes: `_sum_take_weighings`, `_insert_take_weighing`, `_add_meat_to_lot` z Taska 2.
- Produces: `complete_deboning_take` — `dto.kg_meat` to OSTATNIA porcja; wpis dostaje `kg_meat` = suma porcji, na magazyn wchodzi tylko ostatnia porcja.

- [ ] **Step 1: Padający test** — dopisz do `test_deboning_take_weighings_db.py`:

```python
def test_complete_po_czesciach_sumuje_i_nie_dubluje_magazynu(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    complete_deboning_take(entry["id"], _meat_dto(95.0))  # ostatnia porcja
    row = query_one(
        "SELECT status, kg_meat, yield_pct, kg_remainder FROM deboning_entries WHERE id=%s",
        (entry["id"],),
    )
    assert row["status"] == "complete"
    assert float(row["kg_meat"]) == 195.0          # 100 + 95
    assert float(row["yield_pct"]) == 65.0          # 195/300
    assert float(row["kg_remainder"]) == 105.0
    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE lot_no='800'")
    assert float(lot["kg_available"]) == 195.0      # nie 100+195
    w = query_one("SELECT COUNT(*) AS n FROM deboning_take_weighings WHERE entry_id=%s", (entry["id"],))
    assert w["n"] == 2                              # obie porcje w historii


def test_complete_z_czesciami_waliduje_sume(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(200.0))
    with pytest.raises(HTTPException) as e:
        complete_deboning_take(entry["id"], _meat_dto(150.0))  # 350 > 300
    assert e.value.status_code == 400
```

- [ ] **Step 2: Uruchom — mają PAŚĆ**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_deboning_take_weighings_db.py -v`
Expected: 2 nowe FAIL (`kg_meat` = 95 zamiast 195; walidacja przepuszcza 150).

- [ ] **Step 3: Implementacja.** W `complete_deboning_take`, po walidacji `weigh_mode == "auto"` (która zostaje na PORCJI `kg_meat`), zastąp fragment liczący yield:

```python
        # dto.kg_meat = OSTATNIA porcja. Wcześniejsze częściowe ważenia
        # (weigh-part) weszły już na magazyn — wpis dostaje SUMĘ, magazyn
        # tylko porcję. Bez części: suma == porcja, zachowanie jak dotąd.
        kg_taken = float(entry.get("kg_quarter") or 0)
        kg_part = kg_meat
        kg_meat = round(_sum_take_weighings(conn, entry_id) + kg_part, 2)
        yield_err = validate_meat_yield(kg_taken, kg_meat)
        if yield_err:
            raise HTTPException(400, yield_err)
        _insert_take_weighing(conn, entry_id, kg_part, dto)
```

(dalej UPDATE wpisu liczy jak dotąd z `kg_meat` = suma), a wywołanie helpera lotu zmień na porcję: `_add_meat_to_lot(conn, entry, kg_part, entry_id)`. Log `deboning.take.completed` rozszerz o `"kg_part": kg_part`.

- [ ] **Step 4: Testy mają przejść + regresja**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_deboning_take_weighings_db.py tests/test_deboning_takes_db.py -v 2>/dev/null || TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/ -q`
Expected: PASS (jeśli `tests/test_deboning_takes_db.py` nie istnieje, sam pakiet).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/deboning_service.py backend/tests/test_deboning_take_weighings_db.py
git commit -m "feat: complete pobrania sumuje częściowe ważenia (magazyn bez dubli)"
```

---

### Task 4: Backend — storno i edycja pobrania z ważeniami

**Files:**
- Modify: `backend/app/services/deboning_service.py` (`delete_deboning_entry` gałąź pending ~linia 1284; `update_deboning_take` ~linia 985)
- Test: `backend/tests/test_deboning_take_weighings_db.py`

**Interfaces:**
- Consumes: `_sum_take_weighings` (Task 2).
- Produces: storno pendingu cofa też zważone porcje z lotu; edycja kg pobrania nie zejdzie poniżej sumy porcji.

- [ ] **Step 1: Padające testy:**

```python
def test_storno_pendingu_z_wazeniami_cofa_magazyn(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    delete_deboning_entry(entry["id"])
    assert query_one("SELECT id FROM deboning_entries WHERE id=%s", (entry["id"],)) is None
    assert query_one("SELECT id FROM meat_stock WHERE lot_no='800'") is None  # pusty lot znika
    b = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(b["kg_available"]) == 300.0
    assert query_one("SELECT id FROM deboning_take_weighings LIMIT 1") is None  # CASCADE
    assert query_one(
        "SELECT id FROM stock_movements WHERE source_type='deboning' AND source_id=%s LIMIT 1",
        (entry["id"],),
    ) is None


def test_storno_pendingu_blokada_gdy_mieso_zuzyte(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    # masowanie zabrało 60 kg z lotu — cofnięcie oddałoby mięso, którego nie ma
    execute("UPDATE meat_stock SET kg_available = 40 WHERE lot_no='800'")
    with pytest.raises(HTTPException) as e:
        delete_deboning_entry(entry["id"])
    assert e.value.status_code == 400


def test_edycja_pobrania_nie_zejdzie_ponizej_zwazonych(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    with pytest.raises(HTTPException) as e:
        update_deboning_take(entry["id"], SimpleNamespace(kg_taken=80.0))
    assert e.value.status_code == 400
    updated = update_deboning_take(entry["id"], SimpleNamespace(kg_taken=150.0))
    assert updated["kgTaken"] == 150.0
```

- [ ] **Step 2: Uruchom — mają PAŚĆ** (storno pendingu dziś nie rusza lotu; edycja przepuszcza 80).

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_deboning_take_weighings_db.py -v`
Expected: 3 nowe FAIL.

- [ ] **Step 3: Implementacja.** W `delete_deboning_entry`, w gałęzi pending (przed UPDATE raw_batches) dodaj:

```python
        # Pending z częściowymi ważeniami: porcje weszły już na lot mięsa —
        # storno musi je zdjąć (guard: mięso mogło pójść do masowania).
        weighed = _sum_take_weighings(conn, entry_id)
        if weighed > 0:
            meat_lot = cx_query_one(
                conn,
                "SELECT id, kg_initial, kg_available FROM meat_stock WHERE lot_no=%s FOR UPDATE",
                (entry.get("raw_batch_no"),),
            )
            if not meat_lot or float(meat_lot["kg_available"]) + 0.001 < weighed:
                raise HTTPException(
                    400, "Mięso z częściowych ważeń już zużyte — cofnięcie niemożliwe"
                )
            if float(meat_lot["kg_initial"]) - weighed <= 0.001:
                cx_execute(conn, "DELETE FROM meat_stock WHERE id=%s", (meat_lot["id"],))
            else:
                cx_execute(
                    conn,
                    "UPDATE meat_stock SET kg_initial = kg_initial - %s, "
                    "kg_available = GREATEST(0, kg_available - %s) WHERE id=%s",
                    (weighed, weighed, meat_lot["id"]),
                )
```

(istniejący `DELETE FROM stock_movements … source_id=%s` sprząta też ruchy IN porcji; wiersze ważeń kasuje FK CASCADE). W `update_deboning_take`, po wyliczeniu `old_kg`:

```python
        weighed = _sum_take_weighings(conn, entry_id)
        if new_kg + 0.01 < weighed:
            raise HTTPException(
                400,
                f"Nie można zmniejszyć do {new_kg} kg — zważono już "
                f"{round(weighed, 2)} kg mięsa z tego pobrania",
            )
```

- [ ] **Step 4: Testy mają przejść + regresja całego pakietu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/deboning_service.py backend/tests/test_deboning_take_weighings_db.py
git commit -m "fix: storno i edycja pobrania uwzględniają częściowe ważenia"
```

---

### Task 5: Backend — `kgMeatWeighed` w liście wpisów

**Files:**
- Modify: `backend/app/services/deboning_service.py` (`list_deboning_entries` ~linia 66)
- Test: `backend/tests/test_deboning_take_weighings_db.py`

**Interfaces:**
- Produces: każdy zwracany wpis pending ma pole `kgMeatWeighed: float` (0 gdy brak porcji); wpisy complete — bez pola (frontend traktuje brak jak 0). Task 7/8 czyta `kgMeatWeighed`.

- [ ] **Step 1: Padający test:**

```python
def test_lista_wpisow_ma_kg_meat_weighed_dla_pending(db):
    _seed_batch()
    entry = create_deboning_take(_take_dto())
    weigh_part_deboning_take(entry["id"], _meat_dto(100.0))
    rows = list_deboning_entries(None)
    mine = next(r for r in rows if r["id"] == entry["id"])
    assert mine["kgMeatWeighed"] == 100.0
```

Run: `… pytest tests/test_deboning_take_weighings_db.py -v` — Expected: FAIL (`KeyError: 'kgMeatWeighed'`).

- [ ] **Step 2: Implementacja.** Na końcu `list_deboning_entries` (wspólnie dla wszystkich gałęzi — zamień trzy `return` na zbudowanie `rows` i jeden wspólny epilog):

```python
    mapped = [_map_deboning_entry(r) for r in rows]
    # HMI pokazuje na kafelku „zważono X/Y kg" — suma porcji per OTWARTE
    # pobranie, jednym zapytaniem (bez N+1).
    pending_ids = [m["id"] for m in mapped if m.get("status") == "pending"]
    if pending_ids:
        sums = query_all(
            "SELECT entry_id, COALESCE(SUM(kg_meat),0) AS kg "
            "FROM deboning_take_weighings WHERE entry_id = ANY(%s) GROUP BY entry_id",
            (pending_ids,),
        )
        by_id = {s["entry_id"]: float(s["kg"]) for s in sums}
        for m in mapped:
            if m.get("status") == "pending":
                m["kgMeatWeighed"] = round(by_id.get(m["id"], 0.0), 2)
    return mapped
```

- [ ] **Step 3: Test ma przejść + regresja** — `… pytest tests/ -q` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/deboning_service.py backend/tests/test_deboning_take_weighings_db.py
git commit -m "feat: kgMeatWeighed na otwartych pobraniach w liście wpisów"
```

---

### Task 6: Backend — `/byproducts/today` z listą ważeń (suma z palet po `weighedAt`)

**Files:**
- Modify: `backend/app/services/batch_byproducts_service.py` (`today_totals` ~linia 207)
- Modify: `backend/tests/test_batch_byproducts_db.py` (test `test_today_totals_sumuje_dzisiejsze_wazenia` ~linia 138)

**Interfaces:**
- Produces: `today_totals() -> {"backsKg": float, "bonesKg": float, "weighings": [{"kind": "backs"|"bones", "rawBatchNo": str, "weighedAt": str, "tareLabel": str, "containers": int, "netKg": float}]}` — Task 9 renderuje `weighings` w modalu.

- [ ] **Step 1: Zaktualizuj istniejący test + dodaj nowy.** Nagłówek pliku: dorzuć do importów `from datetime import datetime, timezone` (obok `date, timedelta`). Podmień `test_today_totals_sumuje_dzisiejsze_wazenia` i dodaj test wielodniowy:

```python
def test_today_totals_sumuje_dzisiejsze_wazenia(db):
    _seed_batch_with_entries(internal_no="804")
    ensure_record("rb1")
    # suma liczy się z PALET (żywy kreator zawsze je wysyła) — frakcja
    # zapisana bez palet nie ma dnia, więc do „dziś" nie wchodzi
    record("rb1", "backs", 55.5, [
        {"tareLabel": "H1", "tareKg": 18, "containers": 4, "gross": 73.5, "net": 55.5},
    ])
    t = today_totals()
    assert t["backsKg"] == 55.5
    assert t["bonesKg"] == 0.0
    assert len(t["weighings"]) == 1
    w = t["weighings"][0]
    assert (w["kind"], w["rawBatchNo"], w["containers"], w["netKg"]) == ("backs", "804", 4, 55.5)
    assert w["tareLabel"] == "H1" and w["weighedAt"]


def test_today_totals_partia_wazona_przez_dwa_dni_liczy_tylko_dzis(db):
    _seed_batch_with_entries(internal_no="811")
    ensure_record("rb1")
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    # paleta z wczoraj przychodzi ze SWOIM stemplem (kreator odsyła całą
    # listę narastająco), nowa dostaje „teraz" w _stamp_pallets
    record("rb1", "bones", 700.0, [
        {"tareLabel": "H1", "tareKg": 18, "containers": 36, "gross": 518, "net": 500,
         "weighedAt": yesterday},
        {"tareLabel": "H1", "tareKg": 18, "containers": 14, "gross": 218, "net": 200},
    ])
    t = today_totals()
    assert t["bonesKg"] == 200.0  # stary kod dawał 700 (całe backs_kg po bones_at)
    assert [w["netKg"] for w in t["weighings"] if w["kind"] == "bones"] == [200.0]
```

- [ ] **Step 2: Uruchom — mają PAŚĆ**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_batch_byproducts_db.py -v`
Expected: nowy test FAIL (`bonesKg == 700`), zaktualizowany FAIL (`KeyError: 'weighings'`).

- [ ] **Step 3: Implementacja — podmień `today_totals`:**

```python
def today_totals() -> Dict[str, Any]:
    """Dzisiejsze ważenia grzbietów/kości (czas PL) — pasek dolny HMI + modal
    listy ważeń. Suma i lista liczone z PALET po ich weighedAt — partia
    ważona przez kilka dni rozlicza każdą paletę w JEJ dniu. Poprzednia
    wersja sumowała narastające backs_kg/bones_kg po backs_at/bones_at,
    przez co CAŁA frakcja wpadała do dnia OSTATNIEGO ważenia. Palety sprzed
    stemplowania (bez weighedAt) nie mogą być dzisiejsze — odpadają w WHERE."""
    rows = query_all(
        """
        SELECT bb.raw_batch_no, k.kind, p.pallet
        FROM batch_byproducts bb
        CROSS JOIN LATERAL (VALUES
            ('backs', bb.backs_pallets), ('bones', bb.bones_pallets)
        ) AS k(kind, pallets)
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(k.pallets, '[]'::jsonb)) AS p(pallet)
        WHERE ((p.pallet->>'weighedAt')::timestamptz AT TIME ZONE 'Europe/Warsaw')::date
              = (now() AT TIME ZONE 'Europe/Warsaw')::date
        ORDER BY (p.pallet->>'weighedAt')::timestamptz
        """
    )
    weighings: List[Dict[str, Any]] = []
    backs = bones = 0.0
    for r in rows:
        p = r["pallet"] or {}
        net = float(p.get("net") or 0)
        if r["kind"] == "backs":
            backs += net
        else:
            bones += net
        weighings.append({
            "kind": r["kind"],
            "rawBatchNo": r["raw_batch_no"],
            "weighedAt": p.get("weighedAt"),
            "tareLabel": p.get("tareLabel") or "",
            "containers": int(p.get("containers") or 0),
            "netKg": round(net, 2),
        })
    return {"backsKg": round(backs, 2), "bonesKg": round(bones, 2), "weighings": weighings}
```

- [ ] **Step 4: Testy mają przejść + regresja** — `… pytest tests/ -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/batch_byproducts_service.py backend/tests/test_batch_byproducts_db.py
git commit -m "feat: today ubocznych z palet po weighedAt + lista ważeń dla HMI"
```

---

### Task 7: Frontend — funkcja decyzji + warstwa api/hooki

**Files:**
- Create: `src/features/deboning/utils/partialWeighing.ts`
- Create: `src/features/deboning/utils/partialWeighing.test.ts`
- Modify: `src/features/deboning/utils/index.ts` (re-export)
- Modify: `src/features/deboning/types/index.ts` (`kgMeatWeighed`, `WeighPartTakeDto`)
- Modify: `src/lib/api.ts` (`deboningEntriesApi.weighPart`, typ `byproductsApi.today`, `ByproductTodayWeighing`)
- Modify: `src/features/deboning/api/index.ts` (`weighPart` w kontrakcie i implementacji)
- Modify: `src/features/deboning/hooks/index.ts` (`weighPart` + `weighPartLoading` w `useDeboningEntries`)

**Interfaces:**
- Produces (dla Tasków 8–9):
  - `PARTIAL_ASK_BELOW_PCT = 63`, `type TakeSaveDecision = 'block' | 'ask' | 'complete'`, `decideTakeSave(weighedKg: number, portionKg: number, takenKg: number): TakeSaveDecision`
  - `DeboningEntry.kgMeatWeighed?: number`; `type WeighPartTakeDto = CompleteDeboningTakeDto`
  - hook: `weighPart(entryId: string, dto: WeighPartTakeDto, session): Promise<string | null>`, `weighPartLoading: boolean`
  - `export interface ByproductTodayWeighing { kind: 'backs' | 'bones'; rawBatchNo: string; weighedAt: string; tareLabel: string; containers: number; netKg: number }` w `src/lib/api.ts`; `byproductsApi.today()` zwraca `{ backsKg, bonesKg, weighings: ByproductTodayWeighing[] }`.

- [ ] **Step 1: Padający test** — `src/features/deboning/utils/partialWeighing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideTakeSave } from './partialWeighing'

describe('decideTakeSave — jeden przycisk ZAPISZ + pytanie z %', () => {
  it('blokuje, gdy suma z już zważonym przekracza pobranie', () => {
    expect(decideTakeSave(100, 250, 300)).toBe('block')
  })
  it('blokuje bez porcji lub bez pobrania', () => {
    expect(decideTakeSave(0, 0, 300)).toBe('block')
    expect(decideTakeSave(0, 10, 0)).toBe('block')
  })
  it('pyta poniżej 63% (scenariusz z hali: 100 z 300 = 33%)', () => {
    expect(decideTakeSave(0, 100, 300)).toBe('ask')
  })
  it('pyta też przy kolejnej porcji, gdy łącznie wciąż < 63%', () => {
    expect(decideTakeSave(100, 60, 300)).toBe('ask') // 53%
  })
  it('domyka bez pytania w paśmie: 100 + 95 z 300 = 65%', () => {
    expect(decideTakeSave(100, 95, 300)).toBe('complete')
  })
  it('próg dokładnie 63% domyka bez pytania', () => {
    expect(decideTakeSave(0, 189, 300)).toBe('complete')
  })
})
```

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/deboning/utils/partialWeighing.test.ts`
Expected: FAIL — moduł nie istnieje.

- [ ] **Step 2: Implementacja** — `src/features/deboning/utils/partialWeighing.ts`:

```ts
/**
 * partialWeighing.ts — decyzja po ZAPISZ w trybie domykania pobrania.
 *
 * Wariant „jeden przycisk + pytanie z %" (decyzja użytkownika 2026-07-18):
 * łączny % (zważone porcje + bieżąca) / pobrane >= 63 → domknij od razu;
 * poniżej → dialog „część czy całość?". 63 = dolna granica normy uzysku
 * 63–68% z hali. Świadome ryzyko: część o % w normie (200/300) domknie się
 * bez pytania — ratunkiem korekta z biura (POST /deboning/entries/{id}/correct).
 */
export const PARTIAL_ASK_BELOW_PCT = 63

export type TakeSaveDecision = 'block' | 'ask' | 'complete'

export function decideTakeSave(weighedKg: number, portionKg: number, takenKg: number): TakeSaveDecision {
  if (takenKg <= 0 || portionKg <= 0) return 'block'
  if (weighedKg + portionKg > takenKg) return 'block'
  const pct = ((weighedKg + portionKg) / takenKg) * 100
  return pct >= PARTIAL_ASK_BELOW_PCT ? 'complete' : 'ask'
}
```

W `src/features/deboning/utils/index.ts` dopisz `export * from './partialWeighing'` (obok istniejących eksportów).

- [ ] **Step 3: Test ma przejść** — `npx vitest run src/features/deboning/utils/partialWeighing.test.ts` → 6 passed.

- [ ] **Step 4: Typy + api + hook.**

`src/features/deboning/types/index.ts` — w `DeboningEntry` po `completedAt` dopisz:

```ts
  /** Suma porcji z częściowych ważeń (tylko pending; complete ma sumę w kgMeat). */
  readonly kgMeatWeighed?: number
```

oraz po `CompleteDeboningTakeDto`:

```ts
/** Częściowe ważenie mięsa — te same pola co domknięcie (porcja + audyt wagi). */
export type WeighPartTakeDto = CompleteDeboningTakeDto
```

`src/lib/api.ts` — w `deboningEntriesApi` po `completeTake`:

```ts
  // weighPart — częściowe ważenie mięsa: porcja na magazyn, pobranie zostaje otwarte
  weighPart: (id: string, dto: any) => post<any>(`/deboning/takes/${id}/weigh-part`, {
    ...toSnake(dto),
    kgMeat: dto.kgMeat,
  }),
```

oraz nad `BatchByproducts`:

```ts
/** Jedno dzisiejsze ważenie frakcji (paleta z kreatora) — modal dolnego paska HMI. */
export interface ByproductTodayWeighing {
  kind: 'backs' | 'bones'; rawBatchNo: string; weighedAt: string
  tareLabel: string; containers: number; netKg: number
}
```

i podmień typ `today`:

```ts
  today: () => get<{ backsKg: number; bonesKg: number; weighings: ByproductTodayWeighing[] }>('/deboning/byproducts/today'),
```

`src/features/deboning/api/index.ts` — do interfejsu `DeboningApi` po `completeTake`: `weighPart(entryId: string, dto: CompleteDeboningTakeDto): Promise<DeboningEntry>`; w implementacji: `weighPart: (id, dto) => entriesStore.weighPart(id, dto),`.

`src/features/deboning/hooks/index.ts` — w `useDeboningEntries` po `completeTakeMutation`:

```ts
  const weighPartMutation = useMutation(
    ({ id, dto }: { id: string; dto: WeighPartTakeDto }) => deboningApi.weighPart(id, dto)
  )

  // Częściowe ważenie mięsa — porcja na magazyn, pobranie zostaje otwarte
  const weighPart = useCallback(async (
    entryId: string,
    dto: WeighPartTakeDto,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    if (session?.status !== 'open') return 'Ważenie możliwe tylko przy otwartej sesji'
    if (dto.kgMeat <= 0) return 'Ilość mięsa musi być > 0'
    try {
      await weighPartMutation.mutate({ id: entryId, dto })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd częściowego ważenia'
    }
  }, [weighPartMutation, refetch])
```

Import `WeighPartTakeDto` z `../types`; w `return` hooka dodaj `weighPart` i `weighPartLoading: weighPartMutation.loading`.

- [ ] **Step 5: Typecheck** — `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck` → bez błędów.

- [ ] **Step 6: Commit**

```bash
git add src/features/deboning/utils/partialWeighing.ts src/features/deboning/utils/partialWeighing.test.ts src/features/deboning/utils/index.ts src/features/deboning/types/index.ts src/features/deboning/api/index.ts src/features/deboning/hooks/index.ts src/lib/api.ts
git commit -m "feat: decyzja część/całość + weighPart w warstwie api/hooków"
```

---

### Task 8: HMI — dialog część/całość, kafelki „zważono X/Y"

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx`

**Interfaces:**
- Consumes: `decideTakeSave` (import z `@/features/deboning/utils`), `weighPart`/`weighPartLoading` z hooka, `kgMeatWeighed` na wpisach pending.

- [ ] **Step 1: Stan i pochodne.** Po `const [resumeId, setResumeId] = useState<string | null>(null)` dodaj:

```tsx
  // Dialog „część czy całość?" — łączny % poniżej normy (63) po ZAPISZ.
  const [partialPrompt, setPartialPrompt] = useState<{ portionKg: number; weighedKg: number; takenKg: number } | null>(null)
```

Po destrukturyzacji hooka dopisz `weighPart, weighPartLoading` (rozszerz istniejącą linię `const { entries, addEntry, ... } = useDeboningEntries(...)`). Pod `pendingKgByBatch` (linia ~528) dodaj:

```tsx
  // Domykane pobranie + suma już zważonych porcji (kgMeatWeighed z listy).
  const resumeEntry = useMemo(
    () => (resumeId ? (pendingTakes.find(p => p.id === resumeId) as DeboningEntry | undefined) ?? null : null),
    [resumeId, pendingTakes],
  )
  const resumeWeighedKg = Number(resumeEntry?.kgMeatWeighed ?? 0)
```

Podmień `meatTooBig` (linia ~639) na sumę z porcjami:

```tsx
  const meatTooBig = taken > 0 && resumeWeighedKg + meat > taken
```

W `pendingKgByBatch` odejmuj zważone (kafel partii „czeka na mięso" pokazuje to, co FAKTYCZNIE jeszcze wróci na wagę): `m.set(bid, (m.get(bid) ?? 0) + Number((e as any).kgTaken || 0) - Number((e as any).kgMeatWeighed || 0))`.

- [ ] **Step 2: Decyzja po ZAPISZ.** Zmień `handleCompleteTake`: wydziel obecne ciało do `doCompleteTake` i dodaj rozgałęzienie:

```tsx
  // ZAPISZ w trybie domykania: jeden przycisk — o „część czy całość" decyduje
  // łączny % (wariant wybrany 2026-07-18; szczegóły w utils/partialWeighing).
  async function handleCompleteTake() {
    if (completeTakeLoading || weighPartLoading || !resumeId || meat <= 0 || meatTooBig || !session) return
    if (decideTakeSave(resumeWeighedKg, meat, taken) === 'ask') {
      setPartialPrompt({ portionKg: meat, weighedKg: resumeWeighedKg, takenKg: taken })
      return
    }
    await doCompleteTake()
  }

  async function doCompleteTake() {
    setPartialPrompt(null)
    // … DOTYCHCZASOWE ciało handleCompleteTake bez pierwszej linii guardów …
  }

  // Porcja zapisana, pobranie zostaje otwarte — mięso od razu na magazynie.
  async function handleWeighPart() {
    if (weighPartLoading || !resumeId || meat <= 0 || !session) return
    const portion = meat
    const takenNow = taken
    const err = await weighPart(resumeId, {
      kgMeat: portion,
      ...(scale.available ? {
        weighMode: autoMode ? 'auto' as const : 'manual' as const,
        ...(autoMode ? {
          kgGross: scale.gross,
          tareCartKg: cartTareTotal ?? undefined,
          tareE2Kg: weighing.tareE2Kg,
          e2Count,
        } : {}),
      } : {}),
    }, session)
    if (err) { showToast(err, 'err'); return }
    setPartialPrompt(null)
    setResumeId(null)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    showToast(`Zapisano ${fmtKg(portion, 1)} kg — razem ${fmtKg(resumeWeighedKg + portion, 1)}/${fmtKg(takenNow, 1)} kg, pobranie otwarte`)
  }
```

W `doCompleteTake` zostają guardy `if (!resumeId || !session) return` (bez warunków wagi — sprawdzone przed dialogiem).

- [ ] **Step 3: Dialog.** Obok modala `finishPrompt` (po nim) dodaj:

```tsx
      {/* Częściowe ważenie: łączny % poniżej normy — część czy całość? */}
      {partialPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center flex-shrink-0" style={{ borderRadius: 12, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}><Scale size={26} /></div>
              <div>
                <h3 className="font-extrabold text-xl">
                  Zważono łącznie {fmtKg(partialPrompt.weighedKg + partialPrompt.portionKg, 1)} z {fmtKg(partialPrompt.takenKg, 1)} kg
                </h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>
                  To {fmtPct((partialPrompt.weighedKg + partialPrompt.portionKg) / partialPrompt.takenKg * 100, 0)} pobrania — czy to już całość?
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={handleWeighPart} disabled={weighPartLoading}
                className="h-14 text-base font-bold flex items-center justify-center gap-3" style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
                {weighPartLoading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Clock size={20} />}
                DOWIOZĄ RESZTĘ — zapisz część
              </button>
              <button type="button" onClick={() => { void doCompleteTake() }} disabled={completeTakeLoading}
                className="h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
                TO CAŁOŚĆ — zamknij pobranie
              </button>
              <button type="button" onClick={() => setPartialPrompt(null)}
                className="h-10 text-sm font-bold" style={{ borderRadius: 10, color: 'var(--mut)' }}>
                Wróć
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Kafelki i nagłówek.**
  1. `pendingByWorker` (linia ~724): w akumulatorze dodaj `weighedKg` — inicjalnie `Number((e as any).kgMeatWeighed || 0)`, w gałęzi `cur`: `cur.weighedKg += Number((e as any).kgMeatWeighed || 0)`; typ mapy rozszerz o `weighedKg: number`.
  2. `WorkerTileV10`: nowy prop `pendingWeighedKg?: number`; podmień treść plakietki (linia ~265):

```tsx
          ⏳ {pendingBatchNo ? `${pendingBatchNo} · ` : ''}
          {(pendingWeighedKg ?? 0) > 0
            ? `zważono ${fmtKg(pendingWeighedKg ?? 0, 0)}/${fmtKg(pendingKg ?? 0, 0)} kg`
            : `${fmtKg(pendingKg ?? 0, 1)} kg`}
```

  W miejscu użycia kafelka przekaż `pendingWeighedKg={pending?.weighedKg}` (tam gdzie idzie `pendingKg={pending?.totalKg}`).
  3. Pole „Pobrano (z pobrania)" (linia ~1476): `sub={resumeId ? (resumeWeighedKg > 0 ? `zważono już ${fmtKg(resumeWeighedKg, 1)} kg — waż resztę` : 'zablokowane — zważ mięso') : …}` (reszta ternara bez zmian).

- [ ] **Step 5: Typecheck + testy frontu**

Run: `npm run typecheck && npx vitest run src/features/deboning`
Expected: bez błędów; testy przechodzą.

- [ ] **Step 6: Weryfikacja w przeglądarce (dev).** `npm run dev` + Playwright/przeglądarka na stronie HMI v10 (wejście przez `/rozbior-v10.html` lub odpowiedni entry dev): scenariusz — pobranie 300 kg → klik kafelka pracownika → wpisz 100 kg (tryb ręczny) → ZAPISZ → dialog „część/całość" → „DOWIOZĄ RESZTĘ" → kafelek pokazuje „zważono 100/300 kg" → ponowny klik → wpisz 95 → ZAPISZ → domyka bez pytania (65%). Sprawdź stan magazynu mięsa po części (Magazyn mięsa w biurze: lot partii +100 kg).

- [ ] **Step 7: Commit**

```bash
git add src/pages/tablet/DeboningHmiV10Page.tsx
git commit -m "feat: HMI — częściowe ważenia pobrania (dialog część/całość, kafelki X/Y)"
```

---

### Task 9: HMI — modal ważeń ubocznych z dolnego paska

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx` (pasek dolny ~linia 1831; modale obok `statsModal`)

**Interfaces:**
- Consumes: `byprodToday.data.weighings` (`ByproductTodayWeighing` z Taska 7 — import typu z `@/lib/apiClient` lub `@/lib/api` zgodnie z istniejącym importem `BatchByproducts`).

- [ ] **Step 1: Stan + kafelki jako przyciski.** Dodaj stan `const [byprodModal, setByprodModal] = useState<'backs' | 'bones' | null>(null)`. Podmień tablicę paska dolnego (linie ~1832–1844) — Grzbiety/Kości czytają TYLKO `byprodToday` (jedno źródło = `batch_byproducts`; dotychczasowe dodawanie `shift.totBacks/totBones` dublowałoby ręczne zakończenie partii, które zapisuje te same kg jako paletę „ręcznie") i dostają `onTap`:

```tsx
        {([
          { label: 'Ćwiartka pobrana dzisiaj', val: `${fmtKg(shift.totTaken, 0)} kg` },
          { label: 'Mięso',         val: `${fmtKg(shift.totMeat, 0)} kg` },
          { label: 'Wydajność dnia', val: shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—', color: yieldInk(shift.yieldPct) },
          { label: 'Grzbiety',      val: `${fmtKg(byprodToday.data?.backsKg ?? 0, 0)} kg`, onTap: () => setByprodModal('backs') },
          { label: 'Kości',         val: `${fmtKg(byprodToday.data?.bonesKg ?? 0, 0)} kg`, onTap: () => setByprodModal('bones') },
          { label: 'Wpisy',         val: String(completeEntries.length) },
        ] as { label: string; val: string; color?: string; onTap?: () => void }[]).map(c => c.onTap ? (
          <button key={c.label} type="button" onClick={c.onTap}
            className="flex flex-col items-center justify-center px-1 text-center active:scale-95 transition-transform"
            style={{ borderRight: '1px solid var(--lineSoft)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none" style={{ color: c.color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--accent)' }}>{c.label} ▸</span>
          </button>
        ) : (
          <div key={c.label} className="flex flex-col items-center justify-center px-1 text-center" style={{ borderRight: '1px solid var(--lineSoft)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none" style={{ color: c.color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--mut)' }}>{c.label}</span>
          </div>
        ))}
```

- [ ] **Step 2: Modal listy ważeń** (obok `statsModal`, ten sam wzór 720 px):

```tsx
      {byprodModal && (() => {
        const rows = (byprodToday.data?.weighings ?? []).filter(w => w.kind === byprodModal)
        const sumKg = rows.reduce((s, w) => s + w.netKg, 0)
        const sumCont = rows.reduce((s, w) => s + (w.containers || 0), 0)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={VARS}>
            <div className="w-[720px] max-h-[80vh] flex flex-col" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
              <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--lineSoft)' }}>
                <Scale size={22} style={{ color: 'var(--accent)' }} />
                <h3 className="font-extrabold text-xl flex-1">{byprodModal === 'backs' ? 'Grzbiety' : 'Kości'} — ważenia dzisiaj</h3>
                <button type="button" onClick={() => setByprodModal(null)} className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={18} /></button>
              </div>
              <div className="overflow-y-auto flex-1">
                {rows.length === 0 ? (
                  <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--mut)' }}>Brak ważeń dzisiaj</div>
                ) : rows.map((w, i) => (
                  <div key={`${w.weighedAt}-${i}`} className="grid grid-cols-[100px_64px_1fr_110px_90px_110px] items-center px-6 py-3.5" style={{ borderTop: i > 0 ? '1px solid var(--lineSoft)' : undefined }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>Ważenie {i + 1}</span>
                    <span className="hmi-v10-mono text-sm">{new Date(w.weighedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="hmi-v10-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>{w.rawBatchNo}</span>
                    <span className="text-sm font-semibold truncate">{w.tareLabel || '—'}</span>
                    <span className="hmi-v10-mono text-sm text-right">{w.containers > 0 ? `${w.containers} poj.` : '—'}</span>
                    <span className="hmi-v10-mono text-base font-bold text-right">{fmtKg(w.netKg, 1)} kg</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
                <span className="text-sm font-bold uppercase" style={{ color: 'var(--mut)' }}>
                  Suma dnia · {rows.length} ważeń{sumCont > 0 ? ` · ${sumCont} poj.` : ''}
                </span>
                <span className="hmi-v10-mono text-2xl font-extrabold">{fmtKg(sumKg, 1)} kg</span>
              </div>
            </div>
          </div>
        )
      })()}
```

- [ ] **Step 3: Typecheck + weryfikacja w przeglądarce.** `npm run typecheck`; w dev: kafelek „Kości" → modal z wierszami (godzina, partia, wózek, poj., kg), suma stopki = liczba na kafelku; pusty dzień → „Brak ważeń dzisiaj".

- [ ] **Step 4: Commit**

```bash
git add src/pages/tablet/DeboningHmiV10Page.tsx
git commit -m "feat: HMI — lista dzisiejszych ważeń ubocznych z dolnego paska"
```

---

### Task 10: Weryfikacja końcowa

**Files:** brak nowych — uruchomienia i ewentualne poprawki.

- [ ] **Step 1: Pełny pakiet backendu** — `cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest tests/ -q` → PASS.
- [ ] **Step 2: Pełny front** — `npm test && npm run typecheck && npm run build` → PASS/bez błędów.
- [ ] **Step 3: Przejdź scenariusz spec end-to-end w dev** (skill `verify`): pobranie → część 100 (dialog, „dowiozą") → magazyn mięsa +100 → reszta 95 → domknięte 65%, statystyki liczą wpis raz; kafelki ubocznych = modal.
- [ ] **Step 4: Commit poprawek, jeśli były.** Wdrożenie (poza planem, na żądanie użytkownika): pre-deploy diff prod↔repo, cp `app/` + restart backendu, tag `rozbior-v10-*` z bumpem wersji w `tauri.rozbior-v10.conf.json`.
