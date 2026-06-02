# QR per sztuka — Plan: Faza 2 (pakowanie + termin przydatności)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Walidacja przy pakowaniu (karton + skan sztuki z blokadą pomyłek) oraz termin przydatności liczony z pola `shelf_life_days` w recepturze.

**Architecture:** Czysta logika walidacji pakowania i wyliczania terminu w `app/utils/unit_codes.py` (rozszerzenie, TDD). Serwis `cartons_service.py` (DB) tylko ją woła. Reużycie wzorca skanu z `/pallets/scan`. Bazuje na Fazie 1 (`finished_units`, `cartons`).

**Tech Stack:** Python 3 / FastAPI / psycopg2 / PostgreSQL; testy pure-logic w pytest.

**Spec:** `docs/superpowers/specs/2026-06-02-qr-per-sztuka-design.md` (Faza 3 pakowanie + termin).

---

## Struktura plików
- **Modify:** `backend/app/utils/unit_codes.py` — `best_before(prod_date, days)`, `validate_pack(unit, carton)`.
- **Modify:** `backend/tests/test_unit_codes.py` — testy nowych funkcji.
- **Modify:** `backend/app/migrations.py` — `ALTER TABLE recipes ADD COLUMN shelf_life_days`.
- **Create:** `backend/app/models/cartons.py` — DTO (CreateCarton, CartonScan).
- **Create:** `backend/app/services/cartons_service.py` — create_carton, scan_into_carton, close_carton.
- **Create:** `backend/app/routes/cartons.py` — endpointy; rejestracja w `main.py`.

---

## Task 1: Pure — `best_before` i `validate_pack` (TDD)

**Files:** Modify `backend/app/utils/unit_codes.py`, `backend/tests/test_unit_codes.py`

- [ ] **Step 1: Dopisz failing testy do `backend/tests/test_unit_codes.py`**

```python
from app.utils.unit_codes import best_before, validate_pack


def test_best_before_adds_days():
    assert best_before("2026-06-02", 5) == "2026-06-07"
    assert best_before("2026-06-02", 365) == "2027-06-02"


def test_best_before_blank_inputs():
    assert best_before("", 5) == ""
    assert best_before("2026-06-02", 0) == "2026-06-02"


def test_validate_pack_ok():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 5}
    ok, reason = validate_pack(unit, carton)
    assert ok is True
    assert reason == ""


def test_validate_pack_wrong_weight():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 30, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 5}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "kg" in reason


def test_validate_pack_not_produced():
    unit = {"status": "planned", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 0}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "produkcj" in reason.lower()


def test_validate_pack_already_packed():
    unit = {"status": "packed", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": "c1"}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 5}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "spakowan" in reason.lower()


def test_validate_pack_wrong_client():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Inny", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 0}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "klient" in reason.lower()


def test_validate_pack_carton_full():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 20}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "pełny" in reason.lower() or "pelny" in reason.lower()
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_unit_codes.py -v`
Expected: FAIL (ImportError best_before/validate_pack).

- [ ] **Step 3: Dopisz funkcje do `backend/app/utils/unit_codes.py`**

Dodaj na górze: `from datetime import datetime, timedelta` i `from typing import Dict, Tuple` (rozszerz istniejący import typing). Dodaj funkcje:

```python
def best_before(produced_date: str, shelf_life_days: int) -> str:
    """Termin przydatności = data produkcji + dni. Pusta data → ''."""
    if not produced_date:
        return ""
    d = datetime.strptime(produced_date[:10], "%Y-%m-%d").date()
    return (d + timedelta(days=int(shelf_life_days or 0))).isoformat()


def validate_pack(unit: Dict, carton: Dict) -> Tuple[bool, str]:
    """Walidacja sztuki do kartonu. Zwraca (ok, powód_błędu)."""
    if unit.get("status") != PRODUCED:
        if unit.get("status") == PACKED:
            return False, "Sztuka już spakowana"
        return False, "Sztuka nie potwierdzona na produkcji"
    if unit.get("carton_id"):
        return False, "Sztuka już spakowana"
    if int(carton.get("packed_qty") or 0) >= int(carton.get("target_qty") or 0):
        return False, "Karton pełny"
    if (unit.get("product_type_id") or "") != (carton.get("product_type_id") or ""):
        return False, "Inny produkt niż w kartonie"
    if (unit.get("recipe_id") or "") != (carton.get("recipe_id") or ""):
        return False, "Inna receptura niż w kartonie"
    if abs(float(unit.get("weight_kg") or 0) - float(carton.get("target_weight_kg") or 0)) > 0.001:
        return False, f"Inna waga: {float(unit.get('weight_kg') or 0):g} kg, karton wymaga {float(carton.get('target_weight_kg') or 0):g} kg"
    carton_client = (carton.get("client_name") or "")
    if carton_client and carton_client != "STAN" and (unit.get("client_name") or "") != carton_client:
        return False, "Inny klient niż w kartonie"
    return True, ""
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_unit_codes.py -v`
Expected: PASS (6 starych + 9 nowych).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/unit_codes.py backend/tests/test_unit_codes.py
git commit -m "feat(qr): pure best_before + validate_pack (walidacja pakowania) + testy"
```

---

## Task 2: Migracja — `recipes.shelf_life_days`

**Files:** Modify `backend/app/migrations.py`

- [ ] **Step 1: Dodaj ALTER do listy `_DDL`**

Dopisz na końcu listy `_DDL` (jak inne ALTER-y):

```python
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER NOT NULL DEFAULT 5",
```

- [ ] **Step 2: Weryfikacja**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.migrations as m; print('shelf_life_days' in open(m.__file__).read())"`
Expected: `True`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/migrations.py
git commit -m "feat(qr): recipes.shelf_life_days (dni przydatności do terminu)"
```

---

## Task 3: DTO kartonów

**Files:** Create `backend/app/models/cartons.py`

- [ ] **Step 1: Utwórz `backend/app/models/cartons.py`**

```python
"""DTO kartonów (pakowanie QR per sztuka)."""
from typing import Optional

from pydantic import BaseModel


class CreateCartonRequest(BaseModel):
    order_id: Optional[str] = None
    client_name: str = ""
    product_type_id: str = ""
    recipe_id: str = ""
    tuleja: str = ""
    target_qty: int
    target_weight_kg: float


class CartonScanRequest(BaseModel):
    code: str
```

- [ ] **Step 2: Weryfikacja**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "from app.models.cartons import CreateCartonRequest, CartonScanRequest; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/models/cartons.py
git commit -m "feat(qr): DTO kartonów"
```

---

## Task 4: Serwis kartonów — create / scan / close

**Files:** Create `backend/app/services/cartons_service.py`

- [ ] **Step 1: Utwórz `backend/app/services/cartons_service.py`**

```python
"""cartons — tworzenie kartonu, skan sztuki do kartonu (walidacja), zamknięcie."""
from typing import Any, Dict

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.unit_codes import PACKED, parse_unit_qr, validate_pack

logger = get_logger(__name__)


def create_carton(dto: Dict[str, Any]) -> Dict[str, Any]:
    cid = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """
            INSERT INTO cartons
                (id, order_id, client_name, product_type_id, recipe_id, tuleja,
                 target_qty, target_weight_kg, packed_qty, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,0,'open',%s)
            """,
            (
                cid,
                dto.get("order_id"),
                dto.get("client_name") or "",
                dto.get("product_type_id") or "",
                dto.get("recipe_id") or "",
                dto.get("tuleja") or "",
                int(dto.get("target_qty") or 0),
                float(dto.get("target_weight_kg") or 0),
                now_iso(),
            ),
        )
    return {"id": cid, "status": "open"}


def scan_into_carton(carton_id: str, code: str) -> Dict[str, Any]:
    """Skan sztuki do kartonu: walidacja SKU/klient/produced/dubel/limit."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        carton = cx_query_one(
            conn, "SELECT * FROM cartons WHERE id=%s FOR UPDATE", (carton_id,)
        )
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")

        ok, reason = validate_pack(unit, carton)
        if not ok:
            return {"ok": False, "reason": reason,
                    "packedQty": int(carton.get("packed_qty") or 0),
                    "targetQty": int(carton.get("target_qty") or 0)}

        cx_execute(
            conn,
            "UPDATE finished_units SET status=%s, carton_id=%s WHERE id=%s",
            (PACKED, carton_id, unit_id),
        )
        new_packed = int(carton.get("packed_qty") or 0) + 1
        new_status = "full" if new_packed >= int(carton.get("target_qty") or 0) else "open"
        closed = now_iso() if new_status == "full" else None
        cx_execute(
            conn,
            "UPDATE cartons SET packed_qty=%s, status=%s, closed_at=%s WHERE id=%s",
            (new_packed, new_status, closed, carton_id),
        )
        return {"ok": True, "reason": "", "packedQty": new_packed,
                "targetQty": int(carton.get("target_qty") or 0), "cartonStatus": new_status}
```

- [ ] **Step 2: Weryfikacja importu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.services.cartons_service as s; print(hasattr(s,'create_carton'), hasattr(s,'scan_into_carton'))"`
Expected: `True True`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/cartons_service.py
git commit -m "feat(qr): serwis kartonów — create + scan_into_carton (walidacja) + auto-status"
```

---

## Task 5: Router kartonów + rejestracja

**Files:** Create `backend/app/routes/cartons.py`, Modify `backend/app/main.py`

- [ ] **Step 1: Utwórz `backend/app/routes/cartons.py`**

```python
"""Endpointy kartonów — pakowanie QR per sztuka."""
from fastapi import APIRouter

from app.models.cartons import CartonScanRequest, CreateCartonRequest
from app.services import cartons_service as svc

router = APIRouter(prefix="/api/cartons", tags=["cartons"])


@router.post("")
def create_carton(dto: CreateCartonRequest):
    return svc.create_carton(dto.model_dump())


@router.post("/{carton_id}/scan")
def scan(carton_id: str, dto: CartonScanRequest):
    return svc.scan_into_carton(carton_id, dto.code)
```

- [ ] **Step 2: Rejestracja w `backend/app/main.py`**

Dodaj `cartons,` w bloku `from app.routes import (...)` oraz w krotce pętli `for mod in (...)` (wzorzec jak `finished_units` / `raw_batches`). Nie zmieniaj nic innego.

- [ ] **Step 3: Weryfikacja**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.routes.cartons as r; print([ro.path for ro in r.router.routes])"`
Expected: lista zawiera `/api/cartons` i `/api/cartons/{carton_id}/scan`.
Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/ -q`
Expected: wszystkie PASS.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/routes/cartons.py backend/app/main.py
git commit -m "feat(qr): router kartonów (create + scan) + rejestracja"
```

---

## Weryfikacja ręczna (jeśli baza)
1. `POST /api/cartons {target_qty:20,target_weight_kg:40,recipe_id:R1,product_type_id:P1,client_name:Zagros}` → `{id, status:open}`.
2. Sztuka `produced` 40 kg R1/P1/Zagros → `POST /api/cartons/{id}/scan {code:"U|..."}` → `{ok:true, packedQty:1}`.
3. Sztuka 30 kg → `{ok:false, reason:"Inna waga: 30 kg, karton wymaga 40 kg"}`.
4. Sztuka `planned` → `{ok:false, reason:"Sztuka nie potwierdzona na produkcji"}`.
5. Ten sam skan 2× → `{ok:false, reason:"Sztuka już spakowana"}`.
6. 20-ta sztuka → `cartonStatus:"full"`.

## Kolejne fazy
- Druk etykiet per klient+receptura (ZPL + tło/pola), pole shelf_life_days w formularzu receptury, generacja sztuk z planu w UI.
- Ekrany skanu (produkcja + magazyn) jako PWA + lineage/karta sztuki + wpięcie karton→paleta.
