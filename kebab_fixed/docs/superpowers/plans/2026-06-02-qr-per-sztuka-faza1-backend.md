# QR per sztuka — Plan wdrożenia: Faza 1 (fundament backendu)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backendowy fundament identyfikowalności per sztuka: tabele `finished_units` + `cartons`, generowanie sztuk z linii planu, skan produkcyjny (status + wózek + wykrycie dubli) i lookup po QR.

**Architecture:** Cała logika kodów/tokenów i przejść statusów w czystym, testowalnym module `app/utils/unit_codes.py` (TDD przez pytest). Serwis `finished_units_service.py` (DB) tylko go woła. Wzorce 1:1 z istniejących serwisów (cuid/next_seq/transaction/cx_query_*). Migracje jak w `migrations.py` (lista SQL). To samodzielny, testowalny kawałek — kolejne plany (druk etykiet, pakowanie, lineage-UI) bazują na nim.

**Tech Stack:** Python 3 / FastAPI / psycopg2 / PostgreSQL; testy pure-logic w `pytest`.

**Spec:** `docs/superpowers/specs/2026-06-02-qr-per-sztuka-design.md` (Fazy 1–2; pakowanie/lineage w kolejnych planach).

---

## Struktura plików

- **Create:** `backend/app/utils/unit_codes.py` — czyste: token QR sztuki, parsowanie, przejścia statusu.
- **Create:** `backend/tests/test_unit_codes.py` — testy jednostkowe modułu.
- **Modify:** `backend/app/migrations.py` — tabele `finished_units`, `cartons` + indeksy + sekwencja.
- **Create:** `backend/app/models/finished_units.py` — DTO (pydantic) requestów.
- **Create:** `backend/app/services/finished_units_service.py` — generacja z planu, skan produkcyjny, lookup.
- **Create:** `backend/app/routes/finished_units.py` — endpointy.
- **Modify:** `backend/app/main.py` — rejestracja routera `finished_units`.

---

## Task 1: Czysty moduł `unit_codes` + testy

**Files:**
- Create: `backend/app/utils/unit_codes.py`
- Create: `backend/tests/test_unit_codes.py`

- [ ] **Step 1: Napisz failing testy `backend/tests/test_unit_codes.py`**

```python
import pytest

from app.utils.unit_codes import (
    unit_qr,
    parse_unit_qr,
    next_produced_status,
    PRODUCED,
    PLANNED,
    PACKED,
)


def test_unit_qr_format():
    assert unit_qr("abc123") == "U|abc123"


def test_parse_unit_qr_ok():
    assert parse_unit_qr("U|abc123") == "abc123"


def test_parse_unit_qr_trims_whitespace():
    assert parse_unit_qr("  U|abc123  ") == "abc123"


def test_parse_unit_qr_rejects_other_tokens():
    assert parse_unit_qr("PAL|x|1") is None
    assert parse_unit_qr("abc123") is None
    assert parse_unit_qr("") is None
    assert parse_unit_qr(None) is None


def test_next_produced_status_from_planned():
    # planned → produced (poprawne potwierdzenie produkcji)
    assert next_produced_status(PLANNED) == PRODUCED


def test_next_produced_status_duplicate_raises():
    # już produced/packed → skan produkcyjny to DUBEL
    with pytest.raises(ValueError):
        next_produced_status(PRODUCED)
    with pytest.raises(ValueError):
        next_produced_status(PACKED)
```

- [ ] **Step 2: Uruchom — FAIL (brak modułu)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_unit_codes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.utils.unit_codes'`

- [ ] **Step 3: Zaimplementuj `backend/app/utils/unit_codes.py`**

```python
"""Czysta logika kodów sztuk (bez DB/IO).

Token QR sztuki: 'U|<unit_id>' (analogicznie do 'PAL|<order>|<no>' palet).
Statusy sztuki: planned → produced → packed → shipped.
"""
from __future__ import annotations

from typing import Optional

PLANNED = "planned"
PRODUCED = "produced"
PACKED = "packed"
SHIPPED = "shipped"

_PREFIX = "U|"


def unit_qr(unit_id: str) -> str:
    """Token QR dla sztuki."""
    return f"{_PREFIX}{unit_id}"


def parse_unit_qr(code: Optional[str]) -> Optional[str]:
    """Wyciąga unit_id z tokenu 'U|<id>'. Zwraca None gdy to nie token sztuki."""
    if not code:
        return None
    s = code.strip()
    if not s.startswith(_PREFIX):
        return None
    unit_id = s[len(_PREFIX):]
    return unit_id or None


def next_produced_status(current: str) -> str:
    """Przejście przy skanie produkcyjnym. Tylko z 'planned'.

    Skan sztuki już 'produced'/'packed'/'shipped' to DUBEL → ValueError.
    """
    if current == PLANNED:
        return PRODUCED
    raise ValueError("Sztuka już zeskanowana na produkcji")
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_unit_codes.py -v`
Expected: PASS (6 testów)

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/unit_codes.py backend/tests/test_unit_codes.py
git commit -m "feat(qr): czysty moduł unit_codes (token QR sztuki + statusy) + testy"
```

---

## Task 2: Migracja — tabele `finished_units` i `cartons`

**Files:**
- Modify: `backend/app/migrations.py`

- [ ] **Step 1: Dodaj instrukcje SQL do listy migracji**

W `backend/app/migrations.py` znajdź listę instrukcji SQL (krotka/lista stringów wykonywanych
przez `run_migrations`) i dopisz na jej końcu (przed zamknięciem listy):

```python
    # ── QR per sztuka — finished_units + cartons ──
    """CREATE TABLE IF NOT EXISTS finished_units (
        id            TEXT PRIMARY KEY,
        qr_code       TEXT NOT NULL UNIQUE,
        qr_seq        INTEGER,
        plan_line_id  TEXT,
        order_id      TEXT,
        client_name   TEXT DEFAULT '',
        product_type_id TEXT DEFAULT '',
        recipe_id     TEXT DEFAULT '',
        tuleja        TEXT DEFAULT '',
        weight_kg     NUMERIC NOT NULL DEFAULT 0,
        batch_no      TEXT DEFAULT '',
        produced_date TEXT DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'planned',
        trolley_id    TEXT,
        produced_at   TIMESTAMPTZ,
        carton_id     TEXT,
        created_at    TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_status   ON finished_units(status)",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_batch    ON finished_units(batch_no)",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_planline ON finished_units(plan_line_id)",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_carton   ON finished_units(carton_id) WHERE carton_id IS NOT NULL",

    """CREATE TABLE IF NOT EXISTS cartons (
        id              TEXT PRIMARY KEY,
        order_id        TEXT,
        client_name     TEXT DEFAULT '',
        product_type_id TEXT DEFAULT '',
        recipe_id       TEXT DEFAULT '',
        tuleja          TEXT DEFAULT '',
        target_qty      INTEGER NOT NULL DEFAULT 0,
        target_weight_kg NUMERIC NOT NULL DEFAULT 0,
        packed_qty      INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'open',
        pallet_id       TEXT,
        created_at      TIMESTAMPTZ DEFAULT now(),
        closed_at       TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_cartons_status ON cartons(status)",
```

- [ ] **Step 2: Weryfikacja składni migracji**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.migrations; print('migrations import OK')"`
Expected: `migrations import OK`

- [ ] **Step 3: (jeśli jest lokalna baza) odpal migracje**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "from app.db import init_pool, close_pool; from app.migrations import run_migrations; init_pool(); run_migrations(); close_pool(); print('migrated')"`
Expected: `migrated` (bez błędu); tabele `finished_units`, `cartons` istnieją.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/migrations.py
git commit -m "feat(qr): migracja — tabele finished_units i cartons"
```

---

## Task 3: Model DTO `finished_units`

**Files:**
- Create: `backend/app/models/finished_units.py`

- [ ] **Step 1: Utwórz `backend/app/models/finished_units.py`**

```python
"""DTO requestów dla finished_units (QR per sztuka)."""
from typing import Optional

from pydantic import BaseModel


class GenerateUnitsRequest(BaseModel):
    plan_line_id: str


class ScanProducedRequest(BaseModel):
    code: str
    trolley_id: Optional[str] = None
```

- [ ] **Step 2: Weryfikacja importu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "from app.models.finished_units import GenerateUnitsRequest, ScanProducedRequest; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/models/finished_units.py
git commit -m "feat(qr): DTO finished_units"
```

---

## Task 4: Serwis — generowanie sztuk z linii planu

**Files:**
- Create: `backend/app/services/finished_units_service.py`

Kontekst: `production_plan_lines` ma m.in. `qty`, `kg_per_unit`, `recipe_id`,
`seasoned_batch_nos` (TEXT[]), `client_order_line_id`. Numer partii sztuki bierzemy z linii planu:
pierwszy z `seasoned_batch_nos` (lub pusty, jeśli brak). `cx_query_one` zwraca wiersz jako dict;
używamy `.get()`, więc brak kolumny → pusta wartość (bez crasha).

**Uwaga:** pola denormalizowane `client_name`, `tuleja`, `product_type_id` mogą nie być wprost
na `production_plan_lines` — wtedy zostaną puste na tym etapie. Ich pełne uzupełnienie (złączenia
do zamówienia/receptury/typu produktu) doprecyzujemy w planie druku etykiet, gdzie te pola są
realnie potrzebne na etykiecie. Fundament (id, qr, batch_no, weight, qty, status) działa niezależnie.

- [ ] **Step 1: Utwórz `backend/app/services/finished_units_service.py`**

```python
"""finished_units — generacja z planu, skan produkcyjny, lookup."""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.unit_codes import next_produced_status, parse_unit_qr, unit_qr

logger = get_logger(__name__)


def generate_units_from_plan_line(plan_line_id: str) -> Dict[str, Any]:
    """Tworzy `qty` rekordów finished_units (status 'planned') dla linii planu.

    Idempotentne per linia: jeśli sztuki już istnieją, zwraca istniejące.
    """
    with transaction() as conn:
        line = cx_query_one(
            conn,
            "SELECT * FROM production_plan_lines WHERE id=%s",
            (plan_line_id,),
        )
        if not line:
            raise HTTPException(404, "Linia planu nie znaleziona")

        existing = cx_query_all(
            conn,
            "SELECT id FROM finished_units WHERE plan_line_id=%s",
            (plan_line_id,),
        )
        if existing:
            return {"planLineId": plan_line_id, "created": 0, "existing": len(existing)}

        qty = int(line.get("qty") or 0)
        if qty <= 0:
            raise HTTPException(400, "Linia planu ma qty <= 0")

        seasoned = line.get("seasoned_batch_nos") or []
        batch_no = seasoned[0] if seasoned else ""
        created = 0
        for _ in range(qty):
            uid = cuid()
            seq = next_seq("unit_seq")
            cx_execute(
                conn,
                """
                INSERT INTO finished_units
                    (id, qr_code, qr_seq, plan_line_id, order_id, client_name,
                     product_type_id, recipe_id, tuleja, weight_kg, batch_no,
                     produced_date, status, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'planned',%s)
                """,
                (
                    uid,
                    unit_qr(uid),
                    seq,
                    plan_line_id,
                    line.get("client_order_line_id"),
                    line.get("client_name") or "",
                    line.get("product_type_id") or "",
                    line.get("recipe_id") or "",
                    line.get("tuleja") or "",
                    float(line.get("kg_per_unit") or 0),
                    batch_no,
                    line.get("produced_date") or "",
                    now_iso(),
                ),
            )
            created += 1

        logger.info("finished_units.generated", extra={"plan_line_id": plan_line_id, "created": created})
        return {"planLineId": plan_line_id, "created": created, "existing": 0}
```

- [ ] **Step 2: Weryfikacja importu/składni**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.services.finished_units_service as s; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/finished_units_service.py
git commit -m "feat(qr): serwis — generowanie sztuk z linii planu"
```

---

## Task 5: Serwis — skan produkcyjny (status + wózek + duble) i lookup

**Files:**
- Modify: `backend/app/services/finished_units_service.py`

- [ ] **Step 1: Dopisz funkcje `scan_produced` i `lookup_unit`**

Dodaj na końcu `backend/app/services/finished_units_service.py`:

```python
def scan_produced(code: str, trolley_id: str | None = None) -> Dict[str, Any]:
    """Skan produkcyjny: planned → produced (+ wózek). Dubel → 409."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")

    with transaction() as conn:
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")
        try:
            new_status = next_produced_status(unit["status"])
        except ValueError as exc:
            raise HTTPException(409, str(exc))

        cx_execute(
            conn,
            """
            UPDATE finished_units
            SET status=%s, produced_at=now(), trolley_id=%s
            WHERE id=%s
            """,
            (new_status, trolley_id, unit_id),
        )

        # licznik linii planu: ile potwierdzonych vs zaplanowanych
        counts = cx_query_one(
            conn,
            """
            SELECT count(*) FILTER (WHERE status <> 'planned') AS done,
                   count(*) AS total
            FROM finished_units WHERE plan_line_id=%s
            """,
            (unit.get("plan_line_id"),),
        )
        return {
            "ok": True,
            "unitId": unit_id,
            "status": new_status,
            "clientName": unit.get("client_name") or "",
            "batchNo": unit.get("batch_no") or "",
            "weightKg": float(unit.get("weight_kg") or 0),
            "done": int((counts or {}).get("done") or 0),
            "total": int((counts or {}).get("total") or 0),
        }


def lookup_unit(code: str) -> Dict[str, Any]:
    """Pełna karta sztuki po QR (identyfikacja w dowolnym momencie)."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    unit = query_one("SELECT * FROM finished_units WHERE id=%s", (unit_id,))
    if not unit:
        raise HTTPException(404, "Sztuka nie znaleziona")
    return {
        "id": unit["id"],
        "qrCode": unit["qr_code"],
        "status": unit["status"],
        "clientName": unit.get("client_name") or "",
        "productTypeId": unit.get("product_type_id") or "",
        "recipeId": unit.get("recipe_id") or "",
        "tuleja": unit.get("tuleja") or "",
        "weightKg": float(unit.get("weight_kg") or 0),
        "batchNo": unit.get("batch_no") or "",
        "trolleyId": unit.get("trolley_id"),
        "cartonId": unit.get("carton_id"),
        "producedAt": str(unit.get("produced_at") or ""),
    }
```

- [ ] **Step 2: Weryfikacja importu/składni**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.services.finished_units_service as s; print(hasattr(s,'scan_produced'), hasattr(s,'lookup_unit'))"`
Expected: `True True`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/finished_units_service.py
git commit -m "feat(qr): skan produkcyjny (status+wózek+duble) i lookup sztuki"
```

---

## Task 6: Router + rejestracja

**Files:**
- Create: `backend/app/routes/finished_units.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Utwórz `backend/app/routes/finished_units.py`**

```python
"""Endpointy finished_units — QR per sztuka."""
from fastapi import APIRouter

from app.models.finished_units import GenerateUnitsRequest, ScanProducedRequest
from app.services import finished_units_service as svc

router = APIRouter(prefix="/api/finished-units", tags=["finished-units"])


@router.post("/from-plan-line")
def generate_from_plan_line(dto: GenerateUnitsRequest):
    return svc.generate_units_from_plan_line(dto.plan_line_id)


@router.post("/scan-produced")
def scan_produced(dto: ScanProducedRequest):
    return svc.scan_produced(dto.code, dto.trolley_id)


@router.get("/lookup")
def lookup(code: str):
    return svc.lookup_unit(code)
```

- [ ] **Step 2: Zarejestruj router w `backend/app/main.py`**

W `app/main.py` w bloku `from app.routes import (...)` dodaj `finished_units,` do listy importów,
oraz `finished_units,` do krotki modułów przekazywanej do pętli `app.include_router(...)`
(ten sam wzorzec co pozostałe routery, np. `raw_batches`).

- [ ] **Step 3: Weryfikacja importu aplikacji**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.routes.finished_units; print('route ok')"`
Expected: `route ok`
(Pełny `import app.main` wymaga konfiguracji DB — wystarczy import routera.)

- [ ] **Step 4: Pełny zestaw testów pure**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/ -q`
Expected: PASS (wszystkie, w tym test_unit_codes 6 + wcześniejsze).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/routes/finished_units.py backend/app/main.py
git commit -m "feat(qr): router finished-units (generacja/skan-produkcyjny/lookup)"
```

---

## Weryfikacja ręczna (jeśli jest lokalna/staging baza)

Po wdrożeniu, z uruchomionym backendem:
1. `POST /api/finished-units/from-plan-line {"plan_line_id":"<id>"}` → `{created: N}`; ponowne → `{existing: N}`.
2. Pobierz `qr_code` jednej sztuki z bazy (`SELECT qr_code FROM finished_units LIMIT 1`).
3. `POST /api/finished-units/scan-produced {"code":"U|<id>","trolley_id":"W1"}` → `{ok:true, status:"produced", done:1, total:N}`.
4. Ten sam skan ponownie → **409** „Sztuka już zeskanowana na produkcji" (DUBEL).
5. `GET /api/finished-units/lookup?code=U|<id>` → karta sztuki (status `produced`, trolley `W1`).

## Kolejne plany (po tej fazie)
- **Druk etykiet per klient** (frontend): silnik szablonów (1/2 A4, 1/4 A5, Zebra) + QR
  (`qrcode`) + `window.print()`, wzorzec z `PalletLabelPrintPage.tsx`.
- **Pakowanie w magazynie**: `cartons` + `POST /api/cartons/{id}/scan` (walidacja SKU/klient/
  `produced`/duble/limit), ekran skanu, wpięcie w paletę.
- **Lineage-UI**: skan QR → karta sztuki w PWA; hierarchia sztuka→karton→paleta→pojazd.
