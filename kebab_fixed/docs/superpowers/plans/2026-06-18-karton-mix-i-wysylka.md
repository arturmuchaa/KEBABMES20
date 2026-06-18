# Karton mieszany + ścieżka wysyłki + spójność dokumentów — Plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UWAGA (pamięć projektu):** subagenty NIE piszą do `backend/` ani większości `src/`. Zadania backendowe (1–11) wykonywać **inline** w sesji głównej. Zadania frontowe (12–14) też dotykają `src/` → inline.

**Goal:** Karton magazynowy obsługuje skład mieszany (jeden klient, wiele pozycji), ma domkniętą ścieżkę wysyłki (skan kartonu na wyjazd, ad-hoc i pod zamówienie), a dokumenty WZ/HDI liczą fizycznie wydane sztuki bez podwójnego liczenia.

**Architecture:** `stock_cartons` zostaje nagłówkiem; skład przenosimy do nowej tabeli `stock_carton_lines` (pozycja = receptura+rodzaj+tuleja+waga+ilość). Pakowanie dopasowuje sztukę do pozycji. Wysyłka idzie przez `dispatches` (po kliencie) nową operacją `scan_carton_into_dispatch`. Reconciliacja dokumentów wyklucza z FIFO `finished_goods` sztuki już skartonowane pod to zamówienie.

**Tech Stack:** Python 3 / FastAPI / psycopg2 (PostgreSQL), pytest; React + TypeScript + Vite, Vitest.

## Global Constraints

- Backend na PostgreSQL; testy DB tylko z `TEST_DATABASE_URL` zawierającym `kebab_mes_test` (fixture `db` w `backend/tests/conftest.py`).
- Pieniądze/wagi: porównania wagi przez `_kg(v) = round(float(v or 0), 3)`.
- LogRecord: nie używać zarezerwowanych kluczy (`created/filename/module/name/...`) w `logger ... extra=`.
- Migracje idempotentne: DDL przez `IF NOT EXISTS`, backfille tylko gdy brak danych.
- Numeracja kartonu: `next_seq("carton_seq")`, format `format_carton_no`.
- Status sztuki: `produced` → `packed` → `shipped` (stałe `PRODUCED/PACKED/SHIPPED` w `app/utils/unit_codes.py`).
- Uruchamianie testów backendu:
  `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest <ścieżka> -v`
  (czyste funkcje działają i bez `TEST_DATABASE_URL`).

---

### Task 1: Tabela `stock_carton_lines` + migracja backfill

**Files:**
- Modify: `backend/app/migrations.py` (lista `_DDL` od linii 13; `run_migrations` od ~572)
- Modify: `backend/tests/conftest.py` (lista `_TRUNCATE`)
- Test: `backend/tests/test_stock_carton_lines_db.py` (Create)

**Interfaces:**
- Produces: tabela `stock_carton_lines(id, carton_id, recipe_id, recipe_name, product_type_id, product_type_name, packaging_id, packaging_name, kg_per_unit, target_qty, packed_qty)`; funkcja `_backfill_stock_carton_lines()`.

- [ ] **Step 1: Dodaj `stock_carton_lines` do `_TRUNCATE`**

W `backend/tests/conftest.py`, w liście `_TRUNCATE`, w wierszu z `stock_cartons` dopisz `stock_carton_lines`:

```python
    "stock_movements", "stock_cartons", "stock_carton_lines", "finished_units", "finished_goods",
```

- [ ] **Step 2: Napisz failujący test backfillu**

Utwórz `backend/tests/test_stock_carton_lines_db.py`:

```python
"""Migracja: stock_carton_lines + backfill jednorodnych kartonów."""
from app.db import execute, query_all, query_one
from app.migrations import _backfill_stock_carton_lines


def test_backfill_creates_one_line_per_legacy_carton(db):
    execute(
        """INSERT INTO stock_cartons
             (id, carton_no, client_id, client_name, recipe_id, recipe_name,
              product_type_id, product_type_name, packaging_id, packaging_name,
              kg_per_unit, target_qty, packed_qty, status, created_at)
           VALUES ('c1', 1, 'cl1', 'Zagros', 'r1', 'Klasyk',
                   'pt1', 'Udo', 'pk1', 'Tuleja A', 10.0, 50, 0, 'open', now())""",
    )
    _backfill_stock_carton_lines()
    lines = query_all("SELECT * FROM stock_carton_lines WHERE carton_id='c1'")
    assert len(lines) == 1
    assert lines[0]["recipe_id"] == "r1"
    assert int(lines[0]["target_qty"]) == 50
    assert float(lines[0]["kg_per_unit"]) == 10.0


def test_backfill_is_idempotent(db):
    execute(
        """INSERT INTO stock_cartons
             (id, carton_no, client_id, kg_per_unit, target_qty, packed_qty, status, created_at)
           VALUES ('c2', 2, 'cl1', 5.0, 20, 0, 'open', now())""",
    )
    _backfill_stock_carton_lines()
    _backfill_stock_carton_lines()
    rows = query_one("SELECT count(*) AS c FROM stock_carton_lines WHERE carton_id='c2'")
    assert int(rows["c"]) == 1
```

- [ ] **Step 3: Uruchom test — ma failować**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_carton_lines_db.py -v`
Expected: FAIL — `ImportError: cannot import name '_backfill_stock_carton_lines'` / brak tabeli.

- [ ] **Step 4: Dodaj DDL i backfill**

W `backend/app/migrations.py`, na końcu listy `_DDL` (przed jej `]`) dopisz:

```python
    """CREATE TABLE IF NOT EXISTS stock_carton_lines (
        id                TEXT PRIMARY KEY,
        carton_id         TEXT NOT NULL,
        recipe_id         TEXT DEFAULT '',
        recipe_name       TEXT DEFAULT '',
        product_type_id   TEXT DEFAULT '',
        product_type_name TEXT DEFAULT '',
        packaging_id      TEXT DEFAULT '',
        packaging_name    TEXT DEFAULT '',
        kg_per_unit       NUMERIC NOT NULL DEFAULT 0,
        target_qty        INTEGER NOT NULL DEFAULT 0,
        packed_qty        INTEGER NOT NULL DEFAULT 0
    )""",
    "CREATE INDEX IF NOT EXISTS idx_stock_carton_lines_carton ON stock_carton_lines(carton_id)",
```

Dodaj funkcję backfillu (obok innych `_backfill_*`, np. po `_backfill_byproduct_lots`):

```python
def _backfill_stock_carton_lines() -> None:
    """Każdy istniejący (jednorodny) karton bez pozycji → jedna pozycja z jego składu."""
    try:
        from app.utils.ids import cuid
        legacy = query_all(
            """SELECT sc.* FROM stock_cartons sc
               WHERE NOT EXISTS (
                   SELECT 1 FROM stock_carton_lines l WHERE l.carton_id = sc.id)"""
        )
        for c in legacy:
            execute(
                """INSERT INTO stock_carton_lines
                     (id, carton_id, recipe_id, recipe_name, product_type_id,
                      product_type_name, packaging_id, packaging_name,
                      kg_per_unit, target_qty, packed_qty)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (cuid(), c["id"], c.get("recipe_id") or "", c.get("recipe_name") or "",
                 c.get("product_type_id") or "", c.get("product_type_name") or "",
                 c.get("packaging_id") or "", c.get("packaging_name") or "",
                 float(c.get("kg_per_unit") or 0), int(c.get("target_qty") or 0),
                 int(c.get("packed_qty") or 0)),
            )
    except Exception as exc:
        logger.warning("migrations.backfill_stock_carton_lines.failed", extra={"error": str(exc)})
```

Upewnij się, że na górze `migrations.py` jest `from app.db import ... query_all` (dodaj `query_all` do importu jeśli brak). W `run_migrations()` dopisz wywołanie `_backfill_stock_carton_lines()` przy pozostałych backfillach.

Zastosuj DDL do bazy testowej:
`DATABASE_URL=$TEST_DATABASE_URL python3 -c "from app.migrations import run_migrations; run_migrations()"`

- [ ] **Step 5: Uruchom test — ma przejść**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_carton_lines_db.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/migrations.py backend/tests/conftest.py backend/tests/test_stock_carton_lines_db.py
git commit -m "feat(carton): tabela stock_carton_lines + backfill jednorodnych kartonów"
```

---

### Task 2: Czysta funkcja `pick_line_for_unit`

**Files:**
- Modify: `backend/app/services/stock_cartons_service.py`
- Test: `backend/tests/test_pick_line_for_unit.py` (Create)

**Interfaces:**
- Produces: `pick_line_for_unit(unit: dict, lines: list[dict]) -> dict | None` — pierwsza pozycja z wolnym miejscem, której spec pasuje do sztuki (recipe_id, product_type_id, tuleja==packaging_name, waga przez `_kg`).

- [ ] **Step 1: Napisz failujące testy (czyste, bez DB)**

Utwórz `backend/tests/test_pick_line_for_unit.py`:

```python
from app.services.stock_cartons_service import pick_line_for_unit

def _line(**kw):
    base = dict(id="l1", recipe_id="r1", product_type_id="pt1",
                packaging_name="Tuleja A", kg_per_unit=10.0, target_qty=5, packed_qty=0)
    base.update(kw); return base

def _unit(**kw):
    base = dict(recipe_id="r1", product_type_id="pt1", tuleja="Tuleja A", weight_kg=10.0)
    base.update(kw); return base

def test_matches_single_line():
    assert pick_line_for_unit(_unit(), [_line()])["id"] == "l1"

def test_no_match_wrong_recipe():
    assert pick_line_for_unit(_unit(recipe_id="rX"), [_line()]) is None

def test_skips_full_line_picks_next():
    full = _line(id="l1", packed_qty=5)
    free = _line(id="l2", packed_qty=0)
    assert pick_line_for_unit(_unit(), [full, free])["id"] == "l2"

def test_weight_compared_with_rounding():
    assert pick_line_for_unit(_unit(weight_kg=10.0004), [_line(kg_per_unit=10.0)])["id"] == "l1"

def test_returns_none_when_all_full():
    assert pick_line_for_unit(_unit(), [_line(packed_qty=5)]) is None
```

- [ ] **Step 2: Uruchom — ma failować**

Run: `cd backend && python3 -m pytest tests/test_pick_line_for_unit.py -v`
Expected: FAIL — `ImportError: cannot import name 'pick_line_for_unit'`.

- [ ] **Step 3: Implementacja**

W `backend/app/services/stock_cartons_service.py` dodaj (obok `_kg`):

```python
def pick_line_for_unit(unit: Dict[str, Any], lines: List[Dict[str, Any]]):
    """Pierwsza pozycja kartonu z wolnym miejscem, zgodna ze specyfikacją sztuki."""
    for ln in lines:
        if int(ln.get("packed_qty") or 0) >= int(ln.get("target_qty") or 0):
            continue
        if (unit.get("recipe_id") or "") != (ln.get("recipe_id") or ""):
            continue
        if (unit.get("product_type_id") or "") != (ln.get("product_type_id") or ""):
            continue
        if (unit.get("tuleja") or "") != (ln.get("packaging_name") or ""):
            continue
        if _kg(unit.get("weight_kg")) != _kg(ln.get("kg_per_unit")):
            continue
        return ln
    return None
```

- [ ] **Step 4: Uruchom — ma przejść**

Run: `cd backend && python3 -m pytest tests/test_pick_line_for_unit.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/stock_cartons_service.py backend/tests/test_pick_line_for_unit.py
git commit -m "feat(carton): pick_line_for_unit — dopasowanie sztuki do pozycji kartonu"
```

---

### Task 3: `match_cartons` per-pozycja (mix)

**Files:**
- Modify: `backend/app/services/stock_carton_match_service.py`
- Test: `backend/tests/test_stock_carton_match.py` (Modify — dopisz testy mix)

**Interfaces:**
- Consumes: `_line_matches(carton_spec, order_client_id, order_line)` (istnieje).
- Produces: `match_cartons(order_client_id, order_lines, cartons)` gdzie każdy `carton` ma klucz `lines: list[dict]` (pozycje z `packed_qty>0`); zwraca sugestię na karton, podpiętą do pierwszej pasującej linii zamówienia — tylko gdy **każda** pozycja kartonu pasuje do jakiejś linii zamówienia.

- [ ] **Step 1: Dopisz failujące testy (czyste)**

W `backend/tests/test_stock_carton_match.py` dopisz:

```python
def test_mixed_carton_matches_when_all_lines_match():
    lines = [
        {"id": "L1", "recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "pk1", "kg_per_unit": 10.0, "qty": 100},
        {"id": "L2", "recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "pk2", "kg_per_unit": 15.0, "qty": 100},
    ]
    cartons = [{
        "id": "c1", "carton_no": 1, "client_id": "cl1",
        "lines": [
            {"recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "pk1", "kg_per_unit": 10.0, "packed_qty": 30},
            {"recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "pk2", "kg_per_unit": 15.0, "packed_qty": 20},
        ],
    }]
    out = match_cartons("cl1", lines, cartons)
    assert len(out) == 1 and out[0]["cartonId"] == "c1"

def test_mixed_carton_skipped_when_one_line_unmatched():
    lines = [{"id": "L1", "recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "pk1", "kg_per_unit": 10.0, "qty": 100}]
    cartons = [{
        "id": "c1", "carton_no": 1, "client_id": "cl1",
        "lines": [
            {"recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "pk1", "kg_per_unit": 10.0, "packed_qty": 30},
            {"recipe_id": "rX", "product_type_id": "pt1", "packaging_id": "pk9", "kg_per_unit": 9.0, "packed_qty": 5},
        ],
    }]
    assert match_cartons("cl1", lines, cartons) == []
```

(Istniejące testy single-spec dostosuj: dodaj do `cartons` klucz `lines` z jedną pozycją odzwierciedlającą spec, albo zostaw `match_cartons` wstecznie zgodne — patrz Step 3.)

- [ ] **Step 2: Uruchom — nowe testy failują**

Run: `cd backend && python3 -m pytest tests/test_stock_carton_match.py -v`
Expected: FAIL na nowych testach (KeyError `lines` lub złe dopasowanie).

- [ ] **Step 3: Implementacja `match_cartons` po pozycjach**

W `backend/app/services/stock_carton_match_service.py` zastąp ciało `match_cartons`:

```python
def match_cartons(order_client_id, order_lines, cartons):
    """Sugestia na karton tylko gdy każda jego pozycja (packed_qty>0) pasuje do
    jakiejś linii zamówienia tego klienta. Podpięcie do pierwszej pasującej linii."""
    out = []
    for c in cartons:
        lines = [l for l in (c.get("lines") or []) if int(l.get("packed_qty") or 0) > 0]
        if not lines:
            continue
        matched_line = None
        all_ok = True
        for cl in lines:
            ln = next((ol for ol in order_lines if _line_matches(
                {"client_id": c.get("client_id"), **cl}, order_client_id, ol)), None)
            if ln is None:
                all_ok = False
                break
            matched_line = matched_line or ln
        if not all_ok or matched_line is None:
            continue
        total_packed = sum(int(l.get("packed_qty") or 0) for l in lines)
        out.append({
            "cartonId": c["id"], "cartonNo": c.get("carton_no"),
            "orderLineId": matched_line["id"], "qty": total_packed,
            "lines": lines,
        })
    return out
```

Uwaga: `_line_matches` przyjmuje słownik ze specyfikacją kartonu (`recipe_id/product_type_id/packaging_id/kg_per_unit` + `client_id`) — tu podajemy spec pozycji.

- [ ] **Step 4: Uruchom — wszystkie przechodzą**

Dostosuj stare testy single-spec (owiń spec w `"lines": [ {...} ]`).
Run: `cd backend && python3 -m pytest tests/test_stock_carton_match.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/stock_carton_match_service.py backend/tests/test_stock_carton_match.py
git commit -m "feat(carton): match_cartons per-pozycja dla kartonu mieszanego"
```

---

### Task 4: Reconciliacja braków — wyklucz sztuki skartonowane (fix C, czysta funkcja)

**Files:**
- Modify: `backend/app/services/order_stock_service.py`
- Test: `backend/tests/test_order_stock.py` (Modify — dopisz testy wykluczenia)

**Interfaces:**
- Produces: `compute_shortfalls(order_lines, produced_by_key, cartoned_by_key=None)` — odejmuje też sztuki już spakowane do kartonów powiązanych z tym zamówieniem.

- [ ] **Step 1: Dopisz failujący test (czysty)**

W `backend/tests/test_order_stock.py` dopisz:

```python
from app.services.order_stock_service import compute_shortfalls, _key

def test_cartoned_units_reduce_shortfall():
    order_lines = [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}]
    produced = {}  # nic z planów
    cartoned = {_key("r1", 10.0): 20}  # 20 szt już w kartonie pod to zamówienie
    short = compute_shortfalls(order_lines, produced, cartoned)
    assert short == {_key("r1", 10.0): 30}

def test_cartoned_plus_produced_cover_fully():
    order_lines = [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}]
    produced = {_key("r1", 10.0): 30}
    cartoned = {_key("r1", 10.0): 20}
    assert compute_shortfalls(order_lines, produced, cartoned) == {}
```

- [ ] **Step 2: Uruchom — failuje**

Run: `cd backend && python3 -m pytest tests/test_order_stock.py -v`
Expected: FAIL — `compute_shortfalls() takes 2 positional arguments`.

- [ ] **Step 3: Implementacja**

W `backend/app/services/order_stock_service.py` zmień sygnaturę i ciało `compute_shortfalls`:

```python
def compute_shortfalls(order_lines, produced_by_key, cartoned_by_key=None):
    short: Dict[Key, int] = {}
    for ln in order_lines or []:
        k = _key(ln.get("recipe_id"), ln.get("kg_per_unit"))
        short[k] = short.get(k, 0) + int(ln.get("qty") or 0)
    for k, done in (produced_by_key or {}).items():
        if k in short:
            short[k] = short[k] - int(done or 0)
    for k, packed in (cartoned_by_key or {}).items():
        if k in short:
            short[k] = short[k] - int(packed or 0)
    return {k: v for k, v in short.items() if v > 0}
```

- [ ] **Step 4: Uruchom — przechodzi**

Run: `cd backend && python3 -m pytest tests/test_order_stock.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/order_stock_service.py backend/tests/test_order_stock.py
git commit -m "feat(docs): compute_shortfalls uwzględnia sztuki skartonowane pod zamówienie"
```

---

### Task 5: `create_stock_carton` z wieloma pozycjami + dedup po `_kg` (fix E)

**Files:**
- Modify: `backend/app/services/stock_cartons_service.py`
- Modify: `backend/app/models/production.py` (`StockCartonCreate`)
- Test: `backend/tests/test_stock_cartons_db.py` (Modify)

**Interfaces:**
- Produces: `StockCartonCreate` przyjmuje `lines: list[StockCartonLineDto]` (każda: recipe_id/name, product_type_id/name, packaging_id/name, kg_per_unit, qty). Wstecznie: jeśli `lines` puste, a podano pojedynczy spec — twórz jedną pozycję. `create_stock_carton(dto)` wstawia nagłówek + pozycje; dedup pustego identycznego kartonu po (client + zestaw pozycji) z użyciem `_kg`.

- [ ] **Step 1: Model — dodaj `StockCartonLineDto` i `lines`**

W `backend/app/models/production.py` dodaj przed `StockCartonCreate`:

```python
class StockCartonLineDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    recipe_id: str = Field("", alias="recipeId")
    recipe_name: str = Field("", alias="recipeName")
    product_type_id: str = Field("", alias="productTypeId")
    product_type_name: str = Field("", alias="productTypeName")
    packaging_id: str = Field("", alias="packagingId")
    packaging_name: str = Field("", alias="packagingName")
    kg_per_unit: float = Field(..., alias="kgPerUnit", gt=0)
    qty: int = Field(..., gt=0)
```

W `StockCartonCreate` dodaj pole (zachowaj stare pola jako opcjonalne dla wstecznej zgodności — zmień `recipe_id`/`product_type_id`/`kg_per_unit`/`qty` na opcjonalne z domyślnymi):

```python
    lines: list[StockCartonLineDto] = Field(default_factory=list)
```

Zmień wymagane pola pojedynczego spec na opcjonalne:
`recipe_id: str = Field("", alias="recipeId")`, `product_type_id: str = Field("", alias="productTypeId")`,
`qty: int = Field(0)`, `kg_per_unit: float = Field(0, alias="kgPerUnit")`.

- [ ] **Step 2: Napisz failujący test (DB)**

W `backend/tests/test_stock_cartons_db.py` dopisz:

```python
def test_create_mixed_carton_has_two_lines(db):
    from app.models.production import StockCartonCreate, StockCartonLineDto
    dto = StockCartonCreate(client_id="cl1", client_name="Zagros", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tuleja A", kg_per_unit=10.0, qty=30),
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tuleja B", kg_per_unit=15.0, qty=20),
    ])
    carton = create_stock_carton(dto)
    from app.db import query_all
    lines = query_all("SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit", (carton["id"],))
    assert len(lines) == 2
    assert int(lines[0]["target_qty"]) == 30 and float(lines[0]["kg_per_unit"]) == 10.0
    assert int(lines[1]["target_qty"]) == 20 and float(lines[1]["kg_per_unit"]) == 15.0
```

- [ ] **Step 3: Uruchom — failuje**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py::test_create_mixed_carton_has_two_lines -v`
Expected: FAIL.

- [ ] **Step 4: Implementacja `create_stock_carton`**

W `backend/app/services/stock_cartons_service.py` zastąp `create_stock_carton`:

```python
def create_stock_carton(dto) -> Dict:
    """Utwórz karton (nagłówek + pozycje). Wstecznie: brak `lines` → jedna pozycja
    z pojedynczego spec. Dedup pustego identycznego kartonu (klient + zestaw pozycji)."""
    lines = list(getattr(dto, "lines", None) or [])
    if not lines:
        from app.models.production import StockCartonLineDto
        lines = [StockCartonLineDto(
            recipe_id=dto.recipe_id, recipe_name=dto.recipe_name or "",
            product_type_id=dto.product_type_id, product_type_name=dto.product_type_name or "",
            packaging_id=dto.packaging_id or "", packaging_name=dto.packaging_name or "",
            kg_per_unit=float(dto.kg_per_unit), qty=int(dto.qty),
        )]
    sig = sorted((l.recipe_id or "", l.product_type_id or "", l.packaging_id or "",
                  _kg(l.kg_per_unit), int(l.qty)) for l in lines)
    with transaction() as conn:
        # Dedup: otwarty, niepowiązany karton tego klienta o identycznym zestawie pozycji.
        candidates = cx_query_all(
            conn,
            """SELECT sc.id, sc.carton_no FROM stock_cartons sc
               WHERE sc.status='open' AND sc.linked_order_id IS NULL
                 AND COALESCE(sc.client_id,'')=%s""",
            (dto.client_id,),
        )
        for cand in candidates:
            cl = cx_query_all(conn,
                "SELECT recipe_id, product_type_id, packaging_id, kg_per_unit, target_qty "
                "FROM stock_carton_lines WHERE carton_id=%s", (cand["id"],))
            cand_sig = sorted((r.get("recipe_id") or "", r.get("product_type_id") or "",
                               r.get("packaging_id") or "", _kg(r.get("kg_per_unit")),
                               int(r.get("target_qty") or 0)) for r in cl)
            if cand_sig == sig:
                raise HTTPException(409,
                    f"Taki karton już istnieje (nr {format_carton_no(cand['carton_no'])}) — najpierw go spakuj")
        carton_no = next_seq("carton_seq")
        total_qty = sum(int(l.qty) for l in lines)
        row = cx_query_one(conn,
            """INSERT INTO stock_cartons
                 (id, carton_no, client_id, client_name, kg_per_unit, target_qty,
                  packed_qty, status, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,0,'open',%s) RETURNING *""",
            (cuid(), carton_no, dto.client_id, dto.client_name or "",
             _kg(lines[0].kg_per_unit), total_qty, now_iso()))
        for l in lines:
            cx_execute(conn,
                """INSERT INTO stock_carton_lines
                     (id, carton_id, recipe_id, recipe_name, product_type_id, product_type_name,
                      packaging_id, packaging_name, kg_per_unit, target_qty, packed_qty)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0)""",
                (cuid(), row["id"], l.recipe_id or "", l.recipe_name or "",
                 l.product_type_id or "", l.product_type_name or "",
                 l.packaging_id or "", l.packaging_name or "",
                 _kg(l.kg_per_unit), int(l.qty)))
    logger.info("stock_cartons.created", extra={"carton_no": carton_no, "lines": len(lines)})
    return row
```

Dodaj import `cx_query_all` do `from app.db import (...)` w tym pliku.

- [ ] **Step 5: Uruchom — przechodzi; przejrzyj istniejące testy create**

Dostosuj istniejące testy (`test_create_assigns_carton_no_open`, dedup) — używają single-spec, który nadal działa (tworzy 1 pozycję). Dedup test (`test_create_blocks_duplicate_open_carton`) powinien przejść (identyczny zestaw 1 pozycji).
Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/stock_cartons_service.py backend/app/models/production.py backend/tests/test_stock_cartons_db.py
git commit -m "feat(carton): create_stock_carton z wieloma pozycjami + dedup po _kg"
```

---

### Task 6: `scan_unit_into_carton` po pozycjach + pełność po wszystkich pozycjach

**Files:**
- Modify: `backend/app/services/stock_cartons_service.py`
- Test: `backend/tests/test_stock_cartons_db.py` (Modify)

**Interfaces:**
- Consumes: `pick_line_for_unit`.
- Produces: `scan_unit_into_carton(carton_id, code)` inkrementuje pasującą pozycję; nagłówek `packed` gdy `SUM(packed)>=SUM(target)`; zwraca `{ok, cartonNo, packedQty (suma), targetQty (suma), full, batchNo}`.

- [ ] **Step 1: Napisz failujący test mix (DB)**

W `backend/tests/test_stock_cartons_db.py` dopisz helper i test. Użyj istniejących helperów tworzących `finished_units` (skopiuj wzorzec z `test_scan_packs_matching_produced_unit`). Test: karton z 2 pozycjami (10kg×1, 15kg×1); skan sztuki 10kg → pozycja 1 pełna, karton nadal `open`; skan sztuki 15kg → karton `packed`, `full=True`.

```python
def test_scan_mixed_carton_full_after_all_lines(db):
    from app.models.production import StockCartonCreate, StockCartonLineDto
    carton = create_stock_carton(StockCartonCreate(client_id="cl1", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tul", kg_per_unit=10.0, qty=1),
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tul", kg_per_unit=15.0, qty=1),
    ]))
    u10 = _make_produced_unit(recipe_id="r1", product_type_id="pt1", tuleja="Tul", weight_kg=10.0)
    u15 = _make_produced_unit(recipe_id="r1", product_type_id="pt1", tuleja="Tul", weight_kg=15.0)
    r1 = scan_unit_into_carton(carton["id"], f"UNIT|{u10}")
    assert r1["full"] is False
    r2 = scan_unit_into_carton(carton["id"], f"UNIT|{u15}")
    assert r2["full"] is True and r2["targetQty"] == 2
```

(Zdefiniuj `_make_produced_unit(**kw)` na bazie istniejącego wzorca wstawiania `finished_units` w tym pliku — `status='produced'`, `carton_id NULL`, poprawny `qr_code`.)

- [ ] **Step 2: Uruchom — failuje**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py::test_scan_mixed_carton_full_after_all_lines -v`
Expected: FAIL.

- [ ] **Step 3: Implementacja `scan_unit_into_carton`**

Zastąp logikę dopasowania w `scan_unit_into_carton`: po walidacji sztuki (status produced, nie w innym kartonie — bez zmian) zamiast porównań ze stałym składem kartonu:

```python
        lines = cx_query_all(conn,
            "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit", (carton_id,))
        line = pick_line_for_unit(unit, lines)
        if line is None:
            # rozróżnij: spec pasuje ale pełne vs brak pasującej pozycji
            raise HTTPException(409, "Brak wolnej pozycji kartonu dla tej sztuki (zła spec lub pełne)")
        cx_execute(conn, "UPDATE finished_units SET carton_id=%s, status='packed' WHERE id=%s",
                   (carton_id, unit_id))
        cx_execute(conn, "UPDATE stock_carton_lines SET packed_qty=packed_qty+1 WHERE id=%s", (line["id"],))
        agg = cx_query_one(conn,
            "SELECT COALESCE(SUM(packed_qty),0) AS p, COALESCE(SUM(target_qty),0) AS t "
            "FROM stock_carton_lines WHERE carton_id=%s", (carton_id,))
        new_packed, target = int(agg["p"]), int(agg["t"])
        full = new_packed >= target
        cx_execute(conn,
            "UPDATE stock_cartons SET packed_qty=%s, status=%s, closed_at=%s WHERE id=%s",
            (new_packed, "packed" if full else "open", now_iso() if full else None, carton_id))
    return {"ok": True, "cartonNo": format_carton_no(carton["carton_no"]),
            "packedQty": new_packed, "targetQty": target, "full": full,
            "batchNo": unit.get("batch_no") or ""}
```

Usuń stary warunek `if int(carton["packed_qty"]) >= int(carton["target_qty"])` (pełność liczona z pozycji) — zamiast tego, jeśli `pick_line_for_unit` zwróci None, błąd jak wyżej. Zachowaj idempotencję (sztuka już w tym kartonie → zwróć agregaty z pozycji).

- [ ] **Step 4: Uruchom — przechodzi (i stare testy scan)**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py -v`
Expected: PASS. Dostosuj `test_scan_rejects_when_carton_full` (pełność z pozycji) i `test_scan_rejects_wrong_spec/weight` (komunikat „Brak wolnej pozycji…").

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/stock_cartons_service.py backend/tests/test_stock_cartons_db.py
git commit -m "feat(carton): skan sztuki dopasowuje pozycję; pełność po wszystkich pozycjach"
```

---

### Task 7: Ręczne dodanie sztuk w biurze + `eligible_units_for_line`

**Files:**
- Modify: `backend/app/services/stock_cartons_service.py`, `backend/app/routes/stock_cartons.py`
- Test: `backend/tests/test_stock_cartons_db.py` (Modify)

**Interfaces:**
- Produces:
  - `eligible_units_for_line(line_id) -> list[{code, batchNo}]` — produced, carton_id NULL, zgodne z pozycją, FIFO `batch_no, qr_seq`.
  - `add_units_to_carton_line(carton_id, line_id, qty) -> {ok, added}` — pakuje do `qty` uprawnionych sztuk (FIFO) wywołując tę samą logikę co skan.
  - Route `GET /api/stock-cartons/lines/{line_id}/eligible-units`, `POST /api/stock-cartons/{carton_id}/lines/{line_id}/add`.

- [ ] **Step 1: Napisz failujący test (DB)**

```python
def test_add_units_to_line_packs_fifo(db):
    from app.models.production import StockCartonCreate, StockCartonLineDto
    carton = create_stock_carton(StockCartonCreate(client_id="cl1", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tul", kg_per_unit=10.0, qty=5)]))
    line = query_one("SELECT id FROM stock_carton_lines WHERE carton_id=%s", (carton["id"],))
    for _ in range(3):
        _make_produced_unit(recipe_id="r1", product_type_id="pt1", tuleja="Tul", weight_kg=10.0)
    res = add_units_to_carton_line(carton["id"], line["id"], 2)
    assert res["added"] == 2
    packed = query_one("SELECT packed_qty FROM stock_carton_lines WHERE id=%s", (line["id"],))
    assert int(packed["packed_qty"]) == 2
```

- [ ] **Step 2: Uruchom — failuje** (`add_units_to_carton_line` nie istnieje).

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py::test_add_units_to_line_packs_fifo -v`

- [ ] **Step 3: Implementacja**

```python
def eligible_units_for_line(line_id: str) -> List[Dict]:
    line = query_one("SELECT * FROM stock_carton_lines WHERE id=%s", (line_id,))
    if not line:
        raise HTTPException(404, "Pozycja kartonu nie znaleziona")
    rows = query_all(
        """SELECT qr_code, batch_no FROM finished_units
           WHERE status='produced' AND carton_id IS NULL
             AND COALESCE(recipe_id,'')=%s AND COALESCE(product_type_id,'')=%s
             AND COALESCE(tuleja,'')=%s AND weight_kg=%s
           ORDER BY batch_no, qr_seq""",
        (line.get("recipe_id") or "", line.get("product_type_id") or "",
         line.get("packaging_name") or "", _kg(line.get("kg_per_unit"))))
    return [{"code": r["qr_code"], "batchNo": r.get("batch_no") or ""} for r in rows]


def add_units_to_carton_line(carton_id: str, line_id: str, qty: int) -> Dict:
    """Biuro: dorzuć do `qty` uprawnionych sztuk (FIFO) do pozycji — przez scan."""
    codes = [u["code"] for u in eligible_units_for_line(line_id)]
    added = 0
    for code in codes[: max(0, int(qty))]:
        scan_unit_into_carton(carton_id, code)
        added += 1
    return {"ok": True, "added": added}
```

W `backend/app/routes/stock_cartons.py` dodaj trasy:

```python
@router.get("/lines/{line_id}/eligible-units")
def line_eligible(line_id: str):
    return svc.eligible_units_for_line(line_id)


@router.post("/{carton_id}/lines/{line_id}/add")
def line_add(carton_id: str, line_id: str, body: dict):
    return svc.add_units_to_carton_line(carton_id, line_id, int((body or {}).get("qty") or 0))
```

- [ ] **Step 4: Uruchom — przechodzi**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py::test_add_units_to_line_packs_fifo -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/stock_cartons_service.py backend/app/routes/stock_cartons.py backend/tests/test_stock_cartons_db.py
git commit -m "feat(carton): ręczne dodanie sztuk z magazynu do pozycji kartonu (FIFO)"
```

---

### Task 8: `assign_carton_to_order` — strażnik pustego (fix F) + `suggestions_for_order` po pozycjach

**Files:**
- Modify: `backend/app/services/stock_cartons_service.py`, `backend/app/services/stock_carton_match_service.py`
- Test: `backend/tests/test_stock_cartons_db.py` (Modify)

**Interfaces:**
- Consumes: `match_cartons` (Task 3).
- Produces: `assign_carton_to_order` odrzuca karton z `SUM(packed_qty)=0`; `suggestions_for_order` ładuje pozycje kartonów (`lines`) i przekazuje do `match_cartons`.

- [ ] **Step 1: Failujący test (DB)**

```python
def test_assign_rejects_empty_carton(db):
    from app.models.production import StockCartonCreate, StockCartonLineDto
    carton = create_stock_carton(StockCartonCreate(client_id="cl1", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tul", kg_per_unit=10.0, qty=5)]))
    _make_order("ord1", client_id="cl1")  # helper jak w istniejących testach assign
    with pytest.raises(HTTPException) as e:
        assign_carton_to_order(carton["id"], "ord1")
    assert e.value.status_code == 409
```

- [ ] **Step 2: Uruchom — failuje** (assign nie sprawdza pustego).

- [ ] **Step 3: Implementacja**

W `assign_carton_to_order`, po pobraniu kartonu (`FOR UPDATE`) dodaj:

```python
        packed = cx_query_one(conn,
            "SELECT COALESCE(SUM(packed_qty),0) AS p FROM stock_carton_lines WHERE carton_id=%s",
            (carton_id,))
        if int(packed["p"]) <= 0:
            raise HTTPException(409, "Karton jest pusty — najpierw spakuj sztuki")
```

W `suggestions_for_order` (`stock_carton_match_service.py`) dociągnij pozycje: po pobraniu `cartons` (niepowiązane, z dowolną spakowaną sztuką — zmień warunek z `packed_qty>0` nagłówka na obecność spakowanych pozycji), dla każdego kartonu dołącz `lines`:

```python
    cartons = query_all(
        """SELECT sc.id, sc.carton_no, sc.client_id FROM stock_cartons sc
           WHERE sc.linked_order_id IS NULL
             AND EXISTS (SELECT 1 FROM stock_carton_lines l
                         WHERE l.carton_id=sc.id AND l.packed_qty>0)""")
    for c in cartons:
        c["lines"] = query_all(
            "SELECT recipe_id, product_type_id, packaging_id, kg_per_unit, packed_qty "
            "FROM stock_carton_lines WHERE carton_id=%s", (c["id"],))
    return match_cartons(order.get("client_id") or "", lines, cartons)
```

- [ ] **Step 4: Uruchom — przechodzi** (i `test_suggestions_match_packed_carton` dostosowany do pozycji).

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_stock_cartons_db.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/stock_cartons_service.py backend/app/services/stock_carton_match_service.py backend/tests/test_stock_cartons_db.py
git commit -m "feat(carton): assign odrzuca pusty karton; sugestie po pozycjach"
```

---

### Task 9: `scan_carton_into_dispatch` + route (naprawa A)

**Files:**
- Modify: `backend/app/services/dispatches_service.py`, `backend/app/routes/dispatches.py`
- Test: `backend/tests/test_carton_dispatch_db.py` (Create)

**Interfaces:**
- Produces:
  - `scan_carton_into_dispatch(dispatch_id, code) -> {ok, cartonNo, added, qty, batchBreakdown}` — `SCARTON|id`, walidacja klienta wyjazdu, ustawia `dispatch_id` na spakowanych sztukach kartonu (idempotentnie).
  - Route `POST /api/dispatches/{dispatch_id}/scan-carton`.
- Consumes: `close_dispatch` (istnieje) przełącza sztuki → shipped.

- [ ] **Step 1: Failujący test (DB)**

Utwórz `backend/tests/test_carton_dispatch_db.py`:

```python
import pytest
from fastapi import HTTPException
from app.db import execute, query_one
from app.services.stock_cartons_service import create_stock_carton, scan_unit_into_carton
from app.services.dispatches_service import (
    create_dispatch, scan_carton_into_dispatch, close_dispatch)

# _make_produced_unit: skopiuj wzorzec z tests/test_stock_cartons_db.py

def test_carton_dispatch_ships_all_units(db):
    from app.models.production import StockCartonCreate, StockCartonLineDto
    carton = create_stock_carton(StockCartonCreate(client_id="cl1", client_name="Zagros", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tul", kg_per_unit=10.0, qty=2)]))
    u1 = _make_produced_unit(recipe_id="r1", product_type_id="pt1", tuleja="Tul", weight_kg=10.0, client_name="Zagros")
    u2 = _make_produced_unit(recipe_id="r1", product_type_id="pt1", tuleja="Tul", weight_kg=10.0, client_name="Zagros")
    scan_unit_into_carton(carton["id"], f"UNIT|{u1}")
    scan_unit_into_carton(carton["id"], f"UNIT|{u2}")
    disp = create_dispatch({"client_name": "Zagros"})
    res = scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    assert res["added"] == 2
    close_dispatch(disp["id"])
    assert query_one("SELECT status FROM finished_units WHERE id=%s", (u1,))["status"] == "shipped"

def test_carton_dispatch_rejects_other_client(db):
    from app.models.production import StockCartonCreate, StockCartonLineDto
    carton = create_stock_carton(StockCartonCreate(client_id="cl1", client_name="Zagros", lines=[
        StockCartonLineDto(recipe_id="r1", product_type_id="pt1", packaging_name="Tul", kg_per_unit=10.0, qty=1)]))
    u = _make_produced_unit(recipe_id="r1", product_type_id="pt1", tuleja="Tul", weight_kg=10.0, client_name="Zagros")
    scan_unit_into_carton(carton["id"], f"UNIT|{u}")
    disp = create_dispatch({"client_name": "Inny"})
    with pytest.raises(HTTPException) as e:
        scan_carton_into_dispatch(disp["id"], f"SCARTON|{carton['id']}")
    assert e.value.status_code == 409
```

- [ ] **Step 2: Uruchom — failuje**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_carton_dispatch_db.py -v`

- [ ] **Step 3: Implementacja**

W `backend/app/services/dispatches_service.py` dodaj (import: `from app.utils.unit_codes import PACKED`; jeśli klient walidowany przez `_client_matches`, zaimportuj go z `unit_codes`):

```python
import re

def _parse_stock_carton(code: str):
    m = re.match(r"^SCARTON\|(.+)$", (code or "").strip(), re.IGNORECASE)
    return m.group(1) if m else None


def scan_carton_into_dispatch(dispatch_id: str, code: str) -> Dict[str, Any]:
    carton_id = _parse_stock_carton(code)
    if not carton_id:
        raise HTTPException(400, "Nieprawidłowy kod QR kartonu")
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT * FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")
        carton = cx_query_one(conn, "SELECT * FROM stock_cartons WHERE id=%s", (carton_id,))
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        disp_client = (disp.get("client_name") or "").strip()
        if disp_client and not _client_matches(carton.get("client_name"), disp_client):
            raise HTTPException(409, "Karton należy do innego klienta niż wydanie")
        units = cx_query_all(conn,
            "SELECT id FROM finished_units WHERE carton_id=%s AND status=%s AND dispatch_id IS NULL",
            (carton_id, PACKED))
        for u in units:
            cx_execute(conn, "UPDATE finished_units SET dispatch_id=%s WHERE id=%s", (dispatch_id, u["id"]))
        qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
        bb = _batch_breakdown(conn, dispatch_id)
    return {"ok": True, "cartonNo": format_carton_no(carton["carton_no"]),
            "added": len(units), "qty": int(qty["c"] if qty else 0), "batchBreakdown": bb}
```

Dodaj importy: `format_carton_no` z `app.utils.ids`, `cx_query_all` z `app.db`. W `backend/app/routes/dispatches.py` dodaj trasę:

```python
@router.post("/{dispatch_id}/scan-carton")
def scan_carton(dispatch_id: str, body: dict):
    return svc.scan_carton_into_dispatch(dispatch_id, (body or {}).get("code") or "")
```

- [ ] **Step 4: Uruchom — przechodzi**

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_carton_dispatch_db.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/dispatches_service.py backend/app/routes/dispatches.py backend/tests/test_carton_dispatch_db.py
git commit -m "feat(wysylka): scan_carton_into_dispatch — wysyłka kartonu (ad-hoc i pod zamówienie)"
```

---

### Task 10: Wpięcie reconciliacji w `stock_portions_for_order` (fix C, DB)

**Files:**
- Modify: `backend/app/services/order_stock_service.py`
- Test: `backend/tests/test_order_stock.py` (Modify — test DB)

**Interfaces:**
- Consumes: `compute_shortfalls(..., cartoned_by_key)` (Task 4).
- Produces: `stock_portions_for_order` liczy `cartoned_by_key` z `finished_units` powiązanych z zamówieniem przez karton (`stock_cartons.linked_order_id = order` → sztuki tego kartonu, klucz `(recipe_id, weight_kg)`), i przekazuje do `compute_shortfalls`. FIFO `finished_goods` jak dziś, ale braki już pomniejszone o karton.

- [ ] **Step 1: Failujący test (DB)**

Scenariusz: zamówienie 50 szt (r1, 10kg); karton powiązany z zamówieniem ma 20 szt spakowanych (r1,10kg); `finished_goods` ma wiersz 50 szt dostępnych. Oczekiwane: `stock_portions_for_order` rozdziela tylko 30 (50 − 20 z kartonu), nie 50.

```python
def test_portions_exclude_cartoned_units(db):
    # utwórz order (ord1, cl1) + linia 50szt r1/10kg
    # utwórz finished_goods: 50 szt r1/10kg, client_order_no='' (dostępne)
    # utwórz stock_carton linked_order_id=ord1 + 20 finished_units (r1,10kg, carton_id, packed)
    portions = stock_portions_for_order("ord1", "ZAM/1", order_lines, produced_by_key={})
    assert sum(p["take"] for p in portions) == 30
```

(Uzupełnij setup wg wzorców z istniejących testów `test_order_stock.py` i `test_stock_cartons_db.py`.)

- [ ] **Step 2: Uruchom — failuje** (dziś rozdzieli 50).

- [ ] **Step 3: Implementacja**

W `stock_portions_for_order` przed `compute_shortfalls` policz karton:

```python
    cartoned_rows = query_all(
        """SELECT fu.recipe_id, fu.weight_kg, COUNT(*) AS qty
           FROM finished_units fu
           JOIN stock_cartons sc ON sc.id = fu.carton_id
           WHERE sc.linked_order_id = %s AND fu.status IN ('packed','shipped')
           GROUP BY fu.recipe_id, fu.weight_kg""",
        (order_id,))
    cartoned_by_key = {_key(r["recipe_id"], r["weight_kg"]): int(r["qty"]) for r in cartoned_rows}
    shortfalls = compute_shortfalls(order_lines, produced_by_key, cartoned_by_key)
```

(Zmień obecne `shortfalls = compute_shortfalls(order_lines, produced_by_key)` na powyższe.)

- [ ] **Step 4: Uruchom — przechodzi** (i istniejące testy order_stock).

Run: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL python3 -m pytest tests/test_order_stock.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/order_stock_service.py backend/tests/test_order_stock.py
git commit -m "fix(docs): wyklucz sztuki kartonowe z FIFO finished_goods (koniec podwójnego liczenia)"
```

---

### Task 11: RBAC świadome metody (fix B)

**Files:**
- Modify: `backend/app/auth/permissions.py`, `backend/app/auth/middleware.py` (wywołanie `permission_for_path`)
- Test: `backend/tests/test_permissions.py` (Create lub Modify, jeśli istnieje)

**Interfaces:**
- Produces: `permission_for_path(path, method="GET")` — zwraca dział dla nowych ścieżek pakowania/wydania zależnie od metody.

- [ ] **Step 1: Failujące testy (czyste)**

Utwórz/dopisz `backend/tests/test_permissions.py`:

```python
from app.auth.permissions import permission_for_path

def test_hall_can_scan_stock_carton():
    assert permission_for_path("/api/stock-cartons/abc/scan", "POST") == "pakowanie"

def test_hall_can_list_open_cartons():
    assert permission_for_path("/api/stock-cartons/open", "GET") == "pakowanie"

def test_create_stock_carton_is_office():
    assert permission_for_path("/api/stock-cartons", "POST") == "office"

def test_hall_can_pack_pallet():
    assert permission_for_path("/api/pallets/abc/pack", "POST") == "pakowanie"

def test_carton_dispatch_is_wydanie():
    assert permission_for_path("/api/dispatches/abc/scan-carton", "POST") == "wydanie"
```

- [ ] **Step 2: Uruchom — failuje** (sygnatura/mapowania).

Run: `cd backend && python3 -m pytest tests/test_permissions.py -v`

- [ ] **Step 3: Implementacja**

W `backend/app/auth/permissions.py` rozszerz `permission_for_path` o `method` i specjalne reguły pakowania, PRZED ogólnym `DEPARTMENT_PREFIXES` i przed `return "office"`:

```python
def permission_for_path(path: str, method: str = "GET") -> str:
    for p in PUBLIC_PREFIXES:
        if _matches(path, p):
            return "public"
    for p in ANY_PREFIXES:
        if _matches(path, p):
            return "any"
    for p in ADMIN_PREFIXES:
        if _matches(path, p):
            return "admin"
    # Pakowanie (hala): skan/odczyt kartonów i palet — bez tworzenia/assign (office).
    if path.startswith("/api/stock-cartons"):
        if method == "POST" and path == "/api/stock-cartons":
            return "office"  # tworzenie kartonu
        if "/lines/" in path and path.endswith("/add"):
            return "office"  # ręczne dodanie sztuk = biuro
        return "pakowanie"   # /open, /{id}, /{id}/scan, eligible-units
    if path.startswith("/api/pallets"):
        if path == "/api/pallets/scan" or path == "/api/pallets/in-cold-storage":
            return "wydanie"
        return "pakowanie"
    for dept, prefixes in DEPARTMENT_PREFIXES.items():
        for p in prefixes:
            if _matches(path, p):
                return dept
    return "office"
```

Dodaj `"wydanie": ("/api/dispatches",)` do `DEPARTMENT_PREFIXES` (carton dispatch wpada w nie).
W `backend/app/auth/middleware.py` przekaż metodę: znajdź `permission_for_path(request.url.path)` i zmień na `permission_for_path(request.url.path, request.method)`.

- [ ] **Step 4: Uruchom — przechodzi**

Run: `cd backend && python3 -m pytest tests/test_permissions.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/permissions.py backend/app/auth/middleware.py backend/tests/test_permissions.py
git commit -m "fix(rbac): operator hali ma dostęp do skanu palet/kartonów; wydanie do dispatchy"
```

---

### Task 12: Frontend — typy API + `StockCartonModal` wieloskładnikowy

**Files:**
- Modify: `src/lib/api.ts` (`stockCartonsApi`, `StockCartonCreateDto`, `mapStockCarton`)
- Modify: `src/features/finished-goods/components/StockCartonModal.tsx`
- Test: `src/lib/api.test.ts` (jeśli jest mapowanie do przetestowania) — opcjonalnie

**Interfaces:**
- Consumes: backend `POST /api/stock-cartons` z `{ clientId, clientName, lines: [{recipeId, recipeName, productTypeId, productTypeName, packagingId, packagingName, kgPerUnit, qty}] }`; `GET /api/stock-cartons/lines/{lineId}/eligible-units`; `POST /api/stock-cartons/{cartonId}/lines/{lineId}/add`.
- Produces: modal pozwala dodać wiele pozycji (rodzaj+waga+ilość) dla jednego klienta; po utworzeniu — opcja „dodaj sztuki z magazynu" per pozycja.

- [ ] **Step 1: Rozszerz typy i `stockCartonsApi`**

W `src/lib/api.ts`: dodaj typ `StockCartonLineDto = { recipeId; recipeName; productTypeId; productTypeName; packagingId; packagingName; kgPerUnit: number; qty: number }`; zmień `StockCartonCreateDto` na `{ clientId; clientName?; lines: StockCartonLineDto[] }`. Dodaj metody:

```typescript
  lineEligible: (lineId: string) =>
    get<any[]>(`/stock-cartons/lines/${lineId}/eligible-units`).then(rows => (rows ?? []).map((r:any)=>({ code:r.code as string, batchNo:r.batchNo as string }))),
  addToLine: (cartonId: string, lineId: string, qty: number) =>
    post<{ ok: boolean; added: number }>(`/stock-cartons/${cartonId}/lines/${lineId}/add`, { qty }),
```

Upewnij się, że `create` wysyła `toSnake(dto)` zgodnie z aliasami (lines → snake). `mapStockCarton` dołącz `lines` jeśli backend je zwraca w `get`.

- [ ] **Step 2: Przebuduj `StockCartonModal` na listę pozycji**

Zmień stan z pojedynczego (recipe/qty/kg) na `lines: LineDraft[]` (`{recipeId, productTypeId, packagingId, kgPerUnit, qty}`), z przyciskiem „Dodaj pozycję" / „Usuń". Klient wspólny. Prefill z wyrobu gotowego dodaje pozycję. `submit` wysyła `{ clientId, clientName, lines }` z domapowanymi nazwami (recipeName/productTypeName/packagingName) z list. Walidacja: ≥1 pozycja, każda z qty>0 i kg>0.

- [ ] **Step 3: Weryfikacja ręczna (build + lint)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit -p tsconfig.json`
Expected: brak błędów typów w zmienionych plikach.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/features/finished-goods/components/StockCartonModal.tsx
git commit -m "feat(ui): karton mieszany — lista pozycji w modalu + dodawanie z magazynu"
```

---

### Task 13: Frontend — `MobilePakowaniePage` postęp per pozycja + walidacja offline per pozycja

**Files:**
- Modify: `src/pages/mobile/MobilePakowaniePage.tsx`
- Modify: `src/features/offline/scanQueue.ts`, `src/features/offline/validateScanLocally.ts` (jeśli walidacja zna tylko płaski zbiór)
- Test: `src/features/offline/validateScanLocally.test.ts` (Modify, jeśli istnieje)

**Interfaces:**
- Consumes: `stockCartonsApi.get(id)` zwraca `lines` (każda z `packed_qty/target_qty/kgPerUnit/...`); `eligibleUnits` zostaje (suma po kartonie) lub per linia.
- Produces: nagłówek aktywnego kartonu pokazuje wiersz na pozycję z postępem `packed/target`; offline walidacja akceptuje sztukę jeśli pasuje do którejkolwiek niepełnej pozycji.

- [ ] **Step 1: Pokaż pozycje w nagłówku aktywnego kartonu**

Gdy `pallet.kind==='stock'`, pobierz `lines` z `stockCartonsApi.get` i wyświetl listę pozycji z postępem (analogicznie do bloku „Partie w palecie”).

- [ ] **Step 2: Offline — uprawnione sztuki nadal sumarycznie**

`eligibleUnits(id)` może zostać sumą po kartonie (wszystkie uprawnione sztuki wszystkich pozycji) — walidacja lokalna „czy kod jest uprawniony" działa bez zmian. Inkrement optymistyczny pozostaje sumaryczny (`packedQty+1`).

- [ ] **Step 3: Weryfikacja (tsc + istniejące testy vitest)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit && npx vitest run src/features/offline`
Expected: brak błędów; testy offline zielone.

- [ ] **Step 4: Commit**

```bash
git add src/pages/mobile/MobilePakowaniePage.tsx src/features/offline/
git commit -m "feat(ui): postęp pakowania per pozycja kartonu na ekranie hali"
```

---

### Task 14: Frontend — skan kartonu na wyjazd (ekran wydania)

**Files:**
- Modify: ekran wydania mobilny (znajdź: `grep -rl "dispatchesApi\|/dispatches" src/pages/mobile`)
- Modify: `src/lib/api.ts` (`dispatchesApi.scanCarton`)
- Test: brak (ścieżka integracyjna; weryfikacja manualna)

**Interfaces:**
- Consumes: `POST /api/dispatches/{id}/scan-carton` `{ code }`.
- Produces: ekran wydania rozpoznaje `SCARTON|` w skanie i wywołuje `scanCarton`; obok dotychczasowego skanu luzem.

- [ ] **Step 1: Dodaj `dispatchesApi.scanCarton`**

W `src/lib/api.ts`:

```typescript
  scanCarton: (dispatchId: string, code: string) =>
    post<any>(`/dispatches/${dispatchId}/scan-carton`, { code }),
```

- [ ] **Step 2: Rozpoznaj `SCARTON|` na ekranie wydania**

W handlerze skanu wydania: jeśli `/^SCARTON\|/i.test(code)` → `dispatchesApi.scanCarton(dispatchId, code)`; inaczej dotychczasowy `scanIntoDispatch`. Pokaż feedback (ile sztuk dorzucono, batch breakdown).

- [ ] **Step 3: Weryfikacja (tsc)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak błędów typów.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/pages/mobile/
git commit -m "feat(ui): skan kartonu na wyjazd (ad-hoc i pod zamówienie)"
```

---

## Self-Review (autor planu)

- **Pokrycie spec:** model nagłówek+pozycje (T1, T5), pakowanie po pozycjach (T2, T6), ręczne dodanie (T7), wysyłka kartonu jedną ścieżką (T9), dopasowanie per-pozycja (T3, T8), dokumenty fizyczna prawda (T4, T10), RBAC metodowy (T11), drobne D (T2/T6 — tuleja po nazwie), E (T5), F (T8), front (T12–T14). Wszystkie sekcje spec mają zadanie.
- **Placeholdery:** kroki frontowe (T12–T14) opisują zmiany na bazie istniejących wzorców plików, z konkretnym kodem API; logika ryzyka (backend) ma pełny kod i testy.
- **Spójność typów:** `pick_line_for_unit`, `match_cartons(lines)`, `compute_shortfalls(...,cartoned_by_key)`, `scan_carton_into_dispatch`, `eligible_units_for_line`, `add_units_to_carton_line`, `permission_for_path(path,method)` — nazwy spójne między zadaniami.

## Ryzyka / uwagi wykonawcze

- Po T1 zastosuj DDL do bazy testowej (`run_migrations`) zanim odpalisz testy DB kolejnych zadań.
- Istniejące testy single-spec (`test_stock_cartons_db.py`, `test_stock_carton_match.py`) wymagają drobnego dostosowania do modelu pozycji — ujęte w krokach „dostosuj".
- `_make_produced_unit` / `_make_order` to helpery do skopiowania ze wzorców w istniejących testach (nie wymyślaj kolumn — użyj istniejącego INSERT-u).
- Subagenty nie piszą do `backend/`/`src/` — wszystkie zadania wykonuj inline.
