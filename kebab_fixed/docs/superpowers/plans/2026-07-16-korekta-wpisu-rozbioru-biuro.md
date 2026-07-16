# Korekta wpisu rozbioru z biura — plan wdrożenia

> **Dla wykonawcy:** realizuj zadanie po zadaniu, każdy krok osobno. Kroki mają checkboxy (`- [ ]`).
> **UWAGA:** ten plan dotyka `backend/` i `src/` — zgodnie z regułą projektu **subagenty tu nie piszą**, wykonanie inline.

**Cel:** Biuro może poprawić pracownika i kg we wpisie rozbioru także po zatwierdzeniu zmiany, z obowiązkowym powodem i widoczną historią korekt.

**Architektura:** Osobny endpoint `POST /api/deboning/entries/{id}/correct` (nie rozszerzenie `PATCH`, którego używa HMI), świadomie pomijający `validate_session_writable`. Dostęp zawężony w RBAC do `office`. Każda korekta zapisuje wiersz w nowej tabeli `deboning_entry_corrections` (powód + diff PRZED/PO). Korekta stanów magazynowych reużywa reguł z `update_deboning_entry`.

**Tech Stack:** FastAPI + psycopg2 (raw SQL), pytest (DB: `kebab_mes_test`), React + TypeScript + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-korekta-wpisu-rozbioru-biuro-design.md`

## Global Constraints

- Powód wymagany: po `.strip()` minimum **3 znaki**, inaczej HTTP 400.
- Endpoint `/correct` **NIE** wywołuje `validate_session_writable` — to jest jego cel.
- RBAC dla `/correct` = `"office"`; operator działu `rozbior` musi dostać 403.
- Wszystkie zapisy jednej korekty w **jednej transakcji** (`with transaction() as conn`).
- Tolerancja porównań kg: `0.001` (jak w istniejącym `update_deboning_entry`).
- Komentarze i komunikaty po polsku, jak reszta kodu.
- Testy DB uruchamiane z `TEST_DATABASE_URL` (patrz `backend/tests/conftest.py`).

---

## File Structure

- `backend/app/auth/permissions.py` — wyjątek `office-only` dla `/correct` (modyfikacja).
- `backend/app/migrations.py` — DDL tabeli `deboning_entry_corrections` (modyfikacja).
- `backend/app/services/deboning_service.py` — `correct_deboning_entry`, `list_entry_corrections` (modyfikacja).
- `backend/app/models/deboning.py` — DTO `DeboningEntryCorrect` (modyfikacja).
- `backend/app/routes/deboning.py` — 2 trasy (modyfikacja).
- `backend/tests/test_permissions.py` — testy RBAC (modyfikacja).
- `backend/tests/test_deboning_correct_db.py` — testy korekty (**nowy**).
- `kebab_fixed/src/lib/api.ts` — `deboningEntriesApi.correct` + `.corrections` (modyfikacja).
- `kebab_fixed/src/pages/office/DeboningReportsPage.tsx` — przycisk, modal, historia (modyfikacja).

---

### Task 1: RBAC — `/correct` wyłącznie dla biura

**Uzasadnienie:** `DEPARTMENT_PREFIXES` mapuje `"rozbior": ("/api/deboning",)`, a `<slug>` znaczy „operator działu **LUB** biuro". Bez tego wyjątku operator kiosku mógłby wywołać `/correct` i ominąć blokadę zatwierdzonej zmiany.

**Files:**
- Modify: `backend/app/auth/permissions.py` (w `permission_for_path`, PRZED pętlą po `DEPARTMENT_PREFIXES`)
- Test: `backend/tests/test_permissions.py`

**Interfaces:**
- Consumes: nic (pierwsze zadanie).
- Produces: `permission_for_path("/api/deboning/entries/<id>/correct", "POST") == "office"`.

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `backend/tests/test_permissions.py`:

```python
def test_korekta_wpisu_tylko_dla_biura():
    """/correct omija blokadę zatwierdzonej zmiany, więc operator hali NIE
    może go wywołać — inaczej przepisywałby zatwierdzone dane i cudzy akord."""
    p = permission_for_path("/api/deboning/entries/abc123/correct", "POST")
    assert p == "office"
    # operator działu rozbior — mimo że /api/deboning to jego dział
    operator = {"kind": "operator", "departments": ["rozbior"]}
    assert can_access(operator, p) is False
    # biuro przechodzi
    assert can_access({"kind": "office", "role": "office"}, p) is True
    assert can_access({"kind": "office", "role": "admin"}, p) is True
    # zwykłe ścieżki rozbioru dalej działają dla operatora
    assert permission_for_path("/api/deboning/entries/abc123", "PATCH") == "rozbior"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -m pytest tests/test_permissions.py::test_korekta_wpisu_tylko_dla_biura -q
```
Expected: FAIL — `assert 'rozbior' == 'office'`

- [ ] **Step 3: Write minimal implementation**

W `backend/app/auth/permissions.py`, w `permission_for_path`, **bezpośrednio przed** `for dept, prefixes in DEPARTMENT_PREFIXES.items():`:

```python
    # Korekta wpisu z biura (pracownik/kg) ŚWIADOMIE omija blokadę
    # zatwierdzonej zmiany, więc wpuszczamy tu WYŁĄCZNIE biuro — operator
    # hali nie może przepisywać zatwierdzonych danych ani cudzego akordu.
    if path.startswith("/api/deboning/entries/") and path.endswith("/correct"):
        return "office"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_permissions.py -q
```
Expected: PASS (wszystkie, łącznie z istniejącym `test_department_paths`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/permissions.py backend/tests/test_permissions.py
git commit -m "feat(rbac): korekta wpisu rozbioru /correct wylacznie dla biura"
```

---

### Task 2: Migracja — tabela historii korekt

**Files:**
- Modify: `backend/app/migrations.py` (dopisz do listy `_DDL`, która zaczyna się w linii 14)

**Interfaces:**
- Consumes: nic.
- Produces: tabela `deboning_entry_corrections(id, entry_id, at, by_subject, reason, changes)`.

- [ ] **Step 1: Dopisz DDL do `_DDL`**

Dodaj na końcu listy `_DDL` w `backend/app/migrations.py`:

```python
    # Historia korekt wpisów rozbioru z biura (zmiana pracownika/kg po
    # zatwierdzeniu zmiany). Powód jest WYMAGANY, a diff trzymamy w JSONB —
    # to czysty zapis audytowy, nikt po nim nie filtruje ani nie liczy.
    """
    CREATE TABLE IF NOT EXISTS deboning_entry_corrections (
        id         TEXT PRIMARY KEY,
        entry_id   TEXT NOT NULL,
        at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        by_subject TEXT,
        reason     TEXT NOT NULL,
        changes    JSONB NOT NULL DEFAULT '{}'::jsonb
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_dec_entry ON deboning_entry_corrections(entry_id)",
```

- [ ] **Step 2: Zastosuj migrację na bazie testowej i sprawdź**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -c "from app.migrations import run_migrations; run_migrations()"
DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -c "
from app.db import query_one
print(query_one(\"SELECT COUNT(*) AS n FROM deboning_entry_corrections\"))"
```
Expected: `{'n': 0}` (tabela istnieje, pusta)

- [ ] **Step 3: Dopisz tabelę do czyszczenia w conftest**

W `backend/tests/conftest.py`, w liście `_TRUNCATE`, dodaj `"deboning_entry_corrections"` **przed** `"raw_batches"` (kolejność: zależne najpierw):

```python
    "deboning_entry_corrections",
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/migrations.py backend/tests/conftest.py
git commit -m "feat(db): tabela deboning_entry_corrections (historia korekt z biura)"
```

---

### Task 3: Serwis — `correct_deboning_entry`

**Files:**
- Modify: `backend/app/services/deboning_service.py`
- Test: `backend/tests/test_deboning_correct_db.py` (nowy)

**Interfaces:**
- Consumes: `validate_edit_deltas(delta_taken, raw_available, delta_meat, meat_available) -> str | None`, `_map_deboning_entry(row) -> Dict`, `cuid()`, `transaction()`, `cx_query_one/cx_execute/cx_execute_returning`.
- Produces:
  - `correct_deboning_entry(entry_id: str, worker_id: str | None, kg_quarter: float | None, kg_meat: float | None, reason: str, by_subject: str = "") -> Dict`
  - `list_entry_corrections(entry_id: str) -> List[Dict]` — klucze: `id`, `at` (ISO), `bySubject`, `reason`, `changes`.

- [ ] **Step 1: Write the failing tests**

Utwórz `backend/tests/test_deboning_correct_db.py`:

```python
"""Korekta wpisu rozbioru z biura: pracownik + kg, działa na ZATWIERDZONEJ
zmianie, wymaga powodu, zapisuje historię. Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.deboning_service import (
    correct_deboning_entry,
    deboning_stats,
    list_entry_corrections,
)
from app.utils.ids import cuid, now_iso


def _seed(kg_quarter=200.0, kg_meat=132.0, session_status="approved"):
    """Partia + lot mięsa + wpis Adriana w ZATWIERDZONEJ zmianie (jak prod)."""
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
        "('w-adrian','Adrian','rozbior',0.5), ('w-raschad','Raschad','rozbior',0.5)"
    )
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, created_at)"
        " VALUES ('rb1','900',900,'Dostawca',1000,800,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (now_iso(),),
    )
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_initial, kg_available, created_at)"
        " VALUES ('ms1','900',%s,%s, now())",
        (kg_meat, kg_meat),
    )
    # session_date i process_type są NOT NULL — bez nich INSERT padnie.
    execute(
        "INSERT INTO production_sessions (id, session_date, process_type, status, started_at)"
        " VALUES ('s1', CURRENT_DATE, 'deboning', %s, now())",
        (session_status,),
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, session_id, created_at, completed_at)"
        " VALUES ('e1','rb1','900','w-adrian','Adrian',%s,%s,66.0,'s1', now(), now())",
        (kg_quarter, kg_meat),
    )


def test_korekta_dziala_na_zatwierdzonej_zmianie(db):
    """Sedno sprawy: wpisy starsze niż dziś są ZAWSZE w sesji 'approved',
    a każda dotychczasowa ścieżka odmawiała („Sesja zatwierdzona")."""
    _seed(session_status="approved")
    out = correct_deboning_entry("e1", "w-raschad", None, None, "pomyłka operatora")
    assert out["workerName"] == "Raschad"
    row = query_one("SELECT worker_id, worker_name FROM deboning_entries WHERE id='e1'")
    assert row["worker_id"] == "w-raschad" and row["worker_name"] == "Raschad"


def test_zmiana_pracownika_przenosi_akord(db):
    """Robocizna liczy się z rate_per_kg × kg ćwiartki per wpis i grupuje po
    worker_id — zmiana pracownika ma sama naprawić rozliczenie."""
    _seed()
    from datetime import date
    today = date.today().isoformat()
    before = {w["workerName"]: w for w in deboning_stats(today, today)["workers"]}
    assert "Adrian" in before
    correct_deboning_entry("e1", "w-raschad", None, None, "pomyłka operatora")
    after = {w["workerName"]: w for w in deboning_stats(today, today)["workers"]}
    assert "Raschad" in after and "Adrian" not in after
    assert after["Raschad"]["kgQuarter"] == 200.0


def test_korekta_cwiartki_zwraca_roznice_do_partii(db):
    _seed(kg_quarter=200.0)
    correct_deboning_entry("e1", None, 180.0, None, "za dużo wpisane")
    # 20 kg wraca na partię: 800 → 820
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")["kg_available"]) == 820.0
    assert float(query_one("SELECT kg_quarter FROM deboning_entries WHERE id='e1'")["kg_quarter"]) == 180.0


def test_korekta_miesa_koryguje_lot(db):
    _seed(kg_meat=132.0)
    correct_deboning_entry("e1", None, None, 140.0, "źle zważone")
    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE id='ms1'")
    assert float(lot["kg_available"]) == 140.0
    assert float(query_one("SELECT yield_pct FROM deboning_entries WHERE id='e1'")["yield_pct"]) == 70.0


def test_powod_jest_wymagany(db):
    _seed()
    for bad in ("", "   ", "ok"):
        with pytest.raises(HTTPException) as e:
            correct_deboning_entry("e1", "w-raschad", None, None, bad)
        assert e.value.status_code == 400


def test_brak_zmian_odrzucony(db):
    _seed()
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry("e1", None, None, None, "bez zmian")
    assert e.value.status_code == 400


def test_mieso_nie_moze_przekroczyc_cwiartki(db):
    _seed(kg_quarter=200.0)
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry("e1", None, None, 250.0, "literówka")
    assert e.value.status_code == 400


def test_mieso_juz_zuzyte_daje_czytelny_blad(db):
    """Mięso poszło w masowanie — zdjęcie go z lotu musi dać 400, a nie ujemny stan."""
    _seed(kg_meat=132.0)
    execute("UPDATE meat_stock SET kg_available=0 WHERE id='ms1'")
    with pytest.raises(HTTPException) as e:
        correct_deboning_entry("e1", None, None, 100.0, "korekta")
    assert e.value.status_code == 400


def test_historia_zapisuje_powod_i_diff(db):
    _seed(kg_quarter=200.0)
    correct_deboning_entry("e1", "w-raschad", 180.0, None, "pomyłka operatora", by_subject="am")
    h = list_entry_corrections("e1")
    assert len(h) == 1
    assert h[0]["reason"] == "pomyłka operatora"
    assert h[0]["bySubject"] == "am"
    assert h[0]["changes"]["worker"] == {"from": "Adrian", "to": "Raschad"}
    assert h[0]["changes"]["kgQuarter"] == {"from": 200.0, "to": 180.0}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
export TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test"
python3 -m pytest tests/test_deboning_correct_db.py -q
```
Expected: FAIL — `ImportError: cannot import name 'correct_deboning_entry'`

- [ ] **Step 3: Dodaj import `json` do serwisu**

W `backend/app/services/deboning_service.py`, na górze (przed `from datetime import ...`):

```python
import json
```

- [ ] **Step 4: Write implementation**

Dopisz na końcu `backend/app/services/deboning_service.py`:

```python
def correct_deboning_entry(
    entry_id: str,
    worker_id: str | None,
    kg_quarter: float | None,
    kg_meat: float | None,
    reason: str,
    by_subject: str = "",
) -> Dict:
    """Korekta wpisu rozbioru Z BIURA: pracownik i/lub kg.

    ŚWIADOMIE NIE woła validate_session_writable — to jedyna ścieżka, którą
    biuro prostuje pomyłki operatora PO zatwierdzeniu zmiany (wpisy starsze
    niż dziś są zawsze w sesji 'approved', więc PATCH/change-batch/undo
    odmawiają). Dostęp zawęża RBAC: permission_for_path zwraca dla /correct
    "office", więc operator hali tu nie wejdzie.

    Powód jest wymagany i razem z diffem PRZED/PO ląduje w
    deboning_entry_corrections — wsteczna zmiana akordu musi mieć ślad.
    """
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(400, "Powód korekty jest wymagany (min. 3 znaki)")

    with transaction() as conn:
        entry = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not entry:
            raise HTTPException(404, "Wpis rozbioru nie znaleziony")

        changes: Dict[str, Any] = {}

        new_worker_id = entry.get("worker_id")
        new_worker_name = entry.get("worker_name")
        if worker_id and worker_id != entry.get("worker_id"):
            w = cx_query_one(conn, "SELECT id, name FROM workers WHERE id=%s", (worker_id,))
            if not w:
                raise HTTPException(400, "Pracownik nie istnieje")
            changes["worker"] = {"from": entry.get("worker_name") or "", "to": w["name"]}
            new_worker_id, new_worker_name = w["id"], w["name"]

        old_taken = float(entry.get("kg_quarter") or 0)
        old_meat = float(entry.get("kg_meat") or 0)
        new_taken = float(kg_quarter) if kg_quarter is not None else old_taken
        new_meat = float(kg_meat) if kg_meat is not None else old_meat
        if new_meat > new_taken:
            raise HTTPException(400, "kg mięsa nie może przekraczać pobranej ćwiartki")
        if abs(new_taken - old_taken) > 0.001:
            changes["kgQuarter"] = {"from": old_taken, "to": new_taken}
        if abs(new_meat - old_meat) > 0.001:
            changes["kgMeat"] = {"from": old_meat, "to": new_meat}

        if not changes:
            raise HTTPException(400, "Brak zmian do zapisania")

        # Korekta stanów — te same reguły co update_deboning_entry.
        delta_taken = new_taken - old_taken
        delta_meat = new_meat - old_meat
        raw_row = None
        meat_lot = None
        if abs(delta_taken) > 0.001:
            raw_row = cx_query_one(
                conn, "SELECT id, kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
                (entry.get("raw_batch_id"),),
            )
        if abs(delta_meat) > 0.001:
            meat_lot = cx_query_one(
                conn,
                "SELECT id, kg_initial, kg_available FROM meat_stock WHERE lot_no=%s FOR UPDATE",
                (entry.get("raw_batch_no"),),
            )
        delta_err = validate_edit_deltas(
            delta_taken,
            float(raw_row["kg_available"]) if raw_row else None,
            delta_meat,
            float(meat_lot["kg_available"]) if meat_lot else None,
        )
        if delta_err:
            raise HTTPException(400, delta_err)
        if raw_row:
            cx_execute(
                conn,
                "UPDATE raw_batches SET kg_available = GREATEST(0, COALESCE(kg_available,0) - %s) WHERE id=%s",
                (delta_taken, raw_row["id"]),
            )
        if meat_lot:
            cx_execute(
                conn,
                "UPDATE meat_stock SET kg_initial = GREATEST(0, kg_initial + %s), "
                "kg_available = GREATEST(0, kg_available + %s) WHERE id=%s",
                (delta_meat, delta_meat, meat_lot["id"]),
            )

        kg_remainder = max(0, new_taken - new_meat)
        yield_pct = round((new_meat / new_taken * 100) if new_taken > 0 else 0, 2)
        row = cx_execute_returning(
            conn,
            """
            UPDATE deboning_entries
            SET worker_id=%s, worker_name=%s, kg_quarter=%s, kg_meat=%s,
                kg_remainder=%s, yield_pct=%s
            WHERE id=%s
            RETURNING *
            """,
            (new_worker_id, new_worker_name, new_taken, new_meat,
             kg_remainder, yield_pct, entry_id),
        )
        cx_execute(
            conn,
            "INSERT INTO deboning_entry_corrections (id, entry_id, by_subject, reason, changes) "
            "VALUES (%s,%s,%s,%s,%s)",
            (cuid(), entry_id, by_subject or "", reason,
             json.dumps(changes, ensure_ascii=False)),
        )
    logger.info("deboning.entry.corrected", extra={"entry_id": entry_id})
    return _map_deboning_entry(row)


def list_entry_corrections(entry_id: str) -> List[Dict]:
    """Historia korekt wpisu — biuro widzi kto, kiedy, co na co i dlaczego."""
    rows = query_all(
        "SELECT id, at, by_subject, reason, changes FROM deboning_entry_corrections "
        "WHERE entry_id=%s ORDER BY at DESC",
        (entry_id,),
    )
    return [
        {
            "id": r["id"],
            "at": r["at"].isoformat() if r.get("at") else None,
            "bySubject": r.get("by_subject") or "",
            "reason": r.get("reason") or "",
            "changes": r.get("changes") or {},
        }
        for r in rows
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_deboning_correct_db.py -q
```
Expected: PASS (9 testów)

- [ ] **Step 6: Run the full suite for regressions**

```bash
python3 -m pytest tests/ --tb=short -q
```
Expected: jedyna porażka to znany, wcześniej istniejący `test_mieso_zs_db.py::test_mieso_zs_seeded_as_seasonable_not_receivable`

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/deboning_service.py backend/tests/test_deboning_correct_db.py
git commit -m "feat(rozbior): korekta wpisu z biura — pracownik/kg mimo zatwierdzonej zmiany + historia"
```

---

### Task 4: Endpointy

**Files:**
- Modify: `backend/app/models/deboning.py`
- Modify: `backend/app/routes/deboning.py`

**Interfaces:**
- Consumes: `correct_deboning_entry(...)`, `list_entry_corrections(entry_id)` z Task 3.
- Produces: `POST /api/deboning/entries/{entry_id}/correct`, `GET /api/deboning/entries/{entry_id}/corrections`.

- [ ] **Step 1: DTO**

Dopisz w `backend/app/models/deboning.py` (obok `DeboningEntryUpdate`):

```python
class DeboningEntryCorrect(BaseModel):
    """POST /api/deboning/entries/{id}/correct — korekta z biura.
    Powód WYMAGANY: korekta zmienia wstecz akord i statystyki."""

    model_config = ConfigDict(populate_by_name=True)

    worker_id: Optional[str] = Field(None, alias="workerId")
    kg_quarter: Optional[float] = Field(None, alias="kgQuarter", ge=0)
    kg_meat: Optional[float] = Field(None, alias="kgMeat", ge=0)
    reason: str = Field(..., min_length=3)
```

- [ ] **Step 2: Trasy**

W `backend/app/routes/deboning.py` zmień pierwszy import na:

```python
from fastapi import APIRouter, HTTPException, Query, Request
```

dodaj `DeboningEntryCorrect` do importu z `app.models.deboning`, i dopisz trasy zaraz po `change_deboning_entry_batch`:

```python
@router.post("/api/deboning/entries/{entry_id}/correct")
def correct_deboning_entry(entry_id: str, dto: DeboningEntryCorrect, request: Request):
    """Korekta z biura: pracownik i/lub kg — działa TAKŻE na zatwierdzonej
    zmianie (to jest jej cel). Dostęp: wyłącznie biuro (permissions.py)."""
    subject = getattr(request.state, "subject", None) or {}
    by = str(subject.get("username") or subject.get("id") or "")
    return svc.correct_deboning_entry(
        entry_id, dto.worker_id, dto.kg_quarter, dto.kg_meat, dto.reason, by
    )


@router.get("/api/deboning/entries/{entry_id}/corrections")
def list_deboning_entry_corrections(entry_id: str):
    return {"corrections": svc.list_entry_corrections(entry_id)}
```

- [ ] **Step 3: Sprawdź, że aplikacja się ładuje i trasy istnieją**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -c "
from app.main import app
paths = [r.path for r in app.routes if 'correct' in r.path or 'corrections' in r.path]
print(paths)
assert '/api/deboning/entries/{entry_id}/correct' in paths
assert '/api/deboning/entries/{entry_id}/corrections' in paths
print('trasy OK')"
```
Expected: `trasy OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/deboning.py backend/app/routes/deboning.py
git commit -m "feat(api): POST /deboning/entries/{id}/correct + GET /corrections"
```

---

### Task 5: Front — przycisk, modal, historia

**Files:**
- Modify: `kebab_fixed/src/lib/api.ts` (obok `deboningEntriesApi.changeBatch`)
- Modify: `kebab_fixed/src/pages/office/DeboningReportsPage.tsx`

**Interfaces:**
- Consumes: endpointy z Task 4.
- Produces: `deboningEntriesApi.correct(id, body)`, `deboningEntriesApi.corrections(id)`.

- [ ] **Step 1: API**

W `kebab_fixed/src/lib/api.ts`, w obiekcie `deboningEntriesApi` (tam, gdzie jest `changeBatch`):

```ts
  // Korekta z biura: pracownik i/lub kg. Działa TAKŻE na zatwierdzonej zmianie
  // (osobny endpoint od PATCH, którego używa HMI). Powód wymagany.
  correct: (id: string, body: { workerId?: string; kgQuarter?: number; kgMeat?: number; reason: string }) =>
    post<any>(`/deboning/entries/${id}/correct`, body),
  corrections: (id: string) =>
    get<{ corrections: EntryCorrection[] }>(`/deboning/entries/${id}/corrections`)
      .then(r => r?.corrections ?? []),
```

oraz typ obok `deboningEntriesApi`:

```ts
export interface EntryCorrection {
  id: string
  at: string | null
  bySubject: string
  reason: string
  changes: Record<string, { from: unknown; to: unknown }>
}
```

- [ ] **Step 2: Modal korekty w `DeboningReportsPage.tsx`**

Wzoruj się na istniejącym modalu „Zmień partię wpisu" (`cbEntry` / `submitChangeBatch`, ok. linii 660-700). Dodaj stan:

```tsx
  const [fixEntry, setFixEntry] = useState<any | null>(null)
  const [fixWorker, setFixWorker] = useState('')
  const [fixQuarter, setFixQuarter] = useState('')
  const [fixMeat, setFixMeat] = useState('')
  const [fixReason, setFixReason] = useState('')
  const [fixBusy, setFixBusy] = useState(false)
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([])

  // UWAGA: obiekt nazywa się usersApi (nie workersApi) — czyta GET /workers.
  useEffect(() => { usersApi.list().then(setWorkers).catch(() => setWorkers([])) }, [])

  function openFix(r: any) {
    setFixEntry(r)
    setFixWorker(r.workerId ?? '')
    setFixQuarter(String(r.kgQuarter ?? ''))
    setFixMeat(String(r.kgMeat ?? ''))
    setFixReason('')
  }

  async function submitFix() {
    if (!fixEntry || fixReason.trim().length < 3) return
    setFixBusy(true)
    try {
      await deboningEntriesApi.correct(fixEntry.id, {
        workerId: fixWorker || undefined,
        kgQuarter: parseFloat(fixQuarter.replace(',', '.')) || undefined,
        kgMeat: parseFloat(fixMeat.replace(',', '.')) || undefined,
        reason: fixReason.trim(),
      })
      setFixEntry(null)
      deboningApi.stats(from, to).then(setData).catch(() => {})
    } catch (e: any) {
      alert(e?.message || 'Nie udało się zapisać korekty')
    } finally {
      setFixBusy(false)
    }
  }
```

Przycisk w wierszu feedu, obok istniejącego „Zmień partię":

```tsx
<button onClick={() => openFix(r)} title="Popraw pracownika lub kg (pomyłka operatora)">
  Popraw
</button>
```

Modal — pola: select pracownika (`workers`), ćwiartka, mięso, powód (wymagany), podgląd uzysku; przycisk zapisu `disabled={fixBusy || fixReason.trim().length < 3}`. Ostrzeżenie nad polem powodu:

```tsx
<p className="text-sm" style={{ color: '#B45309' }}>
  Korekta zmieni wstecz akord pracownika i statystyki. Powód trafi do historii wpisu.
</p>
```

- [ ] **Step 3: Historia korekt**

Pod polami modala pokaż historię (ładowaną przy `openFix`):

```tsx
  const [fixHistory, setFixHistory] = useState<EntryCorrection[]>([])
  // w openFix:
  deboningEntriesApi.corrections(r.id).then(setFixHistory).catch(() => setFixHistory([]))
```

Render: lista `at` (data), `bySubject`, `reason` i pary `from → to` z `changes`.

- [ ] **Step 4: Typecheck + build + testy frontu**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx tsc --noEmit && npm run build 2>&1 | tail -3 && npx vitest run --reporter=basic 2>&1 | tail -3
```
Expected: tsc bez błędów, build OK, vitest 111 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/pages/office/DeboningReportsPage.tsx
git commit -m "feat(biuro): przycisk Popraw — korekta pracownika/kg wpisu + historia korekt"
```

---

### Task 6: Wdrożenie i weryfikacja na produkcji

**Files:** brak zmian w kodzie.

- [ ] **Step 1: Diff prod↔repo (REGUŁA pre-deploy)**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
diff -rq /opt/kebab/app/backend/app backend/app | grep -v __pycache__ | grep -v "\.bak-"
```
Expected: różnice WYŁĄCZNIE w plikach zmienionych tym planem. Jeśli jest coś innego — zmiany prod-only, scommituj je do `main` NAJPIERW.

- [ ] **Step 2: Wdróż backend + migracja**

```bash
cp backend/app/auth/permissions.py backend/app/migrations.py \
   backend/app/services/deboning_service.py backend/app/models/deboning.py \
   backend/app/routes/deboning.py /opt/kebab/app/backend/app/  # UWAGA: zachowaj podkatalogi
```
(kopiuj z zachowaniem ścieżek: `auth/`, `services/`, `models/`, `routes/`)

Migracja odpali się przy starcie; potem:

```bash
systemctl reload kebab-mes && sleep 4 && systemctl is-active kebab-mes
curl -s -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:8010/api/health
journalctl -u kebab-mes --since "2 minutes ago" --no-pager | grep -icE "error|traceback"
```
Expected: `active`, `health: 200`, `0` błędów

- [ ] **Step 3: Sprawdź, że tabela powstała na PROD**

```bash
# przez MCP kebab-mes-db albo psql
SELECT COUNT(*) FROM deboning_entry_corrections;
```
Expected: `0`

- [ ] **Step 4: Popraw realne pomyłki właściciela**

Przez UI biura, w feedzie za 14–15.07:
- 15.07 — wpis Adriana → zmień pracownika na Raschada, powód „pomyłka operatora — Adrian zamiast Raschada".
- 14.07 — popraw kg Evgheniego i drugiego pracownika, powód opisujący korektę.

- [ ] **Step 5: Potwierdź, że akord się przeniósł**

Porównaj ranking pracowników w raporcie za 14–15.07 przed i po. `kgQuarter` Raschada ma wzrosnąć o wartość poprawionego wpisu, Adriana — zmaleć.

---

## Self-Review

**Pokrycie spec:** tabela korekt → Task 2; endpoint `/correct` bez `validate_session_writable` → Task 3+4; `GET /corrections` → Task 3+4; RBAC office-only → Task 1; korekta stanów przez `validate_edit_deltas` → Task 3; zmiana pracownika z `workers` → Task 3; UI przycisk/modal/powód/ostrzeżenie/historia → Task 5; testy 1-10 ze spec → Task 1 (RBAC) + Task 3 (reszta). Wszystko pokryte.

**Spójność typów:** `correct_deboning_entry(entry_id, worker_id, kg_quarter, kg_meat, reason, by_subject)` — ta sama sygnatura w Task 3 (definicja), Task 3 (testy) i Task 4 (trasa). `list_entry_corrections` zwraca `bySubject`/`reason`/`changes` — zgodne z `EntryCorrection` w Task 5.

**Świadomie pominięte:** cofanie korekt, edycja grzbietów/kości per wpis, transfer kg między wpisami (patrz spec, sekcja „Świadomie poza zakresem").
