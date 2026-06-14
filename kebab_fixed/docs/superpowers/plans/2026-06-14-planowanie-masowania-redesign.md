# Przeprojektowanie strony „Planowanie masowania" — Plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zunifikować planowanie masowania w jeden „Plan dnia" z rozwijanymi wierszami, gdzie biuro obowiązkowo przypisuje partie mięsa FEFO już przy planowaniu, wygodnie dodaje/zmienia pozycje w ciągu dnia i przeciąga kolejność.

**Architecture:** Backend rozszerza `save_day_plan` o partie per pozycja z re-rezerwacją (wspólne helpery `_reserve_order_lots_cx` / `_release_order_lots_cx` wyciągnięte z `create_mixing_order` / `cancel_mixing_order`), plus czysta walidacja partii obowiązkowych. Frontend rozbija `MixingDayPlanEditor` na `PlanRow` + `MeatLotPicker` + `IngredientPreview` + czysty helper `autoFefoDistribute`, a `PlanningPage` traci kreator i tabelę zleceń.

**Tech Stack:** FastAPI + psycopg (raw SQL, transakcje), React 18 + TypeScript, shadcn/ui, lucide-react, sonner. Brak harnessu testowego dla DB/UI — TDD dotyczy czystych funkcji (pytest); reszta weryfikowana ręcznie (smoke test API + dev server + Playwright screenshot).

**Spec:** `docs/superpowers/specs/2026-06-14-planowanie-masowania-redesign-design.md`

---

## Struktura plików

**Backend (modyfikacja):**
- `backend/app/services/mixing_service.py` — nowe helpery `_reserve_order_lots_cx`, `_release_order_lots_cx`, czysta funkcja `validate_day_plan_item`; refaktor `create_mixing_order` / `cancel_mixing_order` na helpery; rozszerzenie `save_day_plan` o partie.
- `backend/tests/test_day_plan_validation.py` — **nowy**, testy czystej walidacji.

**Frontend (nowe):**
- `src/features/products/lib/autoFefo.ts` — czysty helper dystrybucji FEFO po wierszach.
- `src/features/products/components/MeatLotPicker.tsx` — lista partii FEFO z zaznaczaniem + auto-FEFO wiersza (wyciągnięte z kreatora).
- `src/features/products/components/IngredientPreview.tsx` — podgląd składników + półproduktu.
- `src/features/products/components/PlanRow.tsx` — pojedynczy wiersz planu (kompaktowy + rozwinięcie + drag).

**Frontend (modyfikacja):**
- `src/features/products/components/MixingDayPlanEditor.tsx` — przebudowa na serce strony (toolbar, partie, gating zapisu).
- `src/features/products/pages/PlanningPage.tsx` — odchudzenie: usunięcie modala kreatora i tabeli zleceń.
- `src/lib/api.ts:1542` — `saveDayPlan` wysyła `meatLots` per pozycja.

---

## Faza 1 — Backend: walidacja partii (TDD, czyste)

### Task 1: Czysta walidacja pozycji planu

**Files:**
- Modify: `backend/app/services/mixing_service.py` (dodaj funkcję po `cancel_mixing_order`, przed `get_day_plan`)
- Test: `backend/tests/test_day_plan_validation.py`

- [ ] **Step 1: Napisz failujący test**

```python
# backend/tests/test_day_plan_validation.py
"""Walidacja partii obowiązkowych w planie dnia masowania."""
import pytest
from fastapi import HTTPException
from app.services.mixing_service import validate_day_plan_item


def _item(**kw):
    base = {"recipeId": "r1", "meatKg": 100,
            "meatLots": [{"meatLotId": "L1", "kgPlanned": 100}]}
    base.update(kw)
    return base


def test_valid_item_passes():
    validate_day_plan_item(_item(), is_untouchable=False)  # nie rzuca


def test_untouchable_skips_lot_check():
    # in_progress/done — partie nietykalne, brak lotów nie jest błędem
    validate_day_plan_item(_item(meatLots=[]), is_untouchable=True)


def test_missing_recipe_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(_item(recipeId=""), is_untouchable=False)
    assert e.value.status_code == 400


def test_zero_kg_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(_item(meatKg=0), is_untouchable=False)
    assert e.value.status_code == 400


def test_missing_lots_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(_item(meatLots=[]), is_untouchable=False)
    assert e.value.status_code == 400


def test_lots_sum_mismatch_raises():
    with pytest.raises(HTTPException) as e:
        validate_day_plan_item(
            _item(meatKg=100, meatLots=[{"meatLotId": "L1", "kgPlanned": 60}]),
            is_untouchable=False,
        )
    assert e.value.status_code == 400


def test_lots_sum_within_tolerance_passes():
    # tolerancja 0.5 kg — drobne zaokrąglenia OK
    validate_day_plan_item(
        _item(meatKg=100, meatLots=[{"meatLotId": "L1", "kgPlanned": 99.7}]),
        is_untouchable=False,
    )
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `cd backend && python -m pytest tests/test_day_plan_validation.py -v`
Expected: FAIL — `ImportError: cannot import name 'validate_day_plan_item'`

- [ ] **Step 3: Zaimplementuj funkcję**

W `backend/app/services/mixing_service.py`, bezpośrednio przed `def get_day_plan()` (ok. linia 914):

```python
def validate_day_plan_item(item: Dict[str, Any], is_untouchable: bool) -> None:
    """Waliduje pojedynczą pozycję planu dnia.

    Partie mięsa są OBOWIĄZKOWE dla pozycji edytowalnych (nowa/w kolejce):
    suma kgPlanned partii musi równać się meatKg (tolerancja 0.5 kg).
    Pozycje nietykalne (in_progress/done) pomijają sprawdzanie partii —
    ich loty są już zarezerwowane i nie wolno ich ruszać.
    """
    if is_untouchable:
        return
    recipe_id = str(item.get("recipeId") or item.get("recipe_id") or "")
    meat_kg = float(item.get("meatKg") or item.get("meat_kg") or 0)
    if not recipe_id:
        raise HTTPException(400, "Receptura wymagana dla pozycji planu")
    if meat_kg <= 0:
        raise HTTPException(400, "Kg mięsa musi być > 0")
    lots = item.get("meatLots") or item.get("meat_lots") or []
    if not lots:
        raise HTTPException(
            400,
            "Każda pozycja planu wymaga przypisanych partii mięsa "
            "(partie obowiązkowe przy planowaniu).",
        )
    total = sum(
        float(l.get("kgPlanned") or l.get("kg_planned") or 0) for l in lots
    )
    if abs(total - meat_kg) > 0.5:
        raise HTTPException(
            400,
            f"Suma partii ({total:.2f} kg) ≠ kg pozycji ({meat_kg:.2f} kg).",
        )
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `cd backend && python -m pytest tests/test_day_plan_validation.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/mixing_service.py backend/tests/test_day_plan_validation.py
git commit -m "feat(masowanie): walidacja partii obowiązkowych w planie dnia"
```

---

## Faza 2 — Backend: helpery rezerwacji + wpięcie w save_day_plan

### Task 2: Wyciągnij helpery rezerwacji/zwalniania lotów

**Files:**
- Modify: `backend/app/services/mixing_service.py` (dodaj helpery przed `create_mixing_order`, ok. linia 209)

Te helpery operują na otwartym połączeniu (`conn`) wewnątrz istniejącej transakcji. Brak testu jednostkowego (wymagałyby DB) — to ekstrakcja sprawdzonego w produkcji kodu; weryfikacja w Task 6 (smoke test) i Task 13 (screenshot).

- [ ] **Step 1: Dodaj `_reserve_order_lots_cx`**

```python
def _reserve_order_lots_cx(
    conn, order_id: str, lots: List[Dict[str, Any]]
) -> None:
    """Rezerwuje partie mięsa dla zlecenia w otwartej transakcji.

    `lots`: lista {meatLotId|meat_lot_id, kgPlanned|kg_planned}. Blokuje
    partie deterministycznie (sorted po id) by uniknąć deadlocków, sprawdza
    wolne kg (available - reserved) i podnosi kg_reserved + wstawia
    mixing_order_lots. Wyciągnięte z create_mixing_order.
    """
    norm = [
        (
            str(l.get("meatLotId") or l.get("meat_lot_id") or ""),
            float(l.get("kgPlanned") or l.get("kg_planned") or 0),
        )
        for l in lots
    ]
    for ms_id, kg_planned in sorted(norm, key=lambda x: x[0]):
        if not ms_id or kg_planned <= 0:
            continue
        locked = cx_query_one(
            conn, "SELECT * FROM meat_stock WHERE id=%s FOR UPDATE", (ms_id,)
        )
        if not locked:
            raise HTTPException(400, f"Partia mięsa nie znaleziona: {ms_id}")
        available = float(locked.get("kg_available") or 0)
        reserved = float(locked.get("kg_reserved") or 0)
        free = available - reserved
        if free < kg_planned - 0.1:
            raise HTTPException(
                400,
                f"Niewystarczające kg w partii {locked.get('lot_no','?')}: "
                f"wolne {free:.2f} kg, wymagane {kg_planned:.2f} kg.",
            )
        cx_execute(
            conn,
            """
            INSERT INTO mixing_order_lots
                (id, order_id, meat_stock_id, kg_planned, kg_actual)
            VALUES (%s,%s,%s,%s,0)
            """,
            (cuid(), order_id, ms_id, kg_planned),
        )
        rowcount = cx_execute_rowcount(
            conn,
            "UPDATE meat_stock SET kg_reserved = kg_reserved + %s WHERE id = %s",
            (kg_planned, ms_id),
        )
        if rowcount == 0:
            raise HTTPException(
                409, f"Race condition: brak kg w partii {ms_id} (update failed)"
            )
```

- [ ] **Step 2: Dodaj `_release_order_lots_cx`**

```python
def _release_order_lots_cx(conn, order_id: str) -> None:
    """Zwalnia rezerwacje i USUWA wiersze mixing_order_lots zlecenia.

    Używane przy re-rezerwacji edytowanej pozycji planu (czysty restart
    lotów). cancel_mixing_order ma własną wersję (zeruje kg_planned dla
    audytu) — tu kasujemy, bo zaraz wstawiamy nowe.
    """
    lots = cx_query_all(
        conn,
        "SELECT meat_stock_id, kg_planned FROM mixing_order_lots "
        "WHERE order_id=%s ORDER BY meat_stock_id FOR UPDATE",
        (order_id,),
    )
    for ms_id in sorted(
        {l["meat_stock_id"] for l in lots if l.get("meat_stock_id")}
    ):
        cx_query_one(
            conn, "SELECT id FROM meat_stock WHERE id=%s FOR UPDATE", (ms_id,)
        )
    for lot in lots:
        kg = float(lot.get("kg_planned") or 0)
        if kg <= 0:
            continue
        cx_execute(
            conn,
            "UPDATE meat_stock SET kg_reserved = GREATEST(0, kg_reserved - %s) "
            "WHERE id=%s",
            (kg, lot.get("meat_stock_id")),
        )
    cx_execute(
        conn, "DELETE FROM mixing_order_lots WHERE order_id=%s", (order_id,)
    )
```

- [ ] **Step 3: Refaktoruj `create_mixing_order` na helper**

W `create_mixing_order` zastąp pętlę rezerwacji (obecne linie ~264–310, blok `for lot_dto in sorted(...)`) jednym wywołaniem:

```python
        # Rezerwacja partii (wspólny helper)
        _reserve_order_lots_cx(
            conn,
            oid,
            [
                {"meatLotId": l.meat_lot_id, "kgPlanned": l.kg_planned}
                for l in dto.meat_lots
            ],
        )
```

- [ ] **Step 4: Sanity — istniejące testy nadal przechodzą**

Run: `cd backend && python -m pytest tests/ -v`
Expected: PASS (wszystkie, w tym test_day_plan_validation z Task 1)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/mixing_service.py
git commit -m "refactor(masowanie): wspólne helpery rezerwacji/zwalniania lotów"
```

### Task 3: Rozszerz `save_day_plan` o partie z re-rezerwacją

**Files:**
- Modify: `backend/app/services/mixing_service.py:931-1021` (`save_day_plan`)

- [ ] **Step 1: Dodaj walidację i partie w pętli pozycji**

Zastąp ciało pętli `for idx, it in enumerate(items):` (linie ~952–1008) wersją z walidacją i partiami. Pełny nowy fragment pętli:

```python
        for idx, it in enumerate(items):
            seq = int(it.get("seq") or it.get("daySeq") or (idx + 1))
            oid = str(it.get("id") or "")
            recipe_id = str(it.get("recipeId") or it.get("recipe_id") or "")
            meat_kg = float(it.get("meatKg") or it.get("meat_kg") or 0)
            lots = it.get("meatLots") or it.get("meat_lots") or []

            is_untouchable = bool(oid and oid in untouchable)
            validate_day_plan_item(it, is_untouchable)

            if is_untouchable:
                cx_execute(
                    conn, "UPDATE mixing_orders SET day_seq=%s WHERE id=%s",
                    (seq, oid),
                )
                sent.add(oid)
                continue

            if oid and oid in editable:
                recipe = cx_query_one(
                    conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,)
                )
                if not recipe:
                    raise HTTPException(400, "Receptura wymagana dla pozycji planu")
                cx_execute(
                    conn,
                    """
                    UPDATE mixing_orders
                    SET day_seq=%s, recipe_id=%s, recipe_name=%s, meat_kg=%s,
                        planned_output_kg=%s
                    WHERE id=%s AND status IN ('planned','confirmed')
                    """,
                    (seq, recipe["id"], recipe["name"], meat_kg,
                     calc_kg_output(recipe["id"], meat_kg), oid),
                )
                # Re-rezerwacja: zwolnij stare loty, zarezerwuj nowe
                _release_order_lots_cx(conn, oid)
                _reserve_order_lots_cx(conn, oid, lots)
                sent.add(oid)
                continue

            # Nowa pozycja planu — tworzy zlecenie z rezerwacją partii
            recipe = cx_query_one(
                conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,)
            )
            if not recipe:
                raise HTTPException(400, "Receptura nie znaleziona")
            new_oid = cuid()
            order_no = next_dated_no(conn, "MAS")
            cx_execute(
                conn,
                """
                INSERT INTO mixing_orders
                    (id, order_no, recipe_id, recipe_name, meat_kg,
                     planned_output_kg, kg_done, machine_id, status,
                     day_seq, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,0,NULL,'confirmed',%s,%s)
                """,
                (new_oid, order_no, recipe["id"], recipe["name"], meat_kg,
                 calc_kg_output(recipe["id"], meat_kg), seq, now_iso()),
            )
            _reserve_order_lots_cx(conn, new_oid, lots)
```

(Uwaga: nowa pozycja używa teraz `new_oid` zamiast `cuid()` inline, żeby przekazać id do rezerwacji.)

- [ ] **Step 2: Sanity — testy czyste nadal zielone**

Run: `cd backend && python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/mixing_service.py
git commit -m "feat(masowanie): partie obowiązkowe w save_day_plan z re-rezerwacją"
```

---

## Faza 3 — API client

### Task 4: `saveDayPlan` wysyła partie

**Files:**
- Modify: `src/lib/api.ts:1542-1548`

- [ ] **Step 1: Rozszerz sygnaturę i payload**

Zastąp obecny `saveDayPlan` (linie 1542–1548):

```typescript
  saveDayPlan:       (items: {
    id?: string
    recipeId: string
    meatKg: number
    seq: number
    meatLots: { meatLotId: string; kgPlanned: number }[]
  }[]) =>
    put<any>('/mixing-orders/day-plan', {
      items: items.map(i => ({
        id: i.id,
        recipeId: i.recipeId,
        meatKg: i.meatKg,
        seq: i.seq,
        meatLots: i.meatLots.map(l => ({
          meatLotId: l.meatLotId,
          kgPlanned: l.kgPlanned,
        })),
      })),
    }).then(r => ({
      items: (r?.items ?? []).map(mapMixingOrder),
      rev:   r?.rev ?? '',
    })),
```

- [ ] **Step 2: Sprawdź kompilację TS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -i "api.ts" || echo "api.ts OK"`
Expected: `api.ts OK` (błędy w `MixingDayPlanEditor.tsx` na tym etapie są oczekiwane — naprawimy w Fazie 5)

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(masowanie): saveDayPlan wysyła partie per pozycja"
```

---

## Faza 4 — Frontend: czysty helper FEFO + komponenty wyciągnięte

### Task 5: Czysty helper `autoFefoDistribute`

**Files:**
- Create: `src/features/products/lib/autoFefo.ts`

Czysta funkcja — bez DOM, bez API. (Brak runnera testów TS w projekcie; weryfikacja przez użycie w UI + screenshot w Task 13. Funkcja celowo wydzielona, by była trywialnie czytelna.)

- [ ] **Step 1: Utwórz plik**

```typescript
// src/features/products/lib/autoFefo.ts
/**
 * Dystrybucja partii mięsa wg FEFO po wierszach planu w kolejności.
 * Wiersz 1 dostaje najwcześniej wygasające mięso; kolejne wiersze biorą
 * to, co zostało. Czysta funkcja — wejście/wyjście, bez efektów ubocznych.
 */
export interface AvailLot {
  id: string
  kgFree: number       // dostępne - zarezerwowane (poza tym planem)
  expiryDate: string   // ISO; sortowanie rosnąco = FEFO
}

export interface PlanNeed {
  rowKey: string       // stabilny klucz wiersza (id zlecenia lub 'new-N')
  kg: number           // ile mięsa potrzebuje wiersz
}

export interface LotAlloc {
  meatLotId: string
  kgPlanned: number
}

export function autoFefoDistribute(
  rows: PlanNeed[],
  lots: AvailLot[],
): Record<string, LotAlloc[]> {
  const pool = [...lots]
    .filter(l => l.kgFree > 0.001)
    .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : 1))
    .map(l => ({ ...l }))   // kopia: mutujemy kgFree lokalnie

  const out: Record<string, LotAlloc[]> = {}
  for (const row of rows) {
    let remaining = row.kg
    const allocs: LotAlloc[] = []
    for (const lot of pool) {
      if (remaining <= 0.001) break
      if (lot.kgFree <= 0.001) continue
      const take = Math.min(lot.kgFree, remaining)
      allocs.push({ meatLotId: lot.id, kgPlanned: Math.round(take * 100) / 100 })
      lot.kgFree -= take
      remaining -= take
    }
    out[row.rowKey] = allocs
  }
  return out
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/products/lib/autoFefo.ts
git commit -m "feat(masowanie): czysty helper dystrybucji FEFO po wierszach"
```

### Task 6: Smoke test backendu (read-only) + helper FEFO sanity

**Files:** brak (weryfikacja ręczna)

Cel: potwierdzić, że backend ze zmianami z Faz 1–3 czyta plan i że re-rezerwacja nie psuje odczytu. **Nie** wykonujemy zapisów na produkcyjnej bazie (5433) — tylko GET. Pełny zapis weryfikujemy na dev/dev-bazie lub po świadomym deployu (Task 13).

- [ ] **Step 1: GET planu dnia z żywego backendu**

Run: `curl -s http://127.0.0.1:8010/api/mixing-orders/day-plan | python3 -m json.tool | head -40`
Expected: JSON `{ "items": [...], "rev": "..." }`; każdy item ma pole `meatLots` (lista).

- [ ] **Step 2: Potwierdź, że pytest całości backendu zielony**

Run: `cd backend && python -m pytest tests/ -v`
Expected: PASS

### Task 7: Komponent `IngredientPreview`

**Files:**
- Create: `src/features/products/components/IngredientPreview.tsx`

Wyciągnięte z `PlanningPage` (`calcSteps` + `plannedOutput` + tabelka kroku 3).

- [ ] **Step 1: Utwórz komponent**

```tsx
// src/features/products/components/IngredientPreview.tsx
import { useMemo } from 'react'
import { fmtKg } from '@/lib/utils'

interface Recipe {
  id: string
  ingredients: { ingredientName: string; unit?: string; qtyPer100kg: number; isUnlimited?: boolean }[]
}

/** Podgląd składników i półproduktu dla receptury + kg mięsa. */
export function IngredientPreview({ recipe, meatKg }: { recipe?: Recipe; meatKg: number }) {
  const steps = useMemo(() => {
    if (!recipe || meatKg <= 0) return []
    return recipe.ingredients.map(ri => ({
      name: ri.ingredientName,
      unit: ri.unit ?? 'kg',
      qty: Math.round((ri.qtyPer100kg * meatKg) / 100 * 1000) / 1000,
      isUnlimited: ri.isUnlimited,
    }))
  }, [recipe, meatKg])

  const output = useMemo(() => {
    if (!recipe || meatKg <= 0) return 0
    const ingKg = recipe.ingredients
      .filter(ri => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
      .reduce((s, ri) => s + (ri.qtyPer100kg * meatKg) / 100, 0)
    return Math.round((meatKg + ingKg) * 100) / 100
  }, [recipe, meatKg])

  if (!recipe || meatKg <= 0) return null

  return (
    <div className="border rounded text-[12px] overflow-hidden">
      <div className="px-3 py-2 bg-blue-50/50 border-b grid grid-cols-[1fr_100px_50px] gap-2">
        <span className="font-semibold text-blue-700">Mięso (baza)</span>
        <span className="font-bold text-blue-700 text-right">{fmtKg(meatKg, 2)}</span>
        <span className="text-muted-foreground">kg</span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="px-3 py-1.5 border-b last:border-0 grid grid-cols-[1fr_100px_50px] gap-2">
          <span className="font-medium">
            {s.name}{s.isUnlimited && <span className="ml-1 text-[10px] text-blue-600">(woda)</span>}
          </span>
          <span className="font-bold text-right">{s.qty}</span>
          <span className="text-muted-foreground">{s.unit}</span>
        </div>
      ))}
      <div className="px-3 py-2 bg-green-50 border-t-2 border-green-200 grid grid-cols-[1fr_100px_50px] gap-2 font-bold text-green-700">
        <span>PÓŁPRODUKT ŁĄCZNIE</span>
        <span className="text-right">{fmtKg(output, 2)}</span>
        <span>kg</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Kompilacja TS tego pliku**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep "IngredientPreview" || echo "IngredientPreview OK"`
Expected: `IngredientPreview OK`

- [ ] **Step 3: Commit**

```bash
git add src/features/products/components/IngredientPreview.tsx
git commit -m "feat(masowanie): komponent IngredientPreview (podgląd składników)"
```

### Task 8: Komponent `MeatLotPicker`

**Files:**
- Create: `src/features/products/components/MeatLotPicker.tsx`

Wyciągnięte z bloku „Dostępne partie mięsa (FEFO)" kreatora (`PlanningPage` linie ~396–459).

- [ ] **Step 1: Utwórz komponent**

```tsx
// src/features/products/components/MeatLotPicker.tsx
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { CheckCircle } from 'lucide-react'

export interface PickerLot {
  id: string
  lotNo: string
  rawBatchNo?: string
  kgAvailable: number     // wolne kg (po odjęciu rezerwacji spoza tego wiersza)
  expiryDate: string
  materialName?: string
  materialTypeId?: string
}

export interface SelLot { meatLotId: string; kgPlanned: number }

/** Lista partii FEFO z zaznaczaniem + auto-FEFO dla tego wiersza. */
export function MeatLotPicker({
  lots, value, targetKg, onChange, onAutoFefo,
}: {
  lots: PickerLot[]
  value: SelLot[]
  targetKg: number
  onChange: (next: SelLot[]) => void
  onAutoFefo: () => void
}) {
  const selectedKg = value.reduce((s, l) => s + (l.kgPlanned || 0), 0)
  const idx = (id: string) => value.findIndex(v => v.meatLotId === id)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Partie mięsa (FEFO) — zaznacz i wpisz kg
        </span>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onAutoFefo}>
          Auto-FEFO ten wiersz
        </Button>
      </div>
      <div className="border rounded max-h-48 overflow-y-auto divide-y">
        {lots.map(lot => {
          const i = idx(lot.id)
          const isSel = i >= 0
          const free = lot.kgAvailable
          const fullyUsed = free <= 0 && !isSel
          return (
            <div key={lot.id} className={cn(
              'flex items-center gap-2 px-3 py-2 text-[12px] transition-colors',
              isSel ? 'bg-blue-50' : fullyUsed ? 'bg-muted/40 opacity-60' : 'hover:bg-muted/50',
            )}>
              <input type="checkbox" checked={isSel} disabled={fullyUsed}
                onChange={e => {
                  if (e.target.checked) {
                    onChange([...value, { meatLotId: lot.id, kgPlanned: Math.min(free, targetKg) }])
                  } else {
                    onChange(value.filter(v => v.meatLotId !== lot.id))
                  }
                }}
                className="w-4 h-4 flex-shrink-0 accent-primary" />
              <span className="font-mono font-bold flex-shrink-0 w-24">{lot.lotNo}</span>
              {lot.materialName && lot.materialTypeId !== 'mat-cwiartka' && (
                <span className="text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded flex-shrink-0">
                  {lot.materialName}
                </span>
              )}
              <span className="text-muted-foreground flex-shrink-0 w-16 truncate">{lot.rawBatchNo}</span>
              <span className="font-semibold text-green-700 flex-shrink-0 w-20 tabular-nums">{fmtKg(free)} kg</span>
              <span className="text-muted-foreground text-[11px] flex-1">do: {fmtDatePl(lot.expiryDate)}</span>
              {isSel && (
                <Input type="number" min="0.1" step="0.1" value={value[i].kgPlanned}
                  onChange={e => {
                    const v = Math.min(parseFloat(e.target.value) || 0, free)
                    onChange(value.map((l, j) => j === i ? { ...l, kgPlanned: v } : l))
                  }}
                  className="w-20 h-7 text-sm font-bold text-right flex-shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <CheckCircle size={13} className={selectedKg >= targetKg - 0.5 ? 'text-green-600' : 'text-muted-foreground'} />
        <span className={selectedKg >= targetKg - 0.5 ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
          Wybrano {fmtKg(selectedKg)} / {fmtKg(targetKg)} kg
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Kompilacja TS tego pliku**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep "MeatLotPicker" || echo "MeatLotPicker OK"`
Expected: `MeatLotPicker OK`

- [ ] **Step 3: Commit**

```bash
git add src/features/products/components/MeatLotPicker.tsx
git commit -m "feat(masowanie): komponent MeatLotPicker (wybór partii FEFO)"
```

---

## Faza 5 — Frontend: PlanRow + przebudowa edytora

### Task 9: Komponent `PlanRow`

**Files:**
- Create: `src/features/products/components/PlanRow.tsx`

- [ ] **Step 1: Utwórz komponent**

```tsx
// src/features/products/components/PlanRow.tsx
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtKg } from '@/lib/utils'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Trash2,
  CheckCircle, AlertTriangle,
} from 'lucide-react'
import { MeatLotPicker, type PickerLot, type SelLot } from './MeatLotPicker'
import { IngredientPreview } from './IngredientPreview'

export interface PlanRowData {
  rowKey: string
  id?: string
  recipeId: string
  meatKg: string
  status: string          // new | planned | confirmed | in_progress | done
  orderNo?: string
  kgDone?: number
  lots: SelLot[]
}

const ROW_STATUS: Record<string, { label: string; cls: string }> = {
  new:         { label: 'nowa',        cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  planned:     { label: 'w kolejce',   cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  confirmed:   { label: 'w kolejce',   cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  in_progress: { label: 'w masownicy', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  done:        { label: 'gotowe',      cls: 'bg-green-50 text-green-700 border-green-200' },
}

export function PlanRow({
  row, index, total, recipes, lots, output, expanded,
  onUpdate, onMove, onDelete, onToggle, onAutoFefoRow,
  dragHandlers,
}: {
  row: PlanRowData
  index: number
  total: number
  recipes: any[]
  lots: PickerLot[]
  output: number
  expanded: boolean
  onUpdate: (patch: Partial<PlanRowData>) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  onToggle: () => void
  onAutoFefoRow: () => void
  dragHandlers: {
    draggable: boolean
    onDragStart: () => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: () => void
    onDragEnd: () => void
  }
}) {
  const st = ROW_STATUS[row.status] ?? ROW_STATUS.new
  const locked = row.status === 'in_progress' || row.status === 'done'
  const kg = parseFloat(row.meatKg) || 0
  const lotKg = row.lots.reduce((s, l) => s + (l.kgPlanned || 0), 0)
  const lotsOk = lotKg >= kg - 0.5 && kg > 0

  return (
    <div className={`rounded-lg border ${locked ? 'bg-muted/40' : 'bg-white'}`}
      onDragOver={dragHandlers.onDragOver} onDrop={dragHandlers.onDrop}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          draggable={dragHandlers.draggable && !locked}
          onDragStart={dragHandlers.onDragStart}
          onDragEnd={dragHandlers.onDragEnd}
          className={`flex-shrink-0 ${locked ? 'opacity-20' : 'cursor-grab text-muted-foreground hover:text-ink'}`}
          title={locked ? 'Pozycja w masownicy/gotowa' : 'Przeciągnij, by zmienić kolejność'}>
          <GripVertical size={16} />
        </span>
        <span className="w-5 text-center text-sm font-black text-violet-700 tabular-nums">{index + 1}</span>

        <div className="flex-1 min-w-0">
          <Select value={row.recipeId || '__none'} disabled={locked}
            onValueChange={v => onUpdate({ recipeId: v === '__none' ? '' : v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Receptura..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Receptura...</SelectItem>
              {recipes.map(rc => <SelectItem key={rc.id} value={rc.id}>{rc.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 w-24 flex-shrink-0">
          <Input type="number" min="1" step="10" value={row.meatKg} disabled={locked}
            onChange={e => onUpdate({ meatKg: e.target.value })}
            className="h-8 text-[13px] font-bold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          <span className="text-[10px] text-muted-foreground">kg</span>
        </div>

        <span className="w-24 text-right text-[12px] text-green-700 font-semibold tabular-nums flex-shrink-0">
          → {fmtKg(output, 0)} kg
        </span>

        {!locked && (
          <span className={`flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 w-20 ${lotsOk ? 'text-green-700' : 'text-amber-700'}`}>
            {lotsOk ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
            {lotsOk ? 'partie' : 'brak'}
          </span>
        )}

        <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${st.cls}`}>
          {st.label}{row.status === 'in_progress' && row.kgDone ? ` · ${fmtKg(row.kgDone, 0)} kg` : ''}
        </Badge>

        <div className="flex flex-col flex-shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0}
            className="h-4 w-7 flex items-center justify-center text-muted-foreground hover:text-ink disabled:opacity-20">
            <ArrowUp size={13} />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1}
            className="h-4 w-7 flex items-center justify-center text-muted-foreground hover:text-ink disabled:opacity-20">
            <ArrowDown size={13} />
          </button>
        </div>

        <button onClick={onToggle} disabled={locked}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted/60 disabled:opacity-20 flex-shrink-0"
          title="Partie i składniki">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <button onClick={onDelete} disabled={locked}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-20 flex-shrink-0"
          title={locked ? 'Pozycja w masownicy/gotowa' : 'Usuń z planu'}>
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && !locked && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/20 grid grid-cols-2 gap-3">
          <MeatLotPicker
            lots={lots} value={row.lots} targetKg={kg}
            onChange={next => onUpdate({ lots: next })}
            onAutoFefo={onAutoFefoRow} />
          <IngredientPreview
            recipe={recipes.find(r => r.id === row.recipeId)} meatKg={kg} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Kompilacja TS tego pliku**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep "PlanRow" || echo "PlanRow OK"`
Expected: `PlanRow OK`

- [ ] **Step 3: Commit**

```bash
git add src/features/products/components/PlanRow.tsx
git commit -m "feat(masowanie): komponent PlanRow (wiersz planu z partiami i drag)"
```

### Task 10: Przebuduj `MixingDayPlanEditor` na serce strony

**Files:**
- Modify: `src/features/products/components/MixingDayPlanEditor.tsx` (pełna przebudowa)

- [ ] **Step 1: Zastąp całą zawartość pliku**

```tsx
/**
 * MixingDayPlanEditor — plan dnia masowania (serce strony planowania).
 *
 * Biuro układa kolejkę 1→n receptur z OBOWIĄZKOWYM przypisaniem partii mięsa
 * FEFO. Pozycje w masownicy (in_progress) i gotowe (done) są zablokowane
 * (tylko kolejność). Auto-FEFO całość rozdziela dostępne partie po wierszach.
 * Zapis = PUT /api/mixing-orders/day-plan; panel operatora wykrywa zmianę (rev).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { mixingOrdersApi, meatStockApi } from '@/lib/apiClient'
import { useRecipes } from '@/features/ingredients/hooks'
import { useApi } from '@/hooks/useApi'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CalendarDays, Loader2, Plus, Save, Zap } from 'lucide-react'
import { PlanRow, type PlanRowData } from './PlanRow'
import type { PickerLot } from './MeatLotPicker'
import { autoFefoDistribute, type AvailLot } from '../lib/autoFefo'

export function MixingDayPlanEditor({ onSaved }: { onSaved?: () => void }) {
  const { recipes } = useRecipes()
  const { data: meatData } = useApi(() => meatStockApi.list())
  const [rows, setRows] = useState<PlanRowData[]>([])
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const dragIdx = useRef<number | null>(null)

  // Dostępne partie mięsa (wolne kg = available - reserved), FEFO
  const pickerLots: PickerLot[] = useMemo(() =>
    (meatData?.data ?? [])
      .filter((m: any) => m.status !== 'DEPLETED' && m.status !== 'IN_PRODUCTION')
      .map((m: any) => ({
        id: m.id,
        lotNo: m.lotNo,
        rawBatchNo: m.rawBatchNo,
        kgAvailable: Math.max(0, Number(m.kgAvailable) - Number(m.kgReserved ?? 0)),
        expiryDate: m.expiryDate,
        materialName: m.materialName,
        materialTypeId: m.materialTypeId,
      }))
      .filter((l: PickerLot) => l.kgAvailable > 0)
      .sort((a: PickerLot, b: PickerLot) => (a.expiryDate < b.expiryDate ? -1 : 1)),
    [meatData],
  )

  const totalAvail = pickerLots.reduce((s, l) => s + l.kgAvailable, 0)

  async function load() {
    try {
      const r = await mixingOrdersApi.dayPlan()
      setRows((r.items ?? []).map((o: any) => ({
        rowKey: o.id, id: o.id, recipeId: o.recipeId, meatKg: String(o.meatKg),
        status: o.status, orderNo: o.orderNo, kgDone: o.kgDone,
        lots: (o.meatLots ?? []).map((l: any) => ({ meatLotId: l.meatLotId, kgPlanned: l.kgPlanned })),
      })))
      setLoaded(true)
      setDirty(false)
    } catch { setLoaded(true) }
  }

  useEffect(() => {
    load()
    const t = setInterval(() => { if (!dirty) load() }, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const recipeOutput = (recipeId: string, meatKg: number) => {
    const r = recipes.find((x: any) => x.id === recipeId)
    if (!r || meatKg <= 0) return 0
    const ingKg = (r.ingredients ?? [])
      .filter((ri: any) => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
      .reduce((s: number, ri: any) => s + (ri.qtyPer100kg * meatKg) / 100, 0)
    return Math.round((meatKg + ingKg) * 100) / 100
  }

  function update(idx: number, patch: Partial<PlanRowData>) {
    setRows(p => p.map((r, i) => i === idx ? { ...r, ...patch } : r)); setDirty(true)
  }
  function move(idx: number, dir: -1 | 1) {
    setRows(p => {
      const n = [...p]; const j = idx + dir
      if (j < 0 || j >= n.length) return p
      ;[n[idx], n[j]] = [n[j], n[idx]]; return n
    }); setDirty(true)
  }
  function reorder(from: number, to: number) {
    setRows(p => {
      if (from === to || from < 0 || to < 0) return p
      const n = [...p]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n
    }); setDirty(true)
  }
  function remove(idx: number) {
    setRows(p => p.filter((_, j) => j !== idx)); setDirty(true)
  }
  function addRow() {
    const key = `new-${Date.now()}`
    setRows(p => [...p, { rowKey: key, recipeId: '', meatKg: '100', status: 'new', lots: [] }])
    setExpandedKey(key); setDirty(true)
  }

  // Auto-FEFO ten wiersz: bierze pulę pomniejszoną o loty INNYCH wierszy
  function autoFefoRow(idx: number) {
    const row = rows[idx]
    const kg = parseFloat(row.meatKg) || 0
    const usedElsewhere = new Map<string, number>()
    rows.forEach((r, i) => {
      if (i === idx) return
      r.lots.forEach(l => usedElsewhere.set(l.meatLotId, (usedElsewhere.get(l.meatLotId) ?? 0) + l.kgPlanned))
    })
    const avail: AvailLot[] = pickerLots.map(l => ({
      id: l.id, expiryDate: l.expiryDate,
      kgFree: Math.max(0, l.kgAvailable - (usedElsewhere.get(l.id) ?? 0)),
    }))
    const dist = autoFefoDistribute([{ rowKey: row.rowKey, kg }], avail)
    update(idx, { lots: dist[row.rowKey] ?? [] })
  }

  // Auto-FEFO całość: rozdziela pulę po wierszach edytowalnych w kolejności
  function autoFefoAll() {
    const editable = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status !== 'in_progress' && r.status !== 'done')
    const avail: AvailLot[] = pickerLots.map(l => ({ id: l.id, expiryDate: l.expiryDate, kgFree: l.kgAvailable }))
    const needs = editable.map(({ r }) => ({ rowKey: r.rowKey, kg: parseFloat(r.meatKg) || 0 }))
    const dist = autoFefoDistribute(needs, avail)
    setRows(p => p.map(r =>
      (r.status === 'in_progress' || r.status === 'done') ? r : { ...r, lots: dist[r.rowKey] ?? r.lots }
    ))
    setDirty(true)
  }

  const totalPlan = rows.reduce((s, r) => s + (parseFloat(r.meatKg) || 0), 0)
  const totalOutput = rows.reduce((s, r) => s + recipeOutput(r.recipeId, parseFloat(r.meatKg) || 0), 0)
  const overBudget = totalPlan > totalAvail + 0.5

  // Gating zapisu: każda edytowalna pozycja musi mieć kompletne partie
  const allLotsComplete = rows.every(r => {
    if (r.status === 'in_progress' || r.status === 'done') return true
    const kg = parseFloat(r.meatKg) || 0
    const lotKg = r.lots.reduce((s, l) => s + (l.kgPlanned || 0), 0)
    return r.recipeId && kg > 0 && lotKg >= kg - 0.5
  })

  async function save() {
    setError('')
    if (!allLotsComplete) { setError('Każda pozycja musi mieć recepturę, kg > 0 i kompletne partie mięsa'); return }
    setSaving(true)
    try {
      await mixingOrdersApi.saveDayPlan(rows.map((r, i) => ({
        id: r.id, recipeId: r.recipeId, meatKg: parseFloat(r.meatKg), seq: i + 1,
        meatLots: r.lots,
      })))
      await load()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu planu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden border-violet-200">
      <div className="px-4 py-2.5 bg-violet-50/60 border-b border-violet-200 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-violet-600" />
          <span className="text-[12px] font-bold text-violet-800 uppercase tracking-wide">Plan dnia masowania</span>
        </div>
        <span className="text-[12px] font-black text-violet-700">
          Σ {fmtKg(totalPlan, 0)} kg → {fmtKg(totalOutput, 0)} kg półprodukt
        </span>
        <span className={`text-[12px] font-semibold ${overBudget ? 'text-red-600' : 'text-muted-foreground'}`}>
          Dostępne mięso: {fmtKg(totalAvail, 0)} kg{overBudget ? ' — za mało!' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1 text-[12px]" onClick={autoFefoAll}>
            <Zap size={13} /> Auto-FEFO całość
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {!loaded ? (
          <div className="text-[12px] text-muted-foreground py-3 text-center">Wczytuję…</div>
        ) : rows.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-3 text-center border border-dashed rounded-lg">
            Brak planu na dziś — dodaj pierwszą pozycję
          </div>
        ) : (
          rows.map((r, i) => (
            <PlanRow
              key={r.rowKey}
              row={r}
              index={i}
              total={rows.length}
              recipes={recipes ?? []}
              lots={pickerLots}
              output={recipeOutput(r.recipeId, parseFloat(r.meatKg) || 0)}
              expanded={expandedKey === r.rowKey}
              onUpdate={patch => update(i, patch)}
              onMove={dir => move(i, dir)}
              onDelete={() => remove(i)}
              onToggle={() => setExpandedKey(k => k === r.rowKey ? null : r.rowKey)}
              onAutoFefoRow={() => autoFefoRow(i)}
              dragHandlers={{
                draggable: true,
                onDragStart: () => { dragIdx.current = i },
                onDragOver: e => e.preventDefault(),
                onDrop: () => { if (dragIdx.current !== null) reorder(dragIdx.current, i); dragIdx.current = null },
                onDragEnd: () => { dragIdx.current = null },
              }}
            />
          ))
        )}

        {error && (
          <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-[12px]" onClick={addRow}>
            <Plus size={13} /> Dodaj pozycję
          </Button>
          <Button size="sm" disabled={saving || !dirty || !allLotsComplete} onClick={save}
            className="h-8 gap-1.5 text-[12px] ml-auto bg-violet-600 hover:bg-violet-700">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {dirty ? 'Zapisz plan (operator zobaczy zmianę)' : 'Plan zapisany'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Sprawdź czy `meatStockApi.list()` zwraca `kgReserved`, `materialName`, `materialTypeId`, `rawBatchNo`**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && grep -nE "kgReserved|materialName|materialTypeId|rawBatchNo" src/lib/api.ts | head`
Expected: pola istnieją w mapowaniu meat_stock. Jeśli `kgReserved` brak — użyj `0` (już jest fallback `?? 0`) i zanotuj do weryfikacji w Task 13.

- [ ] **Step 3: Commit**

```bash
git add src/features/products/components/MixingDayPlanEditor.tsx
git commit -m "feat(masowanie): MixingDayPlanEditor z partiami, drag i auto-FEFO"
```

---

## Faza 6 — Frontend: odchudzenie PlanningPage

### Task 11: Usuń kreator i tabelę zleceń z `PlanningPage`

**Files:**
- Modify: `src/features/products/pages/PlanningPage.tsx` (pełna przebudowa — radykalne odchudzenie)

- [ ] **Step 1: Zastąp całą zawartość pliku**

```tsx
/**
 * PlanningPage — Planowanie masowania.
 *
 * Masowanie = półprodukt. Cała strona to plan dnia (MixingDayPlanEditor):
 * kolejka receptur z obowiązkowym przypisaniem partii mięsa FEFO, edytowalna
 * w ciągu dnia. Wynik masowania idzie do planowania produkcji.
 */
import { MixingDayPlanEditor } from '../components/MixingDayPlanEditor'

export function PlanningPage() {
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-[11px] text-muted-foreground">
        Masowanie = półprodukt. Plan dnia: kolejka receptur z partiami mięsa.
        Wynik masowania idzie do planowania produkcji.
      </p>
      <MixingDayPlanEditor />
    </div>
  )
}
```

- [ ] **Step 2: Pełna kompilacja TS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | tail -20`
Expected: brak błędów (lub tylko nieużywane importy — usuń je, jeśli wystąpią). W razie błędu „unused" w innych plikach niezwiązanych z masowaniem — zignoruj jeśli istniały wcześniej.

- [ ] **Step 3: Commit**

```bash
git add src/features/products/pages/PlanningPage.tsx
git commit -m "refactor(masowanie): PlanningPage = sam plan dnia (usunięto kreator i tabelę)"
```

---

## Faza 7 — Build i weryfikacja wizualna

### Task 12: Build produkcyjny

**Files:** brak

- [ ] **Step 1: Zbuduj front**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -8`
Expected: `✓ built in ...` bez błędów TS/rollup.

### Task 13: Weryfikacja wizualna (dev server + Playwright)

**Files:** brak

Weryfikuje pełny flow na żywym backendzie 8010 (real data). Zapisy planu testujemy świadomie — to zmienia rezerwacje w bazie; jeśli to baza produkcyjna, użyj nieszkodliwych wartości i posprzątaj (usuń testowy wiersz) albo testuj na kopii.

- [ ] **Step 1: Uruchom dev server**

Run (background): `cd /opt/kebab/kebab_new/kebab_fixed && VITE_API_URL=http://127.0.0.1:8010 npm run dev -- --port 5173`
Wait: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` → `200`

- [ ] **Step 2: Otwórz stronę i zrób screenshot**

Playwright: navigate `http://localhost:5173/office/planowanie-masowania`, resize 1600×1000, screenshot.
Expected (oceń wizualnie): jedna karta „Plan dnia masowania" z paskiem Σ kg / dostępne mięso / Auto-FEFO całość; wiersze z uchwytem drag, recepturą, kg, → półprodukt, chipem partie/brak, statusem; przycisk „Dodaj pozycję" i „Zapisz plan". BRAK starego kreatora i tabeli zleceń.

- [ ] **Step 3: Test interakcji (Playwright)**

- Kliknij „Dodaj pozycję" → pojawia się nowy wiersz, rozwinięty, z `MeatLotPicker` i `IngredientPreview`.
- Wybierz recepturę, ustaw kg, kliknij „Auto-FEFO ten wiersz" → partie się zaznaczają, chip zmienia się na „partie".
- Kliknij „Auto-FEFO całość" → wszystkie edytowalne wiersze dostają partie.
- Zweryfikuj, że „Zapisz plan" jest aktywny dopiero gdy wszystkie wiersze mają kompletne partie.
- Screenshot stanu rozwiniętego wiersza.

- [ ] **Step 4: (Opcjonalnie) zapis i odczyt**

Jeśli środowisko pozwala bezpiecznie zapisać: kliknij „Zapisz plan", potwierdź toast/sukces, odśwież stronę → plan się utrzymuje z partiami. Następnie sprawdź panel operatora: navigate `http://localhost:5173/tablet/mieszanie-v2`, screenshot — plan dnia widoczny.

- [ ] **Step 5: Zatrzymaj dev server**

Zakończ proces dev servera.

- [ ] **Step 6: Commit ewentualnych poprawek z weryfikacji**

```bash
git add -A && git commit -m "fix(masowanie): poprawki z weryfikacji wizualnej planu dnia"
```

---

## Self-review (autor planu)

- **Pokrycie specu:** zakres (cała strona = plan dnia) → Task 11; pełna rezerwacja partii → Task 3, 8, 9; partie obowiązkowe + gating → Task 1, 10 (`allLotsComplete`), 3 (400); drag → Task 9, 10 (`reorder`); auto-FEFO całość → Task 5, 10; usunięcie kreatora i tabeli → Task 11; rozbicie na komponenty → Task 7–10; backend `meatLots` per pozycja → Task 3, 4; status na żywo/rev → zachowane w Task 10 (`load` co 15 s, badge w PlanRow). Szablony — świadomie poza zakresem.
- **Placeholdery:** brak „TBD/TODO"; każdy krop kodu kompletny.
- **Spójność typów:** `PlanRowData`, `SelLot` (`meatLotId`/`kgPlanned`), `PickerLot`, `AvailLot` (`kgFree`), `autoFefoDistribute` zwraca `Record<string, LotAlloc[]>` z `meatLotId`/`kgPlanned` — zgodne z payloadem `saveDayPlan` (Task 4) i wejściem `MeatLotPicker`.
- **Zweryfikowane przy pisaniu planu:** `meatStockApi.list()` zwraca `kgReserved`, `materialName`, `materialTypeId`, `rawBatchNo` (`src/lib/api.ts:269-280`). `mapMixingOrder` → `mapMixingOrderMeatLot` zwraca `meatLotId`/`kgPlanned` (`src/lib/api.ts:1465-1475`), zgodne z `load()` w Task 10. Brak otwartych ryzyk kontraktowych.
