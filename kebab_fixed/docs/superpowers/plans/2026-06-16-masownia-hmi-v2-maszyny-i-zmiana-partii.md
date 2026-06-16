# HMI v2 masowania — maszyny w trakcie + kg-z-partii + zmiana partii — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** W HMI v2 masowania pokazać aktywne masownice (z timerem) zawsze — także gdy biuro nie zaplanowało zleceń, pokazać rozbicie kg-z-partii na liście zleceń, oraz umożliwić operatorowi podmianę zaplanowanej partii na inną dostępną ze stanu (FEFO, blokada brakiem kg), z trwałym śladem partii.

**Architecture:** Zmiany niemal w całości w `src/pages/tablet/MixingHmiV2Page.tsx` (monolityczna strona — zgodnie z istniejącym wzorcem repo). Net-nowy, samodzielny picker partii + czysty helper FEFO wydzielone do małego modułu `src/pages/tablet/mixing/`. Warstwa 1 (ślad faktycznej partii) jest już w pełni wspierana przez backend (`finishSession.lotAllocations` zużywa stock z alokacji TEJ sesji) — wystarczy front. Warstwa 2 (trwała zmiana planu zlecenia) to osobny, ostatni krok: cienki serwis `replace_order_meat_lots` (release + reserve) + endpoint `PATCH /mixing-orders/{id}/meat-lots`.

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind (zmienne `--ink/--mut/--amb/...`), FastAPI + psycopg (backend). Brak runnera jednostkowego — gate per zadanie = `npm run typecheck`; zachowanie weryfikujemy szkieletem Playwright (wzorzec repo: `test.skip`) + wizualnie na :8080. Backend zmiany: smoke `curl`.

**Spec:** `docs/superpowers/specs/2026-06-16-masownia-hmi-v2-maszyny-i-zmiana-partii-design.md`

---

## File Structure

- **Create** `src/pages/tablet/mixing/batchCandidates.ts` — czyste typy + `buildBatchCandidates()` (filtr AVAILABLE + wolne kg, filtr materiału, sort FEFO). Bez React.
- **Create** `src/pages/tablet/mixing/BatchPickerSheet.tsx` — modal wyboru zastępczej partii (UI, używa `buildBatchCandidates`).
- **Modify** `src/pages/tablet/MixingHmiV2Page.tsx` — panel maszyn w stanie pustym, rozbicie kg-z-partii na karcie zlecenia, „Zmień partię" w `MeatScreenV2`, przełącznik warstwy 2.
- **Modify (warstwa 2)** `backend/app/services/mixing_service.py`, `backend/app/routes/mixing.py`, `src/lib/api.ts`.
- **Create** `e2e/masownia-hmi-v2.spec.ts` — szkielet e2e (skip, kontrakt zachowania).

---

## Task 1: Czysty helper kandydatów partii (FEFO)

**Files:**
- Create: `src/pages/tablet/mixing/batchCandidates.ts`

- [ ] **Step 1: Utwórz helper z typami i logiką FEFO**

Plik `src/pages/tablet/mixing/batchCandidates.ts`:

```ts
/**
 * Czysta logika doboru zastępczej partii mięsa dla masowania.
 * Źródło: meatStockApi.list() → MeatStock[] (camelCase po mapMeatStock).
 * Reguły (spec C): tylko AVAILABLE z wolnymi kg, zgodny materiał (gdy znany),
 * sort FEFO (najkrótszy termin pierwszy).
 */

export interface BatchCandidate {
  meatStockId:    string   // meat_stock.id — trafia do lotAllocations.meatLotId
  lotNo:          string
  rawBatchNo:     string
  materialTypeId: string
  materialName:   string
  kgFree:         number   // kgAvailable - kgReserved
  expiryDate:     string
  expiryStatus:   string   // 'OK' | 'SOON' | 'EXPIRED' | ...
}

/** Surowy element ze stanu mięsa (po mapMeatStock w api.ts). */
export interface RawMeatStock {
  id?: string
  lotNo?: string
  rawBatchNo?: string
  materialTypeId?: string
  materialName?: string
  kgAvailable?: number | string
  kgReserved?: number | string
  expiryDate?: string
  expiryStatus?: string
  status?: string
}

/**
 * Buduje listę kandydatów (FEFO) z surowego stanu mięsa.
 * @param requiredMaterialTypeId - gdy podany, zawęża do tego samego materiału.
 * @param excludeStockIds - partie do pominięcia (już użyte w innych wierszach).
 */
export function buildBatchCandidates(
  rawStock: RawMeatStock[],
  requiredMaterialTypeId?: string | null,
  excludeStockIds: string[] = [],
): BatchCandidate[] {
  const exclude = new Set(excludeStockIds)
  return (rawStock ?? [])
    .filter(m => (m.status ?? 'AVAILABLE') !== 'DEPLETED')
    .map(m => ({
      meatStockId:    String(m.id ?? ''),
      lotNo:          m.lotNo ?? '',
      rawBatchNo:     m.rawBatchNo ?? '',
      materialTypeId: m.materialTypeId ?? '',
      materialName:   m.materialName ?? '',
      kgFree:         Math.max(0, Number(m.kgAvailable ?? 0) - Number(m.kgReserved ?? 0)),
      expiryDate:     m.expiryDate ?? '',
      expiryStatus:   m.expiryStatus ?? 'OK',
    }))
    .filter(c => c.meatStockId && c.kgFree > 0.01 && !exclude.has(c.meatStockId))
    .filter(c => !requiredMaterialTypeId || c.materialTypeId === requiredMaterialTypeId)
    .sort((a, b) => (a.expiryDate > b.expiryDate ? 1 : a.expiryDate < b.expiryDate ? -1 : 0))
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS (brak błędów).

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/mixing/batchCandidates.ts
git commit -m "feat(masownia): czysty helper FEFO kandydatów partii (HMI v2)"
```

---

## Task 2: Komponent BatchPickerSheet

**Files:**
- Create: `src/pages/tablet/mixing/BatchPickerSheet.tsx`

- [ ] **Step 1: Utwórz modal wyboru partii**

Plik `src/pages/tablet/mixing/BatchPickerSheet.tsx`:

```tsx
/**
 * BatchPickerSheet — wybór zastępczej partii mięsa (HMI v2 masowania).
 * Pokazuje partie FEFO ze stanu, blokuje pozycje bez wystarczających kg.
 * Po wyborze zwraca BatchCandidate do MeatScreenV2 (podmiana wiersza).
 */
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { X, AlertTriangle, Timer } from 'lucide-react'
import { buildBatchCandidates, type BatchCandidate, type RawMeatStock } from './batchCandidates'

export function BatchPickerSheet({
  rawStock, requiredMaterialTypeId, neededKg, excludeStockIds, onPick, onClose,
}: {
  rawStock: RawMeatStock[]
  requiredMaterialTypeId?: string | null
  neededKg: number
  excludeStockIds: string[]
  onPick: (c: BatchCandidate) => void
  onClose: () => void
}) {
  const candidates = buildBatchCandidates(rawStock, requiredMaterialTypeId, excludeStockIds)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(15,23,42,.45)' }} onClick={onClose}>
      <div className="w-full sm:max-w-xl max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: 'var(--panel)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Zmień partię</div>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ background: 'var(--bd)' }}>
            <X size={22} style={{ color: 'var(--ink)' }} />
          </button>
        </div>
        <div className="text-[14px] mb-4" style={{ color: 'var(--mut)' }}>
          Potrzeba ok. <strong style={{ color: 'var(--amb)' }}>{fmtKg(neededKg)} kg</strong> · partie wg terminu (FEFO)
        </div>

        {candidates.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10" style={{ color: 'var(--mut)' }}>
            <AlertTriangle size={40} style={{ color: 'var(--amb)' }} />
            <div className="text-lg font-bold">Brak dostępnych partii na stanie</div>
          </div>
        )}

        <div className="space-y-3">
          {candidates.map(c => {
            const tooLittle = c.kgFree < neededKg - 0.1
            return (
              <button key={c.meatStockId}
                onClick={() => !tooLittle && onPick(c)}
                disabled={tooLittle}
                className="w-full text-left rounded-2xl border-[3px] p-4 transition-all active:scale-[.99] disabled:opacity-50"
                style={{ borderColor: tooLittle ? 'var(--red)' : 'var(--bd)', background: 'var(--panel)' }}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[18px] font-black" style={{ color: 'var(--blu)' }}>{c.lotNo}</span>
                  <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{c.rawBatchNo}</span>
                </div>
                <div className="text-[15px] font-bold mt-0.5" style={{ color: 'var(--ink)' }}>{c.materialName}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-2xl font-black tabular-nums"
                    style={{ color: tooLittle ? 'var(--red)' : 'var(--grn)' }}>
                    {fmtKg(c.kgFree)} kg
                  </span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: 'var(--mut)' }}>
                    <Timer size={13} /> do: {fmtDatePl(c.expiryDate)}
                  </span>
                </div>
                {tooLittle && (
                  <div className="text-[13px] font-bold mt-1 flex items-center gap-1" style={{ color: 'var(--red)' }}>
                    <AlertTriangle size={13} /> Za mało na stanie (potrzeba {fmtKg(neededKg)} kg)
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS. Jeśli `fmtDatePl`/`fmtKg` nie są eksportowane z `@/lib/utils`, potwierdź import (są używane w `MixingHmiV2Page.tsx`).

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/mixing/BatchPickerSheet.tsx
git commit -m "feat(masownia): BatchPickerSheet — wybór zastępczej partii FEFO (HMI v2)"
```

---

## Task 3: Panel „Masownice w pracy" zawsze widoczny (stan pusty)

**Files:**
- Modify: `src/pages/tablet/MixingHmiV2Page.tsx` (funkcja `OrderListV2`, gałąź `orders.length === 0`, ~linie 216–231; istniejący blok „Masownice w pracy" ~315–324; `ActiveMachineTile` ~330)

**Kontekst:** Dziś gałąź pustego stanu robi `return` z samym komunikatem; panel maszyn istnieje tylko w gałęzi z listą. Wydzielamy panel do lokalnej funkcji i renderujemy w obu gałęziach.

- [ ] **Step 1: Dodaj komponent `ActiveMachinesPanel` (nad `ActiveMachineTile`)**

Wstaw przed `function ActiveMachineTile(` nową funkcję:

```tsx
function ActiveMachinesPanel({ locks }: { locks: MachineLock[] }) {
  if (locks.length === 0) return null
  return (
    <div className="mt-6">
      <div className="text-[13px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--mut)' }}>
        Masownice w pracy
      </div>
      <div className="grid grid-cols-3 gap-3">
        {locks.map(l => <ActiveMachineTile key={`${l.machineId}-${l.orderId}`} lock={l} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wzbogać kafelek `ActiveMachineTile` o nr zlecenia**

W `ActiveMachineTile` (renderuje „Masownica {lock.machineId}") dodaj pod numerem masownicy wiersz z `orderNo`. Znajdź w `ActiveMachineTile` element z `Masownica {lock.machineId}` i bezpośrednio po nim dodaj:

```tsx
      <div className="text-[12px] font-mono font-bold truncate" style={{ color: 'var(--mut)' }}>
        {lock.orderNo}
      </div>
```

(`MachineLock` ma pole `orderNo` — patrz typ w `mockApi.ts`.)

- [ ] **Step 3: Renderuj panel w stanie pustym**

W `OrderListV2`, w gałęzi `if (orders.length === 0) {`, zamień zwracany blok tak, by zawierał panel maszyn. Zmień:

```tsx
  if (orders.length === 0) {
    const hasInProgress = inProgress.length > 0
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10">
        <Lock size={64} style={{ color: hasInProgress ? 'var(--amb)' : 'var(--mut)' }} />
        <div className="text-3xl font-black" style={{ color: 'var(--ink)' }}>
          {hasInProgress ? 'Masowanie w toku' : 'Brak zleceń'}
        </div>
        <div className="text-lg" style={{ color: 'var(--mut)' }}>
          {hasInProgress
            ? `Pozostało ${fmtKg(inProgress.reduce((s, o: any) => s + ((o.kgRemaining ?? o.meatKg) || 0), 0), 0)} kg — masownica chłodzi`
            : 'Biuro nie zaplanowało masowania'}
        </div>
      </div>
    )
  }
```

na:

```tsx
  if (orders.length === 0) {
    const hasInProgress = inProgress.length > 0
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col items-center gap-4">
          <Lock size={64} style={{ color: hasInProgress ? 'var(--amb)' : 'var(--mut)' }} />
          <div className="text-3xl font-black" style={{ color: 'var(--ink)' }}>
            {hasInProgress ? 'Masowanie w toku' : 'Brak zleceń'}
          </div>
          <div className="text-lg text-center" style={{ color: 'var(--mut)' }}>
            {hasInProgress
              ? `Pozostało ${fmtKg(inProgress.reduce((s, o: any) => s + ((o.kgRemaining ?? o.meatKg) || 0), 0), 0)} kg — masownica chłodzi`
              : 'Biuro nie zaplanowało masowania'}
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <ActiveMachinesPanel locks={locks} />
        </div>
      </div>
    )
  }
```

- [ ] **Step 4: Użyj `ActiveMachinesPanel` w gałęzi z listą (DRY)**

W gałęzi z listą zleceń zamień istniejący blok:

```tsx
        {/* Aktywne masownice */}
        {locks.length > 0 && (
          <div className="mt-6">
            <div className="text-[13px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--mut)' }}>
              Masownice w pracy
            </div>
            <div className="grid grid-cols-3 gap-3">
              {locks.map(l => <ActiveMachineTile key={`${l.machineId}-${l.orderId}`} lock={l} />)}
            </div>
          </div>
        )}
```

na:

```tsx
        {/* Aktywne masownice */}
        <ActiveMachinesPanel locks={locks} />
```

- [ ] **Step 5: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingHmiV2Page.tsx
git commit -m "feat(masownia): panel masownic w pracy zawsze widoczny, też w stanie pustym (HMI v2)"
```

---

## Task 4: Rozbicie kg-z-partii na karcie zlecenia

**Files:**
- Modify: `src/pages/tablet/MixingHmiV2Page.tsx` (`OrderListV2`, karta zlecenia — istniejący wiersz `{o.meatLots.length} partie`, ~linie 305–308)

- [ ] **Step 1: Zamień licznik partii na rozbicie kg/partia**

Znajdź w karcie zlecenia:

```tsx
                <div className="flex gap-4 mt-2 text-[13px]" style={{ color: 'var(--mut)' }}>
                  <span className="flex items-center gap-1"><Beef size={13} /> {o.meatLots.length} partie</span>
                  <span>{o.steps.length} składników</span>
                </div>
```

Zamień na:

```tsx
                {o.meatLots.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {o.meatLots.slice(0, 4).map((lot: any) => (
                      <span key={lot.meatLotId}
                        className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-full"
                        style={{ background: 'var(--bd)', color: 'var(--ink)' }}>
                        <Beef size={11} /> {lot.rawBatchNo || lot.meatLotNo} · {fmtKg(lot.kgPlanned, 0)} kg
                      </span>
                    ))}
                    {o.meatLots.length > 4 && (
                      <span className="text-[12px] font-bold px-2 py-1" style={{ color: 'var(--mut)' }}>
                        +{o.meatLots.length - 4}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex gap-4 mt-2 text-[13px]" style={{ color: 'var(--mut)' }}>
                  <span>{o.steps.length} składników</span>
                </div>
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingHmiV2Page.tsx
git commit -m "feat(masownia): rozbicie kg-z-partii na karcie zlecenia (HMI v2)"
```

---

## Task 5: „Zmień partię" w ekranie mięsa (warstwa 1 — ślad)

**Files:**
- Modify: `src/pages/tablet/MixingHmiV2Page.tsx` (`MeatScreenV2` ~432–540 oraz komponent-kontener przekazujący props, render `<MeatScreenV2 ...>` ~979)

**Kontekst:** `MeatScreenV2` trzyma wiersze w lokalnym stanie `lots` (z `order.meatLots`) i buduje `allocs = {meatLotId, kg}[]`. `allocs` → `lotAllocs` → `finishSession.lotAllocations`, które backend zużywa per sesja. Podmiana wiersza w `lots` automatycznie zmienia `meatLotId` w śladzie. `meatStockData` (surowy stan) jest już pobrany w kontenerze.

- [ ] **Step 1: Przekaż surowy stan mięsa do `MeatScreenV2`**

W kontenerze, render `MeatScreenV2` (ok. linii 979) ma:

```tsx
        <MeatScreenV2 order={liveOrder} availableLots={availableMeatLots}
          onConfirm={handleMeatConfirm} onBack={() => setPhase('machine')} />
```

Zamień na (dodaj `rawMeatStock`):

```tsx
        <MeatScreenV2 order={liveOrder} availableLots={availableMeatLots}
          rawMeatStock={(meatStockData as any)?.data ?? []}
          onConfirm={handleMeatConfirm} onBack={() => setPhase('machine')} />
```

- [ ] **Step 2: Rozszerz sygnaturę i stan `MeatScreenV2` o podmianę partii**

W `MeatScreenV2` zmień nagłówek funkcji i lokalny stan `lots`. Obecnie:

```tsx
function MeatScreenV2({ order, availableLots, onConfirm, onBack }: {
  order: MixingOrder; availableLots?: MeatScreenLot[]
  onConfirm: (allocs: { meatLotId: string; kg: number }[], total: number) => void
  onBack: () => void
}) {
  const kgRemaining = (order as any).kgRemaining ?? order.meatKg
  const lots: MeatScreenLot[] = order.meatLots.length > 0 ? (order.meatLots as any) : (availableLots ?? [])
  const [lotKgs, setLotKgs] = useState<Record<string, string>>(() => {
```

Zamień na (dodaj import na górze pliku: `import { BatchPickerSheet } from '@/pages/tablet/mixing/BatchPickerSheet'` oraz `import type { RawMeatStock, BatchCandidate } from '@/pages/tablet/mixing/batchCandidates'`):

```tsx
function MeatScreenV2({ order, availableLots, rawMeatStock = [], onConfirm, onBack }: {
  order: MixingOrder; availableLots?: MeatScreenLot[]
  rawMeatStock?: RawMeatStock[]
  onConfirm: (allocs: { meatLotId: string; kg: number }[], total: number) => void
  onBack: () => void
}) {
  const kgRemaining = (order as any).kgRemaining ?? order.meatKg
  const initialLots: MeatScreenLot[] = order.meatLots.length > 0 ? (order.meatLots as any) : (availableLots ?? [])
  // Lokalna kopia wierszy — pozwala podmienić partię (warstwa 1: ślad przez lotAllocations).
  const [lots, setLots] = useState<MeatScreenLot[]>(initialLots)
  const [pickerForLotId, setPickerForLotId] = useState<string | null>(null)

  // Maks kg per wiersz: kgPlanned planowanej, a po podmianie — wolne kg ze stanu.
  const [maxKgByLot, setMaxKgByLot] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    initialLots.forEach(l => { m[l.meatLotId] = l.kgPlanned })
    return m
  })

  // Materiał wymagany = materiał pierwszej planowanej partii (gdy znaleziony w stanie).
  const requiredMaterialTypeId = (() => {
    const first = initialLots[0]
    const match = rawMeatStock.find(s => String(s.id) === String(first?.meatLotId))
    return match?.materialTypeId ?? null
  })()

  function applyBatchSwap(oldLotId: string, c: BatchCandidate) {
    setLots(prev => prev.map(l => l.meatLotId === oldLotId ? {
      meatLotId: c.meatStockId, meatLotNo: c.lotNo, rawBatchNo: c.rawBatchNo,
      kgPlanned: c.kgFree, expiryDate: c.expiryDate,
    } : l))
    setMaxKgByLot(prev => {
      const { [oldLotId]: _drop, ...rest } = prev
      return { ...rest, [c.meatStockId]: c.kgFree }
    })
    setLotKgs(prev => {
      const { [oldLotId]: _drop, ...rest } = prev
      return { ...rest, [c.meatStockId]: '' }
    })
    setPickerForLotId(null)
  }

  const [lotKgs, setLotKgs] = useState<Record<string, string>>(() => {
```

- [ ] **Step 3: Użyj `maxKgByLot` zamiast `lot.kgPlanned` w walidacji**

W bloku liczącym `lotErrors` zamień:

```tsx
  lots.forEach(lot => {
    const kg = parseFloat(lotKgs[lot.meatLotId] || '0') || 0
    if (kg > lot.kgPlanned + 0.01) lotErrors[lot.meatLotId] = `Maks. ${fmtKg(lot.kgPlanned)} kg`
  })
```

na:

```tsx
  lots.forEach(lot => {
    const kg  = parseFloat(lotKgs[lot.meatLotId] || '0') || 0
    const max = maxKgByLot[lot.meatLotId] ?? lot.kgPlanned
    if (kg > max + 0.01) lotErrors[lot.meatLotId] = `Maks. ${fmtKg(max)} kg`
  })
```

- [ ] **Step 4: Dodaj przycisk „Zmień partię" w wierszu i render pickera**

W mapowaniu wierszy `lots.map(lot => ...)`, w nagłówku wiersza (gdzie jest `<span>{lot.rawBatchNo}</span>` i `maks. {fmtKg(lot.kgPlanned)} kg`) zamień blok `maks.` na użycie `maxKgByLot` i dodaj przycisk. Znajdź:

```tsx
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[18px] font-black" style={{ color: 'var(--blu)' }}>{lot.meatLotNo}</span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{lot.rawBatchNo}</span>
                <span className="text-[14px] font-bold" style={{ color: 'var(--mut)' }}>maks. {fmtKg(lot.kgPlanned)} kg</span>
              </div>
```

Zamień na:

```tsx
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="font-mono text-[18px] font-black" style={{ color: 'var(--blu)' }}>{lot.meatLotNo}</span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{lot.rawBatchNo}</span>
                <span className="text-[14px] font-bold" style={{ color: 'var(--mut)' }}>
                  maks. {fmtKg(maxKgByLot[lot.meatLotId] ?? lot.kgPlanned)} kg
                </span>
                <button type="button" onClick={() => setPickerForLotId(lot.meatLotId)}
                  className="text-[13px] font-bold px-3 py-1.5 rounded-lg border-2 active:scale-95"
                  style={{ borderColor: 'var(--blu)', color: 'var(--blu)' }}>
                  Zmień partię
                </button>
              </div>
```

Następnie tuż przed zamykającym `</div>` głównego kontenera `MeatScreenV2` (po przyciskach „Wstecz / Przelicz składniki") dodaj render pickera:

```tsx
      {pickerForLotId && (
        <BatchPickerSheet
          rawStock={rawMeatStock}
          requiredMaterialTypeId={requiredMaterialTypeId}
          neededKg={parseFloat(lotKgs[pickerForLotId] || '0') || (maxKgByLot[pickerForLotId] ?? 0)}
          excludeStockIds={lots.map(l => l.meatLotId).filter(id => id !== pickerForLotId)}
          onPick={c => applyBatchSwap(pickerForLotId, c)}
          onClose={() => setPickerForLotId(null)}
        />
      )}
```

- [ ] **Step 5: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS. (Jeśli `lots` było `const` i jest jeszcze użyte gdzieś z `order.meatLots`, upewnij się, że render i `onConfirm`/`allocs` korzystają z nowego stanu `lots`.)

- [ ] **Step 6: Weryfikacja wizualna (manualna)**

Zbuduj i sprawdź na :8080 (patrz Task 8). Oczekiwane: przy wierszu partii jest „Zmień partię"; klik otwiera listę FEFO; wybór podmienia partię i ustawia maks kg = wolne kg; pozycje z za małą ilością są zablokowane.

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingHmiV2Page.tsx
git commit -m "feat(masownia): zmiana partii w ekranie mięsa — FEFO, blokada, ślad przez lotAllocations (HMI v2)"
```

---

## Task 6: Warstwa 2 — trwała aktualizacja planu zlecenia (backend + front)

**Files:**
- Modify: `backend/app/services/mixing_service.py` (dodaj `replace_order_meat_lots`)
- Modify: `backend/app/routes/mixing.py` (dodaj `PATCH /{order_id}/meat-lots`)
- Modify: `src/lib/api.ts` (`mixingOrdersApi.replaceMeatLots`)
- Modify: `src/pages/tablet/MixingHmiV2Page.tsx` (przełącznik + wywołanie po podmianie)

**Kontekst:** Istnieją czyste helpery `_release_order_lots_cx(conn, order_id)` (zwalnia rezerwacje + kasuje `mixing_order_lots`) oraz `_reserve_order_lots_cx(conn, order_id, lots)` (rezerwuje + wstawia `mixing_order_lots`, waliduje wolne kg). Warstwa 2 = release + reserve nowych lotów w jednej transakcji.

- [ ] **Step 1: Serwis `replace_order_meat_lots` w `mixing_service.py`**

Dodaj funkcję (np. po `_release_order_lots_cx`, przed `# ── Create ──`):

```python
def replace_order_meat_lots(order_id: str, lots: List[Dict[str, Any]]) -> Dict:
    """Trwale podmienia zaplanowane partie zlecenia (warstwa 2).

    `lots`: [{meatLotId, kgPlanned}]. Zwalnia stare rezerwacje, kasuje
    mixing_order_lots i rezerwuje nowe — atomowo. Walidacja wolnych kg
    jest w _reserve_order_lots_cx (HTTP 400 przy braku).
    """
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT * FROM mixing_orders WHERE id=%s", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zlecenie masowania nie znalezione")
        _release_order_lots_cx(conn, order_id)
        _reserve_order_lots_cx(conn, order_id, lots)
        order = cx_query_one(
            conn, "SELECT * FROM mixing_orders WHERE id=%s", (order_id,)
        )
    assert order is not None
    logger.info("mixing.order.lots_replaced", extra={"order_id": order_id, "lots": len(lots)})
    return build_mixing_order(order)
```

- [ ] **Step 2: Endpoint w `routes/mixing.py`**

Dodaj (po `start_mixing_order`):

```python
@router.patch("/{order_id}/meat-lots")
def replace_meat_lots(order_id: str, body: dict):
    lots = body.get("meat_lots") or body.get("meatLots") or []
    return mixing_service.replace_order_meat_lots(order_id, lots)
```

(Upewnij się, że `mixing_service` jest zaimportowany tak jak inne wywołania w tym pliku — sprawdź istniejące `mixing_service.start_mixing_order` itp. i użyj tej samej konwencji.)

- [ ] **Step 3: Smoke backendu**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed && python -c "import ast; ast.parse(open('backend/app/services/mixing_service.py').read()); ast.parse(open('backend/app/routes/mixing.py').read()); print('syntax OK')"
```
Expected: `syntax OK`. (Pełny test na żywej bazie wykonamy w Task 8.)

- [ ] **Step 4: Metoda w `src/lib/api.ts`**

W `mixingOrdersApi` (obok `start`) dodaj:

```ts
  replaceMeatLots: (id: string, lots: { meatLotId: string; kgPlanned: number }[]) =>
    patch<any>(`/mixing-orders/${id}/meat-lots`, {
      meat_lots: lots.map(l => ({ meat_lot_id: l.meatLotId, kg_planned: l.kgPlanned })),
    }).then(mapMixingOrder),
```

- [ ] **Step 5: Przełącznik „Zaktualizuj plan zlecenia" w `MeatScreenV2`**

W `MeatScreenV2` dodaj stan i UI. Po deklaracji `pickerForLotId` dodaj:

```tsx
  const [updatePlan, setUpdatePlan] = useState(false)
  const [swappedAny, setSwappedAny] = useState(false)
```

W `applyBatchSwap`, na końcu (przed `setPickerForLotId(null)`), dodaj `setSwappedAny(true)`.

Nad przyciskami „Wstecz / Przelicz składniki" dodaj checkbox widoczny tylko po podmianie:

```tsx
      {swappedAny && (
        <label className="flex items-center gap-3 mb-4 px-2 py-3 rounded-xl cursor-pointer"
          style={{ background: 'var(--panel)', border: '2px solid var(--bd)' }}>
          <input type="checkbox" checked={updatePlan} onChange={e => setUpdatePlan(e.target.checked)}
            className="w-6 h-6" />
          <span className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
            Zaktualizuj plan zlecenia podmienioną partią
          </span>
        </label>
      )}
```

Zmień `onConfirm`, by przekazać też aktualne wiersze i flagę. Zamień handler przycisku „Przelicz składniki":

```tsx
          onClick={() => {
            const allocs = lots
              .map(lot => ({ meatLotId: lot.meatLotId, kg: parseFloat(lotKgs[lot.meatLotId] || '0') || 0 }))
              .filter(a => a.kg > 0)
            onConfirm(allocs, totalKg)
          }}
```

na:

```tsx
          onClick={() => {
            const allocs = lots
              .map(lot => ({ meatLotId: lot.meatLotId, kg: parseFloat(lotKgs[lot.meatLotId] || '0') || 0 }))
              .filter(a => a.kg > 0)
            const planLots = updatePlan
              ? lots.map(l => ({ meatLotId: l.meatLotId, kgPlanned: maxKgByLot[l.meatLotId] ?? l.kgPlanned }))
              : null
            onConfirm(allocs, totalKg, planLots)
          }}
```

- [ ] **Step 6: Rozszerz `onConfirm` i `handleMeatConfirm`**

Zmień typ `onConfirm` w sygnaturze `MeatScreenV2`:

```tsx
  onConfirm: (allocs: { meatLotId: string; kg: number }[], total: number,
              planLots?: { meatLotId: string; kgPlanned: number }[] | null) => void
```

W kontenerze zmień `handleMeatConfirm`:

```tsx
  const handleMeatConfirm = useCallback(async (allocs: { meatLotId: string; kg: number }[], total: number) => {
    if (!liveOrder) return
    setKgActual(total); setLotAllocs(allocs)
    try { await allocMut.mutate({ id: liveOrder.id, m: liveOrder.machineId!, kg: total }) } catch { /* ignore */ }
    setStepIdx(0); setPhase('steps')
  }, [liveOrder, allocMut])
```

na:

```tsx
  const handleMeatConfirm = useCallback(async (
    allocs: { meatLotId: string; kg: number }[], total: number,
    planLots?: { meatLotId: string; kgPlanned: number }[] | null,
  ) => {
    if (!liveOrder) return
    setKgActual(total); setLotAllocs(allocs)
    if (planLots && planLots.length > 0) {
      try {
        const updated = await mixingOrdersApi.replaceMeatLots(liveOrder.id, planLots)
        setLiveOrder(updated)
      } catch (e) { showToast(e instanceof Error ? e.message : 'Nie udało się zaktualizować planu') }
    }
    try { await allocMut.mutate({ id: liveOrder.id, m: liveOrder.machineId!, kg: total }) } catch { /* ignore */ }
    setStepIdx(0); setPhase('steps')
  }, [liveOrder, allocMut])
```

- [ ] **Step 7: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/mixing_service.py backend/app/routes/mixing.py src/lib/api.ts src/pages/tablet/MixingHmiV2Page.tsx
git commit -m "feat(masownia): warstwa 2 — trwała aktualizacja planu partii zlecenia (PATCH /meat-lots, HMI v2)"
```

---

## Task 7: Szkielet e2e (kontrakt zachowania)

**Files:**
- Create: `e2e/masownia-hmi-v2.spec.ts`

- [ ] **Step 1: Utwórz pomijany szkielet (wzorzec repo)**

Plik `e2e/masownia-hmi-v2.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

/**
 * SZKIELET — HMI v2 masowania (maszyny w trakcie + zmiana partii).
 * Wymaga: backend (:8010) + zaseedowana baza + zalogowany operator produkcji.
 * `skip` dopóki nie ustawisz seeda i selektorów. Kontrakt do ochrony:
 *  1. Stan pusty (brak zaplanowanych) pokazuje aktywne masownice z timerem.
 *  2. Karta zlecenia pokazuje rozbicie kg-z-partii.
 *  3. „Zmień partię" otwiera listę FEFO, blokuje partie z za małą ilością kg,
 *     a po wyborze podmienia partię na ekranie mięsa.
 */
test.describe('masownia HMI v2', () => {
  test.skip(true, 'TODO: seed bazy + selektory + tryb HMI v2 (localStorage mieszanie_hmi_mode=v2)')

  test('stan pusty pokazuje masownice w pracy z timerem', async ({ page }) => {
    await page.goto('/tablet/mieszanie')
    // TODO: ustaw mieszanie_hmi_mode=v2, zasiej lock; expect tekst "Masownice w pracy"
    expect(true).toBe(true)
  })

  test('zmiana partii pokazuje listę FEFO i podmienia wiersz', async ({ page }) => {
    await page.goto('/tablet/mieszanie')
    // TODO: wejdź w zlecenie → maszyna → ekran mięsa → "Zmień partię"; expect lista FEFO
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Sprawdź, że spec się ładuje (nie wykonuje)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx playwright test masownia-hmi-v2 --list`
Expected: lista 2 testów (oba skipped). Brak błędu kompilacji TS.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add e2e/masownia-hmi-v2.spec.ts
git commit -m "test(e2e): szkielet HMI v2 masowania (skip — kontrakt zachowania)"
```

---

## Task 8: Build, weryfikacja, deploy na :8080

**Files:** brak (deploy)

- [ ] **Step 1: Pełny typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Build produkcyjny (z zabezpieczeniem OOM/pipefail)**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed && set -o pipefail && VITE_API_URL= npm run build 2>&1 | tail -20 && ls dist/index.html dist/assets/main-*.js
```
Expected: „built in …", istnieją `dist/index.html` i `dist/assets/main-*.js`.

- [ ] **Step 3: Restart backendu (warstwa 2 — nowy endpoint) + deploy dist**

> Backend produkcyjny to KOPIE w `/opt/kebab/app/backend` (nie repo). Skopiuj zmienione pliki masowania i zrestartuj usługę; podmień dist (backup starego).

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed && \
cp backend/app/services/mixing_service.py /opt/kebab/app/backend/app/services/mixing_service.py && \
cp backend/app/routes/mixing.py /opt/kebab/app/backend/app/routes/mixing.py && \
systemctl restart kebab-mes && sleep 2 && curl -s 127.0.0.1:8010/api/health && \
TS=$(date +%Y%m%d-%H%M%S) && mv /opt/kebab/app/dist /opt/kebab/app/dist.bak-$TS && cp -r dist /opt/kebab/app/dist && \
echo "deployed (backup dist.bak-$TS)"
```
Expected: `true` z health + „deployed".

- [ ] **Step 4: Smoke nowego endpointu (404 vs 405)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X PATCH 127.0.0.1:8010/api/mixing-orders/__nope__/meat-lots -H 'Content-Type: application/json' -d '{"meat_lots":[]}'`
Expected: kod inny niż 404-routing (np. 404 „nie znalezione" z serwisu lub 400) — istotne, że trasa istnieje (nie „Not Found" z braku route). Potwierdź wizualnie w logach: `journalctl -u kebab-mes -n 30 --no-pager`.

- [ ] **Step 5: Weryfikacja wizualna na :8080**

Otwórz `http://204.168.166.34:8080` (twardy refresh / wyczyść cache), zaloguj operatora produkcji → Masownia (HMI v2). Sprawdź kryteria sukcesu ze spec:
1. Stan pusty pokazuje aktywne masownice z numerem zlecenia i odliczanym czasem.
2. Karta zlecenia pokazuje rozbicie `partia · kg`.
3. „Zmień partię" → lista FEFO, blokada przy braku kg, podmiana wiersza, maks kg = wolne kg.
4. (Warstwa 2) zaznaczenie „Zaktualizuj plan zlecenia" trwale podmienia partię (po podmianie i przejściu dalej plan zlecenia ma nową partię).

- [ ] **Step 6: Brak commita** (deploy nie zmienia repo). Jeśli coś poprawiałeś w kodzie podczas weryfikacji — commit zgodnie z zadaniem, którego dotyczy.

---

## Notatki / ryzyka

- **Rezerwacja planowanej partii przy podmianie (warstwa 1 bez warstwy 2):** `start` zarezerwował kg planowanej partii. Przy samej podmianie per-sesja (bez warstwy 2) rezerwacja na pierwotnej partii może wisieć do zamknięcia/anulowania zlecenia. Zweryfikuj na realnej bazie czy `finish-session`/`auto-approve` zwalnia rezerwację pierwotnej partii; jeśli nie — rozważ użycie warstwy 2 jako domyślnej przy podmianie. (Do potwierdzenia w Task 8 Step 5, nie blokuje funkcji.)
- **Materiał wymagany:** filtr `requiredMaterialTypeId` opiera się na materiale pierwszej planowanej partii odnalezionej w stanie. Gdy nie odnaleziono — picker pokazuje wszystkie dostępne (świadomy fallback).
- **Zakres:** wyłącznie HMI v2; v1/klasyczny bez zmian.
