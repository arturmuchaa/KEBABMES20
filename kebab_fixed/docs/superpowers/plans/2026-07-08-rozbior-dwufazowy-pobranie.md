# Rozbiór dwufazowy (pobranie → mięso) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umożliwić operatorowi rozbioru zapisanie samego pobrania ćwiartki teraz, a zważenie wykrojonego mięsa później — bez zmiany dotychczasowego zapisu „od razu".

**Architecture:** Istniejąca tabela `deboning_entries` dostaje kolumnę `status` (`pending`/`complete`). Atomowe `create_deboning_entry` jest rozcięte na dwie fazy: `create_deboning_take` (zdejmuje surowiec z partii, wiersz `pending`, bez lotu mięsa) i `complete_deboning_take` (dopisuje mięso, tworzy lot + ABP, `complete`). HMI v10 (`DeboningHmiV10Page`, wspólny komponent kiosku produkcyjnego v10 = wersja 1.0.4x) dostaje przycisk „Zapisz pobranie" i kafelki otwartych pobrań, które po kliknięciu wracają do formularza z zablokowaną ćwiartką.

**Tech Stack:** Backend FastAPI + psycopg2 (surowy SQL, transakcje), pytest (czyste funkcje + integracja `db` z `TEST_DATABASE_URL`). Frontend React + TypeScript + Vite, vitest.

## Global Constraints

- Kanoniczne źródło: `/opt/kebab/kebab_new/kebab_fixed/` (NIE `/root/kebab_fixed_work/`).
- Migracje MUSZĄ być idempotentne: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Backend zmiany robione inline (subagenty nie piszą do `backend/`).
- Nie używać zarezerwowanych kluczy LogRecord (`created`, `filename`, `module`, `name`…) w `logger ... extra=`.
- Dotychczasowy zapis „od razu" (`create_deboning_entry`, `POST /api/deboning/entries`) pozostaje NIETKNIĘTY funkcjonalnie.
- Sanity-check wydajności 30–95% obowiązuje przy domknięciu mięsem (tak jak dziś przy zapisie od razu).
- Wpisy `pending` (kg_meat=0) są wykluczone ze statystyk/podsumowań; surowiec partii JEST już pomniejszony (zamierzone).
- Testy DB uruchamiane tylko z `TEST_DATABASE_URL` wskazującym bazę `kebab_mes_test`; bez niej `skip`.
- Spec: `docs/superpowers/specs/2026-07-08-rozbior-dwufazowy-pobranie-design.md`.

---

## File Structure

- `backend/app/migrations.py` — dopisanie kolumny `status`.
- `backend/app/models/deboning.py` — nowe DTO `DeboningTakeCreate`, `DeboningTakeComplete`.
- `backend/app/services/deboning_service.py` — `validate_meat_yield` (extract), `create_deboning_take`, `complete_deboning_take`, obsługa `pending` w `delete_deboning_entry`, filtr `status='complete'` w `deboning_stats`, `status` w `_map_deboning_entry`.
- `backend/app/routes/deboning.py` — trasy `POST /api/deboning/takes`, `POST /api/deboning/takes/{id}/complete`.
- `backend/tests/test_deboning_yield.py` — testy czystej funkcji `validate_meat_yield`.
- `backend/tests/test_deboning_takes_db.py` — testy integracyjne dwufazowego przepływu.
- `src/lib/api.ts` — `deboningEntriesApi.createTake`, `.completeTake`.
- `src/lib/mockApi.ts` — mock `createTake`, `completeTake`.
- `src/features/deboning/types/index.ts` — `status` w `DeboningEntry`; DTO typy take.
- `src/features/deboning/api/index.ts` — kontrakt + delegacja `createTake`/`completeTake`.
- `src/features/deboning/hooks/index.ts` — `addTake`, `completeTake` w `useDeboningEntries`.
- `src/features/deboning/utils/index.ts` — `splitEntriesByStatus`; `calcSessionSummary` liczy tylko `complete`.
- `src/features/deboning/utils/deboning-status.test.ts` — vitest dla `splitEntriesByStatus` + `calcSessionSummary`.
- `src/pages/tablet/DeboningHmiV10Page.tsx` — przycisk pobrania, kafelki pending, wznowienie do domknięcia.
- `src-tauri/tauri.rozbior-v10.conf.json` — bump wersji kiosku (release).

---

## Task 1: Kolumna `status` + czysta walidacja wydajności

**Files:**
- Modify: `backend/app/migrations.py` (lista `STATEMENTS`, sekcja deboning ~113-117)
- Modify: `backend/app/services/deboning_service.py` (`_map_deboning_entry` ~30-58; `create_deboning_entry` ~347-362)
- Test: `backend/tests/test_deboning_yield.py` (create)

**Interfaces:**
- Produces: `validate_meat_yield(kg_taken: float, kg_meat: float) -> str | None` — zwraca komunikat błędu albo None. Reguły: `kg_meat <= 0` → błąd; `kg_meat > kg_taken` → błąd; yield `>95%` → błąd „nierealna"; yield `<30%` → błąd „bardzo niska".
- Produces: kolumna `deboning_entries.status` (`'pending'`/`'complete'`, default `'complete'`); `_map_deboning_entry` zwraca pole `status`.

- [ ] **Step 1: Write the failing test**

Utwórz `backend/tests/test_deboning_yield.py`:

```python
"""Czysta walidacja wydajności rozbioru — wspólna dla zapisu 'od razu'
i domknięcia pobrania mięsem. Bez bazy."""
from app.services.deboning_service import validate_meat_yield


def test_prawidlowa_wydajnosc_przechodzi():
    assert validate_meat_yield(100.0, 70.0) is None


def test_mieso_zero_blokuje():
    assert validate_meat_yield(100.0, 0.0)


def test_mieso_wieksze_niz_cwiartka_blokuje():
    err = validate_meat_yield(100.0, 120.0)
    assert err and "ćwiartk" in err


def test_wydajnosc_powyzej_95_blokuje():
    err = validate_meat_yield(100.0, 96.0)
    assert err and "nierealna" in err


def test_wydajnosc_ponizej_30_blokuje():
    err = validate_meat_yield(100.0, 20.0)
    assert err and "niska" in err
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_deboning_yield.py -v`
Expected: FAIL — `ImportError: cannot import name 'validate_meat_yield'`

- [ ] **Step 3: Extract the pure validator and refactor create to use it**

W `backend/app/services/deboning_service.py`, dodaj funkcję obok innych walidatorów (np. po `validate_batch_expiry`):

```python
def validate_meat_yield(kg_taken: float, kg_meat: float) -> str | None:
    """Sanity mięsa vs pobranej ćwiartki. Czysta funkcja — testy bez DB.

    Wspólna dla zapisu 'od razu' i domknięcia pobrania. Reguły identyczne
    jak dotąd inline w create_deboning_entry.
    """
    kg_taken = float(kg_taken or 0)
    kg_meat = float(kg_meat or 0)
    if kg_meat <= 0:
        return "Ilość mięsa musi być > 0"
    if kg_taken <= 0:
        return "Ilość pobranej ćwiartki musi być > 0"
    if kg_meat > kg_taken:
        return (
            f"Mięso ({kg_meat} kg) nie może przekraczać pobranej "
            f"ćwiartki ({kg_taken} kg)"
        )
    yield_pct = (kg_meat / kg_taken) * 100
    if yield_pct > 95:
        return f"Wydajność {round(yield_pct, 1)}% jest nierealna — sprawdź dane"
    if yield_pct < 30:
        return f"Wydajność {round(yield_pct, 1)}% jest bardzo niska — sprawdź dane"
    return None
```

W `create_deboning_entry` zastąp blok inline (`if kg_meat <= 0` … `Wydajność … bardzo niska`, ~346-362) wywołaniem:

```python
    yield_err = validate_meat_yield(kg_taken, kg_meat)
    if yield_err:
        raise HTTPException(400, yield_err)
    yield_pct_val = (kg_meat / kg_taken) * 100
```

(Zostaw wcześniejszy `if kg_taken <= 0:` guard, bo `validate_meat_yield` też go łapie — duplikat jest nieszkodliwy; albo usuń starszy, byle `kg_taken<=0` dawało 400.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python3 -m pytest tests/test_deboning_yield.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Add migration + status in mapper**

W `backend/app/migrations.py`, w sekcji deboning (obok `ADD COLUMN IF NOT EXISTS weigh_mode`) dopisz:

```python
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete'",
```

W `_map_deboning_entry` (deboning_service.py) dodaj do zwracanego dict (np. po `weighMode`):

```python
        "status": row.get("status") or "complete",
```

- [ ] **Step 6: Verify existing deboning tests still pass**

Run: `cd backend && python3 -m pytest tests/test_deboning_guards.py tests/test_deboning_weighing.py tests/test_deboning_yield.py -v`
Expected: PASS (wszystkie)

- [ ] **Step 7: Commit**

```bash
git add backend/app/migrations.py backend/app/services/deboning_service.py backend/tests/test_deboning_yield.py
git commit -m "feat(rozbior): kolumna status + czysta walidacja wydajności validate_meat_yield"
```

---

## Task 2: Backend — pobranie (`create_deboning_take`)

**Files:**
- Modify: `backend/app/models/deboning.py` (dodaj `DeboningTakeCreate`)
- Modify: `backend/app/services/deboning_service.py` (dodaj `create_deboning_take`)
- Modify: `backend/app/routes/deboning.py` (trasa `POST /api/deboning/takes`)
- Test: `backend/tests/test_deboning_takes_db.py` (create)

**Interfaces:**
- Consumes: `validate_session_writable`, `validate_batch_expiry`, `next_dated_no`, `create_stock_movement`, `_map_deboning_entry` (z Task 1).
- Produces: `create_deboning_take(dto: DeboningTakeCreate) -> Dict` — wstawia wiersz `status='pending'`, `kg_meat=0`, `kg_quarter=kg_taken`; pomniejsza `raw_batches.kg_available` o `kg_taken`; ruch OUT. Zwraca zmapowany wpis (`status='pending'`).
- Produces: DTO `DeboningTakeCreate` — pola jak `DeboningEntryCreate` MINUS `kg_meat`; wymaga `raw_batch_id` + (`kg_taken` lub `kg_quarter`) > 0.

- [ ] **Step 1: Write the failing test**

Utwórz `backend/tests/test_deboning_takes_db.py`:

```python
"""Dwufazowy rozbiór: pobranie (pending) → domknięcie mięsem → storno.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from app.db import query_one
from app.models.deboning import DeboningTakeCreate
from app.services.deboning_service import create_deboning_take
from app.utils.ids import now_iso
from app.db import execute


def _seed_cwiartka_batch(batch_id="rb1", internal_no="700", kg=100.0):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "Dostawca", kg, kg, now_iso()),
    )


def test_take_tworzy_wpis_pending_bez_miesa(db):
    _seed_cwiartka_batch(internal_no="700", kg=100.0)
    entry = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    assert entry["status"] == "pending"
    assert entry["kgTaken"] == 60.0
    assert entry["kgMeat"] == 0
    row = query_one("SELECT status, kg_meat FROM deboning_entries WHERE id=%s", (entry["id"],))
    assert row["status"] == "pending"


def test_take_zdejmuje_surowiec_z_partii(db):
    _seed_cwiartka_batch(internal_no="701", kg=100.0)
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 40.0


def test_take_nie_tworzy_lotu_miesa(db):
    _seed_cwiartka_batch(internal_no="702", kg=100.0)
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    ms = query_one("SELECT id FROM meat_stock WHERE lot_no='702'")
    assert ms is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_deboning_takes_db.py -v`
Expected: FAIL — `ImportError: cannot import name 'DeboningTakeCreate'` (lub skip bez TEST_DATABASE_URL — wtedy uruchom po ustawieniu zmiennej wg conftest)

- [ ] **Step 3: Add DTO**

W `backend/app/models/deboning.py` dodaj:

```python
class DeboningTakeCreate(BaseModel):
    """POST /api/deboning/takes — pobranie ćwiartki (mięso później).

    Jak DeboningEntryCreate, ale BEZ kg_meat. Service waliduje kg_taken>0.
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    raw_batch_id: str = Field(..., alias="rawBatchId", min_length=1)
    session_id: Optional[str] = Field(None, alias="sessionId")
    worker_id: Optional[str] = Field(None, alias="workerId")
    worker_name: Optional[str] = Field(None, alias="workerName")
    kg_taken: Optional[float] = Field(None, alias="kgTaken", ge=0)
    kg_quarter: Optional[float] = Field(None, alias="kgQuarter", ge=0)
```

- [ ] **Step 4: Add service**

W `backend/app/services/deboning_service.py` dodaj `create_deboning_take` — to faza 1 z `create_deboning_entry` (walidacja sesji/partii/HACCP/dostępności + zdjęcie surowca + ruch OUT), BEZ mięsa/lotu/ABP:

```python
def create_deboning_take(dto: "DeboningTakeCreate") -> Dict:
    """Faza 1: pobranie ćwiartki. Wiersz pending, surowiec schodzi, ruch OUT.
    Bez lotu mięsa i ABP — te powstają dopiero przy domknięciu."""
    from app.models.deboning import DeboningTakeCreate  # noqa: F401

    raw_batch_id = dto.raw_batch_id
    worker_id = dto.worker_id
    worker_name = dto.worker_name
    kg_taken = float(dto.kg_taken or dto.kg_quarter or 0)
    session_id = dto.session_id

    if kg_taken <= 0:
        raise HTTPException(400, "Ilość pobranej ćwiartki musi być > 0")

    entry_id = cuid()
    with transaction() as conn:
        if session_id:
            session_row = cx_query_one(
                conn, "SELECT status FROM production_sessions WHERE id=%s", (session_id,)
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                raise HTTPException(400, session_err)

        session_no = next_dated_no(conn, "ROZ")
        batch = cx_query_one(
            conn, "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE", (raw_batch_id,)
        )
        if not batch:
            batch = cx_query_one(
                conn, "SELECT * FROM raw_batches WHERE internal_batch_no=%s FOR UPDATE",
                (raw_batch_id,),
            )
        if not batch:
            raise HTTPException(404, f"Partia nie znaleziona (raw_batch_id={raw_batch_id!r})")
        if batch.get("status") != "active":
            raise HTTPException(
                400,
                f"Partia {batch.get('internal_batch_no')} ma status "
                f"{batch.get('status')} — rozbiór niemożliwy",
            )
        expiry_err = validate_batch_expiry(batch.get("expiry_date"))
        if expiry_err:
            raise HTTPException(400, expiry_err)

        kg_available = float(batch.get("kg_available") or batch.get("kg_received") or 0)
        if kg_taken > kg_available + 0.01:
            raise HTTPException(
                400,
                f"Nie można pobrać {kg_taken} kg — dostępne tylko "
                f"{round(kg_available, 2)} kg w partii {batch.get('internal_batch_no', '')}",
            )

        if worker_id and not worker_name:
            worker = cx_query_one(conn, "SELECT name FROM workers WHERE id=%s", (worker_id,))
            if worker:
                worker_name = worker["name"]

        entry = cx_execute_returning(
            conn,
            """
            INSERT INTO deboning_entries
                (id, raw_batch_id, raw_batch_no, session_id, session_no,
                 kg_quarter, kg_meat, kg_remainder, yield_pct,
                 worker_id, worker_name, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,0,%s,0,%s,%s,'pending',%s)
            RETURNING *
            """,
            (
                entry_id, batch["id"], batch["internal_batch_no"], session_id, session_no,
                kg_taken, kg_taken, worker_id, worker_name, now_iso(),
            ),
        )

        cx_execute(
            conn,
            "UPDATE raw_batches SET kg_available = GREATEST(0, "
            "COALESCE(kg_available, kg_received) - %s) WHERE id = %s",
            (kg_taken, batch["id"]),
        )
        create_stock_movement(
            conn, product_type="raw", batch_id=batch["id"], qty=kg_taken,
            movement_type="OUT", source_type="deboning", source_id=entry_id,
        )

    logger.info("deboning.take.created", extra={"entry_id": entry_id, "kg_taken": kg_taken})
    return _map_deboning_entry(entry)  # type: ignore[arg-type]
```

(`kg_remainder` na wiersz pending ustawiamy = `kg_taken` — całość jeszcze „nierozliczona"; po domknięciu przeliczymy.)

- [ ] **Step 5: Add route**

W `backend/app/routes/deboning.py`, obok `POST /api/deboning/entries`:

```python
from app.models.deboning import DeboningTakeCreate  # dodaj do importów u góry
from app.services.deboning_service import create_deboning_take  # dodaj do importów


@router.post("/api/deboning/takes")
def create_deboning_take_route(dto: DeboningTakeCreate):
    return create_deboning_take(dto)
```

- [ ] **Step 6: Run tests**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_deboning_takes_db.py -v`
Expected: PASS (3 passed) — jeśli `TEST_DATABASE_URL` ustawiony; inaczej `skip`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/deboning.py backend/app/services/deboning_service.py backend/app/routes/deboning.py backend/tests/test_deboning_takes_db.py
git commit -m "feat(rozbior): create_deboning_take — pobranie ćwiartki (pending), surowiec schodzi od razu"
```

---

## Task 3: Backend — domknięcie mięsem (`complete_deboning_take`)

**Files:**
- Modify: `backend/app/models/deboning.py` (dodaj `DeboningTakeComplete`)
- Modify: `backend/app/services/deboning_service.py` (dodaj `complete_deboning_take`)
- Modify: `backend/app/routes/deboning.py` (trasa `POST /api/deboning/takes/{id}/complete`)
- Test: `backend/tests/test_deboning_takes_db.py` (rozbuduj)

**Interfaces:**
- Consumes: `create_deboning_take` (Task 2), `validate_meat_yield` (Task 1), `validate_weighing_consistency`, `validate_session_writable`, `create_stock_movement`, `create_byproduct_lots_for_entry`.
- Produces: `complete_deboning_take(entry_id: str, dto: DeboningTakeComplete) -> Dict` — dla wiersza `status='pending'`: ustawia `kg_meat`, `kg_remainder`, `yield_pct`, pola audytu wagi; tworzy lot `meat_stock` + ruch IN; loty ABP; `status='complete'`. Odrzuca wiersz nie-pending (409) i wydajność spoza 30–95% (400).
- Produces: DTO `DeboningTakeComplete` — `kg_meat > 0` + opcjonalne `kg_gross`, `tare_cart_kg`, `tare_e2_kg`, `e2_count`, `weigh_mode`.

- [ ] **Step 1: Write the failing tests**

Dopisz do `backend/tests/test_deboning_takes_db.py`:

```python
from app.models.deboning import DeboningTakeComplete
from app.services.deboning_service import complete_deboning_take
import pytest
from fastapi import HTTPException


def test_complete_domyka_wpis_i_tworzy_lot_miesa(db):
    _seed_cwiartka_batch(internal_no="710", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    done = complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    assert done["status"] == "complete"
    assert done["kgMeat"] == 70.0
    ms = query_one("SELECT kg_available FROM meat_stock WHERE lot_no='710'")
    assert ms and float(ms["kg_available"]) == 70.0


def test_complete_nie_rusza_surowca_drugi_raz(db):
    _seed_cwiartka_batch(internal_no="711", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 0.0  # zeszło raz przy pobraniu


def test_complete_zla_wydajnosc_blokuje(db):
    _seed_cwiartka_batch(internal_no="712", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    with pytest.raises(HTTPException) as ei:
        complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=20.0))
    assert ei.value.status_code == 400


def test_podwojne_domkniecie_odrzucone(db):
    _seed_cwiartka_batch(internal_no="713", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=100.0,
    ))
    complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=70.0))
    with pytest.raises(HTTPException) as ei:
        complete_deboning_take(take["id"], DeboningTakeComplete(kg_meat=60.0))
    assert ei.value.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_deboning_takes_db.py -v`
Expected: FAIL — `ImportError: cannot import name 'DeboningTakeComplete'`

- [ ] **Step 3: Add DTO**

W `backend/app/models/deboning.py`:

```python
class DeboningTakeComplete(BaseModel):
    """POST /api/deboning/takes/{id}/complete — domknięcie pobrania mięsem."""

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    kg_meat: float = Field(..., alias="kgMeat", gt=0)
    kg_gross: Optional[float] = Field(None, alias="kgGross", ge=0)
    tare_cart_kg: Optional[float] = Field(None, alias="tareCartKg", ge=0)
    tare_e2_kg: Optional[float] = Field(None, alias="tareE2Kg", ge=0)
    e2_count: Optional[int] = Field(None, alias="e2Count", ge=0)
    weigh_mode: Optional[str] = Field(None, alias="weighMode", pattern="^(auto|manual)$")
```

- [ ] **Step 4: Add service (faza 2)**

W `backend/app/services/deboning_service.py` dodaj — to „druga połowa" `create_deboning_entry` (lot mięsa + ABP + IN), operująca na istniejącym wierszu pending:

```python
def complete_deboning_take(entry_id: str, dto: "DeboningTakeComplete") -> Dict:
    """Faza 2: domknięcie pobrania mięsem. Tworzy lot mięsa + ABP, status→complete.
    Surowiec zszedł już w fazie 1 — tutaj nie ruszamy raw_batches."""
    kg_meat = float(dto.kg_meat)

    with transaction() as conn:
        entry = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not entry:
            raise HTTPException(404, "Pobranie nie znalezione")
        if (entry.get("status") or "complete") != "pending":
            raise HTTPException(409, "Pobranie już domknięte lub nie jest pobraniem")

        if entry.get("session_id"):
            session_row = cx_query_one(
                conn, "SELECT status FROM production_sessions WHERE id=%s",
                (entry["session_id"],),
            )
            session_err = validate_session_writable(session_row)
            if session_err:
                raise HTTPException(400, session_err)

        if dto.weigh_mode == "auto":
            weighing_err = validate_weighing_consistency(
                dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, kg_meat
            )
            if weighing_err:
                raise HTTPException(400, weighing_err)

        kg_taken = float(entry.get("kg_quarter") or 0)
        yield_err = validate_meat_yield(kg_taken, kg_meat)
        if yield_err:
            raise HTTPException(400, yield_err)

        kg_remainder = max(0, kg_taken - kg_meat)
        yield_pct = round((kg_meat / kg_taken) * 100, 2)

        row = cx_execute_returning(
            conn,
            """
            UPDATE deboning_entries
            SET kg_meat=%s, kg_remainder=%s, yield_pct=%s, status='complete',
                kg_gross=%s, tare_cart_kg=%s, tare_e2_kg=%s, e2_count=%s, weigh_mode=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                kg_meat, kg_remainder, yield_pct,
                dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, dto.e2_count, dto.weigh_mode,
                entry_id,
            ),
        )

        from app.services.byproducts_service import create_byproduct_lots_for_entry
        create_byproduct_lots_for_entry(conn, row)

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

    logger.info(
        "deboning.take.completed",
        extra={"entry_id": entry_id, "kg_taken": kg_taken, "kg_meat": kg_meat},
    )
    return _map_deboning_entry(row)  # type: ignore[arg-type]
```

- [ ] **Step 5: Add route**

W `backend/app/routes/deboning.py`:

```python
from app.models.deboning import DeboningTakeComplete  # dodaj do importów
from app.services.deboning_service import complete_deboning_take  # dodaj do importów


@router.post("/api/deboning/takes/{entry_id}/complete")
def complete_deboning_take_route(entry_id: str, dto: DeboningTakeComplete):
    return complete_deboning_take(entry_id, dto)
```

- [ ] **Step 6: Run tests**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_deboning_takes_db.py -v`
Expected: PASS (7 passed łącznie z Task 2)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/deboning.py backend/app/services/deboning_service.py backend/app/routes/deboning.py backend/tests/test_deboning_takes_db.py
git commit -m "feat(rozbior): complete_deboning_take — domknięcie pobrania mięsem (lot + ABP, status complete)"
```

---

## Task 4: Backend — storno pending + wykluczenie pending ze statystyk

**Files:**
- Modify: `backend/app/services/deboning_service.py` (`delete_deboning_entry` ~663; `deboning_stats` ~94-103)
- Test: `backend/tests/test_deboning_takes_db.py` (rozbuduj)

**Interfaces:**
- Consumes: `create_deboning_take` (Task 2), `create_deboning_entry`, `delete_deboning_entry`.
- Produces: `delete_deboning_entry` obsługuje wiersz `pending` (oddaje surowiec, kasuje ruch OUT i wiersz, bez lotu mięsa/ABP). `deboning_stats` liczy tylko `status='complete'`.

- [ ] **Step 1: Write the failing tests**

Dopisz do `backend/tests/test_deboning_takes_db.py`:

```python
from app.services.deboning_service import delete_deboning_entry, deboning_stats
from datetime import date


def test_storno_pending_oddaje_surowiec(db):
    _seed_cwiartka_batch(internal_no="720", kg=100.0)
    take = create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    delete_deboning_entry(take["id"])
    rb = query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")
    assert float(rb["kg_available"]) == 100.0
    row = query_one("SELECT id FROM deboning_entries WHERE id=%s", (take["id"],))
    assert row is None


def test_stats_pomija_pending(db):
    _seed_cwiartka_batch(internal_no="721", kg=200.0)
    # pending: 60 kg ćwiartki, 0 mięsa — nie może zaniżyć wydajności
    create_deboning_take(DeboningTakeCreate(
        raw_batch_id="rb1", worker_name="Jan", kg_taken=60.0,
    ))
    today = date.today().isoformat()
    stats = deboning_stats(today, today)
    assert stats["summary"]["kgMeat"] == 0.0
    assert stats["summary"]["quarters"] == 0  # pending nie liczy się jako sztuka
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_deboning_takes_db.py::test_stats_pomija_pending tests/test_deboning_takes_db.py::test_storno_pending_oddaje_surowiec -v`
Expected: FAIL — `test_stats_pomija_pending` (pending policzone); storno może przejść lub rzucić na undo-guard (do naprawy w kroku 3).

- [ ] **Step 3: Handle pending in delete + exclude in stats**

W `delete_deboning_entry` (deboning_service.py), tuż po pobraniu `entry` i sprawdzeniu sesji, dodaj skróconą ścieżkę dla pending (przed logiką lotu mięsa/ABP/undo-guard):

```python
        if (entry.get("status") or "complete") == "pending":
            kg_taken = float(entry.get("kg_quarter") or 0)
            cx_execute(
                conn,
                "UPDATE raw_batches SET kg_available = COALESCE(kg_available,0) + %s WHERE id=%s",
                (kg_taken, entry.get("raw_batch_id")),
            )
            cx_execute(
                conn,
                "DELETE FROM stock_movements WHERE source_type='deboning' AND source_id=%s",
                (entry_id,),
            )
            cx_execute(conn, "DELETE FROM deboning_entries WHERE id=%s", (entry_id,))
            logger.info("deboning.take.undone", extra={"entry_id": entry_id, "kg_taken": kg_taken})
            return {"ok": True, "id": entry_id}
```

W `deboning_stats`, do zapytania SELECT dodaj filtr statusu:

```python
        WHERE created_at::date BETWEEN %s AND %s
          AND COALESCE(status, 'complete') = 'complete'
```

- [ ] **Step 4: Run tests**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_deboning_takes_db.py -v`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/deboning_service.py backend/tests/test_deboning_takes_db.py
git commit -m "feat(rozbior): storno pobrania pending + wykluczenie pending ze statystyk biura"
```

---

## Task 5: Frontend — API klienta, hook, wykluczenie pending w utilach

**Files:**
- Modify: `src/lib/api.ts` (`deboningEntriesApi` ~285-308)
- Modify: `src/lib/mockApi.ts` (`deboningEntriesApi` ~855)
- Modify: `src/features/deboning/types/index.ts` (`DeboningEntry`, DTO take)
- Modify: `src/features/deboning/api/index.ts` (kontrakt + delegacja)
- Modify: `src/features/deboning/hooks/index.ts` (`useDeboningEntries`)
- Modify: `src/features/deboning/utils/index.ts` (`splitEntriesByStatus`, `calcSessionSummary`)
- Test: `src/features/deboning/utils/deboning-status.test.ts` (create)

**Interfaces:**
- Consumes: backend `POST /api/deboning/takes`, `POST /api/deboning/takes/{id}/complete`.
- Produces: `deboningEntriesApi.createTake(dto)`, `.completeTake(id, dto)` (api.ts + mockApi.ts).
- Produces: `DeboningEntry.status: 'pending' | 'complete'`.
- Produces: `splitEntriesByStatus(entries) -> { pending: DeboningEntry[], complete: DeboningEntry[] }`.
- Produces: hook `useDeboningEntries` zwraca dodatkowo `addTake(dto, session, kgAvailable, expiryDate)` i `completeTake(entryId, dto, session)` (oba zwracają `string | null` błąd).

- [ ] **Step 1: Write the failing test**

Utwórz `src/features/deboning/utils/deboning-status.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { splitEntriesByStatus, calcSessionSummary } from './index'

const base = {
  kgBones: 0, kgBacks: 0, workerId: 'w1', rawBatchId: 'b1', yieldPct: 70,
}

describe('splitEntriesByStatus', () => {
  it('rozdziela pending i complete', () => {
    const { pending, complete } = splitEntriesByStatus([
      { ...base, status: 'pending', kgTaken: 60, kgMeat: 0 },
      { ...base, status: 'complete', kgTaken: 100, kgMeat: 70 },
    ] as any)
    expect(pending).toHaveLength(1)
    expect(complete).toHaveLength(1)
    expect(pending[0].kgTaken).toBe(60)
  })

  it('brak status traktuje jak complete', () => {
    const { complete } = splitEntriesByStatus([{ ...base, kgTaken: 100, kgMeat: 70 }] as any)
    expect(complete).toHaveLength(1)
  })
})

describe('calcSessionSummary pomija pending', () => {
  it('pending nie zanizaja wydajnosci ani liczby wpisow', () => {
    const s = calcSessionSummary([
      { ...base, status: 'complete', kgTaken: 100, kgMeat: 70 },
      { ...base, status: 'pending', kgTaken: 60, kgMeat: 0 },
    ] as any)
    expect(s.entryCount).toBe(1)
    expect(s.totalKgTaken).toBe(100)
    expect(Math.round(s.avgYieldPct)).toBe(70)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/deboning/utils/deboning-status.test.ts`
Expected: FAIL — `splitEntriesByStatus is not exported` / summary liczy pending.

- [ ] **Step 3: Add status to type + util helpers**

W `src/features/deboning/types/index.ts`, w interfejsie `DeboningEntry` dodaj (po `weighMode`):

```typescript
  readonly status?:     'pending' | 'complete'
```

Dodaj DTO take (po `CreateDeboningEntryDto`):

```typescript
export interface CreateDeboningTakeDto {
  sessionId:  string
  rawBatchId: string
  workerId:   string
  kgTaken:    number
}

export interface CompleteDeboningTakeDto {
  kgMeat:     number
  kgGross?:    number
  tareCartKg?: number
  tareE2Kg?:   number
  e2Count?:    number
  weighMode?:  'auto' | 'manual'
}
```

W `src/features/deboning/utils/index.ts` dodaj helper i zmień `calcSessionSummary`, by liczyła tylko complete:

```typescript
export function splitEntriesByStatus<T extends { status?: 'pending' | 'complete' }>(
  entries: ReadonlyArray<T>,
): { pending: T[]; complete: T[] } {
  const pending: T[] = []
  const complete: T[] = []
  for (const e of entries) {
    if (e.status === 'pending') pending.push(e)
    else complete.push(e)
  }
  return { pending, complete }
}
```

W `calcSessionSummary` zmień pierwszą linię, by pominąć pending — zmień sygnaturę o `status?` i filtruj:

```typescript
export function calcSessionSummary(entries: ReadonlyArray<{
  kgTaken: number; kgMeat: number; kgBones: number; kgBacks: number;
  workerId: string; rawBatchId: string; yieldPct: number;
  status?: 'pending' | 'complete';
}>) {
  const done = entries.filter(e => e.status !== 'pending')
  const totalKgTaken = done.reduce((s, e) => s + e.kgTaken, 0)
  const totalKgMeat  = done.reduce((s, e) => s + e.kgMeat,  0)
  const totalKgBones = done.reduce((s, e) => s + e.kgBones, 0)
  const totalKgBacks = done.reduce((s, e) => s + e.kgBacks, 0)
  const totalKgUppz  = Math.max(0, totalKgTaken - totalKgMeat - totalKgBones - totalKgBacks)
  const avgYieldPct  = totalKgTaken > 0 ? (totalKgMeat / totalKgTaken) * 100 : 0
  const workerIds    = new Set(done.map(e => e.workerId))
  const batchIds     = new Set(done.map(e => e.rawBatchId))

  return {
    totalKgTaken, totalKgMeat, totalKgBones, totalKgBacks, totalKgUppz,
    avgYieldPct,
    entryCount:  done.length,
    workerCount: workerIds.size,
    batchCount:  batchIds.size,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/deboning/utils/deboning-status.test.ts`
Expected: PASS

- [ ] **Step 5: Add API client methods (real + mock)**

W `src/lib/api.ts`, w `deboningEntriesApi` (po `create`):

```typescript
  // createTake — pobranie ćwiartki (mięso później); wysyła oba formaty
  createTake: (dto: any) => post<any>('/deboning/takes', {
    ...toSnake(dto),
    rawBatchId: dto.rawBatchId,
    sessionId:  dto.sessionId,
    workerId:   dto.workerId,
    kgTaken:    dto.kgTaken,
  }),
  // completeTake — domknięcie pobrania mięsem
  completeTake: (id: string, dto: any) => post<any>(`/deboning/takes/${id}/complete`, {
    ...toSnake(dto),
    kgMeat: dto.kgMeat,
  }),
```

W `src/lib/mockApi.ts`, w `deboningEntriesApi` dodaj analogiczne mocki (dopasuj do istniejącego wzorca create w mocku — pobranie tworzy wpis `status:'pending', kgMeat:0`, complete ustawia `kgMeat` i `status:'complete'`). Odczytaj sąsiedni `create`/`update` w tym pliku i zachowaj jego styl (localStorage store).

- [ ] **Step 6: Add contract + delegation in feature api**

W `src/features/deboning/api/index.ts`, do interfejsu `DeboningApi` dodaj:

```typescript
  createTake(dto: CreateDeboningTakeDto): Promise<DeboningEntry>
  completeTake(entryId: string, dto: CompleteDeboningTakeDto): Promise<DeboningEntry>
```

(zaimportuj `CreateDeboningTakeDto, CompleteDeboningTakeDto` z `../types`) i w `deboningApi`:

```typescript
  createTake:   (dto)     => entriesStore.createTake(dto),
  completeTake: (id, dto) => entriesStore.completeTake(id, dto),
```

- [ ] **Step 7: Add hook methods**

W `src/features/deboning/hooks/index.ts` → `useDeboningEntries`, dodaj mutacje i funkcje (po `addEntry`):

```typescript
  const createTakeMutation = useMutation((dto: CreateDeboningTakeDto) => deboningApi.createTake(dto))
  const completeTakeMutation = useMutation(
    ({ id, dto }: { id: string; dto: CompleteDeboningTakeDto }) => deboningApi.completeTake(id, dto)
  )

  const addTake = useCallback(async (
    dto: CreateDeboningTakeDto,
    session: ProductionSession | null,
    kgAvailable: number,
    expiryDate: string,
  ): Promise<string | null> => {
    if (!session) return 'Brak aktywnej sesji. Rozpocznij dzień produkcyjny.'
    if (session.status !== 'open') return 'Sesja niedostępna do zapisu.'
    if (isExpired(expiryDate)) return 'Partia przeterminowana — użycie zabronione (HACCP)'
    if (dto.kgTaken <= 0) return 'Ilość pobranej ćwiartki musi być > 0'
    if (dto.kgTaken > kgAvailable + 0.01)
      return `⛔ Nie można pobrać ${dto.kgTaken} kg — dostępne tylko ${kgAvailable.toFixed(2)} kg`
    try {
      await createTakeMutation.mutate(dto)
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zapisu pobrania'
    }
  }, [createTakeMutation, refetch])

  const completeTake = useCallback(async (
    entryId: string,
    dto: CompleteDeboningTakeDto,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    if (session?.status !== 'open') return 'Domknięcie możliwe tylko przy otwartej sesji'
    if (dto.kgMeat <= 0) return 'Ilość mięsa musi być > 0'
    try {
      await completeTakeMutation.mutate({ id: entryId, dto })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd domknięcia pobrania'
    }
  }, [completeTakeMutation, refetch])
```

Dodaj importy typów `CreateDeboningTakeDto, CompleteDeboningTakeDto` do bloku importów z `../types`. Do zwracanego obiektu hooka dodaj: `addTake, completeTake, addTakeLoading: createTakeMutation.loading, completeTakeLoading: completeTakeMutation.loading`.

- [ ] **Step 8: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run src/features/deboning/`
Expected: brak błędów typów; testy PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/api.ts src/lib/mockApi.ts src/features/deboning/types/index.ts src/features/deboning/api/index.ts src/features/deboning/hooks/index.ts src/features/deboning/utils/index.ts src/features/deboning/utils/deboning-status.test.ts
git commit -m "feat(rozbior): API/hook createTake+completeTake, split pending/complete, summary bez pending"
```

---

## Task 6: HMI v10 — przycisk „Zapisz pobranie", kafelki i wznowienie

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx`

**Interfaces:**
- Consumes: `useDeboningEntries` → `addTake`, `completeTake`, `entries`; `splitEntriesByStatus` z utils.
- Produces: UI — drugi przycisk zapisu pobrania; sekcja kafelków „Czeka na zważenie"; tryb wznowienia (ćwiartka zablokowana, mięso aktywne, „Zapisz mięso").

Ten task jest większy (jeden spójny ekran) — implementujemy przyrostowo z ręcznym sprawdzeniem w przeglądarce po każdym kroku, bo brak testów komponentowych dla HMI.

- [ ] **Step 1: Podłącz nowe funkcje hooka i podział wpisów**

W `DeboningHmiV10Page.tsx` znajdź destrukturyzację `useDeboningEntries` i dodaj `addTake, completeTake`. Zaimportuj `splitEntriesByStatus` z `@/features/deboning/utils`. Tam gdzie liczone są `entries` (np. ~410-422, listy i statystyki), wyznacz:

```typescript
  const { pending: pendingTakes, complete: completeEntries } = useMemo(
    () => splitEntriesByStatus(entries),
    [entries],
  )
```

Zamień użycia `entries` w agregatach/listach „ostatnie wpisy"/statystykach na `completeEntries` (podsumowania, sortowanie statów, feed). NIE zmieniaj miejsc, które mają pokazać wszystko — ale w tym ekranie pending idą do osobnej sekcji, więc listy „complete-only”.

- [ ] **Step 2: Stan wznowienia**

Dodaj stan śledzący domykane pobranie:

```typescript
  const [resumeId, setResumeId] = useState<string | null>(null)
```

- [ ] **Step 3: Handler zapisu pobrania**

Dodaj obok `handleSave`:

```typescript
  async function handleSaveTake() {
    if (!selBatch || !selWorker || taken <= 0 || !session) return
    const err = await addTake(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate,
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    showToast(`Pobrano ${fmtKg(taken, 1)} kg — czeka na zważenie`)
  }
```

- [ ] **Step 4: Handler wznowienia (klik w kafelek)**

```typescript
  const resumeTake = useCallback((e: DeboningEntry) => {
    const b = batches.find(x => x.id === e.rawBatchId) ?? null
    if (b) setSelBatch(b)
    const w = workers.find(x => x.id === e.workerId) ?? null
    if (w) setSelWorker(w)
    setResumeId(e.id)
    setKgTaken(String(e.kgTaken))
    setTakenMode('kg')
    setKgMeat('')
    setMeatManual(false)
    setActive('meat')
  }, [batches, workers])
```

(Dopasuj `batches`/`workers` do realnych nazw w komponencie — sprawdź źródło kafli partii i pracowników; jeśli nazwy inne, użyj istniejących.)

- [ ] **Step 5: Handler domknięcia**

```typescript
  async function handleCompleteTake() {
    if (!resumeId || meat <= 0 || !session) return
    const err = await completeTake(resumeId, {
      kgMeat: meat,
      ...(scale.available ? {
        weighMode: autoMode ? 'auto' as const : 'manual' as const,
        ...(autoMode ? { kgGross: scale.gross, tareCartKg: cartTare ?? undefined, tareE2Kg: weighing.tareE2Kg, e2Count } : {}),
      } : {}),
    }, session)
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setResumeId(null)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    showToast(`Zważono ${fmtKg(meat, 1)} kg mięsa`)
  }
```

- [ ] **Step 6: Blokada pól ćwiartki w trybie wznowienia**

Gdy `resumeId != null`: pole ćwiartki + wybór partii/pracownika są zablokowane (read-only). Przy renderze pola ćwiartki i przełącznika kg/poj dodaj warunek `disabled={resumeId != null}`; klik w numpad w trybie wznowienia pisze tylko do mięsa (już tak jest, bo `active='meat'`). Wybór partii/pracownika: gdy `resumeId != null`, ignoruj `pickBatch`/`pickWorker` (na początku tych callbacków: `if (resumeId) return`).

- [ ] **Step 7: Przycisk zapisu — dwa tryby**

W obszarze głównego przycisku zapisu: gdy `resumeId != null` pokaż **„Zapisz mięso"** (`onClick={handleCompleteTake}`, aktywny gdy `meat > 0 && !meatTooBig` i w auto: `scale.stable && weighing.ready`) oraz przycisk „Anuluj wznowienie" (`onClick={() => { setResumeId(null); setKgTaken(''); setKgMeat(''); setActive('taken') }}`).
Gdy `resumeId == null`: obok istniejącego „Zapisz wpis" (od razu) dodaj drugi przycisk **„Zapisz pobranie (mięso później)"** (`onClick={handleSaveTake}`, aktywny gdy `!!selBatch && !!selWorker && taken > 0`). Styl drugorzędny (outline), by nie mylić się z głównym.

- [ ] **Step 8: Sekcja kafelków „Czeka na zważenie"**

Dodaj sekcję renderującą `pendingTakes` (gdy niepusta), np. nad/obok listy ostatnich wpisów:

```tsx
{pendingTakes.length > 0 && (
  <div>
    <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>
      Czeka na zważenie ({pendingTakes.length})
    </div>
    <div className="grid grid-cols-2 gap-2 mt-1">
      {pendingTakes.map(e => (
        <button key={e.id} onClick={() => resumeTake(e)}
          className="text-left rounded-lg p-2 border"
          style={{ borderColor: 'var(--accent)', background: 'var(--surface)' }}>
          <div className="hmi-v10-mono font-extrabold" style={{ fontSize: 22, color: 'var(--accent)' }}>
            {fmtKg(e.kgTaken, 1)} kg
          </div>
          <div className="text-[11px]" style={{ color: 'var(--mut)' }}>
            {e.rawBatchNo} · {e.workerName}
          </div>
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--accent)' }}>
            ⏳ czeka na mięso
          </div>
        </button>
      ))}
    </div>
  </div>
)}
```

(Dopasuj klasy/tokeny do rzeczywistego stylu HMI v10 — użyj `hmi-v10-*` i zmiennych `var(--...)` obecnych w pliku; sprawdź `fmtKg` jest w zasięgu.)

- [ ] **Step 9: Manualna weryfikacja w przeglądarce**

Uruchom środowisko dev (wg `/run` lub `npm run dev`), wejdź na kiosk rozbioru v10. Scenariusz:
1. Wybierz partię + pracownika, wpisz ćwiartkę, kliknij „Zapisz pobranie" → pojawia się kafelek „X kg · partia · pracownik · ⏳".
2. Kliknij kafelek → ćwiartka wpisana i zablokowana, aktywne pole mięso.
3. Wpisz/zważ mięso, „Zapisz mięso" → kafelek znika, wpis pojawia się w liście ostatnich, wydajność się zgadza.
4. „Zapisz pobranie" ponownie i sprawdź, że statystyki nie pokazują pending jako 0-wydajności.

Expected: przepływ jak w spec; brak błędów w konsoli.

- [ ] **Step 10: Commit**

```bash
git add src/pages/tablet/DeboningHmiV10Page.tsx
git commit -m "feat(rozbior): HMI v10 — zapis pobrania, kafelki 'czeka na zważenie', domknięcie mięsem"
```

---

## Task 7: Bump wersji kiosku (release auto-update)

**Files:**
- Modify: `src-tauri/tauri.rozbior-v10.conf.json` (`version`)

**Interfaces:**
- Consumes: cała implementacja Task 1-6.
- Produces: podniesiona wersja kiosku, by auto-update wypchnął build na panel PC.

- [ ] **Step 1: Bump version**

W `src-tauri/tauri.rozbior-v10.conf.json` podnieś `"version"` z bieżącej (`1.0.43`) na następną (`1.0.44`). (Vite czyta ją jako `__ROZBIOR_V10_VERSION__` — stopka HMI pokaże nową wersję.)

- [ ] **Step 2: Verify build inputs**

Run: `npx tsc --noEmit && npm run build`
Expected: build przechodzi (rozbior-v10 entry kompiluje się).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.rozbior-v10.conf.json
git commit -m "chore(rozbior): bump wersji kiosku v10 -> 1.0.44 (dwufazowy rozbiór)"
```

> **Uwaga release:** publikacja instalatora + `latest.json` idzie procesem release (patrz pamięć „Release desktopu Kebab MES" / `desktop_updates_rozbior_v10`). Przed deployem: REGUŁA pre-deploy diff (prod↔repo). To poza zakresem tego planu implementacyjnego.

---

## Self-Review

**Spec coverage:**
- Kolumna `status` + migracja → Task 1. ✓
- Rozcięcie na `create_deboning_take` / `complete_deboning_take` → Task 2, 3. ✓
- Surowiec schodzi przy pobraniu → Task 2 (UPDATE raw_batches + OUT). ✓
- Sanity 30–95% przy domknięciu → Task 3 (`validate_meat_yield`). ✓
- Storno pending → Task 4. ✓
- Wykluczenie pending ze statystyk/podsumowań → Task 4 (stats), Task 5 (`calcSessionSummary`). ✓
- API `/takes`, `/takes/{id}/complete` → Task 2, 3; klient/hook → Task 5. ✓
- UX: przycisk pobrania, kafelki „pobrano XXX — czeka na zważenie", klik → ćwiartka w okienku, tylko waga → Task 6. ✓
- Widoczność tylko na tablecie (brak panelu biura) → zgodne (żadnego task biura). ✓
- Wersja kiosku 1.0.4x, dobry plik `DeboningHmiV10Page` → Task 7 + potwierdzone w analizie. ✓

**Placeholder scan:** kroki UI (Task 6) zawierają realny kod; miejsca do dopasowania nazw (`batches`/`workers`, tokeny stylu) są wprost oznaczone jako „dopasuj do istniejących nazw w pliku” — nie są luźnym „dodaj obsługę”, tylko konkretną instrukcją podłączenia do istniejących zmiennych. Mock w Task 5 Step 5 wskazuje wzorzec sąsiedniego `create` — do odwzorowania 1:1.

**Type consistency:** `createTake`/`completeTake` spójne między api.ts, feature api, hook (`addTake`/`completeTake`). `DeboningTakeCreate`/`DeboningTakeComplete` (backend) ↔ `CreateDeboningTakeDto`/`CompleteDeboningTakeDto` (frontend). `splitEntriesByStatus` ta sama nazwa w utils, teście i Task 6. `validate_meat_yield` ta sama sygnatura w Task 1 i użyciu w Task 3.
