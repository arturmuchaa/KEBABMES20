# Kalkulator zapotrzebowania na surowiec — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pokazać ile surowca (ćwiartka / mięso z/s / filet) trzeba na zamówienie — w formularzu (live) i zbiorczo na stronie zamówień, w tym niedobór netto vs magazyn dla części niewykonanej.

**Architecture:** Backend: czysty serwis odwracający łańcuch produkcji (`material_requirements_service.py`) + endpointy w `routes/orders.py` i współczynnik wydajności w `settings_service`. Frontend: metody w `api.ts`, panel w formularzu zamówienia, karta podsumowania + kolumna „brakuje" w `ClientOrdersPage`.

**Tech Stack:** FastAPI + psycopg (PostgreSQL), pytest; React + TypeScript + Vite, vitest.

## Global Constraints

- Workspace kanoniczny: `/opt/kebab/kebab_new/kebab_fixed/` (NIE `/root/kebab_fixed_work/`).
- Backend testy: `cd backend && pytest` (baza testowa via `build_test_db.py`/pytest.ini).
- Logger `extra=` NIE może używać zarezerwowanych kluczy LogRecord (created/filename/module/name…).
- DTO z frontu → snake_case (backend Python oczekuje snake_case).
- Źródło prawdy składu 70/30: `product_types.components`; fallback `recipes.components`; brak → produkt jednoskładnikowy `mat-mieso-zs` 100%.
- Stały słownik źródeł surowca: mięso z/s (`mat-mieso-zs`) ← ćwiartka (`mat-cwiartka`, rozbiór/yield); pozostałe rodzaje przyjmowane 1:1.
- Współczynnik wydajności rozbioru: jeden globalny `deboning_yield_pct` w `app_settings`, fallback 70%, używany TYLKO do planowania.
- Statusy zamówień otwartych: `status NOT IN ('done','cancelled')`.
- Router zamówień ma prefix `/api/client-orders`.
- **UWAGA (subagent-driven):** pliki w `backend/` i większości `src/` ma pisać agent główny INLINE (subagenty nie piszą do tych ścieżek) — patrz pamięć `sdd-subagent-write-restriction`.

---

## File Structure

- `backend/app/services/material_requirements_service.py` — NOWY. Czysta logika odwracania + funkcje agregujące (zapytania DB).
- `backend/app/services/settings_service.py` — MODYFIKACJA. `get_deboning_yield_pct()`, `save_deboning_yield_pct()`, init ze średniej historycznej.
- `backend/app/routes/settings.py` — MODYFIKACJA. GET/PUT `/api/settings/deboning-yield`.
- `backend/app/routes/orders.py` — MODYFIKACJA. 3 endpointy zapotrzebowania.
- `backend/app/models/orders.py` — MODYFIKACJA. DTO `RequirementsPreviewRequest`.
- `backend/tests/test_material_requirements.py` — NOWY. Testy czystej logiki + kaskady.
- `backend/tests/test_material_requirements_api.py` — NOWY. Testy endpointów (FastAPI TestClient).
- `src/lib/api.ts` — MODYFIKACJA. `materialRequirementsApi`, typy, metody settings.
- `src/features/orders/order-form/MaterialRequirementsPanel.tsx` — NOWY. Panel „Potrzebny surowiec" w formularzu.
- `src/features/orders/order-form/OrderLinesQuickAdd.tsx` — MODYFIKACJA. Osadzenie panelu dla draftu.
- `src/pages/office/ClientOrdersPage.tsx` — MODYFIKACJA. Karta podsumowania + kolumna „brakuje".
- `src/features/orders/material-requirements.ts` — NOWY. Czyste helpery formatowania/sumowania (testowalne vitest).
- `src/features/orders/material-requirements.test.ts` — NOWY. Vitest dla helperów.

---

## Task 1: Czysta logika odwracania łańcucha (mięso + podział komponentów)

**Files:**
- Create: `backend/app/services/material_requirements_service.py`
- Test: `backend/tests/test_material_requirements.py`

**Interfaces:**
- Produces:
  - `meat_factor(ingredients: list[dict]) -> float`
  - `kg_meat_from_output(kg_output: float, ingredients: list[dict]) -> float`
  - `normalize_components(components, fallback_components=None) -> list[dict]` (każdy: `{material_type_id, name, pct}`)
  - `MIESO_ZS="mat-mieso-zs"`, `CWIARTKA="mat-cwiartka"`, `DEFAULT_YIELD_PCT=70.0`, `MEAT_RAW_SOURCE={MIESO_ZS: CWIARTKA}`

- [ ] **Step 1: Napisz failing test**

```python
# backend/tests/test_material_requirements.py
"""Czysta logika zapotrzebowania na surowiec (odwrócenie produkcji)."""
from app.services.material_requirements_service import (
    meat_factor,
    kg_meat_from_output,
    normalize_components,
    MIESO_ZS,
)


def test_meat_factor_sums_only_kg_and_l_ingredients():
    ings = [
        {"qty_per_100kg": 10, "unit": "kg"},      # liczy się
        {"qty_per_100kg": 2, "unit": "l"},        # liczy się
        {"qty_per_100kg": 50, "unit": "g"},       # pomijane (g)
        {"qty_per_100kg": 5, "unit": "ml", "is_unlimited": True},  # liczy się (unlimited)
    ]
    assert meat_factor(ings) == (10 + 2 + 5) / 100.0


def test_kg_meat_from_output_inverts_yield():
    # output = kg_meat * (1 + 0.17); dla 117 kg output → 100 kg mięsa
    ings = [{"qty_per_100kg": 17, "unit": "kg"}]
    assert kg_meat_from_output(117.0, ings) == 100.0


def test_kg_meat_from_output_no_ingredients_is_one_to_one():
    assert kg_meat_from_output(40.0, []) == 40.0


def test_kg_meat_from_output_zero_output_is_zero():
    assert kg_meat_from_output(0.0, [{"qty_per_100kg": 17, "unit": "kg"}]) == 0.0


def test_normalize_components_empty_defaults_to_single_mieso_zs():
    comps = normalize_components([], None)
    assert comps == [{"material_type_id": MIESO_ZS, "name": "Mięso z/s", "pct": 100.0}]


def test_normalize_components_uses_fallback_when_primary_empty():
    fallback = [{"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 100}]
    comps = normalize_components([], fallback)
    assert comps == [{"material_type_id": "mat-filet-kurczak", "name": "Filet", "pct": 100.0}]


def test_normalize_components_drops_zero_pct_and_reads_camel():
    comps = normalize_components(
        [{"materialTypeId": MIESO_ZS, "name": "Mięso z/s", "pct": 70},
         {"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 30},
         {"materialTypeId": "x", "name": "x", "pct": 0}],
    )
    assert comps == [
        {"material_type_id": MIESO_ZS, "name": "Mięso z/s", "pct": 70.0},
        {"material_type_id": "mat-filet-kurczak", "name": "Filet", "pct": 30.0},
    ]
```

- [ ] **Step 2: Uruchom — ma FAIL (brak modułu)**

Run: `cd backend && pytest tests/test_material_requirements.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.material_requirements_service`

- [ ] **Step 3: Zaimplementuj minimalnie**

```python
# backend/app/services/material_requirements_service.py
"""Zapotrzebowanie na surowiec dla zamówień (odwrócenie łańcucha produkcji).

Czysta logika (bez DB) + funkcje agregujące z zapytaniami. Łańcuch:
  qty*kg_per_unit = kg_output  →  kg_meat = kg_output/(1+f)  →  podział wg
  components (70/30)  →  surowiec (ćwiartka po yield lub filet 1:1).
"""
from typing import Any, Dict, List, Optional

MIESO_ZS = "mat-mieso-zs"
CWIARTKA = "mat-cwiartka"
DEFAULT_YIELD_PCT = 70.0
# Mięso z/s powstaje z rozbioru ćwiartki; pozostałe rodzaje przyjmowane 1:1.
MEAT_RAW_SOURCE: Dict[str, str] = {MIESO_ZS: CWIARTKA}


def meat_factor(ingredients: List[Dict[str, Any]]) -> float:
    """f = Σ qty_per_100kg/100 dla składników w kg/L lub is_unlimited."""
    total = 0.0
    for ing in ingredients or []:
        unit = (ing.get("unit") or "").lower()
        if unit in ("kg", "l") or ing.get("is_unlimited"):
            total += float(ing.get("qty_per_100kg") or 0)
    return total / 100.0


def kg_meat_from_output(kg_output: float, ingredients: List[Dict[str, Any]]) -> float:
    """Odwrócenie calc_kg_output: output = kg_meat*(1+f) → kg_meat = output/(1+f)."""
    if kg_output <= 0:
        return 0.0
    f = meat_factor(ingredients)
    return round(kg_output / (1.0 + f), 3)


def normalize_components(
    components: Optional[List[Dict[str, Any]]],
    fallback_components: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Skład produkcyjny → lista {material_type_id, name, pct}. Pusty (po
    odfiltrowaniu pct<=0) → produkt jednoskładnikowy mięso z/s 100%."""
    raw = components if (components and _any_pct(components)) else (fallback_components or [])
    out: List[Dict[str, Any]] = []
    for c in raw:
        pct = float(c.get("pct") or 0)
        if pct <= 0:
            continue
        out.append({
            "material_type_id": c.get("materialTypeId") or c.get("material_type_id") or MIESO_ZS,
            "name": c.get("name") or "",
            "pct": pct,
        })
    if not out:
        return [{"material_type_id": MIESO_ZS, "name": "Mięso z/s", "pct": 100.0}]
    return out


def _any_pct(components: List[Dict[str, Any]]) -> bool:
    return any(float(c.get("pct") or 0) > 0 for c in components)
```

- [ ] **Step 4: Uruchom — ma PASS**

Run: `cd backend && pytest tests/test_material_requirements.py -v`
Expected: PASS (7 testów)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/material_requirements_service.py backend/tests/test_material_requirements.py
git commit -m "feat(zapotrzebowanie): odwrócenie wydajności + normalizacja składu"
```

---

## Task 2: Zapotrzebowanie per pozycja + agregacja + kaskada niedoboru (czysta logika)

**Files:**
- Modify: `backend/app/services/material_requirements_service.py`
- Test: `backend/tests/test_material_requirements.py`

**Interfaces:**
- Consumes (Task 1): `kg_meat_from_output`, `normalize_components`, `MIESO_ZS`, `CWIARTKA`, `MEAT_RAW_SOURCE`.
- Produces:
  - `requirements_for_line(kg_output, ingredients, components, fallback_components, yield_pct, name_of) -> list[dict]`
    gdzie każdy wiersz: `{meat_type_id, meat_name, kg_meat, raw_type_id, raw_name, requires_deboning, kg_raw}`
  - `aggregate_meat_need(line_rows: list[list[dict]]) -> dict[str, float]` → `{meat_type_id: kg_meat}`
  - `compute_net_shortage(need_meat_by_type, stock_by_type, yield_pct, name_of) -> list[dict]`
    gdzie każdy wiersz: `{raw_type_id, raw_name, kg_needed_raw, kg_available, kg_net_shortage}`

- [ ] **Step 1: Napisz failing test**

```python
# dopisz do backend/tests/test_material_requirements.py
from app.services.material_requirements_service import (
    requirements_for_line,
    aggregate_meat_need,
    compute_net_shortage,
    CWIARTKA,
)

NAMES = {
    "mat-mieso-zs": "Mięso z/s",
    "mat-cwiartka": "Ćwiartka z kurczaka",
    "mat-filet-kurczak": "Filet z kurczaka",
}


def test_requirements_for_line_7030_splits_meat_and_raw():
    # 100 kg mięsa (brak dodatków), skład 70/30, yield 50% → ćwiartka = 70/0.5 = 140
    comps = [
        {"materialTypeId": "mat-mieso-zs", "name": "Mięso z/s", "pct": 70},
        {"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 30},
    ]
    rows = requirements_for_line(100.0, [], comps, None, 50.0, NAMES)
    by = {r["meat_type_id"]: r for r in rows}
    # mięso z/s: 70 kg mięsa → ćwiartka 140 kg, requires_deboning
    assert by["mat-mieso-zs"]["kg_meat"] == 70.0
    assert by["mat-mieso-zs"]["raw_type_id"] == CWIARTKA
    assert by["mat-mieso-zs"]["requires_deboning"] is True
    assert by["mat-mieso-zs"]["kg_raw"] == 140.0
    # filet: 30 kg mięsa → 30 kg surowca 1:1, bez rozbioru
    assert by["mat-filet-kurczak"]["kg_meat"] == 30.0
    assert by["mat-filet-kurczak"]["raw_type_id"] == "mat-filet-kurczak"
    assert by["mat-filet-kurczak"]["requires_deboning"] is False
    assert by["mat-filet-kurczak"]["kg_raw"] == 30.0


def test_requirements_for_line_single_component_mieso_zs():
    # brak składu → cały kg_meat jako mięso z/s; yield 70% → ćwiartka 100/0.7
    rows = requirements_for_line(100.0, [], [], None, 70.0, NAMES)
    assert len(rows) == 1
    assert rows[0]["raw_type_id"] == CWIARTKA
    assert rows[0]["kg_raw"] == round(100.0 / 0.7, 3)


def test_aggregate_meat_need_sums_by_meat_type():
    l1 = requirements_for_line(100.0, [], [
        {"materialTypeId": "mat-mieso-zs", "name": "", "pct": 70},
        {"materialTypeId": "mat-filet-kurczak", "name": "", "pct": 30},
    ], None, 70.0, NAMES)
    l2 = requirements_for_line(100.0, [], [], None, 70.0, NAMES)  # 100 kg mięso z/s
    need = aggregate_meat_need([l1, l2])
    assert need["mat-mieso-zs"] == 170.0
    assert need["mat-filet-kurczak"] == 30.0


def test_compute_net_shortage_cascade_uses_mieso_zs_first_then_cwiartka():
    # potrzeba 170 kg mięsa z/s; magazyn: 50 kg mięsa z/s, 100 kg ćwiartki; yield 50%
    need = {"mat-mieso-zs": 170.0}
    stock = {"mat-mieso-zs": 50.0, "mat-cwiartka": 100.0}
    rows = compute_net_shortage(need, stock, 50.0, NAMES)
    by = {r["raw_type_id"]: r for r in rows}
    # brak mięsa z/s = 170-50 = 120 → ćwiartka = 120/0.5 = 240; netto = 240-100 = 140
    assert by[CWIARTKA]["kg_needed_raw"] == 240.0
    assert by[CWIARTKA]["kg_available"] == 100.0
    assert by[CWIARTKA]["kg_net_shortage"] == 140.0


def test_compute_net_shortage_filet_1to1_against_stock():
    need = {"mat-filet-kurczak": 30.0}
    stock = {"mat-filet-kurczak": 12.0}
    rows = compute_net_shortage(need, stock, 70.0, NAMES)
    by = {r["raw_type_id"]: r for r in rows}
    assert by["mat-filet-kurczak"]["kg_net_shortage"] == 18.0


def test_compute_net_shortage_never_negative():
    need = {"mat-filet-kurczak": 5.0}
    stock = {"mat-filet-kurczak": 50.0}
    rows = compute_net_shortage(need, stock, 70.0, NAMES)
    by = {r["raw_type_id"]: r for r in rows}
    assert by["mat-filet-kurczak"]["kg_net_shortage"] == 0.0
```

- [ ] **Step 2: Uruchom — ma FAIL**

Run: `cd backend && pytest tests/test_material_requirements.py -v`
Expected: FAIL — `ImportError: cannot import name 'requirements_for_line'`

- [ ] **Step 3: Zaimplementuj (dopisz do serwisu)**

```python
# dopisz do backend/app/services/material_requirements_service.py

def _raw_for(meat_type: str) -> str:
    return MEAT_RAW_SOURCE.get(meat_type, meat_type)


def requirements_for_line(
    kg_output: float,
    ingredients: List[Dict[str, Any]],
    components: Optional[List[Dict[str, Any]]],
    fallback_components: Optional[List[Dict[str, Any]]],
    yield_pct: float,
    name_of: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Rozbicie jednej pozycji (kg_output gotowego produktu) na surowiec."""
    kg_meat = kg_meat_from_output(kg_output, ingredients)
    comps = normalize_components(components, fallback_components)
    rows: List[Dict[str, Any]] = []
    for c in comps:
        meat_type = c["material_type_id"]
        kg_meat_comp = round(kg_meat * c["pct"] / 100.0, 3)
        raw_type = _raw_for(meat_type)
        requires_deboning = raw_type != meat_type
        if requires_deboning and yield_pct > 0:
            kg_raw = round(kg_meat_comp / (yield_pct / 100.0), 3)
        else:
            kg_raw = kg_meat_comp
        rows.append({
            "meat_type_id": meat_type,
            "meat_name": c["name"] or name_of.get(meat_type, meat_type),
            "kg_meat": kg_meat_comp,
            "raw_type_id": raw_type,
            "raw_name": name_of.get(raw_type, raw_type),
            "requires_deboning": requires_deboning,
            "kg_raw": kg_raw,
        })
    return rows


def aggregate_meat_need(line_rows: List[List[Dict[str, Any]]]) -> Dict[str, float]:
    """Suma kg mięsa per meat_type po wszystkich pozycjach."""
    out: Dict[str, float] = {}
    for rows in line_rows or []:
        for r in rows:
            mt = r["meat_type_id"]
            out[mt] = round(out.get(mt, 0.0) + float(r["kg_meat"]), 3)
    return out


def compute_net_shortage(
    need_meat_by_type: Dict[str, float],
    stock_by_type: Dict[str, float],
    yield_pct: float,
    name_of: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Niedobór netto surowca vs magazyn. Kaskada dla mięsa z/s: najpierw zużyj
    gotowe mięso z/s, brakującą resztę przelicz na ćwiartkę i odejmij stan
    ćwiartki. Pozostałe rodzaje: potrzeba − stan, 1:1. Netto nieujemne."""
    rows: List[Dict[str, Any]] = []
    for meat_type, need in (need_meat_by_type or {}).items():
        raw_type = _raw_for(meat_type)
        if raw_type != meat_type:  # mięso z/s → ćwiartka
            avail_meat = float((stock_by_type or {}).get(meat_type, 0.0))
            brak_meat = max(0.0, float(need) - avail_meat)
            need_raw = round(brak_meat / (yield_pct / 100.0), 3) if yield_pct > 0 else 0.0
        else:                       # filet/indyk 1:1
            need_raw = round(float(need), 3)
        avail_raw = float((stock_by_type or {}).get(raw_type, 0.0))
        rows.append({
            "raw_type_id": raw_type,
            "raw_name": name_of.get(raw_type, raw_type),
            "kg_needed_raw": need_raw,
            "kg_available": round(avail_raw, 3),
            "kg_net_shortage": round(max(0.0, need_raw - avail_raw), 3),
        })
    return rows
```

- [ ] **Step 4: Uruchom — ma PASS**

Run: `cd backend && pytest tests/test_material_requirements.py -v`
Expected: PASS (wszystkie testy Task 1 + Task 2)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/material_requirements_service.py backend/tests/test_material_requirements.py
git commit -m "feat(zapotrzebowanie): rozbicie pozycji, agregacja i kaskada niedoboru netto"
```

---

## Task 3: Współczynnik wydajności rozbioru w ustawieniach

**Files:**
- Modify: `backend/app/services/settings_service.py`
- Modify: `backend/app/routes/settings.py`
- Test: `backend/tests/test_material_requirements.py`

**Interfaces:**
- Produces:
  - `settings_service.get_deboning_yield_pct() -> float` (z `app_settings` klucz `deboning_yield_pct`; brak → średnia z `deboning_entries`; brak danych → `DEFAULT_YIELD_PCT` 70.0)
  - `settings_service.save_deboning_yield_pct(pct: float) -> dict` (`{"deboningYieldPct": float}`)
- Endpoints: `GET /api/settings/deboning-yield`, `PUT /api/settings/deboning-yield`

- [ ] **Step 1: Napisz failing test (jednostkowy na czystej funkcji wyboru)**

```python
# dopisz do backend/tests/test_material_requirements.py
from app.services.settings_service import resolve_yield_pct


def test_resolve_yield_prefers_saved_value():
    assert resolve_yield_pct(saved=65.0, historical_avg=80.0) == 65.0


def test_resolve_yield_falls_back_to_historical_when_unset():
    assert resolve_yield_pct(saved=None, historical_avg=72.5) == 72.5


def test_resolve_yield_defaults_to_70_when_no_data():
    assert resolve_yield_pct(saved=None, historical_avg=None) == 70.0


def test_resolve_yield_ignores_out_of_range_saved():
    # poza (0,100) → traktuj jak brak, użyj historycznej / domyślnej
    assert resolve_yield_pct(saved=0.0, historical_avg=None) == 70.0
    assert resolve_yield_pct(saved=150.0, historical_avg=None) == 70.0
```

- [ ] **Step 2: Uruchom — ma FAIL**

Run: `cd backend && pytest tests/test_material_requirements.py::test_resolve_yield_defaults_to_70_when_no_data -v`
Expected: FAIL — `ImportError: cannot import name 'resolve_yield_pct'`

- [ ] **Step 3: Zaimplementuj w settings_service.py**

```python
# dopisz importy na górze settings_service.py:
#   from app.services.material_requirements_service import DEFAULT_YIELD_PCT
# (oraz istniejące: execute, query_one)

YIELD_KEY = "deboning_yield_pct"


def resolve_yield_pct(saved, historical_avg) -> float:
    """Czysty wybór: zapisany (jeśli w zakresie 0<pct<=100) > historyczny > 70%."""
    if saved is not None and 0 < float(saved) <= 100:
        return round(float(saved), 2)
    if historical_avg is not None and 0 < float(historical_avg) <= 100:
        return round(float(historical_avg), 2)
    return DEFAULT_YIELD_PCT


def _historical_yield_avg():
    row = query_one(
        """
        SELECT AVG(yield_pct) AS avg_yield
        FROM deboning_entries
        WHERE yield_pct > 0 AND yield_pct <= 100
        """
    )
    return float(row["avg_yield"]) if row and row.get("avg_yield") is not None else None


def get_deboning_yield_pct() -> float:
    row = query_one("SELECT value FROM app_settings WHERE key = %s", (YIELD_KEY,))
    saved = None
    if row:
        val = row["value"]
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                val = {}
        if isinstance(val, dict):
            saved = val.get("pct")
        else:
            saved = val
    return resolve_yield_pct(saved, _historical_yield_avg())


def save_deboning_yield_pct(pct: float) -> Dict:
    value = json.dumps({"pct": float(pct)})
    execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (%s, %s::jsonb, now())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        """,
        (YIELD_KEY, value),
    )
    logger.info("settings.deboning_yield.saved")
    return {"deboningYieldPct": get_deboning_yield_pct()}
```

- [ ] **Step 4: Dodaj endpointy w routes/settings.py**

```python
# dopisz w backend/app/routes/settings.py

@router.get("/deboning-yield")
def get_deboning_yield():
    return {"deboningYieldPct": svc.get_deboning_yield_pct()}


@router.put("/deboning-yield")
def save_deboning_yield(body: dict):
    return svc.save_deboning_yield_pct(float(body.get("pct", 70.0)))
```

- [ ] **Step 5: Uruchom testy jednostkowe**

Run: `cd backend && pytest tests/test_material_requirements.py -k resolve_yield -v`
Expected: PASS (4 testy)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/settings_service.py backend/app/routes/settings.py backend/tests/test_material_requirements.py
git commit -m "feat(ustawienia): współczynnik wydajności rozbioru (init ze średniej historycznej)"
```

---

## Task 4: Endpointy zapotrzebowania (order, summary, preview)

**Files:**
- Modify: `backend/app/services/material_requirements_service.py`
- Modify: `backend/app/models/orders.py`
- Modify: `backend/app/routes/orders.py`
- Test: `backend/tests/test_material_requirements_api.py`

**Interfaces:**
- Consumes: `requirements_for_line`, `aggregate_meat_need`, `compute_net_shortage`, `settings_service.get_deboning_yield_pct`, `orders_service.get_order`, `orders_service.list_orders`.
- Produces (service):
  - `material_names() -> dict[str,str]`
  - `recipe_ingredients(recipe_id) -> list[dict]`
  - `components_for(product_type_id, recipe_id) -> tuple[list, list]` → `(primary, fallback)`
  - `requirements_for_order(order_id, basis="total") -> dict`
  - `preview_requirements(items: list[dict]) -> dict`
  - `requirements_summary() -> dict`
- Produces (endpoints, prefix `/api/client-orders`):
  - `GET /{order_id}/material-requirements?basis=total|remaining`
  - `GET /material-requirements/summary`
  - `POST /preview-requirements`

Kształt odpowiedzi order/preview:
```json
{
  "lines": [{"meat_type_id","meat_name","kg_meat","raw_type_id","raw_name","requires_deboning","kg_raw", "line_index"}],
  "totals_by_raw": [{"raw_type_id","raw_name","kg_raw"}],
  "yield_pct": 70.0
}
```
Kształt summary:
```json
{
  "total": [{"raw_type_id","raw_name","kg_raw"}],
  "remaining": [{"raw_type_id","raw_name","kg_raw"}],
  "net_shortage": [{"raw_type_id","raw_name","kg_needed_raw","kg_available","kg_net_shortage"}],
  "yield_pct": 70.0
}
```

- [ ] **Step 1: Dodaj DTO w models/orders.py**

```python
# dopisz do backend/app/models/orders.py
class RequirementsPreviewItem(BaseModel):
    qty: float = 0
    kg_per_unit: float = 0
    recipe_id: str = ""
    product_type_id: str = ""


class RequirementsPreviewRequest(BaseModel):
    items: List[RequirementsPreviewItem]
```

- [ ] **Step 2: Napisz failing test API**

```python
# backend/tests/test_material_requirements_api.py
"""Endpointy zapotrzebowania na surowiec."""
from fastapi.testclient import TestClient
from app.main import create_app

client = TestClient(create_app())


def test_preview_requirements_returns_breakdown_for_single_component():
    # produkt jednoskładnikowy (brak składu/recepta nieznana) → mięso z/s → ćwiartka
    r = client.post("/api/client-orders/preview-requirements", json={
        "items": [{"qty": 10, "kg_per_unit": 4, "recipe_id": "", "product_type_id": ""}]
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "totals_by_raw" in data and "yield_pct" in data
    # 10*4 = 40 kg output, brak dodatków → 40 kg mięsa z/s → ćwiartka 40/yield
    raw = {t["raw_type_id"]: t for t in data["totals_by_raw"]}
    assert "mat-cwiartka" in raw
    assert raw["mat-cwiartka"]["kg_raw"] > 40.0


def test_summary_has_total_remaining_and_net_shortage_keys():
    r = client.get("/api/client-orders/material-requirements/summary")
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("total", "remaining", "net_shortage", "yield_pct"):
        assert key in data
```

- [ ] **Step 3: Uruchom — ma FAIL**

Run: `cd backend && pytest tests/test_material_requirements_api.py -v`
Expected: FAIL — 404 (endpointy nie istnieją)

- [ ] **Step 4: Zaimplementuj funkcje DB w serwisie**

```python
# dopisz do backend/app/services/material_requirements_service.py
from app.db import query_all, query_one  # dodaj do importów na górze
import json


def material_names() -> Dict[str, str]:
    rows = query_all("SELECT id, name FROM raw_material_types")
    return {r["id"]: r["name"] for r in rows}


def recipe_ingredients(recipe_id: str) -> List[Dict[str, Any]]:
    if not recipe_id:
        return []
    return query_all(
        """
        SELECT ri.qty_per_100kg, ri.unit,
               COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
        """,
        (recipe_id,),
    )


def _parse_components(val: Any) -> List[Dict[str, Any]]:
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except Exception:
            return []
    return val if isinstance(val, list) else []


def components_for(product_type_id: str, recipe_id: str):
    """Zwraca (primary, fallback): product_types.components > recipes.components."""
    primary: List[Dict[str, Any]] = []
    fallback: List[Dict[str, Any]] = []
    if product_type_id:
        row = query_one("SELECT components FROM product_types WHERE id = %s", (product_type_id,))
        if row:
            primary = _parse_components(row.get("components"))
    if recipe_id:
        row = query_one("SELECT components FROM recipes WHERE id = %s", (recipe_id,))
        if row:
            fallback = _parse_components(row.get("components"))
    return primary, fallback


def _sum_by_raw(line_rows: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    agg: Dict[str, Dict[str, Any]] = {}
    for rows in line_rows:
        for r in rows:
            rt = r["raw_type_id"]
            if rt not in agg:
                agg[rt] = {"raw_type_id": rt, "raw_name": r["raw_name"], "kg_raw": 0.0}
            agg[rt]["kg_raw"] = round(agg[rt]["kg_raw"] + float(r["kg_raw"]), 3)
    return list(agg.values())


def _rows_for_items(items: List[Dict[str, Any]], yield_pct: float, names: Dict[str, str]):
    """items: [{qty, kg_per_unit, recipe_id, product_type_id}] → (flat_lines, per_line_rows)."""
    flat: List[Dict[str, Any]] = []
    per_line: List[List[Dict[str, Any]]] = []
    for idx, it in enumerate(items):
        kg_output = float(it.get("qty") or 0) * float(it.get("kg_per_unit") or 0)
        if kg_output <= 0:
            per_line.append([])
            continue
        ings = recipe_ingredients(it.get("recipe_id") or "")
        primary, fallback = components_for(it.get("product_type_id") or "", it.get("recipe_id") or "")
        rows = requirements_for_line(kg_output, ings, primary, fallback, yield_pct, names)
        for r in rows:
            flat.append({**r, "line_index": idx})
        per_line.append(rows)
    return flat, per_line


def preview_requirements(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    from app.services.settings_service import get_deboning_yield_pct
    yield_pct = get_deboning_yield_pct()
    names = material_names()
    flat, per_line = _rows_for_items(items, yield_pct, names)
    return {"lines": flat, "totals_by_raw": _sum_by_raw(per_line), "yield_pct": yield_pct}


def requirements_for_order(order_id: str, basis: str = "total") -> Dict[str, Any]:
    from app.services.orders_service import get_order
    order = get_order(order_id)
    items: List[Dict[str, Any]] = []
    for ln in order.get("lines", []):
        qty = float(ln.get("qty") or 0)
        if basis == "remaining":
            qty = max(0.0, qty - float(ln.get("qty_done") or 0))
        items.append({
            "qty": qty,
            "kg_per_unit": ln.get("kg_per_unit"),
            "recipe_id": ln.get("recipe_id"),
            "product_type_id": ln.get("product_type_id"),
        })
    return preview_requirements(items)


def _stock_by_type() -> Dict[str, float]:
    """Stan dostępny: ćwiartka z raw_batches(active), mięso z/s+filet+indyk z meat_stock."""
    out: Dict[str, float] = {}
    for r in query_all(
        "SELECT material_type_id, COALESCE(SUM(kg_available),0) AS kg "
        "FROM raw_batches WHERE status='active' GROUP BY material_type_id"
    ):
        out[r["material_type_id"]] = out.get(r["material_type_id"], 0.0) + float(r["kg"] or 0)
    for r in query_all(
        "SELECT material_type_id, COALESCE(SUM(kg_available - COALESCE(kg_reserved,0)),0) AS kg "
        "FROM meat_stock GROUP BY material_type_id"
    ):
        out[r["material_type_id"]] = out.get(r["material_type_id"], 0.0) + float(r["kg"] or 0)
    return out


def requirements_summary() -> Dict[str, Any]:
    from app.services.settings_service import get_deboning_yield_pct
    from app.services.orders_service import get_order, list_orders
    yield_pct = get_deboning_yield_pct()
    names = material_names()
    total_lines: List[List[Dict[str, Any]]] = []
    remaining_lines: List[List[Dict[str, Any]]] = []
    remaining_need: Dict[str, float] = {}
    for o in list_orders(None):
        if (o.get("status") or "") in ("done", "cancelled"):
            continue
        order = get_order(o["id"])
        items_total, items_rem = [], []
        for ln in order.get("lines", []):
            qty = float(ln.get("qty") or 0)
            rem = max(0.0, qty - float(ln.get("qty_done") or 0))
            base = {"kg_per_unit": ln.get("kg_per_unit"), "recipe_id": ln.get("recipe_id"),
                    "product_type_id": ln.get("product_type_id")}
            items_total.append({**base, "qty": qty})
            items_rem.append({**base, "qty": rem})
        _, pl_total = _rows_for_items(items_total, yield_pct, names)
        _, pl_rem = _rows_for_items(items_rem, yield_pct, names)
        total_lines.extend(pl_total)
        remaining_lines.extend(pl_rem)
        for mt, kg in aggregate_meat_need(pl_rem).items():
            remaining_need[mt] = round(remaining_need.get(mt, 0.0) + kg, 3)
    net = compute_net_shortage(remaining_need, _stock_by_type(), yield_pct, names)
    return {
        "total": _sum_by_raw(total_lines),
        "remaining": _sum_by_raw(remaining_lines),
        "net_shortage": net,
        "yield_pct": yield_pct,
    }
```

- [ ] **Step 5: Dodaj endpointy w routes/orders.py**

```python
# dopisz importy w backend/app/routes/orders.py
from app.models.orders import RequirementsPreviewRequest
from app.services import material_requirements_service as mrs

# UWAGA kolejność tras: trasy statyczne PRZED dynamicznymi /{order_id},
# inaczej "material-requirements" złapie się jako order_id.

@router.get("/material-requirements/summary")
def material_requirements_summary():
    return mrs.requirements_summary()


@router.post("/preview-requirements")
def preview_requirements(body: RequirementsPreviewRequest):
    return mrs.preview_requirements([i.model_dump() for i in body.items])


@router.get("/{order_id}/material-requirements")
def order_material_requirements(order_id: str, basis: str = Query("total")):
    return mrs.requirements_for_order(order_id, basis)
```

- [ ] **Step 6: Uruchom — ma PASS**

Run: `cd backend && pytest tests/test_material_requirements_api.py -v`
Expected: PASS (2 testy)

- [ ] **Step 7: Pełny pakiet backend (regresja)**

Run: `cd backend && pytest -q`
Expected: PASS (brak nowych błędów)

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/material_requirements_service.py backend/app/models/orders.py backend/app/routes/orders.py backend/tests/test_material_requirements_api.py
git commit -m "feat(zapotrzebowanie): endpointy order/summary/preview + niedobór vs magazyn"
```

---

## Task 5: Klient API + typy (frontend) i czyste helpery

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/features/orders/material-requirements.ts`
- Test: `src/features/orders/material-requirements.test.ts`

**Interfaces:**
- Produces (api.ts):
  - typy `RawRequirementRow`, `RequirementLineRow`, `MaterialRequirements`, `NetShortageRow`, `RequirementsSummary`
  - `materialRequirementsApi.preview(items) : Promise<MaterialRequirements>`
  - `materialRequirementsApi.forOrder(id, basis) : Promise<MaterialRequirements>`
  - `materialRequirementsApi.summary() : Promise<RequirementsSummary>`
  - `settingsApi.getDeboningYield()`, `settingsApi.saveDeboningYield(pct)`
- Produces (helper): `fmtRawList(rows: RawRequirementRow[]) : string` — np. „Ćwiartka 140 kg · Filet 30 kg"

- [ ] **Step 1: Napisz failing vitest**

```ts
// src/features/orders/material-requirements.test.ts
import { describe, it, expect } from 'vitest'
import { fmtRawList } from './material-requirements'

describe('fmtRawList', () => {
  it('łączy rodzaje surowca z kg', () => {
    const out = fmtRawList([
      { rawTypeId: 'mat-cwiartka', rawName: 'Ćwiartka z kurczaka', kgRaw: 140 },
      { rawTypeId: 'mat-filet-kurczak', rawName: 'Filet z kurczaka', kgRaw: 30 },
    ])
    expect(out).toContain('Ćwiartka')
    expect(out).toContain('140')
    expect(out).toContain('Filet')
  })

  it('pusty wejściowy → kreska', () => {
    expect(fmtRawList([])).toBe('—')
  })
})
```

- [ ] **Step 2: Uruchom — ma FAIL**

Run: `npx vitest run src/features/orders/material-requirements.test.ts`
Expected: FAIL — brak modułu / `fmtRawList` undefined

- [ ] **Step 3: Zaimplementuj helper**

```ts
// src/features/orders/material-requirements.ts
import { fmtKg } from '@/lib/utils'

export interface RawRequirementRow {
  rawTypeId: string
  rawName: string
  kgRaw: number
}

/** "Ćwiartka z kurczaka 140 kg · Filet z kurczaka 30 kg" */
export function fmtRawList(rows: RawRequirementRow[]): string {
  if (!rows || rows.length === 0) return '—'
  return rows
    .filter(r => r.kgRaw > 0)
    .map(r => `${r.rawName} ${fmtKg(r.kgRaw, 0)} kg`)
    .join(' · ') || '—'
}
```

- [ ] **Step 4: Dodaj typy + API w src/lib/api.ts**

```ts
// dopisz w src/lib/api.ts (np. obok clientOrdersApi)
export interface RequirementLineRow {
  meatTypeId: string; meatName: string; kgMeat: number
  rawTypeId: string; rawName: string; requiresDeboning: boolean; kgRaw: number
  lineIndex?: number
}
export interface RawRequirementTotal { rawTypeId: string; rawName: string; kgRaw: number }
export interface MaterialRequirements {
  lines: RequirementLineRow[]
  totalsByRaw: RawRequirementTotal[]
  yieldPct: number
}
export interface NetShortageRow {
  rawTypeId: string; rawName: string
  kgNeededRaw: number; kgAvailable: number; kgNetShortage: number
}
export interface RequirementsSummary {
  total: RawRequirementTotal[]
  remaining: RawRequirementTotal[]
  netShortage: NetShortageRow[]
  yieldPct: number
}

function mapReqLine(r: any): RequirementLineRow {
  return {
    meatTypeId: r.meat_type_id, meatName: r.meat_name, kgMeat: Number(r.kg_meat ?? 0),
    rawTypeId: r.raw_type_id, rawName: r.raw_name,
    requiresDeboning: !!r.requires_deboning, kgRaw: Number(r.kg_raw ?? 0),
    lineIndex: r.line_index,
  }
}
const mapRawTotal = (r: any): RawRequirementTotal =>
  ({ rawTypeId: r.raw_type_id, rawName: r.raw_name, kgRaw: Number(r.kg_raw ?? 0) })
function mapRequirements(raw: any): MaterialRequirements {
  return {
    lines: (raw.lines ?? []).map(mapReqLine),
    totalsByRaw: (raw.totals_by_raw ?? []).map(mapRawTotal),
    yieldPct: Number(raw.yield_pct ?? 70),
  }
}
const mapNetShortage = (r: any): NetShortageRow => ({
  rawTypeId: r.raw_type_id, rawName: r.raw_name,
  kgNeededRaw: Number(r.kg_needed_raw ?? 0), kgAvailable: Number(r.kg_available ?? 0),
  kgNetShortage: Number(r.kg_net_shortage ?? 0),
})

export interface PreviewItem {
  qty: number; kgPerUnit: number; recipeId: string; productTypeId: string
}
export const materialRequirementsApi = {
  preview: (items: PreviewItem[]) =>
    post<any>('/client-orders/preview-requirements', {
      items: items.map(i => ({
        qty: i.qty, kg_per_unit: i.kgPerUnit,
        recipe_id: i.recipeId, product_type_id: i.productTypeId,
      })),
    }).then(mapRequirements),
  forOrder: (id: string, basis: 'total' | 'remaining' = 'total') =>
    get<any>(`/client-orders/${id}/material-requirements?basis=${basis}`).then(mapRequirements),
  summary: () => get<any>('/client-orders/material-requirements/summary').then(raw => ({
    total: (raw.total ?? []).map(mapRawTotal),
    remaining: (raw.remaining ?? []).map(mapRawTotal),
    netShortage: (raw.net_shortage ?? []).map(mapNetShortage),
    yieldPct: Number(raw.yield_pct ?? 70),
  }) as RequirementsSummary),
}

export const settingsApi = {
  getDeboningYield: () => get<any>('/settings/deboning-yield').then(r => Number(r.deboningYieldPct ?? 70)),
  saveDeboningYield: (pct: number) => put<any>('/settings/deboning-yield', { pct }),
}
```

(Jeśli `settingsApi` już istnieje — dopisz dwie metody do istniejącego obiektu zamiast tworzyć nowy.)

- [ ] **Step 5: Uruchom vitest + typecheck**

Run: `npx vitest run src/features/orders/material-requirements.test.ts && npx tsc --noEmit`
Expected: PASS i brak błędów typów

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src/features/orders/material-requirements.ts src/features/orders/material-requirements.test.ts
git commit -m "feat(zapotrzebowanie): klient API + typy + helper formatowania"
```

---

## Task 6: Panel „Potrzebny surowiec" w formularzu zamówienia

**Files:**
- Create: `src/features/orders/order-form/MaterialRequirementsPanel.tsx`
- Modify: `src/features/orders/order-form/OrderLinesQuickAdd.tsx`

**Interfaces:**
- Consumes (Task 5): `materialRequirementsApi.preview`, `MaterialRequirements`, `RawRequirementTotal`, `fmtRawList`.
- Produces: komponent `<MaterialRequirementsPanel items={PreviewItem[]} />` — debounce 400 ms, pokazuje rozbicie per surowiec; ukryty gdy brak kompletnych pozycji.

- [ ] **Step 1: Utwórz komponent panelu**

```tsx
// src/features/orders/order-form/MaterialRequirementsPanel.tsx
import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements, type PreviewItem } from '@/lib/api'

export function MaterialRequirementsPanel({ items }: { items: PreviewItem[] }) {
  const [data, setData] = useState<MaterialRequirements | null>(null)
  const valid = items.filter(i => i.qty > 0 && i.kgPerUnit > 0)
  const key = JSON.stringify(valid)

  useEffect(() => {
    if (valid.length === 0) { setData(null); return }
    let alive = true
    const t = setTimeout(() => {
      materialRequirementsApi.preview(valid)
        .then(d => { if (alive) setData(d) })
        .catch(() => { if (alive) setData(null) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || data.totalsByRaw.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
        <Boxes size={13} /> Potrzebny surowiec
        <span className="ml-auto font-normal normal-case text-amber-700">wydajność {fmtKg(data.yieldPct, 0)}%</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {data.totalsByRaw.map(t => (
          <span key={t.rawTypeId} className="tabular-nums">
            <span className="text-muted-foreground">{t.rawName}:</span>{' '}
            <span className="font-bold text-amber-900">{fmtKg(t.kgRaw, 0)} kg</span>
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Osadź panel w OrderLinesQuickAdd.tsx**

W `OrderLinesQuickAdd.tsx` zbuduj listę pozycji do podglądu (zatwierdzone + draft jeśli kompletny) i wstaw panel pod paskiem dodawania.

Dodaj import:
```tsx
import { MaterialRequirementsPanel } from './MaterialRequirementsPanel'
import type { PreviewItem } from '@/lib/api'
```

Po linii `const totalUnits = ...` (ok. linii 27) dodaj budowanie pozycji podglądu:
```tsx
  const previewItems: PreviewItem[] = [
    ...committed.map(({ l }) => ({
      qty: parseFloat(l.qty) || 0,
      kgPerUnit: parseFloat(l.kgPerUnit) || 0,
      recipeId: l.recipeId, productTypeId: l.productTypeId,
    })),
    ...(draft.qty && draft.kgPerUnit && draft.recipeId
      ? [{ qty: parseFloat(draft.qty) || 0, kgPerUnit: parseFloat(draft.kgPerUnit) || 0,
           recipeId: draft.recipeId, productTypeId: draft.productTypeId }]
      : []),
  ]
```

Pod blokiem „Pasek dodawania" (po zamknięciu `</div>` z `hint`, przed komentarzem „Lista dodanych pozycji") wstaw:
```tsx
      <MaterialRequirementsPanel items={previewItems} />
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: brak błędów

- [ ] **Step 4: Weryfikacja wizualna (ręczna)**

Uruchom backend + `npm run dev`, otwórz formularz nowego zamówienia, wybierz rodzaj 70/30 + recepturę, wpisz szt i kg. Panel „Potrzebny surowiec" pokazuje ćwiartkę i filet. Potwierdź wartości względem ręcznego wyliczenia.

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/order-form/MaterialRequirementsPanel.tsx src/features/orders/order-form/OrderLinesQuickAdd.tsx
git commit -m "feat(zamówienia): panel 'Potrzebny surowiec' w formularzu (live)"
```

---

## Task 7: Podsumowanie surowca + kolumna „brakuje" na stronie zamówień

**Files:**
- Create: `src/features/orders/MaterialSummaryCard.tsx`
- Modify: `src/pages/office/ClientOrdersPage.tsx`

**Interfaces:**
- Consumes (Task 5): `materialRequirementsApi.summary`, `RequirementsSummary`, `materialRequirementsApi.forOrder`.
- Produces: `<MaterialSummaryCard />` (samo-pobierający summary) + (opcjonalnie) wyświetlenie „brakuje na resztę" per zamówienie w istniejącej liście.

- [ ] **Step 1: Utwórz kartę podsumowania**

```tsx
// src/features/orders/MaterialSummaryCard.tsx
import { useEffect, useState } from 'react'
import { Boxes, AlertTriangle } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { materialRequirementsApi, type RequirementsSummary } from '@/lib/api'

export function MaterialSummaryCard() {
  const [data, setData] = useState<RequirementsSummary | null>(null)
  useEffect(() => {
    materialRequirementsApi.summary().then(setData).catch(() => setData(null))
  }, [])
  if (!data) return null
  const hasShortage = data.netShortage.some(s => s.kgNetShortage > 0)

  return (
    <div className="rounded-xl border border-surface-3 bg-white p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-2">
        <Boxes size={14} /> Surowiec do realizacji wszystkich zamówień
        <span className="ml-auto font-normal normal-case text-muted-foreground">wydajność rozbioru {fmtKg(data.yieldPct, 0)}%</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCol title="Zapotrzebowanie (całość)" rows={data.total} />
        <SummaryCol title="Pozostało do zrobienia" rows={data.remaining} />
        <div>
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Niedobór netto vs magazyn</div>
          {data.netShortage.filter(s => s.kgNetShortage > 0).length === 0 ? (
            <div className="text-xs text-emerald-700">Magazyn pokrywa zapotrzebowanie ✓</div>
          ) : (
            data.netShortage.filter(s => s.kgNetShortage > 0).map(s => (
              <div key={s.rawTypeId} className="flex items-center gap-1.5 text-xs tabular-nums">
                {hasShortage && <AlertTriangle size={12} className="text-red-600 shrink-0" />}
                <span className="text-muted-foreground">{s.rawName}:</span>
                <span className="font-bold text-red-700">{fmtKg(s.kgNetShortage, 0)} kg</span>
                <span className="text-[10px] text-muted-foreground">(jest {fmtKg(s.kgAvailable, 0)})</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCol({ title, rows }: { title: string; rows: { rawTypeId: string; rawName: string; kgRaw: number }[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{title}</div>
      {rows.filter(r => r.kgRaw > 0).length === 0 ? (
        <div className="text-xs text-muted-foreground">—</div>
      ) : (
        rows.filter(r => r.kgRaw > 0).map(r => (
          <div key={r.rawTypeId} className="flex justify-between text-xs tabular-nums">
            <span className="text-muted-foreground">{r.rawName}</span>
            <span className="font-bold text-ink">{fmtKg(r.kgRaw, 0)} kg</span>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 2: Osadź kartę w ClientOrdersPage.tsx**

Najpierw zobacz strukturę strony, by trafić w miejsce nad listą zamówień:

Run: `grep -n "return (\|<h1\|className=\"\|ClientOrders\|orders.map\|export" src/pages/office/ClientOrdersPage.tsx | head -30`

Dodaj import na górze pliku:
```tsx
import { MaterialSummaryCard } from '@/features/orders/MaterialSummaryCard'
```
Wstaw `<MaterialSummaryCard />` bezpośrednio nad sekcją z listą zamówień (pod nagłówkiem strony). Karta sama pobiera dane — nie wymaga propsów.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: brak błędów

- [ ] **Step 4: Weryfikacja wizualna (ręczna)**

Otwórz stronę zamówień. Karta pokazuje 3 kolumny: zapotrzebowanie całość, pozostało, niedobór netto. Zrealizuj częściowo zamówienie (lub ustaw qty_done w danych) — „pozostało" i „niedobór" maleją. Gdy magazyn pokrywa potrzebę → „Magazyn pokrywa zapotrzebowanie ✓".

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/MaterialSummaryCard.tsx src/pages/office/ClientOrdersPage.tsx
git commit -m "feat(zamówienia): karta zapotrzebowania + niedobór netto vs magazyn"
```

---

## Self-Review (wykonane przy pisaniu planu)

- **Pokrycie specu:** formularz live (Task 6) ✓; agregat wszystkich zamówień (Task 4 summary + Task 7) ✓; „ile brakuje" przy częściowej realizacji = `remaining` + `net_shortage` (Task 4/7) ✓; podział 70/30 ćwiartka+filet (Task 1/2) ✓; kaskada „najpierw mięso z/s, potem ćwiartka" (Task 2) ✓; konfigurowalny współczynnik z init historycznym (Task 3) ✓; testy (Task 1–5) ✓.
- **Placeholdery:** brak — każdy krok z kodem.
- **Spójność typów:** `requirements_for_line`/`aggregate_meat_need`/`compute_net_shortage` sygnatury zgodne między Task 2 a Task 4; pola snake↔camel mapowane w Task 5 zgodnie z kształtem z Task 4.
- **Znane uproszczenia (zgodne ze specem):** jeden globalny współczynnik wydajności; mapowanie źródła surowca `MEAT_RAW_SOURCE` (mięso z/s ← ćwiartka, reszta 1:1).
