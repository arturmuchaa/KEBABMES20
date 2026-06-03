# Pakowanie sztuk do palety + identyfikowalność partii — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ujednolicić „pudełko" na palecie: biuro tworzy paletę z zamówienia, magazynier skanuje QR sztuk do palety z walidacją (zła sztuka → błąd), a skład partii palety jest zapisany do późniejszego dokumentu HDI.

**Architecture:** Paleta (`order_pallets`) staje się jedynym pudełkiem. `finished_units` zyskuje `pallet_id`. Walidacja pakowania (port `validate_pack`) jest czystą funkcją na słownikach planowanych/spakowanych sztuk grupowanych po (produkt, receptura, waga). Skład partii wyliczany z `finished_units.batch_no GROUP BY`. Byt `cartons` wygaszany.

**Tech Stack:** Backend FastAPI + psycopg (PostgreSQL), pytest. Frontend React + TypeScript (Vite), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-03-pakowanie-palet-identyfikowalnosc-design.md`

---

## File Structure

**Backend:**
- `backend/app/migrations.py` — modyfikacja: kolumna `finished_units.pallet_id` + indeks.
- `backend/app/utils/unit_codes.py` — modyfikacja: nowa czysta funkcja `validate_pack_to_pallet(...)`.
- `backend/app/services/pallets_service.py` — modyfikacja: `pack_unit_into_pallet(...)`, `batch_breakdown(...)`, `pallets_to_pack()`, progres w `_pallet_with_items`, zmiana `_TRANSITIONS`.
- `backend/app/routes/pallets.py` — modyfikacja: trasy `/pack`, `/batch-breakdown`, `/to-pack`, `/by-id`.
- `backend/tests/test_pack_to_pallet.py` — nowy: testy czystej walidacji.
- `backend/tests/test_unit_codes.py` — bez zmian (zostaje dla referencji).

**Frontend:**
- `src/lib/api.ts` — modyfikacja: `palletsApi.packUnit/lookup/batchBreakdown/toPack`, typy.
- `src/pages/mobile/MobilePakowaniePage.tsx` — przepisanie: skan palety + pakowanie sztuk + skład partii; usunięcie formularza tworzenia kartonu.
- `src/components/orders/PalletsEditor.tsx` — modyfikacja: postęp pakowania + skład partii (read-only).

**Cleanup (po weryfikacji pustości `cartons`):**
- Usunięcie/wygaszenie: `backend/app/routes/cartons.py`, `backend/app/services/cartons_service.py`, `cartonsApi` w `src/lib/api.ts`, rejestracja routera kartonów.

---

## Task 1: Migracja — `finished_units.pallet_id`

**Files:**
- Modify: `backend/app/migrations.py` (lista migracji, sekcja finished_units ~linia 270)

- [ ] **Step 1: Dodaj migracje kolumny + indeksu**

W `backend/app/migrations.py`, po istniejącym indeksie `idx_finished_units_carton`, dopisz do listy migracji:

```python
    "ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS pallet_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_finished_units_pallet ON finished_units(pallet_id) WHERE pallet_id IS NOT NULL",
```

- [ ] **Step 2: Uruchom migracje i potwierdź kolumnę**

Run: `cd backend && python -c "from app.migrations import run_migrations; run_migrations()"`
(jeśli projekt ma inny entrypoint migracji — użyć go; migracje są idempotentne)
Expected: brak błędu; kolumna `pallet_id` istnieje.

- [ ] **Step 3: Commit**

```bash
git add backend/app/migrations.py
git commit -m "feat(db): finished_units.pallet_id dla pakowania sztuk do palety"
```

---

## Task 2: Czysta walidacja `validate_pack_to_pallet`

Funkcja czysta (bez DB) — łatwa do testów. Grupuje po kluczu `(product_type_id, recipe_id, round(weight,3))`, żeby obsłużyć paletę z wieloma pozycjami i różnymi partiami.

**Files:**
- Modify: `backend/app/utils/unit_codes.py`
- Test: `backend/tests/test_pack_to_pallet.py`

- [ ] **Step 1: Napisz failing testy**

Utwórz `backend/tests/test_pack_to_pallet.py`:

```python
from app.utils.unit_codes import validate_pack_to_pallet, pallet_line_key

# planned_by_key: {key: planowana liczba szt}; packed_by_key: {key: już spakowane}
P1R1_40 = ("P1", "R1", 40.0)


def _unit(status="produced", order_id="O1", pt="P1", rc="R1", w=40):
    return {"status": status, "order_id": order_id,
            "product_type_id": pt, "recipe_id": rc, "weight_kg": w}


def test_ok_when_matches_and_free():
    ok, reason, key = validate_pack_to_pallet(
        _unit(), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 5})
    assert ok is True and reason == "" and key == P1R1_40


def test_different_order():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(order_id="O2"), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "zamówienia" in reason.lower()


def test_wrong_product_or_weight():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(w=30), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and ("produkt" in reason.lower() or "waga" in reason.lower())


def test_not_produced():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="planned"), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "produkcj" in reason.lower()


def test_already_packed():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="packed"), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "spakowan" in reason.lower()


def test_position_full():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 20})
    assert ok is False and ("pełna" in reason.lower() or "pelna" in reason.lower())


def test_different_batches_allowed():
    # walidacja nie patrzy na partię — dwie sztuki różnych partii do tej samej pozycji
    ok1, _, _ = validate_pack_to_pallet(
        _unit(), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 0})
    ok2, _, _ = validate_pack_to_pallet(
        _unit(), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 1})
    assert ok1 is True and ok2 is True


def test_pallet_line_key_rounds_weight():
    assert pallet_line_key("P1", "R1", 40.0001) == ("P1", "R1", 40.0)
```

- [ ] **Step 2: Uruchom — ma FAIL**

Run: `cd backend && python -m pytest tests/test_pack_to_pallet.py -v`
Expected: FAIL — `ImportError: cannot import name 'validate_pack_to_pallet'`.

- [ ] **Step 3: Implementacja w `unit_codes.py`**

Dopisz w `backend/app/utils/unit_codes.py` (obok `validate_pack`):

```python
def pallet_line_key(product_type_id, recipe_id, weight) -> tuple:
    """Klucz grupujący pozycję: (produkt, receptura, waga zaokrąglona do 3 miejsc)."""
    return (
        (product_type_id or ""),
        (recipe_id or ""),
        round(float(weight or 0), 3),
    )


def validate_pack_to_pallet(unit, pallet_order_id, planned_by_key, packed_by_key):
    """Czysta walidacja pakowania sztuki do palety.

    unit: dict {status, order_id, product_type_id, recipe_id, weight_kg}
    pallet_order_id: id zamówienia palety
    planned_by_key: {pallet_line_key: planowana liczba szt}
    packed_by_key:  {pallet_line_key: już spakowane szt}
    Zwraca (ok: bool, reason: str, key | None).
    Partia (batch_no) NIE jest kryterium — różne partie dozwolone.
    """
    status = unit.get("status")
    if status != PRODUCED:
        if status == PACKED:
            return False, "Sztuka już spakowana", None
        return False, "Sztuka nie potwierdzona na produkcji", None

    if (unit.get("order_id") or "") != (pallet_order_id or ""):
        return False, "Sztuka z innego zamówienia", None

    key = pallet_line_key(
        unit.get("product_type_id"), unit.get("recipe_id"), unit.get("weight_kg"))
    if key not in planned_by_key:
        return False, "Inny produkt/waga niż na palecie", None

    if int(packed_by_key.get(key, 0)) >= int(planned_by_key[key]):
        return False, "Pozycja palety pełna", None

    return True, "", key
```

- [ ] **Step 4: Uruchom — ma PASS**

Run: `cd backend && python -m pytest tests/test_pack_to_pallet.py -v`
Expected: PASS (8 testów).

- [ ] **Step 5: Commit**

```bash
git add backend/app/utils/unit_codes.py backend/tests/test_pack_to_pallet.py
git commit -m "feat(pack): czysta walidacja pakowania sztuki do palety + testy"
```

---

## Task 3: Serwis `pack_unit_into_pallet` + progres palety

**Files:**
- Modify: `backend/app/services/pallets_service.py`

- [ ] **Step 1: Dodaj importy walidacji, sztuk i `cx_query_one`**

Na górze `pallets_service.py` rozszerz import z `app.utils.unit_codes`:

```python
from app.utils.unit_codes import (
    PACKED, PRODUCED, parse_unit_qr, pallet_line_key, validate_pack_to_pallet,
)
```

Oraz upewnij się, że import z `app.db` zawiera `cx_query_one` (obecnie jest tylko `cx_query_all`, `query_all`, `query_one`, `cx_execute`, `transaction`):

```python
from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
```

- [ ] **Step 2: Funkcja `pack_unit_into_pallet`**

Dopisz w `pallets_service.py`:

```python
def _pallet_pack_state(conn, pallet_id):
    """Zwróć (pallet_row, order_id, planned_by_key, packed_by_key)."""
    pallet = cx_query_one(
        conn, "SELECT * FROM order_pallets WHERE id=%s FOR UPDATE", (pallet_id,))
    if not pallet:
        raise HTTPException(404, "Paleta nie znaleziona")
    order_id = pallet["order_id"]

    lines = cx_query_all(
        conn,
        """SELECT pi.qty, l.product_type_id, l.recipe_id, l.kg_per_unit
           FROM order_pallet_items pi
           JOIN client_order_lines l ON l.id = pi.order_line_id
           WHERE pi.pallet_id = %s""",
        (pallet_id,),
    )
    planned_by_key = {}
    for ln in lines:
        k = pallet_line_key(ln["product_type_id"], ln["recipe_id"], ln["kg_per_unit"])
        planned_by_key[k] = planned_by_key.get(k, 0) + int(ln["qty"] or 0)

    packed_rows = cx_query_all(
        conn,
        """SELECT product_type_id, recipe_id, weight_kg
           FROM finished_units WHERE pallet_id = %s""",
        (pallet_id,),
    )
    packed_by_key = {}
    for u in packed_rows:
        k = pallet_line_key(u["product_type_id"], u["recipe_id"], u["weight_kg"])
        packed_by_key[k] = packed_by_key.get(k, 0) + 1

    return pallet, order_id, planned_by_key, packed_by_key


def pack_unit_into_pallet(pallet_id, code):
    """Skan sztuki do palety: walidacja + zapis pallet_id na sztuce, aktualizacja statusu."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")

    with transaction() as conn:
        pallet, order_id, planned_by_key, packed_by_key = _pallet_pack_state(conn, pallet_id)
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,))
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")

        ok, reason, _key = validate_pack_to_pallet(
            unit, order_id, planned_by_key, packed_by_key)

        planned_total = sum(planned_by_key.values())
        packed_total = sum(packed_by_key.values())
        if not ok:
            return {"ok": False, "reason": reason,
                    "packedQty": packed_total, "targetQty": planned_total,
                    "palletStatus": pallet.get("status") or "created"}

        cx_execute(
            conn,
            "UPDATE finished_units SET status=%s, pallet_id=%s WHERE id=%s",
            (PACKED, pallet_id, unit_id),
        )
        packed_total += 1
        new_status = "packed" if packed_total >= planned_total else "packing"
        cx_execute(
            conn, "UPDATE order_pallets SET status=%s WHERE id=%s",
            (new_status, pallet_id),
        )
        return {"ok": True, "reason": "",
                "packedQty": packed_total, "targetQty": planned_total,
                "palletStatus": new_status}
```

- [ ] **Step 3: Test ręczny serwisu (smoke)**

Run: `cd backend && python -m pytest tests/test_pack_to_pallet.py -v && python -c "import app.services.pallets_service"`
Expected: testy PASS, import bez błędu składni.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/pallets_service.py
git commit -m "feat(pack): serwis pakowania sztuki do palety + statusy packing/packed"
```

---

## Task 4: Trasa `POST /api/pallets/{pallet_id}/pack`

**Files:**
- Modify: `backend/app/routes/pallets.py`
- Modify: `backend/app/models/orders.py`

- [ ] **Step 1: DTO żądania**

W `backend/app/models/orders.py` dopisz:

```python
class PackUnitRequest(BaseModel):
    code: str
```

- [ ] **Step 2: Trasa**

W `backend/app/routes/pallets.py` dodaj import i trasę:

```python
from app.models.orders import PalletScanRequest, PackUnitRequest

@router.post("/{pallet_id}/pack")
def pack_unit(pallet_id: str, body: PackUnitRequest):
    return pallets_service.pack_unit_into_pallet(pallet_id, body.code)
```

- [ ] **Step 3: Smoke import aplikacji**

Run: `cd backend && python -c "from app.routes.pallets import router; print([r.path for r in router.routes])"`
Expected: lista zawiera `/api/pallets/{pallet_id}/pack`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/pallets.py backend/app/models/orders.py
git commit -m "feat(pack): endpoint POST /api/pallets/{id}/pack"
```

---

## Task 5: Cykl statusu — `cold_storage` startuje z `packed`

**Files:**
- Modify: `backend/app/services/pallets_service.py` (`_TRANSITIONS`)

- [ ] **Step 1: Zmień regułę przejścia**

W `_TRANSITIONS` zmień `cold_storage.from` z `("created",)` na `("packed",)`:

```python
_TRANSITIONS = {
    "cold_storage": {"from": ("packed",),       "field": "cold_storage_at"},
    "loaded":       {"from": ("cold_storage",),  "field": "loaded_at"},
}
```

- [ ] **Step 2: Smoke**

Run: `cd backend && python -c "from app.services.pallets_service import _TRANSITIONS; assert _TRANSITIONS['cold_storage']['from'] == ('packed',)"`
Expected: brak błędu.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/pallets_service.py
git commit -m "feat(pack): mroźnia składowa dopiero po skompletowaniu palety (packed)"
```

---

## Task 6: Skład partii palety (`batch-breakdown`) + lista do pakowania + lookup po id

**Files:**
- Modify: `backend/app/services/pallets_service.py`
- Modify: `backend/app/routes/pallets.py`

- [ ] **Step 1: Serwisy**

Dopisz w `pallets_service.py`:

```python
def batch_breakdown(pallet_id):
    """Skład partii palety — dane do HDI."""
    rows = query_all(
        """SELECT batch_no, COUNT(*) AS qty, SUM(weight_kg) AS kg
           FROM finished_units WHERE pallet_id=%s
           GROUP BY batch_no ORDER BY batch_no""",
        (pallet_id,),
    )
    return [{"batchNo": r["batch_no"] or "", "qty": int(r["qty"]),
             "weightKg": float(r["kg"] or 0)} for r in rows]


def pallet_detail_by_id(pallet_id):
    """Szczegóły palety dla mobile: nagłówek + postęp + skład partii."""
    pallet = query_one("SELECT * FROM order_pallets WHERE id=%s", (pallet_id,))
    if not pallet:
        raise HTTPException(404, "Paleta nie znaleziona")
    detail = _pallet_with_items(pallet["order_id"], pallet["pallet_no"])
    packed = query_one(
        "SELECT COUNT(*) AS c FROM finished_units WHERE pallet_id=%s", (pallet_id,))
    detail["id"] = pallet_id
    detail["packed_qty"] = int(packed["c"] if packed else 0)
    detail["batch_breakdown"] = batch_breakdown(pallet_id)
    return detail


def pallets_to_pack():
    """Palety w trakcie/do pakowania (status created lub packing) — dla mobile."""
    return query_all(
        """SELECT p.id, p.order_id, p.pallet_no, p.status,
                  o.order_no, o.client_name,
                  (SELECT COUNT(*) FROM finished_units fu WHERE fu.pallet_id=p.id) AS packed_qty,
                  (SELECT COALESCE(SUM(pi.qty),0) FROM order_pallet_items pi WHERE pi.pallet_id=p.id) AS target_qty
           FROM order_pallets p
           LEFT JOIN client_orders o ON o.id = p.order_id
           WHERE p.status IN ('created','packing')
           ORDER BY o.client_name, p.pallet_no""",
    )
```

- [ ] **Step 2: Trasy**

W `backend/app/routes/pallets.py` dodaj:

```python
@router.get("/to-pack")
def to_pack():
    return pallets_service.pallets_to_pack()

@router.get("/by-id/{pallet_id}")
def by_id(pallet_id: str):
    return pallets_service.pallet_detail_by_id(pallet_id)

@router.get("/{pallet_id}/batch-breakdown")
def batch_breakdown_route(pallet_id: str):
    return pallets_service.batch_breakdown(pallet_id)
```

> Uwaga kolejności tras FastAPI: `/to-pack` i `/by-id/{id}` muszą być zarejestrowane PRZED `/{pallet_id}/...`, żeby nie kolidowały ze ścieżką `/scan`. Trasy stałe (`/scan`, `/lookup`, `/to-pack`, `/by-id/...`) zostają nad trasami z `{pallet_id}`.

- [ ] **Step 3: Smoke**

Run: `cd backend && python -c "from app.routes.pallets import router; print(sorted(r.path for r in router.routes))"`
Expected: zawiera `/api/pallets/to-pack`, `/api/pallets/by-id/{pallet_id}`, `/api/pallets/{pallet_id}/batch-breakdown`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/pallets_service.py backend/app/routes/pallets.py
git commit -m "feat(pack): skład partii (HDI), lista palet do pakowania, detal po id"
```

---

## Task 7: API klienta — `palletsApi`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Typy + metody**

W `src/lib/api.ts` dopisz (obok `orderPalletsApi`):

```typescript
export interface PalletPackResult {
  ok: boolean
  reason: string
  packedQty: number
  targetQty: number
  palletStatus: string
}

export interface PalletBatchRow { batchNo: string; qty: number; weightKg: number }

export interface PalletToPack {
  id: string; orderId: string; palletNo: number; status: string
  orderNo: string; clientName: string; packedQty: number; targetQty: number
}

export const palletsApi = {
  toPack: () =>
    get<any[]>('/pallets/to-pack').then(rows => (rows ?? []).map((r: any): PalletToPack => ({
      id: r.id, orderId: r.order_id, palletNo: Number(r.pallet_no ?? 0),
      status: r.status ?? 'created', orderNo: r.order_no ?? '',
      clientName: r.client_name ?? '', packedQty: Number(r.packed_qty ?? 0),
      targetQty: Number(r.target_qty ?? 0),
    }))),
  detail: (palletId: string) => get<any>(`/pallets/by-id/${palletId}`),
  lookup: (code: string) => get<any>(`/pallets/lookup?code=${encodeURIComponent(code)}`),
  packUnit: (palletId: string, code: string) =>
    post<PalletPackResult>(`/pallets/${palletId}/pack`, { code }),
  batchBreakdown: (palletId: string) =>
    get<PalletBatchRow[]>(`/pallets/${palletId}/batch-breakdown`),
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: brak nowych błędów w `src/lib/api.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(pack): palletsApi (pack, lookup, toPack, batchBreakdown)"
```

---

## Task 8: Mobile — przepisanie `MobilePakowaniePage` na pakowanie palet

Usuwamy formularz tworzenia kartonu. Nowy flow: wybór palety (lista `to-pack` lub skan QR) → pakowanie sztuk → skład partii na żywo.

**Files:**
- Modify: `src/pages/mobile/MobilePakowaniePage.tsx` (pełne przepisanie logiki)

- [ ] **Step 1: Stan i ładowanie palety**

Zastąp logikę komponentu (zachowaj nagłówek/style Tailwind, podmień ciało). Kluczowe elementy:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Package, PackageOpen, X } from 'lucide-react'
import { palletsApi, type PalletPackResult, type PalletToPack, type PalletBatchRow } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'

interface ActivePallet {
  id: string; orderNo: string; clientName: string
  targetQty: number; packedQty: number
}

export function MobilePakowaniePage() {
  const [pallet, setPallet] = useState<ActivePallet | null>(null)
  const [batch, setBatch] = useState<PalletBatchRow[]>([])
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ ok: boolean; message: string; result?: PalletPackResult } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [palletScanOpen, setPalletScanOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const toPackRes = useApi(() => palletsApi.toPack(), [])

  const focusInput = useCallback(() => { setTimeout(() => inputRef.current?.focus(), 30) }, [])
  useEffect(() => { if (pallet) focusInput() }, [pallet, focusInput])
```

- [ ] **Step 2: Otwieranie palety (z listy lub przez skan QR palety)**

```typescript
  async function openPalletById(id: string) {
    const d = await palletsApi.detail(id)
    setPallet({
      id: d.id, orderNo: d.order?.order_no ?? '', clientName: d.order?.client_name ?? '',
      targetQty: Number(d.total_qty ?? 0), packedQty: Number(d.packed_qty ?? 0),
    })
    setBatch(d.batch_breakdown ?? [])
    setLast(null)
  }

  async function openPalletByCode(code: string) {
    try {
      const p = await palletsApi.lookup(code)   // zwraca rekord palety z polem id
      await openPalletById(p.id)
    } catch (e) {
      beepErr()
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Nie znaleziono palety' })
    }
  }
```

- [ ] **Step 3: Pakowanie sztuki**

```typescript
  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy || !pallet) return
    setBusy(true)
    try {
      const result = await palletsApi.packUnit(pallet.id, trimmed)
      if (result.ok) {
        beepOk(); try { navigator.vibrate?.(80) } catch {}
        setBatch(await palletsApi.batchBreakdown(pallet.id))
        if (result.palletStatus === 'packed') {
          setLast({ ok: true, message: 'Paleta zapakowana', result })
          setPallet(null); toPackRes.refetch?.()
        } else {
          setPallet(prev => prev ? { ...prev, packedQty: result.packedQty } : null)
          setLast({ ok: true, message: 'Sztuka spakowana', result })
        }
      } else {
        beepErr(); try { navigator.vibrate?.([60, 40, 60]) } catch {}
        setLast({ ok: false, message: result.reason || 'Nieprawidłowy kod', result })
      }
    } catch (e) {
      beepErr(); try { navigator.vibrate?.([60, 40, 60]) } catch {}
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd skanowania' })
    } finally {
      setBusy(false); setValue(''); focusInput()
    }
  }
```

- [ ] **Step 4: Render — lista palet (gdy brak aktywnej) i skład partii (gdy aktywna)**

Gdy `!pallet`: pokaż przycisk „Skanuj QR palety" (otwiera `QrScannerModal` → `openPalletByCode`) oraz listę `toPackRes.data` (każdy wiersz: klient, `P{palletNo}`, `packedQty/targetQty`, onClick → `openPalletById`).

Gdy `pallet`: nagłówek z `packedQty/targetQty`, pole skanu sztuki (jak obecnie), blok feedbacku `last`, oraz lista składu partii:

```tsx
{batch.length > 0 && (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Partie w palecie</div>
    {batch.map(b => (
      <div key={b.batchNo} className="flex justify-between text-sm tabular-nums">
        <span>Partia {b.batchNo || '—'}</span>
        <span>{b.qty} szt · {b.weightKg.toFixed(0)} kg</span>
      </div>
    ))}
  </div>
)}
```

Dwa modale skanera: `palletScanOpen` (skan palety) i `scannerOpen` (skan sztuki). Pole input sztuki i przycisk kamery jak w obecnym pliku.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: brak błędów. Brak odwołań do `cartonsApi` w tym pliku.

- [ ] **Step 6: Commit**

```bash
git add src/pages/mobile/MobilePakowaniePage.tsx
git commit -m "feat(pack): mobile pakowanie do palety (skan/lista) + skład partii, bez tworzenia kartonu"
```

---

## Task 9: Biuro — postęp pakowania + skład partii w `PalletsEditor`

**Files:**
- Modify: `src/components/orders/PalletsEditor.tsx`

- [ ] **Step 1: Pobierz skład partii dla zapakowanych palet**

Dla palet o statusie `packing`/`packed` dołóż wywołanie `palletsApi.batchBreakdown(p.id)` i pokaż obok palety: „status: pakowanie/zapakowana", postęp (jeśli dostępne `total_qty` vs spakowane — można dociągnąć `palletsApi.detail(p.id)`), oraz listę partii.

```tsx
// w renderze pojedynczej palety, gdy p.status !== 'created':
<div className="text-xs text-slate-500">
  {p.status === 'packed' ? 'Zapakowana' : 'Pakowanie w toku'}
</div>
```

(Pełen widok składu partii — analogiczny blok jak w Task 8 Step 4; reuse istniejącego stylu listy w `PalletsEditor`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: brak błędów.

- [ ] **Step 3: Commit**

```bash
git add src/components/orders/PalletsEditor.tsx
git commit -m "feat(pack): biuro — status pakowania i skład partii palety w PalletsEditor"
```

---

## Task 10: Wygaszenie bytu `cartons`

**Files:**
- Modify: `backend/app/routes/__init__.py` lub miejsce rejestracji routera (usunąć router kartonów)
- Remove: `backend/app/routes/cartons.py`, `backend/app/services/cartons_service.py`
- Modify: `src/lib/api.ts` (usunąć `cartonsApi`, `CartonScanResult` jeśli nieużywane)
- Modify: routing front (usunąć trasę do starego tworzenia kartonu, jeśli istniała oddzielnie)

- [ ] **Step 1: Weryfikacja pustości tabeli w produkcji**

Run (na bazie docelowej, port 5433 wg konfiguracji deployu): `SELECT count(*) FROM cartons;`
- Jeśli `0` → usuwamy kod + (opcjonalnie) `DROP TABLE cartons` w nowej migracji.
- Jeśli `> 0` → NIE usuwamy tabeli; zostawiamy read-only, usuwamy tylko trasy tworzenia/skanu i `cartonsApi`/UI. Odnotować decyzję w commicie.

- [ ] **Step 2: Usuń rejestrację i pliki routera/serwisu kartonów**

Znajdź rejestrację: `grep -rn "cartons" backend/app/main.py backend/app/routes/__init__.py backend/server_pg.py`
Usuń `include_router` dla kartonów oraz pliki `routes/cartons.py`, `services/cartons_service.py`.
(`validate_pack` i jego testy w `unit_codes.py`/`test_unit_codes.py` ZOSTAJĄ — to referencja; nie usuwać.)

- [ ] **Step 3: Usuń `cartonsApi` z frontu**

W `src/lib/api.ts` usuń `export const cartonsApi` oraz powiązane typy, jeśli nigdzie indziej nieużywane (`grep -rn "cartonsApi\|CartonScanResult" src/`).

- [ ] **Step 4: Testy + typecheck + import aplikacji**

Run: `cd backend && python -m pytest -q && python -c "import app.main" 2>/dev/null || python -c "import app.routes.pallets"`
Run: `npx tsc --noEmit`
Expected: testy zielone, brak importów kartonów, brak błędów TS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(pack): wygaszenie bytu cartons (paleta jest jedynym pudełkiem)"
```

---

## Task 11: Pełny przebieg testów + ręczny e2e

- [ ] **Step 1: Cała sucha testów backendu**

Run: `cd backend && python -m pytest -q`
Expected: wszystko zielone (w tym `test_pack_to_pallet.py`).

- [ ] **Step 2: Build frontu**

Run: `npm run build`
Expected: build przechodzi.

- [ ] **Step 3: Ręczny e2e (na środowisku dev)**

1. Biuro: utwórz zamówienie + linię „20 × 40 kg", ułóż paletę z tej linii, wydrukuj etykietę QR palety.
2. Produkcja: dodaj i potwierdź sztuki (status `produced`) dla tego zamówienia.
3. Mobile: skan QR palety → skan 20 sztuk; sztuka z innego zamówienia/produktu → BŁĄD; sztuka spoza produkcji (`planned`) → BŁĄD.
4. Po komplecie: paleta `packed`; skład partii pokazuje rozbicie (np. 15× 333, 5× 334).
5. Skan mroźni: `cold_storage` działa tylko po `packed`.

Expected: zachowanie zgodne ze specyfikacją.

- [ ] **Step 4: Commit (jeśli były poprawki)**

```bash
git add -A && git commit -m "test(pack): e2e przebieg pakowania palet zweryfikowany"
```

---

## Self-Review (do wykonania przez autora planu po napisaniu)

- **Pokrycie specu:** model danych (Task 1), walidacja (Task 2–4), cykl statusu (Task 5), skład partii/HDI-dane (Task 6), API+mobile (Task 7–8), biuro (Task 9), wygaszenie kartonów (Task 10), testy (Task 11). ✅
- **Spójność typów:** `validate_pack_to_pallet(unit, pallet_order_id, planned_by_key, packed_by_key)` używane identycznie w Task 2 i Task 3. `pallet_line_key` jednolite. `PalletPackResult` zgodny z odpowiedzią serwisu (`ok/reason/packedQty/targetQty/palletStatus`). ✅
- **Brak placeholderów w krokach krytycznych (backend):** każdy krok ma kod/komendę. Front (Task 8–9) zawiera realny kod kluczowych handlerów; układ JSX reużywa istniejącego pliku. ✅
