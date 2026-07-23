# Zamknięcie dnia produkcji (korekta ścinków/strat przyprawionego) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dać biuru jedno miejsce (nowa zakładka na `SeasonedMeatPage`) do wpisania,
raz dziennie per receptura, ile mięsa przyprawionego faktycznie zostało — żeby
żywy stan (`seasoned_meat.kg_available`) korygował się do rzeczywistości zamiast
cicho się rozjeżdżać, gdy ścinki z formowania kebaba nikną z bilansu.

**Architektura:** Rozszerzenie istniejącego mechanizmu `reconcile_seasoned_batch`
(korekta teoria↔fizyka pojedynczej partii, z audytem przez `stock_movements`) na
poziom grupy `(recipe_id, production_day)`. Wspólny rdzeń `_reconcile_row`
używany przez oba warianty. Zero nowych tabel — historia korekt czytana z
istniejącego `stock_movements`. Frontend: nowy, samodzielny komponent zakładki
wstrzyknięty do `SeasonedMeatPage.tsx`.

**Tech Stack:** FastAPI + psycopg2 (backend), React + TypeScript + Vite (frontend),
PostgreSQL, pytest (testy DB przez `TEST_DATABASE_URL`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-zamkniecie-dnia-produkcji-design.md` —
  wszystkie decyzje zakresu stamtąd obowiązują (zbiorczo per dzień, koryguje
  żywy stan, zakładka na `SeasonedMeatPage`, bez nowej tabeli audytowej).
- Testy DB: `export TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test"`
  (zweryfikowane działające — kontener `kebab-op` na porcie 55437, baza
  `kebab_mes_test` ma już wszystkie potrzebne kolumny). Bez tej zmiennej testy
  z fixture `db` cicho się pomijają (fałszywe zielone) — zawsze sprawdzaj, że
  faktycznie się wykonały, nie tylko że `pytest` zwrócił 0.
- Uruchamianie backendu: `cd backend && python3 -m pytest -q` (z ustawionym
  `TEST_DATABASE_URL` dla testów `*_db.py`).
- Frontend dev server: `npm run dev` w katalogu głównym repo.
- Nie ruszać `finish_day` / `finished_units_service` — zużycie teoretyczne
  `qty * kg_per_unit` zostaje bez zmian (poza zakresem specu).
- Nie dodawać kolumny/pola "kto" (reconciled_by) — systemowa luka, świadomie
  poza zakresem (patrz spec, sekcja "Poza zakresem").

---

## File Structure

- Modify: `backend/app/utils/batch_numbers.py` — dodaje `scrap_pool_batch_no`.
- Modify: `backend/app/services/seasoned_meat_service.py` — rdzeń `_reconcile_row`,
  nowe funkcje `reconcile_production_day`, `list_production_days`,
  `list_day_reconciliation_history`, pomocnicza pure `_group_production_day_rows`.
- Modify: `backend/app/routes/seasoned_meat.py` — 3 nowe endpointy.
- Modify: `src/lib/api.ts` — 3 nowe metody w `seasonedMeatApi`.
- Create: `src/pages/office/SeasonedProductionDayTab.tsx` — cała nowa zakładka
  (samodzielny komponent, wzorzec `RawStockBatchCard.tsx`).
- Modify: `src/pages/office/SeasonedMeatPage.tsx` — pasek zakładek + montowanie
  nowego komponentu.
- Create: `backend/tests/test_batch_numbers.py` (rozszerzenie istniejącego pliku).
- Create: `backend/tests/test_seasoned_reconcile_db.py` — charakteryzacja
  istniejącego zachowania + testy nowych funkcji DB.

---

### Task 1: `SC{n}` — numeracja puli ścinków

**Files:**
- Modify: `backend/app/utils/batch_numbers.py`
- Test: `backend/tests/test_batch_numbers.py`

**Interfaces:**
- Produces: `scrap_pool_batch_no(n: int) -> str` (zwraca `f"SC{n}"`).
  (Bez recognizera `is_scrap_pool` — sprawdzone, że `seasoned_trace` i frontend
  traktują `batch_no` czysto tekstowo, format `SC{n}` nie wymaga nigdzie
  specjalnego rozpoznawania w tym zadaniu; dodanie nieużywanej funkcji
  byłoby złamaniem YAGNI.)

- [ ] **Step 1: Napisz failing testy**

Dopisz na końcu `backend/tests/test_batch_numbers.py` (sprawdź najpierw istniejącą
zawartość pliku, żeby dopasować styl importów — plik już istnieje):

```python
from app.utils.batch_numbers import scrap_pool_batch_no


def test_scrap_pool_batch_no_format():
    assert scrap_pool_batch_no(1) == "SC1"
    assert scrap_pool_batch_no(12) == "SC12"
```

- [ ] **Step 2: Uruchom testy, potwierdź FAIL**

Run: `cd backend && python3 -m pytest tests/test_batch_numbers.py -v -k scrap`
Expected: `ImportError` / `AttributeError` — `scrap_pool_batch_no` nie istnieje.

- [ ] **Step 3: Zaimplementuj**

W `backend/app/utils/batch_numbers.py`:

1. Zaktualizuj docstring modułu (linie 1-12), dopisz do listy formatów:

```python
  * pula ścinków z dnia produkcji         → "SC{n}", np. "SC1"
    (fizyczna nadwyżka/domknięcie dnia, gdy żadna partia przyprawionego
     z tego dnia nie jest już żywa — patrz reconcile_production_day)
```

2. Dodaj po `is_production_mixed` (po linii 79):

```python
def scrap_pool_batch_no(n: int) -> str:
    """Numer puli ścinków z dnia produkcji (fizyczna nadwyżka bez żywej
    partii do skorygowania — patrz reconcile_production_day)."""
    return f"SC{n}"
```

- [ ] **Step 4: Uruchom testy, potwierdź PASS**

Run: `cd backend && python3 -m pytest tests/test_batch_numbers.py -v`
Expected: wszystkie PASS (stare + 1 nowy).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/batch_numbers.py backend/tests/test_batch_numbers.py
git commit -m "feat: dodaj numerację SC{n} dla puli ścinków z dnia produkcji"
```

---

### Task 2: Charakteryzacja istniejącego `reconcile_seasoned_batch` (siatka bezpieczeństwa przed refaktorem)

**Files:**
- Create: `backend/tests/test_seasoned_reconcile_db.py`

**Interfaces:**
- Consumes: `seasoned_meat_service.reconcile_seasoned_batch(seasoned_id, target_kg, reason="", close=False)`
  (istniejąca funkcja, `backend/app/services/seasoned_meat_service.py:66`).

- [ ] **Step 1: Napisz testy opisujące DZISIEJSZE zachowanie**

Utwórz `backend/tests/test_seasoned_reconcile_db.py`:

```python
"""Charakteryzacja reconcile_seasoned_batch PRZED refaktorem na _reconcile_row —
siatka bezpieczeństwa: te testy muszą przejść identycznie przed i po Task 3."""
from fastapi import HTTPException
import pytest

from app.db import execute, query_one
from app.services.seasoned_meat_service import reconcile_seasoned_batch
from app.utils.ids import now_iso


def _seed_batch(id="sm1", recipe_id="r1", recipe_name="Gold", production_day="2026-07-20",
                 kg_produced=100.0, kg_available=100.0, kg_reserved=0.0, status="available"):
    execute(
        "INSERT INTO recipes (id, name) VALUES (%s,%s) ON CONFLICT (id) DO NOTHING",
        (recipe_id, recipe_name),
    )
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name, kg_produced,"
        " kg_available, kg_used, kg_reserved, status, production_day, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)",
        (id, id, recipe_id, recipe_name, kg_produced, kg_available, kg_reserved,
         status, production_day, now_iso()),
    )


def test_podbicie_wagi_gdy_teoria_zanizona(db):
    _seed_batch(kg_produced=119.0, kg_available=119.0)
    row = reconcile_seasoned_batch("sm1", 120.0, "zaniżona teoria")
    assert row["kg_available"] == 120.0 or float(row["kg_available"]) == 120.0
    saved = query_one("SELECT kg_available, kg_produced, status FROM seasoned_meat WHERE id='sm1'")
    assert float(saved["kg_available"]) == 120.0
    assert float(saved["kg_produced"]) == 120.0
    assert saved["status"] == "available"


def test_zamkniecie_do_zera_ustawia_status_closed(db):
    _seed_batch(kg_produced=12.0, kg_available=12.0)
    reconcile_seasoned_batch("sm1", 0, "resztka technologiczna", close=True)
    saved = query_one("SELECT kg_available, status FROM seasoned_meat WHERE id='sm1'")
    assert float(saved["kg_available"]) == 0.0
    assert saved["status"] == "closed"


def test_blokada_ponizej_rezerwacji(db):
    _seed_batch(kg_available=100.0, kg_reserved=40.0)
    with pytest.raises(HTTPException) as exc:
        reconcile_seasoned_batch("sm1", 30.0, "test")
    assert exc.value.status_code == 400


def test_brak_zmiany_wagi_odrzucone(db):
    _seed_batch(kg_available=100.0)
    with pytest.raises(HTTPException) as exc:
        reconcile_seasoned_batch("sm1", 100.0, "test")
    assert exc.value.status_code == 400


def test_tworzy_ruch_magazynowy_audytowy(db):
    _seed_batch(kg_available=100.0)
    reconcile_seasoned_batch("sm1", 92.0, "strata / odpad")
    mv = query_one(
        "SELECT movement_type, qty, source_type FROM stock_movements"
        " WHERE batch_id='sm1' ORDER BY created_at DESC LIMIT 1"
    )
    assert mv["movement_type"] == "OUT"
    assert float(mv["qty"]) == 8.0
    assert mv["source_type"] == "reconcile"
```

- [ ] **Step 2: Uruchom testy, potwierdź PASS na dzisiejszym kodzie**

Run:
```bash
export TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test"
cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v
```
Expected: 5 PASS. To jest **charakteryzacja**, nie TDD-na-nową-funkcję — testy
opisują istniejące zachowanie i muszą być zielone ZANIM zaczniesz refaktor
w Task 3.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/tests/test_seasoned_reconcile_db.py
git commit -m "test: charakteryzacja reconcile_seasoned_batch przed refaktorem"
```

---

### Task 3: Refaktor — wydzielenie `_reconcile_row`

**Files:**
- Modify: `backend/app/services/seasoned_meat_service.py:66-151`

**Interfaces:**
- Produces: `_reconcile_row(conn, row: Dict[str, Any], target_kg: float, reason: str = "", close: bool = False) -> float`
  — zwraca zastosowaną deltę (0.0 gdy brak zmiany i `close=False`); zakłada,
  że `row` jest już pobrany z `FOR UPDATE` w bieżącej transakcji `conn`.
- Consumes (nie zmienia się): `reconcile_seasoned_batch(seasoned_id, target_kg, reason="", close=False) -> Dict[str, Any]`
  — ten sam kontrakt publiczny, ta sama sygnatura, to samo zachowanie
  (zweryfikowane testami z Task 2).

- [ ] **Step 1: Zastąp linie 66-151 w `seasoned_meat_service.py`**

Podmień całą funkcję `reconcile_seasoned_batch` (linie 66-151) na:

```python
def _reconcile_row(
    conn,
    row: Dict[str, Any],
    target_kg: float,
    reason: str = "",
    close: bool = False,
) -> float:
    """Rdzeń korekty jednej partii przyprawionej — współdzielony przez
    `reconcile_seasoned_batch` (pojedyncza partia) i `reconcile_production_day`
    (grupa partii jednego dnia produkcji). Zakłada, że `row` jest już pobrany
    z `FOR UPDATE` w bieżącej transakcji `conn`. Zwraca zastosowaną deltę
    (target - stara dostępna waga); 0.0 gdy brak zmiany i `close=False`.

    kg_produced jest WYLICZONE z receptury (mięso × %), więc realna waga
    zawsze różni się o 1–3 kg (dozowanie, chłonność wody, wagi). Ustawia
    REALNĄ dostępną wagę: teoria zaniżona → podnieś, resztka po produkcji
    (za dużo) → zamknij (``close``) do 0. Różnica idzie ruchem magazynowym
    (IN gdy +, OUT gdy −; product_type 'seasoned', source 'reconcile') —
    udokumentowany ślad dla kosztu i dokumentów weterynaryjnych. kg_produced
    podąża za korektą (produced = used + available + reserved). Koszt/kg
    liczy się z receptury, więc korekta go nie rusza — patrz cost_service.

    Blokady: partia zamknięta; waga < kg zarezerwowanych pod plan (najpierw
    zwolnij plan); waga ujemna.
    """
    seasoned_id = row["id"]
    if (row.get("status") or "") == "closed":
        raise HTTPException(400, "Partia jest już zamknięta")

    old_avail = float(row.get("kg_available") or 0)
    reserved = float(row.get("kg_reserved") or 0)
    target = 0.0 if close else round(float(target_kg or 0), 3)
    if target < 0:
        raise HTTPException(400, "Waga nie może być ujemna")
    if target + 0.001 < reserved:
        raise HTTPException(
            400,
            f"W partii jest {reserved:.1f} kg zarezerwowane pod plan — nie "
            f"można zejść poniżej. Najpierw zwolnij/usuń pozycję planu.",
        )

    delta = round(target - old_avail, 3)
    if abs(delta) < 0.001 and not close:
        return 0.0

    new_produced = round(float(row.get("kg_produced") or 0) + delta, 3)
    new_status = "closed" if close else (row.get("status") or "available")
    cx_execute(
        conn,
        """
        UPDATE seasoned_meat
        SET kg_available=%s, kg_produced=%s, status=%s,
            reconciled_at=%s, reconcile_reason=%s
        WHERE id=%s
        """,
        (target, new_produced, new_status, now_iso(), (reason or None), seasoned_id),
    )
    if delta > 0.001:
        create_stock_movement(
            conn, product_type="seasoned", batch_id=seasoned_id,
            qty=delta, movement_type="IN",
            source_type="reconcile", source_id=seasoned_id,
        )
    elif delta < -0.001:
        create_stock_movement(
            conn, product_type="seasoned", batch_id=seasoned_id,
            qty=-delta, movement_type="OUT",
            source_type="reconcile", source_id=seasoned_id,
        )
    return delta


def reconcile_seasoned_batch(
    seasoned_id: str,
    target_kg: float,
    reason: str = "",
    close: bool = False,
) -> Dict[str, Any]:
    """Ręczna korekta/zamknięcie POJEDYNCZEJ partii przyprawionej — wrapper
    nad `_reconcile_row` dla API `/seasoned-meat/{id}/reconcile`. Logika
    opisana w `_reconcile_row`."""
    with transaction() as conn:
        b = cx_query_one(
            conn, "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE", (seasoned_id,)
        )
        if not b:
            raise HTTPException(404, "Partia przyprawiona nie znaleziona")

        delta = _reconcile_row(conn, b, target_kg, reason, close)
        if delta == 0.0 and not close:
            raise HTTPException(400, "Brak zmiany wagi — podaj inną wartość.")

        row = cx_query_one(
            conn,
            "SELECT *, (kg_available - COALESCE(kg_reserved,0)) AS kg_free "
            "FROM seasoned_meat WHERE id=%s",
            (seasoned_id,),
        )
    logger.info(
        "seasoned.reconciled",
        extra={
            "seasoned_id": seasoned_id, "delta": delta,
            "close": close, "reason": reason or "",
        },
    )
    return row
```

- [ ] **Step 2: Uruchom testy charakteryzacyjne z Task 2, potwierdź nadal PASS**

Run:
```bash
export TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test"
cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v
```
Expected: 5 PASS, identycznie jak przed refaktorem. Jeśli którykolwiek padnie —
zachowanie się zmieniło, napraw przed przejściem dalej.

- [ ] **Step 3: Uruchom pełny zestaw testów seasoned/mixing (regresja)**

Run: `cd backend && python3 -m pytest tests/test_seasoned_split.py -v`
Expected: PASS (ten plik nie dotyka DB, powinien przejść niezależnie od
`TEST_DATABASE_URL`).

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/seasoned_meat_service.py
git commit -m "refactor: wydziel _reconcile_row jako rdzeń współdzielony przez korektę partii"
```

---

### Task 4: `reconcile_production_day` — przypadek jednej partii w grupie

**Files:**
- Modify: `backend/app/services/seasoned_meat_service.py`
- Test: `backend/tests/test_seasoned_reconcile_db.py`

**Interfaces:**
- Consumes: `_reconcile_row` (Task 3).
- Produces: `reconcile_production_day(recipe_id: str, production_day: str, actual_kg: float, reason: str = "") -> Dict[str, Any]`
  zwraca `{"theoreticalKg": float, "actualKg": float, "delta": float, "affectedBatches": List[Dict]}`,
  gdzie każdy element `affectedBatches` to `{"id": str, "batchNo": str, "deltaApplied": float}`.

- [ ] **Step 1: Napisz failing testy**

Dopisz do `backend/tests/test_seasoned_reconcile_db.py`:

```python
from app.services.seasoned_meat_service import reconcile_production_day


def test_jedna_partia_w_grupie_dziala_jak_pojedyncza_korekta(db):
    _seed_batch(kg_produced=244.0, kg_available=244.0, production_day="2026-07-23")
    out = reconcile_production_day("r1", "2026-07-23", 229.0, "ścinki / resztki z produkcji")
    assert out["theoreticalKg"] == 244.0
    assert out["actualKg"] == 229.0
    assert out["delta"] == -15.0
    assert len(out["affectedBatches"]) == 1
    assert out["affectedBatches"][0]["batchNo"] == "sm1"
    saved = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm1'")
    assert float(saved["kg_available"]) == 229.0


def test_blokada_ponizej_sumy_rezerwacji_grupy(db):
    _seed_batch(kg_available=100.0, kg_reserved=40.0, production_day="2026-07-23")
    with pytest.raises(HTTPException) as exc:
        reconcile_production_day("r1", "2026-07-23", 30.0, "test")
    assert exc.value.status_code == 400


def test_brak_zmiany_odrzucone(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    with pytest.raises(HTTPException) as exc:
        reconcile_production_day("r1", "2026-07-23", 100.0, "test")
    assert exc.value.status_code == 400


def test_delta_dodatnia_tworzy_ruch_in(db):
    _seed_batch(kg_produced=100.0, kg_available=100.0, production_day="2026-07-23")
    reconcile_production_day("r1", "2026-07-23", 105.0, "zaniżona teoria")
    mv = query_one(
        "SELECT movement_type, qty FROM stock_movements"
        " WHERE batch_id='sm1' ORDER BY created_at DESC LIMIT 1"
    )
    assert mv["movement_type"] == "IN"
    assert float(mv["qty"]) == 5.0
```

- [ ] **Step 2: Uruchom testy, potwierdź FAIL**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v -k production_day`
Expected: `ImportError`/`AttributeError` — `reconcile_production_day` nie istnieje.

- [ ] **Step 3: Zaimplementuj (wersja bez wielu partii i bez SC{n} — dochodzą w Task 5/6)**

Dodaj na końcu `backend/app/services/seasoned_meat_service.py`:

```python
def reconcile_production_day(
    recipe_id: str,
    production_day: str,
    actual_kg: float,
    reason: str = "",
) -> Dict[str, Any]:
    """Zbiorcza korekta teoria↔fizyka dla WSZYSTKICH żywych partii jednej
    receptury z jednego dnia produkcji ("zamknięcie dnia"). Reużywa
    `_reconcile_row` per partia — patrz jej docstring dla mechaniki korekty
    pojedynczego wiersza.

    Różnica (`actual_kg` minus suma teoretycznych `kg_available`) trafia na
    partie w kolejności FEFO (`expiry_date`, potem `created_at` — najstarsza
    pierwsza): dodatnia w całości na najstarszą, ujemna rozkłada się po
    partiach, ile każda może oddać bez zejścia poniżej WŁASNEJ rezerwacji.
    Wstępna walidacja (`actual_kg >= suma rezerwacji`) gwarantuje matematycznie,
    że pętla rozłoży całą ujemną deltę bez wyjątków w trakcie.
    """
    actual_kg = round(float(actual_kg or 0), 3)
    if actual_kg < 0:
        raise HTTPException(400, "Waga nie może być ujemna")

    with transaction() as conn:
        rows = cx_query_all(
            conn,
            """
            SELECT * FROM seasoned_meat
            WHERE recipe_id = %s AND production_day = %s AND status != 'closed'
            ORDER BY expiry_date ASC NULLS LAST, created_at ASC
            FOR UPDATE
            """,
            (recipe_id, production_day),
        )

        theoretical = round(sum(float(r.get("kg_available") or 0) for r in rows), 3)
        reserved_total = round(sum(float(r.get("kg_reserved") or 0) for r in rows), 3)

        if actual_kg + 0.001 < reserved_total:
            raise HTTPException(
                400,
                f"W partiach tego dnia jest {reserved_total:.1f} kg zarezerwowane "
                f"pod plan — nie można zejść poniżej. Najpierw zwolnij/usuń "
                f"pozycje planu.",
            )

        delta = round(actual_kg - theoretical, 3)
        if abs(delta) < 0.001:
            raise HTTPException(400, "Brak zmiany wagi — podaj inną wartość.")

        affected: List[Dict[str, Any]] = []
        remaining = delta
        for row in rows:
            row_avail = float(row.get("kg_available") or 0)
            row_reserved = float(row.get("kg_reserved") or 0)
            if remaining >= 0:
                apply = remaining
            else:
                max_giveable = row_avail - row_reserved
                apply = max(remaining, -max_giveable)
            if abs(apply) < 0.0005:
                continue
            target = round(row_avail + apply, 3)
            applied = _reconcile_row(conn, row, target, reason)
            affected.append({
                "id": row["id"], "batchNo": row["batch_no"], "deltaApplied": applied,
            })
            remaining = round(remaining - apply, 3)
            if abs(remaining) < 0.0005:
                break

        logger.info(
            "seasoned.production_day_reconciled",
            extra={
                "recipe_id": recipe_id, "production_day": production_day,
                "theoretical_kg": theoretical, "actual_kg": actual_kg,
                "delta": delta, "reason": reason or "",
                "affected_count": len(affected),
            },
        )
        return {
            "theoreticalKg": theoretical,
            "actualKg": actual_kg,
            "delta": delta,
            "affectedBatches": affected,
        }
```

- [ ] **Step 4: Uruchom testy, potwierdź PASS**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v`
Expected: wszystkie PASS (charakteryzacyjne z Task 2 + nowe 4).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/seasoned_meat_service.py backend/tests/test_seasoned_reconcile_db.py
git commit -m "feat: reconcile_production_day — zbiorcza korekta dnia produkcji (jedna partia w grupie)"
```

---

### Task 5: `reconcile_production_day` — rozkład delty na wiele partii (FEFO)

**Files:**
- Modify: `backend/tests/test_seasoned_reconcile_db.py` (test only — implementacja
  z Task 4 już obsługuje wiele wierszy, ten task ją weryfikuje i domyka).

**Interfaces:**
- Consumes: `reconcile_production_day` (Task 4, bez zmian kodu).

- [ ] **Step 1: Napisz failing test (a właściwie: potwierdzający) dla wielu partii**

Dopisz do `backend/tests/test_seasoned_reconcile_db.py`:

```python
def _seed_second_batch(id="sm2", recipe_id="r1", recipe_name="Gold",
                        production_day="2026-07-23", kg_available=50.0,
                        kg_reserved=0.0, expiry_date="2026-07-30"):
    execute(
        "INSERT INTO seasoned_meat (id, batch_no, recipe_id, recipe_name,"
        " kg_produced, kg_available, kg_used, kg_reserved, status,"
        " production_day, expiry_date, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,0,%s,'available',%s,%s,%s)",
        (id, id, recipe_id, recipe_name, kg_available, kg_available,
         kg_reserved, production_day, expiry_date, now_iso()),
    )


def test_delta_ujemna_przechodzi_na_druga_partie_gdy_pierwsza_zarezerwowana(db):
    # sm1: starsza (expiry wcześniej), w całości zarezerwowana pod plan —
    # nie da się z niej nic zabrać. sm2: młodsza, wolna.
    _seed_batch(kg_available=100.0, kg_reserved=100.0, production_day="2026-07-23")
    execute("UPDATE seasoned_meat SET expiry_date='2026-07-25' WHERE id='sm1'")
    _seed_second_batch(kg_available=50.0, kg_reserved=0.0, expiry_date="2026-07-30")

    out = reconcile_production_day("r1", "2026-07-23", 130.0, "ścinki / resztki z produkcji")
    assert out["theoreticalKg"] == 150.0
    assert out["delta"] == -20.0
    # sm1 nietknięta (zarezerwowana), cała delta na sm2
    sm1 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm1'")
    sm2 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm2'")
    assert float(sm1["kg_available"]) == 100.0
    assert float(sm2["kg_available"]) == 30.0
    assert len(out["affectedBatches"]) == 1
    assert out["affectedBatches"][0]["batchNo"] == "sm2"


def test_delta_ujemna_rozklada_sie_gdy_pierwsza_nie_wystarcza(db):
    _seed_batch(kg_available=100.0, kg_reserved=90.0, production_day="2026-07-23")
    execute("UPDATE seasoned_meat SET expiry_date='2026-07-25' WHERE id='sm1'")
    _seed_second_batch(kg_available=50.0, kg_reserved=0.0, expiry_date="2026-07-30")

    # teoretycznie 150, rezerwacja łącznie 90 -> może zejść do 90.
    out = reconcile_production_day("r1", "2026-07-23", 100.0, "ścinki / resztki z produkcji")
    assert out["delta"] == -50.0
    sm1 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm1'")
    sm2 = query_one("SELECT kg_available FROM seasoned_meat WHERE id='sm2'")
    # sm1 oddaje maksymalnie 10 (100-90 rezerwacji), reszta (40) z sm2
    assert float(sm1["kg_available"]) == 90.0
    assert float(sm2["kg_available"]) == 10.0
    assert len(out["affectedBatches"]) == 2
```

- [ ] **Step 2: Uruchom testy**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v -k "druga_partie or rozklada"`
Expected: implementacja z Task 4 już to obsługuje — PASS bez zmian w kodzie
produkcyjnym. Jeśli którykolwiek FAIL, napraw pętlę w `reconcile_production_day`
(najczęstszy błąd: sortowanie FEFO albo błędny znak `max_giveable`).

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/tests/test_seasoned_reconcile_db.py
git commit -m "test: rozkład delty na wiele partii FEFO w reconcile_production_day"
```

---

### Task 6: `SC{n}` — pula ścinków, gdy brak żywej partii w grupie

**Files:**
- Modify: `backend/app/services/seasoned_meat_service.py`
- Modify: `backend/tests/test_seasoned_reconcile_db.py`

**Interfaces:**
- Consumes: `scrap_pool_batch_no` (Task 1), `next_seq` (już zaimportowane z
  `app.utils.ids`), `cuid`, `now_iso`.

- [ ] **Step 1: Napisz failing testy**

Dopisz do `backend/tests/test_seasoned_reconcile_db.py`:

```python
def test_brak_zywych_partii_tworzy_pule_sc(db):
    _seed_batch(kg_available=0.0, status="closed", production_day="2026-07-23")
    out = reconcile_production_day("r1", "2026-07-23", 18.0, "ścinki / resztki z produkcji")
    assert out["theoreticalKg"] == 0.0
    assert out["actualKg"] == 18.0
    assert out["delta"] == 18.0
    assert len(out["affectedBatches"]) == 1
    assert out["affectedBatches"][0]["batchNo"] == "SC1"

    new_row = query_one("SELECT * FROM seasoned_meat WHERE batch_no='SC1'")
    assert new_row is not None
    assert float(new_row["kg_available"]) == 18.0
    assert float(new_row["kg_produced"]) == 18.0
    assert new_row["recipe_id"] == "r1"
    assert new_row["recipe_name"] == "Gold"
    assert str(new_row["production_day"]) == "2026-07-23"
    assert new_row["status"] == "available"

    mv = query_one(
        "SELECT movement_type, qty FROM stock_movements"
        " WHERE batch_id=%s ORDER BY created_at DESC LIMIT 1",
        (new_row["id"],),
    )
    assert mv["movement_type"] == "IN"
    assert float(mv["qty"]) == 18.0


def test_brak_zywych_partii_i_actual_zero_no_op(db):
    _seed_batch(kg_available=0.0, status="closed", production_day="2026-07-23")
    out = reconcile_production_day("r1", "2026-07-23", 0.0, "sprawdzone, zgadza się")
    assert out == {"theoreticalKg": 0.0, "actualKg": 0.0, "delta": 0.0, "affectedBatches": []}
    count = query_one("SELECT count(*) AS n FROM seasoned_meat WHERE recipe_id='r1'")
    assert count["n"] == 1  # tylko sm1, żadnej nowej partii


def test_druga_pula_sc_tego_samego_dnia_dostaje_kolejny_numer(db):
    _seed_batch(kg_available=0.0, status="closed", production_day="2026-07-23")
    reconcile_production_day("r1", "2026-07-23", 10.0, "ścinki")
    execute("UPDATE seasoned_meat SET status='closed' WHERE batch_no='SC1'")
    out = reconcile_production_day("r1", "2026-07-23", 5.0, "ścinki, druga tura")
    assert out["affectedBatches"][0]["batchNo"] == "SC2"
```

Uwaga w teście `test_brak_zywych_partii_i_actual_zero_no_op`: `raise
HTTPException("Brak zmiany...")` z góry funkcji odpaliłby się tylko, gdyby
`theoretical == actual`; tu `theoretical=0, actual=0` więc **wpadnie w ten sam
early-exit co "brak zmiany"** — to jest poprawne zachowanie (nic do
skorygowania), ale oznacza, że funkcja musi zwrócić ten sam kształt zamiast
rzucać wyjątek w tym konkretnym przypadku zerowym. Zaimplementuj to explicite
w Step 3 (specjalny warunek PRZED ogólnym „brak zmiany").

- [ ] **Step 2: Uruchom testy, potwierdź FAIL**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v -k "sc or SC"`
Expected: FAIL — brak obsługi przypadku pustej listy `rows`.

- [ ] **Step 3: Zaimplementuj**

W `backend/app/services/seasoned_meat_service.py`:

1. Rozszerz import z `batch_numbers` (znajdź linię `from app.utils.batch_numbers
   import combined_batch_no` i zastąp):

```python
from app.utils.batch_numbers import combined_batch_no, scrap_pool_batch_no
```

2. W `reconcile_production_day`, zaraz PO walidacji `reserved_total` (przed
   linią `delta = round(actual_kg - theoretical, 3)`), dodaj obsługę pustej
   grupy:

```python
        if not rows:
            if actual_kg < 0.001:
                return {
                    "theoreticalKg": 0.0, "actualKg": 0.0,
                    "delta": 0.0, "affectedBatches": [],
                }
            recipe = cx_query_one(conn, "SELECT name FROM recipes WHERE id=%s", (recipe_id,))
            recipe_name = (recipe or {}).get("name", "")
            new_id = cuid()
            batch_no = scrap_pool_batch_no(next_seq("sc_seq"))
            expiry = (
                datetime.fromisoformat(production_day) + timedelta(days=5)
            ).date().isoformat()
            cx_execute(
                conn,
                """
                INSERT INTO seasoned_meat
                    (id, batch_no, recipe_id, recipe_name, kg_produced,
                     kg_available, kg_used, status, production_day, expiry_date,
                     reconciled_at, reconcile_reason, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,0,'available',%s,%s,%s,%s,%s)
                """,
                (new_id, batch_no, recipe_id, recipe_name, actual_kg,
                 actual_kg, production_day, expiry, now_iso(),
                 (reason or None), now_iso()),
            )
            create_stock_movement(
                conn, product_type="seasoned", batch_id=new_id,
                qty=actual_kg, movement_type="IN",
                source_type="reconcile", source_id=new_id,
            )
            logger.info(
                "seasoned.production_day_scrap_pool_created",
                extra={
                    "recipe_id": recipe_id, "production_day": production_day,
                    "batch_no": batch_no, "kg": actual_kg,
                },
            )
            return {
                "theoreticalKg": 0.0, "actualKg": actual_kg,
                "delta": actual_kg,
                "affectedBatches": [{"id": new_id, "batchNo": batch_no, "deltaApplied": actual_kg}],
            }
```

3. `datetime` i `timedelta` są już zaimportowane w linii 3 pliku
   (`from datetime import datetime, timedelta`) — żadna zmiana importów nie
   jest tu potrzebna.

- [ ] **Step 4: Uruchom testy, potwierdź PASS**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v`
Expected: wszystkie PASS (całość: charakteryzacja + Task 4/5/6).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/seasoned_meat_service.py backend/tests/test_seasoned_reconcile_db.py
git commit -m "feat: pula ścinków SC{n} gdy brak żywej partii do skorygowania"
```

---

### Task 7: `list_production_days` — grupy receptura×dzień

**Files:**
- Modify: `backend/app/services/seasoned_meat_service.py`
- Test: `backend/tests/test_seasoned_reconcile_db.py`, nowy plik pure-logic
  `backend/tests/test_production_day_grouping.py`

**Interfaces:**
- Produces: `_group_production_day_rows(rows: List[Dict], production_day: str) -> List[Dict]`
  (pure, bez DB) oraz `list_production_days(production_day: str) -> List[Dict]`
  (DB wrapper). Każdy element: `{recipeId, recipeName, productionDay,
  theoreticalKg, batchCount, lastReconciledAt, lastReconcileReason}`.

- [ ] **Step 1: Napisz failing pure-logic testy**

Utwórz `backend/tests/test_production_day_grouping.py`:

```python
"""Czyste grupowanie wierszy seasoned_meat po recepturze dla zakładki
'Zamknięcie dnia' — bez DB, wzorzec analogiczny do split_seasoned_sessions."""
from app.services.seasoned_meat_service import _group_production_day_rows

ROWS = [
    {"recipe_id": "r1", "recipe_name": "Gold", "status": "available",
     "kg_available": 100.0, "reconciled_at": None, "reconcile_reason": None},
    {"recipe_id": "r1", "recipe_name": "Gold", "status": "available",
     "kg_available": 50.0, "reconciled_at": "2026-07-23T10:00:00", "reconcile_reason": "ścinki"},
    {"recipe_id": "r2", "recipe_name": "Classic", "status": "closed",
     "kg_available": 0.0, "reconciled_at": None, "reconcile_reason": None},
]


def test_grupuje_po_recepturze_sumuje_teoretyczne():
    groups = {g["recipeId"]: g for g in _group_production_day_rows(ROWS, "2026-07-23")}
    assert groups["r1"]["theoreticalKg"] == 150.0
    assert groups["r1"]["batchCount"] == 2
    assert groups["r1"]["recipeName"] == "Gold"
    assert groups["r1"]["productionDay"] == "2026-07-23"


def test_zamkniete_partie_licza_sie_do_batch_count_nie_do_teoretycznej():
    groups = {g["recipeId"]: g for g in _group_production_day_rows(ROWS, "2026-07-23")}
    assert groups["r2"]["batchCount"] == 1
    assert groups["r2"]["theoreticalKg"] == 0.0


def test_ostatnia_korekta_wybiera_najnowsza():
    groups = {g["recipeId"]: g for g in _group_production_day_rows(ROWS, "2026-07-23")}
    assert groups["r1"]["lastReconciledAt"] == "2026-07-23T10:00:00"
    assert groups["r1"]["lastReconcileReason"] == "ścinki"
    assert groups["r2"]["lastReconciledAt"] is None


def test_posortowane_po_nazwie_receptury():
    groups = _group_production_day_rows(ROWS, "2026-07-23")
    names = [g["recipeName"] for g in groups]
    assert names == sorted(names)
```

- [ ] **Step 2: Uruchom testy, potwierdź FAIL**

Run: `cd backend && python3 -m pytest tests/test_production_day_grouping.py -v`
Expected: `ImportError` — `_group_production_day_rows` nie istnieje.

- [ ] **Step 3: Zaimplementuj**

Dodaj do `backend/app/services/seasoned_meat_service.py` (obok `split_seasoned_sessions`,
żeby oba "czyste grupowanie" mieszkały razem):

```python
def _group_production_day_rows(rows: List[Dict[str, Any]], production_day: str) -> List[Dict[str, Any]]:
    """Czyste grupowanie wierszy seasoned_meat (dowolnego statusu) po
    recipe_id, dla widoku 'Zamknięcie dnia'. theoreticalKg sumuje TYLKO
    wiersze status != 'closed' (0, gdy wszystkie zamknięte — poprawny stan
    przy domykaniu dnia, nie błąd)."""
    groups: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        key = r["recipe_id"]
        g = groups.setdefault(key, {
            "recipeId": r["recipe_id"],
            "recipeName": r["recipe_name"],
            "productionDay": production_day,
            "theoreticalKg": 0.0,
            "batchCount": 0,
            "lastReconciledAt": None,
            "lastReconcileReason": None,
        })
        g["batchCount"] += 1
        if (r.get("status") or "") != "closed":
            g["theoreticalKg"] += float(r.get("kg_available") or 0)
        ra = r.get("reconciled_at")
        if ra and (g["lastReconciledAt"] is None or str(ra) > str(g["lastReconciledAt"])):
            g["lastReconciledAt"] = ra
            g["lastReconcileReason"] = r.get("reconcile_reason")
    for g in groups.values():
        g["theoreticalKg"] = round(g["theoreticalKg"], 3)
    return sorted(groups.values(), key=lambda g: g["recipeName"])


def list_production_days(production_day: str) -> List[Dict[str, Any]]:
    """DB wrapper nad `_group_production_day_rows` — patrz jej docstring."""
    rows = query_all(
        "SELECT recipe_id, recipe_name, status, kg_available, reconciled_at, reconcile_reason "
        "FROM seasoned_meat WHERE production_day = %s",
        (production_day,),
    )
    return _group_production_day_rows(rows, production_day)
```

- [ ] **Step 4: Napisz DB test dla wrappera**

Dopisz do `backend/tests/test_seasoned_reconcile_db.py`:

```python
from app.services.seasoned_meat_service import list_production_days


def test_list_production_days_czyta_z_bazy(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    _seed_second_batch(kg_available=50.0, production_day="2026-07-23")
    groups = list_production_days("2026-07-23")
    assert len(groups) == 1
    assert groups[0]["recipeId"] == "r1"
    assert groups[0]["theoreticalKg"] == 150.0
    assert groups[0]["batchCount"] == 2


def test_list_production_days_inny_dzien_pusty(db):
    _seed_batch(production_day="2026-07-23")
    assert list_production_days("2026-07-22") == []
```

- [ ] **Step 5: Uruchom wszystkie testy, potwierdź PASS**

Run:
```bash
cd backend && python3 -m pytest tests/test_production_day_grouping.py tests/test_seasoned_reconcile_db.py -v
```
Expected: wszystkie PASS.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/seasoned_meat_service.py backend/tests/test_production_day_grouping.py backend/tests/test_seasoned_reconcile_db.py
git commit -m "feat: list_production_days — grupy receptura×dzień dla zakładki Zamknięcie dnia"
```

---

### Task 8: `list_day_reconciliation_history`

**Files:**
- Modify: `backend/app/services/seasoned_meat_service.py`
- Modify: `backend/tests/test_seasoned_reconcile_db.py`

**Interfaces:**
- Produces: `list_day_reconciliation_history(limit: int = 100) -> List[Dict[str, Any]]`,
  każdy element: `{batchNo, recipeName, productionDay, movementType, qty, reason, createdAt}`.

- [ ] **Step 1: Napisz failing test**

Dopisz do `backend/tests/test_seasoned_reconcile_db.py`:

```python
from app.services.seasoned_meat_service import list_day_reconciliation_history


def test_historia_czyta_ruchy_reconcile_z_kontekstem_partii(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    reconcile_production_day("r1", "2026-07-23", 85.0, "ścinki / resztki z produkcji")
    history = list_day_reconciliation_history(limit=10)
    assert len(history) == 1
    entry = history[0]
    assert entry["batchNo"] == "sm1"
    assert entry["recipeName"] == "Gold"
    assert entry["productionDay"] == "2026-07-23"
    assert entry["movementType"] == "OUT"
    assert entry["qty"] == 15.0
    assert entry["reason"] == "ścinki / resztki z produkcji"
    assert entry["createdAt"]


def test_historia_ignoruje_ruchy_spoza_reconcile(db):
    _seed_batch(kg_available=100.0, production_day="2026-07-23")
    execute(
        "INSERT INTO stock_movements (id, product_type, batch_id, qty,"
        " movement_type, source_type, source_id, created_at)"
        " VALUES ('mv1','seasoned','sm1',10,'OUT','finish_day','plan1', now())"
    )
    assert list_day_reconciliation_history(limit=10) == []
```

- [ ] **Step 2: Uruchom, potwierdź FAIL**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v -k historia`
Expected: `ImportError`.

- [ ] **Step 3: Zaimplementuj**

Dodaj do `backend/app/services/seasoned_meat_service.py`:

```python
def list_day_reconciliation_history(limit: int = 100) -> List[Dict[str, Any]]:
    """Historia korekt 'Zamknięcia dnia' i pojedynczych partii — czytana
    wprost z istniejącego rejestru `stock_movements` (source_type='reconcile'),
    bez żadnej nowej tabeli audytowej."""
    rows = query_all(
        """
        SELECT sm.qty, sm.movement_type, sm.created_at,
               s.batch_no, s.recipe_name, s.production_day, s.reconcile_reason
        FROM stock_movements sm
        JOIN seasoned_meat s ON s.id = sm.batch_id
        WHERE sm.source_type = 'reconcile' AND sm.product_type = 'seasoned'
        ORDER BY sm.created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    return [
        {
            "batchNo": r["batch_no"],
            "recipeName": r["recipe_name"],
            "productionDay": str(r["production_day"]),
            "movementType": r["movement_type"],
            "qty": float(r["qty"]),
            "reason": r["reconcile_reason"] or "",
            "createdAt": str(r["created_at"]),
        }
        for r in rows
    ]
```

- [ ] **Step 4: Uruchom testy, potwierdź PASS**

Run: `cd backend && python3 -m pytest tests/test_seasoned_reconcile_db.py -v`
Expected: wszystkie PASS (cały plik).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/seasoned_meat_service.py backend/tests/test_seasoned_reconcile_db.py
git commit -m "feat: list_day_reconciliation_history z istniejącego rejestru stock_movements"
```

---

### Task 9: Routing — 3 nowe endpointy

**Files:**
- Modify: `backend/app/routes/seasoned_meat.py`

**Interfaces:**
- Consumes: `list_production_days`, `reconcile_production_day`,
  `list_day_reconciliation_history` (Tasks 4-8).
- Produces:
  - `GET /api/seasoned-meat/production-days?day=YYYY-MM-DD`
  - `POST /api/seasoned-meat/production-days/reconcile`
    body: `{recipeId, productionDay, actualKg, reason}`
  - `GET /api/seasoned-meat/production-days/history?limit=100`

- [ ] **Step 1: Dopisz endpointy**

W `backend/app/routes/seasoned_meat.py`, po istniejącym `reconcile_seasoned`
(po linii 34), przed `seasoned_from_order`:

```python
@router.get("/production-days")
def production_days(day: str):
    """dzień w formacie YYYY-MM-DD."""
    return svc.list_production_days(day)


@router.post("/production-days/reconcile")
def production_days_reconcile(body: dict):
    """Zbiorcza korekta dnia produkcji ('Zamknięcie dnia').
    body: { recipeId, productionDay, actualKg, reason? }."""
    recipe_id = str(body.get("recipeId") or "")
    production_day = str(body.get("productionDay") or "")
    if not recipe_id or not production_day:
        raise HTTPException(400, "recipeId i productionDay są wymagane")
    actual_kg = float(body.get("actualKg") or 0)
    reason = str(body.get("reason") or "")
    return svc.reconcile_production_day(recipe_id, production_day, actual_kg, reason)


@router.get("/production-days/history")
def production_days_history(limit: int = 100):
    return svc.list_day_reconciliation_history(limit)
```

- [ ] **Step 2: Ręczna weryfikacja przez curl (backend musi działać lokalnie)**

Run (zakładając backend na `localhost:8010` per konwencja repo — sprawdź
faktyczny port w `backend/app/config.py`/`.env` jeśli inny):

```bash
curl -s "http://localhost:8010/api/seasoned-meat/production-days?day=2026-07-23" | head -c 300
curl -s "http://localhost:8010/api/seasoned-meat/production-days/history?limit=5" | head -c 300
```

Expected: JSON (pusta lista `[]`, jeśli nie ma danych na ten dzień/historii —
to poprawny wynik, nie błąd).

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/routes/seasoned_meat.py
git commit -m "feat: endpointy production-days (list/reconcile/history)"
```

---

### Task 10: Frontend API client

**Files:**
- Modify: `src/lib/api.ts:1955-1974`

**Interfaces:**
- Produces (dodane do `seasonedMeatApi`):
  - `productionDays(day: string): Promise<any[]>`
  - `reconcileDay(opts: {recipeId: string; productionDay: string; actualKg: number; reason?: string}): Promise<any>`
  - `productionDayHistory(limit?: number): Promise<any[]>`

- [ ] **Step 1: Dopisz metody do `seasonedMeatApi`**

W `src/lib/api.ts`, wewnątrz obiektu `seasonedMeatApi` (kończy się linią 1974
`}`), dodaj przed zamykającym `}`:

```ts
  // ── Zamknięcie dnia produkcji (grupa receptura+dzień, ścinki/straty) ──
  productionDays: (day: string) =>
    get<any[]>(`/seasoned-meat/production-days?day=${encodeURIComponent(day)}`),
  reconcileDay: (opts: { recipeId: string; productionDay: string; actualKg: number; reason?: string }) =>
    post<any>('/seasoned-meat/production-days/reconcile', opts),
  productionDayHistory: (limit = 100) =>
    get<any[]>(`/seasoned-meat/production-days/history?limit=${limit}`),
```

- [ ] **Step 2: Sprawdź kompilację TypeScript**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak nowych błędów związanych z `seasonedMeatApi` (mogą istnieć
niezwiązane, wcześniej istniejące błędy w innych plikach — nie są w zakresie
tej zmiany).

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/lib/api.ts
git commit -m "feat: metody productionDays/reconcileDay/productionDayHistory w seasonedMeatApi"
```

---

### Task 11: Nowy komponent — `SeasonedProductionDayTab.tsx`

**Files:**
- Create: `src/pages/office/SeasonedProductionDayTab.tsx`

**Interfaces:**
- Consumes: `seasonedMeatApi.productionDays/reconcileDay/productionDayHistory`
  (Task 10), `useApi` hook, `DataTable` component, `fmtKg`/`fmtDatePl`/`cn` z
  `@/lib/utils`.
- Produces: `export function SeasonedProductionDayTab(): JSX.Element` —
  samodzielny, bez propsów (wzorzec `RawStockBatchCard.tsx`), montowany przez
  `SeasonedMeatPage.tsx` w Task 12.

- [ ] **Step 1: Utwórz plik**

```tsx
/**
 * SeasonedProductionDayTab — "Zamknięcie dnia" na SeasonedMeatPage.
 *
 * Raz dziennie per receptura: biuro wpisuje ile mięsa przyprawionego
 * FAKTYCZNIE zostało (ścinki z formowania kebaba nikną z bilansu, bo
 * produkcja 10 t/dzień nie ma czasu ich ważyć). Korekta idzie przez
 * POST .../production-days/reconcile — ten sam mechanizm audytu co
 * dzisiejsze "Koryguj partię" (stock_movements, source_type='reconcile'),
 * tylko zsumowany na poziomie (receptura, dzień). Patrz spec:
 * docs/superpowers/specs/2026-07-23-zamkniecie-dnia-produkcji-design.md
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { seasonedMeatApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { ChevronDown, ChevronUp, Loader2, SlidersHorizontal } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

const REASONS = [
  'ścinki / resztki z produkcji',
  'zaniżona teoria (fizycznie więcej)',
  'resztka technologiczna',
  'strata / odpad',
  'korekta ważenia',
  'inne',
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function SeasonedProductionDayTab() {
  const [day, setDay] = useState(todayIso())
  const { data: groups, loading, refetch: refetchGroups } =
    useApi(() => (seasonedMeatApi as any).productionDays(day), [day])
  const { data: history, refetch: refetchHistory } =
    useApi(() => (seasonedMeatApi as any).productionDayHistory(50), [])
  const [showHistory, setShowHistory] = useState(false)

  const [rec, setRec] = useState<any | null>(null)
  const [recKg, setRecKg] = useState('')
  const [recReason, setRecReason] = useState(REASONS[0])
  const [recBusy, setRecBusy] = useState(false)
  const [recErr, setRecErr] = useState('')

  function openReconcile(g: any) {
    setRec(g)
    setRecKg(String(Number(g.theoreticalKg ?? 0)))
    setRecReason(REASONS[0])
    setRecErr('')
  }

  async function submitReconcile() {
    if (!rec) return
    setRecBusy(true); setRecErr('')
    try {
      await (seasonedMeatApi as any).reconcileDay({
        recipeId: rec.recipeId,
        productionDay: rec.productionDay,
        actualKg: Number(recKg.replace(',', '.')) || 0,
        reason: recReason,
      })
      setRec(null)
      refetchGroups(); refetchHistory()
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Nie udało się zapisać korekty')
    } finally {
      setRecBusy(false)
    }
  }

  const rows: any[] = groups ?? []
  const historyRows: any[] = history ?? []

  return (
    <div className="space-y-3">
      <Card className="p-3 flex items-center gap-2">
        <label className="text-[11px] font-bold uppercase tracking-wide text-ink-4">
          Dzień produkcji
        </label>
        <Input type="date" value={day} onChange={e => setDay(e.target.value)} className="h-9 w-44" />
      </Card>

      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 text-sm text-muted-foreground">
          Ładowanie…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <div className="text-sm font-medium text-muted-foreground">
            Brak partii przyprawionego z tego dnia
          </div>
        </div>
      ) : (
        <DataTable
          rows={rows}
          rowKey={g => g.recipeId}
          onRowClick={g => openReconcile(g)}
          columns={[
            { key: 'recipeName', header: 'Receptura', sortable: true, sortValue: g => g.recipeName || '',
              cell: g => <span className="font-medium text-ink">{g.recipeName}</span> },
            { key: 'batchCount', header: 'Partii', align: 'right', sortable: true, sortValue: g => g.batchCount,
              cell: g => g.batchCount },
            { key: 'theoreticalKg', header: 'Teoretycznie zostało', align: 'right', sortable: true,
              sortValue: g => g.theoreticalKg,
              cell: g => <span className="font-bold text-emerald-700">{fmtKg(g.theoreticalKg, 1)} kg</span> },
            { key: 'lastReconciledAt', header: 'Ostatnia korekta', sortable: true,
              sortValue: g => g.lastReconciledAt || '',
              cell: g => g.lastReconciledAt
                ? <span className="text-ink-2">{fmtDatePl(String(g.lastReconciledAt).slice(0, 10))} · {g.lastReconcileReason}</span>
                : <span className="text-muted-foreground">—</span> },
            { key: 'act', header: '', align: 'right',
              cell: g => (
                <button
                  onClick={e => { e.stopPropagation(); openReconcile(g) }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50"
                  title="Wpisz realną pozostałość"
                ><SlidersHorizontal size={12} /></button>
              ) },
          ]}
        />
      )}

      {historyRows.length > 0 && (
        <Card>
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Historia zamknięć</span>
              <Badge variant="outline" className="text-[10px]">{historyRows.length}</Badge>
            </div>
            {showHistory ? <ChevronUp size={14} className="text-muted-foreground"/> : <ChevronDown size={14} className="text-muted-foreground"/>}
          </button>
          {showHistory && (
            <div className="border-t overflow-auto max-h-[40vh]">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                  <tr>
                    {['Data', 'Receptura', 'Partia', 'Zmiana', 'Powód'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((h, idx) => (
                    <tr key={`${h.batchNo}-${h.createdAt}-${idx}`}
                      className={cn('border-b border-surface-3', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40')}>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{fmtDatePl(String(h.productionDay))}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{h.recipeName}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap"><code className="font-mono text-[10px] bg-surface-3 text-ink px-1.5 py-0.5 rounded">{h.batchNo}</code></td>
                      <td className={cn('px-2.5 py-2 whitespace-nowrap font-bold',
                        h.movementType === 'IN' ? 'text-emerald-700' : 'text-red-700')}>
                        {h.movementType === 'IN' ? '+' : '−'}{fmtKg(h.qty, 1)} kg
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{h.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {rec && (
        <Dialog open onOpenChange={v => { if (!v && !recBusy) setRec(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-amber-600" />
                Zamknięcie dnia — {rec.recipeName}
              </DialogTitle>
              <DialogDescription>
                Wpisz, ile mięsa przyprawionego z tej receptury i dnia FAKTYCZNIE
                zostało. System skoryguje żywy stan i zapisze różnicę do audytu.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-[13px]">
              <div className="rounded-lg bg-surface-2 border border-surface-4 px-3 py-2 text-center">
                <div className="text-[10px] uppercase tracking-wide text-ink-4">Teoretycznie zostało</div>
                <div className="font-bold tabular-nums text-ink">{fmtKg(rec.theoreticalKg ?? 0, 1)} kg</div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-4 mb-1">Ile fizycznie zostało [kg]</label>
                <Input type="number" step="0.1" min="0" value={recKg}
                  onChange={e => setRecKg(e.target.value)}
                  className="h-9 tabular-nums font-bold" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-4 mb-1">Powód (dla audytu / weterynarii)</label>
                <select value={recReason} onChange={e => setRecReason(e.target.value)}
                  className="w-full h-9 px-2 text-[13px] border border-surface-4 rounded bg-white">
                  {REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              {recErr && <div className="text-[12px] text-red-600 font-semibold">{recErr}</div>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => setRec(null)} disabled={recBusy}
                  className="h-9 px-3 text-[13px] font-semibold rounded border border-surface-4 text-ink-2 hover:bg-surface-2">
                  Anuluj
                </button>
                <button onClick={submitReconcile} disabled={recBusy}
                  className="h-9 px-3 text-[13px] font-bold rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {recBusy ? <Loader2 size={14} className="animate-spin" /> : <SlidersHorizontal size={14} />}
                  Zapisz korektę
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Sprawdź kompilację TypeScript**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak nowych błędów w `SeasonedProductionDayTab.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/SeasonedProductionDayTab.tsx
git commit -m "feat: komponent zakładki Zamknięcie dnia (ścinki/straty przyprawionego)"
```

---

### Task 12: Wpięcie zakładki do `SeasonedMeatPage.tsx`

**Files:**
- Modify: `src/pages/office/SeasonedMeatPage.tsx`

**Interfaces:**
- Consumes: `SeasonedProductionDayTab` (Task 11).

- [ ] **Step 1: Dodaj import**

W `src/pages/office/SeasonedMeatPage.tsx`, po istniejącym imporcie (linia 30
`} from '@/components/ui/dialog'`), dodaj:

```tsx
import { SeasonedProductionDayTab } from './SeasonedProductionDayTab'
```

- [ ] **Step 2: Dodaj stan zakładki**

W funkcji `SeasonedMeatPage()` (zaczyna się linia 242), zaraz po
`export function SeasonedMeatPage() {`, przed `const { data, loading, refetch }`,
dodaj:

```tsx
  const [pageTab, setPageTab] = useState<'partie' | 'zamkniecie'>('partie')
```

- [ ] **Step 3: Dodaj pasek zakładek i warunkowe renderowanie**

Zaraz po otwierającym `return (` (linia 297) i przed `{loading ? (` (linia 299),
wstaw pasek zakładek:

```tsx
      <div className="flex items-center gap-1">
        {([
          { key: 'partie', label: 'Partie' },
          { key: 'zamkniecie', label: 'Zamknięcie dnia' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setPageTab(t.key)}
            className={cn(
              'inline-flex items-center px-3 py-1.5 rounded text-xs font-semibold border transition-colors',
              pageTab === t.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-white text-ink-2 border-surface-4 hover:bg-surface-2',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {pageTab === 'zamkniecie' ? (
        <SeasonedProductionDayTab />
      ) : (
```

Następnie ZAMKNIJ ten nowy blok warunkowy PO istniejącej sekcji "Historia ·
wykorzystane partie" — czyli zaraz PRZED `{traceId && <TracePanel ...`
(obecna linia 420 w niezmodyfikowanym pliku), wstaw:

```tsx
      )}
```

Czyli cały dzisiejszy widok "Partie" (dzisiejszy `{loading ? (...) : raw.length
=== 0 ? (...) : (<DataTable ... />)}` oraz sekcja "Historia · wykorzystane
partie") zostaje wewnątrz gałęzi `else` tego nowego warunku — bez zmiany
choćby jednej linii w środku, tylko opakowany dodatkowym `{pageTab ===
'zamkniecie' ? (...) : ( ...cała dotychczasowa zawartość... )}`.

Dialog `rec` (korekta pojedynczej partii) i `TracePanel` zostają PO tym
bloku, poza warunkiem — działają niezależnie od wybranej zakładki
(przydatne, gdyby ktoś kliknął "Koryguj" tuż przed przełączeniem zakładki).

- [ ] **Step 4: Sprawdź kompilację TypeScript**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak nowych błędów w `SeasonedMeatPage.tsx` (zwróć szczególną uwagę
na niedomknięte JSX — to najczęstszy błąd przy tym typie edycji).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/SeasonedMeatPage.tsx
git commit -m "feat: wepnij zakładkę Zamknięcie dnia do SeasonedMeatPage"
```

---

### Task 13: Weryfikacja end-to-end w przeglądarce

**Files:** brak zmian kodu — tylko weryfikacja.

- [ ] **Step 1: Uruchom backend lokalnie**

Sprawdź `backend/app/config.py`/`.env` dla właściwego portu (zgodnie z pamięcią
projektu backend biurowy działa zwykle na porcie innym niż produkcja — zweryfikuj
przed startem), następnie:

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -m uvicorn app.main:app --reload --port 8010
```

- [ ] **Step 2: Uruchom frontend dev server**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npm run dev
```

- [ ] **Step 3: Ręczny scenariusz w przeglądarce**

1. Zaloguj się do biura, przejdź do „Przyprawione" (`/office/mieso-przyp` lub
   odpowiedni URL — sprawdź `OfficeSidebar.tsx` dla dokładnej ścieżki).
2. Kliknij zakładkę „Zamknięcie dnia" — sprawdź, że pasek zakładek działa i
   nie psuje istniejącego widoku „Partie".
3. Ustaw datę na dzień, w którym istnieje realna partia przyprawionego (albo
   utwórz ją przez normalny flow masowania, jeśli baza dev jest pusta).
4. Kliknij wiersz recepty → dialog pokazuje "Teoretycznie zostało" z
   poprawną wartością.
5. Wpisz mniejszą wartość + wybierz powód „ścinki / resztki z produkcji” →
   Zapisz korektę. Sprawdź: dialog się zamyka, wiersz w tabeli grup aktualizuje
   „Teoretycznie zostało” i „Ostatnia korekta”, sekcja „Historia zamknięć”
   pokazuje nowy wpis ze znakiem „−”.
6. Przełącz na zakładkę „Partie” — sprawdź, że `kg_available` partii bazowej
   faktycznie zmalał o wpisaną różnicę (ten sam numer partii, kolumna „Wolne kg”).
7. Sprawdź przypadek brzegowy: wybierz dzień/recepturę bez żadnej partii w
   systemie (np. dawna data) — upewnij się, że tabela grup poprawnie pokazuje
   pusty stan bez błędu w konsoli przeglądarki.

- [ ] **Step 4: Zgłoś wynik użytkownikowi**

Jeśli którykolwiek krok nie działa zgodnie z oczekiwaniem — NIE zgłaszaj
zadania jako ukończone. Napraw i powtórz weryfikację, zanim przejdziesz do
podsumowania.
