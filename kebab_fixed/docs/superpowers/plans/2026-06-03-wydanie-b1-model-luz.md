# Wydanie B1 — model + wydanie luzem + rozchód finished_goods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wprowadzić byt „wydanie" (dispatch) i przepływ wydania luzem: magazynier wybiera klienta, skanuje sztuki, zatwierdza — sztuki przechodzą na `shipped`, a towar realnie schodzi ze stanu wyrobów (`finished_goods` OUT + ruch magazynowy).

**Architecture:** Nowa tabela `dispatches` + `finished_units.dispatch_id`. Czyste funkcje walidacji/grupowania w `unit_codes.py`. Serwis `dispatches_service.py` (transakcje, FOR UPDATE) — skan dopina sztuki (status zostaje `produced`), zamknięcie robi rozchód `finished_goods` (qty_available−/qty_shipped+ + `stock_movements` OUT w kg) i ustawia sztuki `shipped`. Mobilny ekran „Wydanie luzem".

**Tech Stack:** Backend FastAPI + psycopg (PostgreSQL), pytest. Frontend React + TypeScript (Vite), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-03-wydanie-b1-model-luz-design.md`

---

## File Structure

**Backend:**
- `backend/app/migrations.py` — modyfikacja: tabela `dispatches` + `finished_units.dispatch_id` + indeksy.
- `backend/app/utils/unit_codes.py` — modyfikacja: czyste `validate_loose_dispatch`, `group_units_for_out`.
- `backend/app/services/dispatches_service.py` — nowy: create/scan/remove/close/detail/list/batch_breakdown.
- `backend/app/models/dispatches.py` — nowy: DTO żądań.
- `backend/app/routes/dispatches.py` — nowy: trasy `/api/dispatches`.
- `backend/app/main.py` — modyfikacja: rejestracja routera `dispatches`.
- `backend/tests/test_loose_dispatch.py` — nowy: testy czystych funkcji.

**Frontend:**
- `src/lib/api.ts` — modyfikacja: `dispatchesApi` + typy.
- `src/pages/mobile/MobileWydanieLuzemPage.tsx` — nowy: ekran wydania luzem.
- `src/App.tsx` — modyfikacja: trasa `/mobile/wydanie`.
- `src/pages/mobile/MobilePickerPage.tsx` — modyfikacja: kafel „Wydanie luzem".

---

## Task 1: Migracja — `dispatches` + `finished_units.dispatch_id`

**Files:**
- Modify: `backend/app/migrations.py`

- [ ] **Step 1: Dodaj migracje do listy**

W `backend/app/migrations.py`, po wpisach dla `finished_units` (po linii z indeksem
`idx_finished_units_pallet`), dopisz do listy migracji:

```python
    """CREATE TABLE IF NOT EXISTS dispatches (
        id            TEXT PRIMARY KEY,
        trip_id       TEXT,
        client_id     TEXT,
        client_name   TEXT NOT NULL DEFAULT '',
        vehicle_id    TEXT,
        cmr_requested BOOLEAN NOT NULL DEFAULT false,
        status        TEXT NOT NULL DEFAULT 'open',
        operator      TEXT DEFAULT '',
        notes         TEXT DEFAULT '',
        created_at    TIMESTAMPTZ DEFAULT now(),
        shipped_at    TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status)",
    "CREATE INDEX IF NOT EXISTS idx_dispatches_client ON dispatches(client_id)",
    "ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS dispatch_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_dispatch ON finished_units(dispatch_id) WHERE dispatch_id IS NOT NULL",
```

- [ ] **Step 2: Weryfikacja importu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.migrations"`
Expected: brak błędu.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/migrations.py && \
git commit -m "feat(dispatch): tabela dispatches + finished_units.dispatch_id"
```

---

## Task 2: Czyste funkcje walidacji i grupowania (TDD)

**Files:**
- Modify: `backend/app/utils/unit_codes.py`
- Test: `backend/tests/test_loose_dispatch.py`

- [ ] **Step 1: Napisz failing testy**

Utwórz `backend/tests/test_loose_dispatch.py`:

```python
from app.utils.unit_codes import validate_loose_dispatch, group_units_for_out


def _u(status="produced", client="Zagros", dispatch_id=None, batch_no="B1",
       w=40, rc="R1", pd="2026-06-01"):
    return {"status": status, "client_name": client, "dispatch_id": dispatch_id,
            "batch_no": batch_no, "weight_kg": w, "recipe_id": rc, "produced_date": pd}


def test_loose_ok_same_client():
    ok, reason = validate_loose_dispatch(_u(client="Zagros"), "Zagros")
    assert ok is True and reason == ""


def test_loose_stock_wildcard():
    for c in ("na magazyn", "", "STAN"):
        ok, _ = validate_loose_dispatch(_u(client=c), "Zagros")
        assert ok is True, f"{c!r} powinien wejść"


def test_loose_planned():
    ok, reason = validate_loose_dispatch(_u(status="planned"), "Zagros")
    assert ok is False and "produkcj" in reason.lower()


def test_loose_packed():
    ok, reason = validate_loose_dispatch(_u(status="packed"), "Zagros")
    assert ok is False and "palet" in reason.lower()


def test_loose_shipped():
    ok, reason = validate_loose_dispatch(_u(status="shipped"), "Zagros")
    assert ok is False and "wydana" in reason.lower()


def test_loose_already_on_dispatch():
    ok, reason = validate_loose_dispatch(_u(dispatch_id="d1"), "Zagros")
    assert ok is False and "wydani" in reason.lower()


def test_loose_wrong_client():
    ok, reason = validate_loose_dispatch(_u(client="Kowalski"), "Zagros")
    assert ok is False and "klient" in reason.lower()


def test_group_two_batches():
    units = [_u(batch_no="B1", w=40, pd="2026-06-01"),
             _u(batch_no="B1", w=40, pd="2026-06-01"),
             _u(batch_no="B2", w=30, pd="2026-06-02")]
    g = group_units_for_out(units)
    assert g[("2026-06-01", "B1", "R1")] == {"count": 2, "kg": 80.0}
    assert g[("2026-06-02", "B2", "R1")] == {"count": 1, "kg": 30.0}


def test_group_same_batch_diff_weight():
    units = [_u(batch_no="B1", w=40), _u(batch_no="B1", w=20)]
    g = group_units_for_out(units)
    assert g[("2026-06-01", "B1", "R1")] == {"count": 2, "kg": 60.0}


def test_group_empty():
    assert group_units_for_out([]) == {}
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_loose_dispatch.py -v`
Expected: ImportError (funkcje nie istnieją).

- [ ] **Step 3: Implementacja w `unit_codes.py`**

Dopisz w `backend/app/utils/unit_codes.py` (obok innych walidatorów; reużywa istniejące
`PRODUCED`, `PACKED`, `SHIPPED`, `_client_matches`):

```python
def validate_loose_dispatch(unit: Dict, dispatch_client: Optional[str]) -> Tuple[bool, str]:
    """Czy sztukę można wydać luzem na to wydanie.

    unit: {status, client_name, dispatch_id}; dispatch_client: klient wydania.
    """
    status = unit.get("status")
    if status == SHIPPED:
        return False, "Sztuka już wydana"
    if status == PACKED:
        return False, "Sztuka spakowana na paletę — wydaj przez wyjazd"
    if status != PRODUCED:
        return False, "Sztuka nie potwierdzona na produkcji"
    if unit.get("dispatch_id"):
        return False, "Sztuka już na innym wydaniu"
    if not _client_matches(unit.get("client_name"), dispatch_client):
        return False, "Inny klient niż wydanie"
    return True, ""


def group_units_for_out(units) -> Dict[tuple, dict]:
    """Grupuj sztuki po (produced_date, batch_no, recipe_id) → {count, kg}.

    Klucz dopasowania do wiersza finished_goods przy rozchodzie.
    """
    out: Dict[tuple, dict] = {}
    for u in units:
        key = (u.get("produced_date") or "", u.get("batch_no") or "", u.get("recipe_id") or "")
        g = out.setdefault(key, {"count": 0, "kg": 0.0})
        g["count"] += 1
        g["kg"] += float(u.get("weight_kg") or 0)
    return out
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_loose_dispatch.py -v`
Expected: PASS (10 testów).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/utils/unit_codes.py backend/tests/test_loose_dispatch.py && \
git commit -m "feat(dispatch): czyste validate_loose_dispatch + group_units_for_out + testy"
```

---

## Task 3: Serwis `dispatches_service.py` (z rozchodem finished_goods)

**Files:**
- Create: `backend/app/services/dispatches_service.py`

- [ ] **Step 1: Utwórz serwis**

Utwórz `backend/app/services/dispatches_service.py` z pełną treścią:

```python
"""Wydania (dispatches) — wydanie luzem sztuk + rozchód magazynu wyrobów."""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement
from app.utils.unit_codes import (
    SHIPPED, group_units_for_out, parse_unit_qr, validate_loose_dispatch,
)

logger = get_logger(__name__)


def create_dispatch(dto: Dict[str, Any]) -> Dict[str, Any]:
    did = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """INSERT INTO dispatches
                 (id, client_id, client_name, vehicle_id, cmr_requested, status, operator, created_at)
               VALUES (%s,%s,%s,%s,%s,'open',%s,%s)""",
            (did, dto.get("client_id") or None, dto.get("client_name") or "",
             dto.get("vehicle_id") or None, bool(dto.get("cmr_requested")),
             dto.get("operator") or "", now_iso()),
        )
    return {"id": did, "status": "open"}


def _batch_breakdown(conn, dispatch_id: str) -> List[Dict]:
    rows = cx_query_all(
        conn,
        """SELECT batch_no, COUNT(*) AS qty, SUM(weight_kg) AS kg
           FROM finished_units WHERE dispatch_id=%s
           GROUP BY batch_no ORDER BY batch_no""",
        (dispatch_id,),
    )
    return [{"batchNo": r["batch_no"] or "", "qty": int(r["qty"]),
             "weightKg": float(r["kg"] or 0)} for r in rows]


def scan_into_dispatch(dispatch_id: str, code: str) -> Dict[str, Any]:
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT * FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")
        unit = cx_query_one(conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,))
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")

        ok, reason = validate_loose_dispatch(unit, disp.get("client_name"))
        if not ok:
            qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
            return {"ok": False, "reason": reason, "qty": int(qty["c"] if qty else 0),
                    "batchBreakdown": _batch_breakdown(conn, dispatch_id)}

        # NIE nadpisujemy client_name (zachowanie dopasowania do finished_goods przy OUT)
        cx_execute(conn, "UPDATE finished_units SET dispatch_id=%s WHERE id=%s", (dispatch_id, unit_id))
        qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
        return {"ok": True, "reason": "", "qty": int(qty["c"] if qty else 0),
                "batchBreakdown": _batch_breakdown(conn, dispatch_id)}


def remove_unit(dispatch_id: str, code: str) -> Dict[str, Any]:
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT status FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")
        cx_execute(conn, "UPDATE finished_units SET dispatch_id=NULL WHERE id=%s AND dispatch_id=%s",
                   (unit_id, dispatch_id))
        qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
        return {"ok": True, "qty": int(qty["c"] if qty else 0),
                "batchBreakdown": _batch_breakdown(conn, dispatch_id)}


def close_dispatch(dispatch_id: str) -> Dict[str, Any]:
    """Zamknięcie: rozchód finished_goods (OUT) + sztuki → shipped. Atomowo."""
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT * FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")

        units = cx_query_all(
            conn,
            """SELECT id, produced_date, batch_no, recipe_id, weight_kg
               FROM finished_units WHERE dispatch_id=%s""",
            (dispatch_id,),
        )
        if not units:
            raise HTTPException(400, "Brak sztuk na wydaniu")

        groups = group_units_for_out(units)
        for (produced_date, batch_no, recipe_id), g in groups.items():
            rows = cx_query_all(
                conn,
                """SELECT id, qty_available, kg_per_unit FROM finished_goods
                   WHERE produced_date=%s AND batch_no=%s AND recipe_id=%s
                   ORDER BY (COALESCE(client_name,'')='') DESC, qty_available DESC
                   FOR UPDATE""",
                (produced_date or None, batch_no, recipe_id),
            )
            remaining = g["count"]
            for row in rows:
                take = min(remaining, max(0, int(row.get("qty_available") or 0)))
                if take > 0:
                    cx_execute(
                        conn,
                        "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                        (take, take, row["id"]),
                    )
                    create_stock_movement(
                        conn, product_type="finished_goods", batch_id=row["id"],
                        qty=take * float(row.get("kg_per_unit") or 0),
                        movement_type="OUT", source_type="dispatch", source_id=dispatch_id,
                    )
                    remaining -= take
                if remaining == 0:
                    break
            if remaining > 0:
                raise HTTPException(
                    400, f"Za mało na stanie wyrobów dla partii {batch_no} (brakuje {remaining} szt)")

        cx_execute(conn, "UPDATE finished_units SET status=%s WHERE dispatch_id=%s", (SHIPPED, dispatch_id))
        cx_execute(conn, "UPDATE dispatches SET status='shipped', shipped_at=%s WHERE id=%s",
                   (now_iso(), dispatch_id))
        logger.info("dispatch.closed", extra={"dispatch_id": dispatch_id, "units": len(units)})
        return {"id": dispatch_id, "status": "shipped", "units": len(units)}


def dispatch_detail(dispatch_id: str) -> Dict[str, Any]:
    disp = query_one("SELECT * FROM dispatches WHERE id=%s", (dispatch_id,))
    if not disp:
        raise HTTPException(404, "Wydanie nie znalezione")
    qty = query_one("SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
    disp["qty"] = int(qty["c"] if qty else 0)
    with transaction() as conn:
        disp["batch_breakdown"] = _batch_breakdown(conn, dispatch_id)
    return disp


def list_open_dispatches() -> List[Dict]:
    return query_all(
        """SELECT d.id, d.client_name, d.vehicle_id, d.cmr_requested, d.created_at,
                  (SELECT COUNT(*) FROM finished_units fu WHERE fu.dispatch_id=d.id) AS qty
           FROM dispatches d WHERE d.status='open'
           ORDER BY d.created_at DESC""",
    )


def dispatch_batch_breakdown(dispatch_id: str) -> List[Dict]:
    with transaction() as conn:
        return _batch_breakdown(conn, dispatch_id)
```

- [ ] **Step 2: Smoke import + testy czyste**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.services.dispatches_service; print('OK')" && python3 -m pytest tests/test_loose_dispatch.py -q`
Expected: `OK` + testy PASS.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/dispatches_service.py && \
git commit -m "feat(dispatch): serwis wydania luzem + rozchod finished_goods (OUT) przy zamknieciu"
```

---

## Task 4: DTO + trasy + rejestracja routera

**Files:**
- Create: `backend/app/models/dispatches.py`
- Create: `backend/app/routes/dispatches.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: DTO**

Utwórz `backend/app/models/dispatches.py`:

```python
"""DTO wydań (dispatches)."""
from typing import Optional

from pydantic import BaseModel


class CreateDispatchRequest(BaseModel):
    client_id: Optional[str] = None
    client_name: str = ""
    vehicle_id: Optional[str] = None
    cmr_requested: bool = False
    operator: str = ""


class DispatchScanRequest(BaseModel):
    code: str
```

- [ ] **Step 2: Trasy**

Utwórz `backend/app/routes/dispatches.py`:

```python
"""Endpointy wydań (dispatches)."""
from fastapi import APIRouter

from app.models.dispatches import CreateDispatchRequest, DispatchScanRequest
from app.services import dispatches_service as svc

router = APIRouter(prefix="/api/dispatches", tags=["dispatches"])


@router.post("")
def create(dto: CreateDispatchRequest):
    return svc.create_dispatch(dto.model_dump())


@router.get("/open")
def list_open():
    return svc.list_open_dispatches()


@router.get("/{dispatch_id}")
def detail(dispatch_id: str):
    return svc.dispatch_detail(dispatch_id)


@router.get("/{dispatch_id}/batch-breakdown")
def batch_breakdown(dispatch_id: str):
    return svc.dispatch_batch_breakdown(dispatch_id)


@router.post("/{dispatch_id}/scan")
def scan(dispatch_id: str, body: DispatchScanRequest):
    return svc.scan_into_dispatch(dispatch_id, body.code)


@router.post("/{dispatch_id}/remove")
def remove(dispatch_id: str, body: DispatchScanRequest):
    return svc.remove_unit(dispatch_id, body.code)


@router.post("/{dispatch_id}/close")
def close(dispatch_id: str):
    return svc.close_dispatch(dispatch_id)
```

- [ ] **Step 3: Rejestracja w main.py**

W `backend/app/main.py` dodaj `dispatches,` w DWÓCH miejscach — w krotce importu
(`from app.routes import (...`) po `pallets,` oraz w krotce iterowanej przez
`include_router` (drugie wystąpienie listy modułów), również po `pallets,`.

- [ ] **Step 4: Smoke — trasy**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.main; from app.routes.dispatches import router; print(sorted(r.path for r in router.routes))"`
Expected: zawiera `/api/dispatches`, `/api/dispatches/open`, `/api/dispatches/{dispatch_id}`, `/api/dispatches/{dispatch_id}/scan`, `/api/dispatches/{dispatch_id}/close`, `/api/dispatches/{dispatch_id}/remove`, `/api/dispatches/{dispatch_id}/batch-breakdown`.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/models/dispatches.py backend/app/routes/dispatches.py backend/app/main.py && \
git commit -m "feat(dispatch): DTO + trasy /api/dispatches + rejestracja routera"
```

---

## Task 5: API klienta — `dispatchesApi`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Typy + metody**

W `src/lib/api.ts` dopisz (przy innych api eksportach):

```typescript
export interface DispatchBatchRow { batchNo: string; qty: number; weightKg: number }

export interface DispatchScanResult {
  ok: boolean
  reason: string
  qty: number
  batchBreakdown: DispatchBatchRow[]
}

export interface DispatchOpen {
  id: string; clientName: string; vehicleId: string | null
  cmrRequested: boolean; qty: number; createdAt: string
}

export const dispatchesApi = {
  create: (dto: { clientId?: string; clientName: string; vehicleId?: string; cmrRequested?: boolean }) =>
    post<{ id: string; status: string }>('/dispatches', {
      client_id: dto.clientId ?? null,
      client_name: dto.clientName,
      vehicle_id: dto.vehicleId ?? null,
      cmr_requested: !!dto.cmrRequested,
    }),
  listOpen: () =>
    get<any[]>('/dispatches/open').then(rows => (rows ?? []).map((r: any): DispatchOpen => ({
      id: r.id, clientName: r.client_name ?? '', vehicleId: r.vehicle_id ?? null,
      cmrRequested: !!r.cmr_requested, qty: Number(r.qty ?? 0), createdAt: r.created_at ?? '',
    }))),
  detail: (id: string) => get<any>(`/dispatches/${id}`),
  scan: (id: string, code: string) => post<DispatchScanResult>(`/dispatches/${id}/scan`, { code }),
  remove: (id: string, code: string) => post<DispatchScanResult>(`/dispatches/${id}/remove`, { code }),
  close: (id: string) => post<{ id: string; status: string; units: number }>(`/dispatches/${id}/close`, {}),
  batchBreakdown: (id: string) => get<DispatchBatchRow[]>(`/dispatches/${id}/batch-breakdown`),
}
```

- [ ] **Step 2: Typecheck (tylko nasze linie)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "dispatchesApi|DispatchScanResult|DispatchOpen|DispatchBatchRow" || echo "BRAK błędów dispatch"`
Expected: `BRAK błędów dispatch` (istniejące, niezwiązane błędy repo można zignorować).

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/lib/api.ts && \
git commit -m "feat(dispatch): dispatchesApi (create/scan/remove/close/listOpen/batchBreakdown)"
```

---

## Task 6: Mobilny ekran „Wydanie luzem" + trasa + kafel

**Files:**
- Create: `src/pages/mobile/MobileWydanieLuzemPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/mobile/MobilePickerPage.tsx`

- [ ] **Step 1: Ekran**

Utwórz `src/pages/mobile/MobileWydanieLuzemPage.tsx`. Wzoruj układ/styl na
`MobilePakowaniePage.tsx`. Logika:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Truck, X, Undo2 } from 'lucide-react'
import { dispatchesApi, clientsApi, type DispatchScanResult, type DispatchBatchRow } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'

interface ActiveDispatch { id: string; clientName: string; qty: number }

export function MobileWydanieLuzemPage() {
  const [dispatch, setDispatch] = useState<ActiveDispatch | null>(null)
  const [batch, setBatch] = useState<DispatchBatchRow[]>([])
  const [clientName, setClientName] = useState('')
  const [clientId, setClientId] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ ok: boolean; message: string } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clientsRes = useApi(() => clientsApi.list(), [])
  const openRes = useApi(() => dispatchesApi.listOpen(), [])

  const focusInput = useCallback(() => { setTimeout(() => inputRef.current?.focus(), 30) }, [])
  useEffect(() => { if (dispatch) focusInput() }, [dispatch, focusInput])

  async function createDispatch() {
    if (!clientName.trim()) { setLast({ ok: false, message: 'Wybierz klienta' }); return }
    try {
      const r = await dispatchesApi.create({ clientId: clientId || undefined, clientName: clientName.trim() })
      setDispatch({ id: r.id, clientName: clientName.trim(), qty: 0 })
      setBatch([]); setLast(null)
    } catch (e) {
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd tworzenia wydania' })
    }
  }

  async function openExisting(id: string, name: string) {
    const d = await dispatchesApi.detail(id)
    setDispatch({ id, clientName: name, qty: Number(d.qty ?? 0) })
    setBatch(d.batch_breakdown ?? [])
    setLast(null)
  }

  async function handleScan(code: string, mode: 'scan' | 'remove' = 'scan') {
    const trimmed = code.trim()
    if (!trimmed || busy || !dispatch) return
    setBusy(true)
    try {
      const r: DispatchScanResult = mode === 'remove'
        ? await dispatchesApi.remove(dispatch.id, trimmed)
        : await dispatchesApi.scan(dispatch.id, trimmed)
      if (r.ok) {
        beepOk(); try { navigator.vibrate?.(80) } catch {}
        setDispatch(prev => prev ? { ...prev, qty: r.qty } : null)
        setBatch(r.batchBreakdown ?? [])
        setLast({ ok: true, message: mode === 'remove' ? 'Sztuka cofnięta' : 'Sztuka dodana' })
      } else {
        beepErr(); try { navigator.vibrate?.([60, 40, 60]) } catch {}
        setLast({ ok: false, message: r.reason || 'Nieprawidłowy kod' })
      }
    } catch (e) {
      beepErr(); setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd' })
    } finally { setBusy(false); setValue(''); focusInput() }
  }

  async function closeDispatch() {
    if (!dispatch) return
    if (!confirm(`Zatwierdzić wydanie dla ${dispatch.clientName}? Sztuki zejdą ze stanu.`)) return
    try {
      await dispatchesApi.close(dispatch.id)
      setLast({ ok: true, message: 'Wydanie zatwierdzone — towar wydany' })
      setDispatch(null); setBatch([]); openRes.refetch?.()
    } catch (e) {
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd zamknięcia' })
    }
  }

  const clients = clientsRes.data ?? []
  const openList = openRes.data ?? []

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-orange-200 bg-orange-600 px-4 py-3 text-white shadow-sm">
        <Link to="/mobile" className="flex items-center gap-1 text-sm font-semibold text-orange-50 hover:text-white">
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Truck size={18} /> Wydanie luzem
        </div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {dispatch ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-orange-600">Wydanie otwarte</div>
                <div className="text-sm font-bold">{dispatch.clientName}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold tabular-nums text-orange-700">{dispatch.qty} szt</div>
                <button onClick={() => { setDispatch(null); openRes.refetch?.() }} aria-label="Zamknij" className="rounded p-1 text-slate-500 hover:text-red-600"><X size={18} /></button>
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleScan(value) }} className="flex items-stretch gap-2">
              <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Zeskanuj QR sztuki" autoFocus autoComplete="off" spellCheck={false}
                className="flex-1 rounded-lg border-2 border-orange-300 bg-white px-3 py-3 text-base focus:border-orange-500 focus:outline-none" />
              <button type="button" onClick={() => setScannerOpen(true)} className="flex items-center justify-center rounded-lg bg-orange-600 px-4 text-white" aria-label="Kamera"><Camera size={22} /></button>
              <button type="button" onClick={() => handleScan(value, 'remove')} className="flex items-center justify-center rounded-lg bg-slate-200 px-3 text-slate-700" aria-label="Cofnij sztukę"><Undo2 size={20} /></button>
            </form>

            {last && (
              <div className={`flex items-start gap-3 rounded-xl border-2 p-4 ${last.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
                {last.ok ? <CheckCircle2 size={28} className="text-emerald-600" /> : <AlertTriangle size={28} className="text-red-600" />}
                <div className={`text-sm font-semibold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>{last.message}</div>
              </div>
            )}

            {batch.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Partie na wydaniu</div>
                {batch.map(b => (
                  <div key={b.batchNo || '—'} className="flex justify-between border-b border-slate-100 py-1 text-sm tabular-nums last:border-0">
                    <span>Partia {b.batchNo || '—'}</span><span className="font-semibold">{b.qty} szt · {b.weightKg.toFixed(0)} kg</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={closeDispatch} className="mt-2 rounded-lg bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700">Zatwierdź wydanie</button>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Nowe wydanie luzem</div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Klient *</label>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setClientName(clients.find((c: any) => c.id === e.target.value)?.name ?? '') }}
                className="mb-3 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base">
                <option value="">— wybierz —</option>
                {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={createDispatch} className="w-full rounded-lg bg-orange-600 px-4 py-3 text-base font-bold text-white hover:bg-orange-700">Rozpocznij wydanie</button>
              {last && !last.ok && <div className="mt-2 text-sm text-red-700">{last.message}</div>}
            </div>

            {openList.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Otwarte wydania</div>
                <ul className="flex flex-col gap-2">
                  {openList.map(d => (
                    <li key={d.id}>
                      <button onClick={() => openExisting(d.id, d.clientName)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-orange-50">
                        <span className="text-sm font-semibold">{d.clientName || '—'}</span>
                        <span className="text-sm font-bold tabular-nums text-orange-700">{d.qty} szt</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>

      {scannerOpen && (
        <QrScannerModal onScan={(t) => { setScannerOpen(false); handleScan(t); focusInput() }} onClose={() => { setScannerOpen(false); focusInput() }} />
      )}
    </div>
  )
}
```

> Uwaga: zweryfikuj kształt `clientsApi.list()` (pole `id`/`name`) — jeśli zwraca zmapowane obiekty z innymi nazwami, dostosuj `c.id`/`c.name`.

- [ ] **Step 2: Trasa w App.tsx**

W `src/App.tsx` znajdź trasę `/mobile/pakowanie` (import + `<Route ...>`), dodaj
analogicznie import `MobileWydanieLuzemPage` i trasę:

```tsx
<Route path="/mobile/wydanie" element={<MobileWydanieLuzemPage />} />
```

- [ ] **Step 3: Kafel w MobilePickerPage**

W `src/pages/mobile/MobilePickerPage.tsx` dodaj kafel obok istniejących (np. po
„pakowanie"), importując ikonę `Truck` z `lucide-react` jeśli nie ma:

```tsx
<Link to="/mobile/wydanie" className="flex flex-col items-center justify-center gap-2 rounded-2xl border bg-white p-6 shadow-sm">
  <Truck size={56} />
  <span className="text-sm font-bold">Wydanie luzem</span>
</Link>
```
(Dopasuj klasy do istniejących kafli na tej stronie.)

- [ ] **Step 4: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "MobileWydanieLuzem" || echo "BRAK błędów ekranu"; npm run build 2>&1 | tail -2`
Expected: brak błędów nowego ekranu; build przechodzi.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/mobile/MobileWydanieLuzemPage.tsx src/App.tsx src/pages/mobile/MobilePickerPage.tsx && \
git commit -m "feat(dispatch): mobilny ekran Wydanie luzem + trasa + kafel"
```

---

## Task 7: Pełne testy + e2e

- [ ] **Step 1: Pełny pytest**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q`
Expected: wszystko zielone (w tym `test_loose_dispatch.py`).

- [ ] **Step 2: Build frontu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -2`
Expected: build przechodzi.

- [ ] **Step 3: Ręczny e2e (środowisko z bazą) — rozchód**

1. Wyprodukuj sztuki „na magazyn" danego SKU; potwierdź na produkcji (`produced`).
   Upewnij się, że istnieje wiersz `finished_goods` tej partii (client=''), z `qty_available`.
2. Mobile → „Wydanie luzem" → wybierz klienta X → skan sztuk (licznik rośnie, partie na żywo).
3. Skan sztuki `packed`/`shipped`/innego klienta → odpowiedni BŁĄD.
4. „Zatwierdź wydanie" → sprawdź w DB: sztuki `status='shipped'` + `dispatch_id`;
   `finished_goods.qty_available` zmniejszone o liczbę, `qty_shipped` zwiększone;
   `stock_movements` ma wiersz `OUT` (`product_type='finished_goods'`, `source_type='dispatch'`).
5. Próba zamknięcia gdy brak zapasu w `finished_goods` → błąd „Za mało na stanie wyrobów…",
   nic nie zmienione (rollback).

Expected: zgodne ze specem.

---

## Self-Review (autora planu)

- **Pokrycie specu:** model danych (T1); walidacja+grupowanie (T2); serwis create/scan/remove/
  close+rozchód/detail/list/breakdown (T3); DTO+trasy+rejestracja (T4); API front (T5);
  mobile ekran+trasa+kafel (T6); testy+e2e (T7). ✅
- **Spójność typów:** `validate_loose_dispatch(unit, dispatch_client)` i
  `group_units_for_out(units)` zdefiniowane w T2, użyte w T3. `DispatchScanResult`
  (`ok/reason/qty/batchBreakdown`) zgodne między serwisem (T3), API (T5) i ekranem (T6).
  Trasy z T4 zgodne z `dispatchesApi` w T5. ✅
- **Placeholdery:** brak — pełny kod/komendy w każdym kroku. Jedyne „dostosuj" dotyczą
  weryfikacji kształtu istniejących API (`clientsApi`) i klas Tailwind kafla — wskazane
  jawnie jako weryfikacja, nie luka logiczna. ✅
