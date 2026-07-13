# Elastyczny plan produkcji („plan żywy") — plan wdrożenia (Faza 1/A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Umożliwić edycję AKTYWNEGO planu produkcji bez usuwania, z zachowaniem wyprodukowanych pozycji (`qty_done`) i natychmiastowym zwrotem odznaczonej partii do dyspozycji.

**Architecture:** Backend `update_plan` przestaje wymagać statusu „draft" i zamiast kasować/odtwarzać wszystkie pozycje — dopasowuje pozycje po `id` (dosyłanym z frontu), zachowując `qty_done`/`worker_entries`/`line_status` dla już rozpoczętych; rezerwacje liczone są przez istniejący cykl „zwolnij wszystko → policz alokację → zarezerwuj" (bezpieczny, bo konsumpcja mięsa jest odroczona do `finish_day` i dotyka tylko `kg_reserved`). Front pozwala edytować aktywny plan, blokuje wyprodukowane pozycje i dosyła `id` pozycji.

**Tech Stack:** Python/FastAPI + psycopg (backend), React/TS (front), PostgreSQL. Testy: pytest (backend), vitest (front).

## Global Constraints

- Konsumpcja mięsa przyprawionego dzieje się w `finish_day`, NIE przy aktywacji/edycji — edycja planu rusza wyłącznie `seasoned_meat.kg_reserved` (patrz `_restore_reservations` komentarz). Nie wolno tknąć `kg_used`/`kg_available` na ścieżce edycji.
- Blokady liczymy od ŻYWEGO `qty_done` odczytanego w transakcji `FOR UPDATE`, nie z payloadu frontu.
- Kolejność blokad partii deterministyczna (sort po id) — jak w istniejącym kodzie (unikanie deadlocków).
- Tolerancja braków: istniejąca `SEASONED_SHORTFALL_TOL_KG = 1.0` (nie zmieniamy).
- Plan edytowalny tylko dla statusu ∈ {`draft`, `active`}. `done`/`cancelled` → odrzuć.
- Nie zmieniamy schematu bazy (istniejące kolumny wystarczają).

---

### Task 1: Czysta walidacja edycji pozycji planu (blokady `qty_done`)

Czysta funkcja, testowalna bez bazy: sprawdza reguły nietykalności wyprodukowanych pozycji przy edycji.

**Files:**
- Modify: `backend/app/services/production_plans_service.py` (dodać funkcję `validate_plan_edit` obok innych walidatorów, np. po `_check_plan_shortfalls`)
- Test: `backend/tests/test_plan_edit_guards.py` (nowy)

**Interfaces:**
- Produces: `validate_plan_edit(existing: list[dict], incoming: list[dict]) -> list[str]`
  - `existing`: wiersze z bazy, każdy dict z kluczami `id: str`, `qty_done: int`, `recipe_id: str`.
  - `incoming`: pozycje z payloadu, każdy dict z kluczami `id: str` (pusty dla nowej), `qty: int`, `recipe_id: str`.
  - Zwraca listę komunikatów błędów (pusta = OK).

- [ ] **Step 1: Napisz failing testy**

```python
# backend/tests/test_plan_edit_guards.py
from app.services.production_plans_service import validate_plan_edit


def _ex(id, qty_done, recipe_id="r1"):
    return {"id": id, "qty_done": qty_done, "recipe_id": recipe_id}

def _in(id, qty, recipe_id="r1"):
    return {"id": id, "qty": qty, "recipe_id": recipe_id}


def test_no_produced_lines_anything_goes():
    assert validate_plan_edit([_ex("l1", 0)], [_in("l1", 50)]) == []

def test_cannot_delete_produced_line():
    # l1 ma 10 zrobionych, w payloadzie go nie ma -> blad
    errs = validate_plan_edit([_ex("l1", 10)], [])
    assert len(errs) == 1 and "wyprodukowan" in errs[0].lower()

def test_cannot_shrink_below_qty_done():
    errs = validate_plan_edit([_ex("l1", 20)], [_in("l1", 15)])
    assert len(errs) == 1 and "poni" in errs[0].lower()

def test_can_grow_or_equal_produced():
    assert validate_plan_edit([_ex("l1", 20)], [_in("l1", 20)]) == []
    assert validate_plan_edit([_ex("l1", 20)], [_in("l1", 30)]) == []

def test_cannot_change_recipe_on_produced_line():
    errs = validate_plan_edit([_ex("l1", 5, "r1")], [_in("l1", 50, "r2")])
    assert len(errs) == 1 and "receptur" in errs[0].lower()

def test_new_line_without_id_is_ok():
    assert validate_plan_edit([], [_in("", 40)]) == []

def test_untouched_zero_done_line_removable():
    # l1 bez produkcji moze zniknac z planu
    assert validate_plan_edit([_ex("l1", 0)], []) == []
```

- [ ] **Step 2: Uruchom — ma FAIL**

Run: `cd backend && python3 -m pytest tests/test_plan_edit_guards.py -q`
Expected: FAIL (ImportError: cannot import name 'validate_plan_edit')

- [ ] **Step 3: Zaimplementuj funkcję**

```python
def validate_plan_edit(existing: list[dict], incoming: list[dict]) -> list[str]:
    """Reguły nietykalności wyprodukowanych pozycji przy edycji planu.

    Pozycja z qty_done>0 (część spakowana): nie można jej usunąć z planu,
    zejść qty poniżej qty_done, ani zmienić receptury. Pozycje bez produkcji
    (qty_done=0) są w pełni edytowalne/usuwalne. Nowe pozycje (id puste)
    zawsze OK. Czysta funkcja — bez DB."""
    incoming_by_id = {str(l.get("id") or ""): l for l in incoming if l.get("id")}
    errors: list[str] = []
    for ex in existing:
        qd = int(ex.get("qty_done") or 0)
        if qd <= 0:
            continue
        lid = str(ex.get("id") or "")
        nl = incoming_by_id.get(lid)
        if nl is None:
            errors.append(
                f"Pozycja częściowo/w całości wyprodukowana ({qd} szt.) — "
                f"nie można jej usunąć z planu."
            )
            continue
        if int(nl.get("qty") or 0) < qd:
            errors.append(
                f"Nie można zejść z ilości poniżej już wyprodukowanych "
                f"{qd} szt."
            )
        if str(nl.get("recipe_id") or "") != str(ex.get("recipe_id") or ""):
            errors.append(
                "Nie można zmienić receptury pozycji, która jest już "
                "częściowo wyprodukowana."
            )
    return errors
```

- [ ] **Step 4: Uruchom — ma PASS**

Run: `cd backend && python3 -m pytest tests/test_plan_edit_guards.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/production_plans_service.py backend/tests/test_plan_edit_guards.py
git commit -m "feat(plan): czysta walidacja edycji planu (blokady qty_done)"
```

---

### Task 2: Dodaj `id` pozycji do DTO planu

Aby dopasować pozycje przy edycji (i zachować `qty_done`), payload musi nieść `id` istniejących pozycji.

**Files:**
- Modify: `backend/app/models/production.py` (klasa `PlanLineCreate`, po `model_config`)

**Interfaces:**
- Produces: `PlanLineCreate.id: str` (alias `"id"`, domyślnie `""`).

- [ ] **Step 1: Dodaj pole**

W `class PlanLineCreate`, zaraz po `model_config = ConfigDict(populate_by_name=True)` dodaj:

```python
    id: str = Field("", alias="id")
```

- [ ] **Step 2: Sprawdź import/typy backendu**

Run: `cd backend && python3 -c "from app.models.production import PlanLineCreate; print(PlanLineCreate(id='x', qty=1).id)"`
Expected: wypisze `x`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/production.py
git commit -m "feat(plan): pole id w PlanLineCreate (dopasowanie pozycji przy edycji)"
```

---

### Task 3: `_insert_line` używa dostarczonego id pozycji

Żeby zachować `qty_done` po przebudowie, nowa/edytowana pozycja musi zachować to samo `id` co w bazie.

**Files:**
- Modify: `backend/app/services/production_plans_service.py` (funkcja `_insert_line` — najpierw ją PRZECZYTAJ w całości, zwykle tuż przed/po `update_plan`; obecnie generuje `id = cuid()` w INSERT).

**Interfaces:**
- Consumes: `PlanLineCreate.id` (Task 2).
- Produces: `_insert_line(...)` wstawia wiersz z `line.id` gdy niepuste, inaczej `cuid()`.

- [ ] **Step 1: Zmień generowanie id w `_insert_line`**

Znajdź w `_insert_line` linię tworzącą id (wzorzec `lid = cuid()` lub `cuid()` wprost w VALUES) i zastąp deterministycznym wyborem:

```python
    lid = str(getattr(line, "id", "") or "") or cuid()
```

Użyj `lid` w INSERT jako id wiersza `production_plan_lines` (zamiast bezpośredniego `cuid()`).

- [ ] **Step 2: Sanity import**

Run: `cd backend && python3 -c "import app.services.production_plans_service as s; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/production_plans_service.py
git commit -m "feat(plan): _insert_line zachowuje id pozycji z DTO"
```

---

### Task 4: `update_plan` — edycja aktywnego planu z zachowaniem `qty_done`

Rdzeń: pozwól edytować aktywny plan, zwaliduj blokady, przebuduj pozycje zachowując `id`, i przywróć `qty_done`/`worker_entries`/`line_status` dla dopasowanych pozycji.

**Files:**
- Modify: `backend/app/services/production_plans_service.py` (funkcja `update_plan`, ~745-835)

**Interfaces:**
- Consumes: `validate_plan_edit` (Task 1), `PlanLineCreate.id` (Task 2), `_insert_line` z id (Task 3), istniejące `_restore_reservations`, `_lock_seasoned_batches`, `_check_plan_shortfalls`, `_compute_allocation`, `_apply_reservations`.

- [ ] **Step 1: Poluzuj bramkę statusu**

Zamień:
```python
        if plan["status"] != "draft":
            raise HTTPException(400, "Można edytować tylko plan w statusie Szkic")
```
na:
```python
        if plan["status"] not in ("draft", "active"):
            raise HTTPException(
                400, "Edytować można tylko plan w statusie Szkic lub Aktywny."
            )
```

- [ ] **Step 2: Zsnapshotuj stare pozycje i zwaliduj blokady (PRZED usunięciem)**

Zaraz po pobraniu `plan` (i przed `_restore_reservations`), dodaj:
```python
        old_lines = cx_query_all(
            conn,
            "SELECT id, qty_done, recipe_id, worker_entries, line_status "
            "FROM production_plan_lines WHERE plan_id=%s FOR UPDATE",
            (plan_id,),
        )
        old_by_id = {r["id"]: r for r in old_lines}
        edit_errs = validate_plan_edit(
            [dict(r) for r in old_lines],
            [
                {"id": l.id, "qty": l.qty, "recipe_id": l.recipe_id}
                for l in valid_lines
            ],
        )
        if edit_errs:
            raise HTTPException(400, "Nie można zapisać zmian:\n• " + "\n• ".join(edit_errs))
```

- [ ] **Step 3: Po przebudowie pozycji przywróć postęp produkcji**

Po pętli `for line in valid_lines: ... _apply_reservations(...)` (a przed pobraniem `updated`), dodaj przywrócenie `qty_done` dla dopasowanych po id:
```python
        for line in valid_lines:
            lid = str(line.id or "")
            old = old_by_id.get(lid)
            if not old:
                continue
            qd = int(old.get("qty_done") or 0)
            if qd <= 0:
                continue
            new_qty = int(line.qty or 0)
            ls = "done" if qd >= new_qty and new_qty > 0 else ("in_progress" if qd > 0 else "pending")
            cx_execute(
                conn,
                "UPDATE production_plan_lines SET qty_done=%s, worker_entries=%s, "
                "line_status=%s WHERE id=%s",
                (qd, old.get("worker_entries") or "[]", ls, lid),
            )
```

- [ ] **Step 4: Sanity import + istniejące testy**

Run: `cd backend && python3 -c "import app.services.production_plans_service as s; print('ok')" && python3 -m pytest tests/test_plan_edit_guards.py -q`
Expected: `ok` + 7 passed

- [ ] **Step 5: Kontrolowany test na realnym planie (brak bazy testowej)**

Ponieważ nie ma bazy testowej (rola bez CREATEDB), zweryfikuj na kopii stanu: wybierz aktywny plan bez produkcji, zapisz snapshot `kg_reserved` dotkniętych partii, wywołaj `update_plan` z tą samą treścią (no-op) i potwierdź, że `kg_reserved` bez zmian; potem z jedną odznaczoną partią i potwierdź zwrot `kg_reserved`. Cofnij zmianę drugim `update_plan`. Udokumentuj wynik w commit message.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/production_plans_service.py
git commit -m "feat(plan): edycja aktywnego planu z zachowaniem qty_done (rezerwacje bez churn)"
```

---

### Task 5: Front — edycja aktywnego planu, blokada wyprodukowanych, dosłanie id

**Files:**
- Modify: `src/pages/office/ProductionPlanningPage.tsx` (przycisk „Edytuj" dla aktywnych; blokada pozycji z `qtyDone>0`; `productionPlansApi.update` wysyła `id` pozycji i nie pozwala zejść `qty` poniżej `qtyDone`; odznaczenie partii zapisuje → partia wraca do „wolne kg")

**Interfaces:**
- Consumes: backend `update` przyjmujący `id` pozycji (Task 2-4), `progressByLine[l.id].qtyDone`.

- [ ] **Step 1: Włącz edycję aktywnego planu**

Znajdź gdzie „Edytuj" jest ograniczone do statusu `draft` (np. warunek `plan.status === 'draft'` przy akcji edycji, patrz też `updateStatus`) i rozszerz na `['draft','active'].includes(plan.status)`.

- [ ] **Step 2: Dosyłaj id pozycji w update**

W funkcji zapisu edycji (`productionPlansApi.update(editPlan.id, { planDate, lines })`, ~1558) zbuduj `lines` tak, by każda istniejąca pozycja niosła `id: l.id` (nowe pozycje: `id: ''`). Wzór pól jak przy `create`, dołóż `id`.

- [ ] **Step 3: Blokuj wyprodukowane pozycje w UI**

Dla pozycji z `progressByLine[l.id]?.qtyDone > 0`: oznacz jako zablokowaną (read-only receptura/rodzaj, pola partii tylko dla reszty), a pole ilości z `min = qtyDone`. Wzór: `locked` w `PlanRow` planu masowania.

- [ ] **Step 4: Odznaczenie partii → zapis → zwrot kg**

W `toggleBatch` (~916) po zmianie zaznaczenia wywołaj istniejącą ścieżkę zapisu edycji (update), a po sukcesie odśwież listę partii (`seasonedMeatApi`/`available`), żeby odznaczona partia natychmiast pokazała wolne kg. (Jeśli zapis jest zbiorczy „Zapisz", zostaw — ale wtedy dodaj wyraźny hint, że zwrot następuje po zapisie.)

- [ ] **Step 5: Typecheck**

Run: `export PATH=/root/.nvm/versions/node/v22.23.1/bin:$PATH && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add src/pages/office/ProductionPlanningPage.tsx
git commit -m "feat(plan): front — edycja aktywnego planu, blokada wyprodukowanych, doslanie id pozycji"
```

---

### Task 6: Weryfikacja end-to-end + deploy

**Files:** — (bez zmian kodu; deploy istniejącym `deploy/deploy.sh`)

- [ ] **Step 1: Pełny typecheck + testy backendu planu**

Run: `export PATH=/root/.nvm/versions/node/v22.23.1/bin:$PATH && npx tsc --noEmit 2>&1 | grep -c "error TS"` (oczek. `0`)
Run: `cd backend && python3 -m pytest tests/test_plan_edit_guards.py -q` (oczek. passed)

- [ ] **Step 2: Pre-deploy diff (REGUŁA)**

Run: `diff -rq /opt/kebab/app/backend/app /opt/kebab/kebab_new/kebab_fixed/backend/app | grep differ | grep -vE "__pycache__|\\.bak|\\.przed-"`
Prod-only treść → najpierw commit do main.

- [ ] **Step 3: Deploy + smoke**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && export PATH=/root/.nvm/versions/node/v22.23.1/bin:$PATH && bash deploy/deploy.sh all`
Smoke: w biurze edytuj aktywny plan — odznacz partię, zapisz, sprawdź że wróciła do „wolne kg"; spróbuj zejść z ilości poniżej wyprodukowanych (ma zablokować).

- [ ] **Step 4: Commit/push main** (jeśli deploy lokalny nie commituje) i wpis do pamięci.

---

## Self-Review (autor planu)

- Pokrycie spec: status-gate (T4), blokada qty_done (T1+T4), rezerwacje bez churn / odznaczenie→zwrot (T4+T5), front aktywny+blokady (T5), bezpieczeństwo qty_done z żywego stanu (T4 step 2 `FOR UPDATE`). ✓
- Placeholdery: brak „TBD/TODO"; kroki wymagające czytania istniejącej funkcji (`_insert_line`, miejsce „Edytuj") wskazują dokładnie co zmienić i na co. 
- Spójność typów: `validate_plan_edit(existing, incoming)` — te same klucze w T1 i wołaniu w T4. `line.id` z T2 użyte w T3/T4/T5.
- Zakres: tylko A. B/C poza planem.
