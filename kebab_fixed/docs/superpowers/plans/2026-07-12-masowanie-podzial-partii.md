# Podział masowania na partie źródłowe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przy potwierdzaniu masowania w biurze rozbić wyrób zlecenia z ≥2 partiami mięsa na czyste partie (po numerze surowca) + jedną małą partię mieszaną „PP", zamiast lumpować wszystko w jedno PP.

**Architecture:** Tylko frontend. Nowa czysta, testowalna logika `mixingSplit.ts` (propozycja podziału + walidacja + budowa sekwencji sesji). Nowy dialog `ConfirmMixingSplitDialog.tsx` (edycja składu partii mieszanej). `MixingDayPlanEditor.confirmExecution` dla ≥2 partii otwiera dialog i wywołuje `finishSession` wielokrotnie (po jednej sesji na wynikową partię). Backend bez zmian — `finish_mixing_session` już akumuluje `kg_done` i nadaje numer partii z lotów danej sesji.

**Tech Stack:** React + TypeScript, Vite, vitest. shadcn `Dialog` z `@/components/ui/dialog`.

## Global Constraints

- Backend BEZ zmian. `mixingOrdersApi.finishSession(id, kg, batchNo, lotAllocations)` — `lotAllocations` to `[{ meatLotId: string; kg: number }]`; puste `[]` → backend dzieli proporcjonalnie (stare zachowanie).
- Numer partii nadaje backend: sesja z 1 partią → czysty numer surowca; z ≥2 → „PP…". Nie ustawiamy `batchNo` (przekazujemy `''`).
- Sesje trzeba wywoływać po kolei (await), mieszana OSTATNIA (domyka zlecenie gdy Σkg osiągnie `meat_kg`).
- Domyślny podział: resztka partii = `kgPlanned mod 200`; partia mieszana powstaje tylko gdy ≥2 partie mają resztkę > 0; inaczej resztka zostaje w partii czystej.
- Maszyny elastyczne (1×600 do ~640, 2×200 do ~230) — tolerancja sumy 0,5 kg; ostrzeżenie (nie blokada) gdy Σ mieszanej > 640 kg.
- Teksty PL, styl jak w repo. Spec: `docs/superpowers/specs/2026-07-12-masowanie-podzial-partii-design.md`.

---

## Task 1: Czysta logika `mixingSplit.ts` (propozycja + walidacja + sekwencja)

**Files:**
- Create: `src/features/products/lib/mixingSplit.ts`
- Test: `src/features/products/lib/mixingSplit.test.ts`

**Interfaces:**
- Produces (używane w Task 2 i 3):
  - `SplitLotInput { meatLotId: string; lotNo: string; kgPlanned: number }`
  - `MixingSplit { pure: SplitEntry[]; mixed: SplitEntry[] }` gdzie `SplitEntry { meatLotId: string; lotNo: string; kg: number }`
  - `FinishBatch { kg: number; lotAllocations: { meatLotId: string; kg: number }[] }`
  - `proposeMixingSplit(lots: SplitLotInput[]): MixingSplit`
  - `buildSplit(lots: SplitLotInput[], mixedByLot: Record<string, number>): MixingSplit` — buduje split z ręcznie podanych kg mieszanych per partia (używane przez dialog po edycji)
  - `validateMixingSplit(split: MixingSplit, lots: SplitLotInput[], meatKg: number): { ok: boolean; error?: string; warning?: string }`
  - `splitToBatches(split: MixingSplit): FinishBatch[]`

- [ ] **Step 1: Napisz plik testów (failing)**

Utwórz `src/features/products/lib/mixingSplit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  proposeMixingSplit, buildSplit, validateMixingSplit, splitToBatches,
  type SplitLotInput,
} from './mixingSplit'

const L = (meatLotId: string, lotNo: string, kgPlanned: number): SplitLotInput =>
  ({ meatLotId, lotNo, kgPlanned })

describe('proposeMixingSplit — domyślny podział mod 200', () => {
  it('2 partie 854/1346 → mieszana 54@408 + 146@409, czyste 800/1200', () => {
    const s = proposeMixingSplit([L('a', '408', 854), L('b', '409', 1346)])
    expect(s.mixed).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 54 },
      { meatLotId: 'b', lotNo: '409', kg: 146 },
    ])
    expect(s.pure).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 800 },
      { meatLotId: 'b', lotNo: '409', kg: 1200 },
    ])
  })

  it('partie podzielne przez 200 → brak mieszanej, same czyste', () => {
    const s = proposeMixingSplit([L('a', '408', 800), L('b', '409', 1200)])
    expect(s.mixed).toEqual([])
    expect(s.pure).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 800 },
      { meatLotId: 'b', lotNo: '409', kg: 1200 },
    ])
  })

  it('1 partia → jedna czysta, brak mieszanej', () => {
    const s = proposeMixingSplit([L('a', '408', 854)])
    expect(s.mixed).toEqual([])
    expect(s.pure).toEqual([{ meatLotId: 'a', lotNo: '408', kg: 854 }])
  })

  it('resztka tylko z jednej partii → zostaje w czystej (brak mieszanej)', () => {
    const s = proposeMixingSplit([L('a', '408', 854), L('b', '409', 1200)])
    expect(s.mixed).toEqual([])
    expect(s.pure).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 854 },
      { meatLotId: 'b', lotNo: '409', kg: 1200 },
    ])
  })

  it('3 partie z resztkami → mieszana z 3 składników', () => {
    const s = proposeMixingSplit([L('a', '1', 250), L('b', '2', 250), L('c', '3', 250)])
    expect(s.mixed).toEqual([
      { meatLotId: 'a', lotNo: '1', kg: 50 },
      { meatLotId: 'b', lotNo: '2', kg: 50 },
      { meatLotId: 'c', lotNo: '3', kg: 50 },
    ])
    expect(s.pure).toEqual([
      { meatLotId: 'a', lotNo: '1', kg: 200 },
      { meatLotId: 'b', lotNo: '2', kg: 200 },
      { meatLotId: 'c', lotNo: '3', kg: 200 },
    ])
  })
})

describe('buildSplit — z ręcznie podanych kg mieszanych', () => {
  it('biuro poprawia 146→154 → czyste przelicza się', () => {
    const lots = [L('a', '408', 854), L('b', '409', 1346)]
    const s = buildSplit(lots, { a: 54, b: 154 })
    expect(s.mixed).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 54 },
      { meatLotId: 'b', lotNo: '409', kg: 154 },
    ])
    expect(s.pure).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 800 },
      { meatLotId: 'b', lotNo: '409', kg: 1192 },
    ])
  })

  it('mieszana wyzerowana → same czyste (pełne kg)', () => {
    const lots = [L('a', '408', 854), L('b', '409', 1346)]
    const s = buildSplit(lots, { a: 0, b: 0 })
    expect(s.mixed).toEqual([])
    expect(s.pure).toEqual([
      { meatLotId: 'a', lotNo: '408', kg: 854 },
      { meatLotId: 'b', lotNo: '409', kg: 1346 },
    ])
  })
})

describe('validateMixingSplit', () => {
  const lots = [L('a', '408', 854), L('b', '409', 1346)]
  it('poprawny podział → ok', () => {
    const s = buildSplit(lots, { a: 54, b: 146 })
    expect(validateMixingSplit(s, lots, 2200)).toEqual({ ok: true })
  })
  it('mieszana z jednej partii → błąd (≥2)', () => {
    const s = buildSplit(lots, { a: 54, b: 0 })
    const v = validateMixingSplit(s, lots, 2200)
    expect(v.ok).toBe(false)
    expect(v.error).toMatch(/co najmniej 2 partie/i)
  })
  it('mieszana > kg partii → błąd', () => {
    const s = buildSplit(lots, { a: 900, b: 146 })
    expect(validateMixingSplit(s, lots, 2200).ok).toBe(false)
  })
  it('suma ≠ meatKg → błąd', () => {
    const s = buildSplit(lots, { a: 54, b: 146 })
    expect(validateMixingSplit(s, lots, 3000).ok).toBe(false)
  })
  it('Σ mieszanej > 640 → ostrzeżenie (nadal ok)', () => {
    const big = [L('a', '408', 900), L('b', '409', 900)]
    const s = buildSplit(big, { a: 350, b: 350 })
    const v = validateMixingSplit(s, big, 1800)
    expect(v.ok).toBe(true)
    expect(v.warning).toMatch(/640/)
  })
})

describe('splitToBatches — sekwencja finishSession (mieszana ostatnia)', () => {
  it('czyste najpierw, mieszana na końcu', () => {
    const s = buildSplit([L('a', '408', 854), L('b', '409', 1346)], { a: 54, b: 146 })
    expect(splitToBatches(s)).toEqual([
      { kg: 800, lotAllocations: [{ meatLotId: 'a', kg: 800 }] },
      { kg: 1200, lotAllocations: [{ meatLotId: 'b', kg: 1200 }] },
      { kg: 200, lotAllocations: [{ meatLotId: 'a', kg: 54 }, { meatLotId: 'b', kg: 146 }] },
    ])
  })
  it('brak mieszanej → same czyste', () => {
    const s = buildSplit([L('a', '408', 800), L('b', '409', 1200)], { a: 0, b: 0 })
    expect(splitToBatches(s)).toEqual([
      { kg: 800, lotAllocations: [{ meatLotId: 'a', kg: 800 }] },
      { kg: 1200, lotAllocations: [{ meatLotId: 'b', kg: 1200 }] },
    ])
  })
})
```

- [ ] **Step 2: Uruchom testy — potwierdź FAIL (moduł nie istnieje)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/features/products/lib/mixingSplit.test.ts`
Expected: FAIL — `Cannot find module './mixingSplit'`.

- [ ] **Step 3: Zaimplementuj `mixingSplit.ts`**

Utwórz `src/features/products/lib/mixingSplit.ts`:

```ts
/**
 * mixingSplit.ts — podział wyrobu masowania na partie źródłowe przy potwierdzaniu
 * bez HMI. Czyste funkcje (wejście/wyjście), testowalne bez UI.
 *
 * Zasada: operator robi pełne wsady z jednej partii, a niewypełnione resztki obu
 * partii łączy w JEDEN ostatni wsad → jedna partia mieszana „PP". Domyślna resztka
 * partii = kg mod 200 (600 to wielokrotność 200, więc układ wsadów nie zmienia
 * resztki). Partia mieszana powstaje tylko gdy ≥2 partie mają resztkę > 0.
 */
const LOAD = 200            // moduł wsadu (najmniejsza masownica)
const MAX_MIXED = 640       // największa masownica + zapas — próg ostrzeżenia
const EPS = 0.001

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface SplitLotInput { meatLotId: string; lotNo: string; kgPlanned: number }
export interface SplitEntry { meatLotId: string; lotNo: string; kg: number }
export interface MixingSplit { pure: SplitEntry[]; mixed: SplitEntry[] }
export interface FinishBatch {
  kg: number
  lotAllocations: { meatLotId: string; kg: number }[]
}

/** Domyślna propozycja: resztka = kg mod 200; mieszana tylko gdy ≥2 partie z resztką. */
export function proposeMixingSplit(lots: SplitLotInput[]): MixingSplit {
  const rem: Record<string, number> = {}
  for (const l of lots) rem[l.meatLotId] = r3(l.kgPlanned - Math.floor(l.kgPlanned / LOAD) * LOAD)
  const withRem = lots.filter(l => rem[l.meatLotId] > EPS)
  const mixedByLot: Record<string, number> = {}
  if (withRem.length >= 2) for (const l of withRem) mixedByLot[l.meatLotId] = rem[l.meatLotId]
  return buildSplit(lots, mixedByLot)
}

/** Buduje split z jawnie podanych kg mieszanych per partia (reszta = czysta). */
export function buildSplit(
  lots: SplitLotInput[], mixedByLot: Record<string, number>,
): MixingSplit {
  const mixed: SplitEntry[] = []
  const pure: SplitEntry[] = []
  for (const l of lots) {
    const m = r3(mixedByLot[l.meatLotId] || 0)
    if (m > EPS) mixed.push({ meatLotId: l.meatLotId, lotNo: l.lotNo, kg: m })
    const p = r3(l.kgPlanned - m)
    if (p > EPS) pure.push({ meatLotId: l.meatLotId, lotNo: l.lotNo, kg: p })
  }
  return { pure, mixed }
}

export function validateMixingSplit(
  split: MixingSplit, lots: SplitLotInput[], meatKg: number,
): { ok: boolean; error?: string; warning?: string } {
  const mixedByLot: Record<string, number> = {}
  for (const m of split.mixed) mixedByLot[m.meatLotId] = m.kg
  for (const l of lots) {
    const m = mixedByLot[l.meatLotId] || 0
    if (m < -EPS) return { ok: false, error: `Ujemne kg mieszane dla partii ${l.lotNo}.` }
    if (m > l.kgPlanned + 0.5)
      return { ok: false, error: `Partia ${l.lotNo}: mieszane ${m} kg > dostępne ${l.kgPlanned} kg.` }
  }
  if (split.mixed.length === 1)
    return { ok: false, error: 'Partia mieszana musi zawierać co najmniej 2 partie surowca (albo wyzeruj mieszane).' }
  const total = [...split.pure, ...split.mixed].reduce((s, e) => s + e.kg, 0)
  if (Math.abs(total - meatKg) > 0.5)
    return { ok: false, error: `Suma podziału (${r3(total)} kg) ≠ mięso zlecenia (${meatKg} kg).` }
  const mixedTotal = split.mixed.reduce((s, e) => s + e.kg, 0)
  if (mixedTotal > MAX_MIXED)
    return { ok: true, warning: `Partia mieszana ${r3(mixedTotal)} kg > ${MAX_MIXED} kg — to więcej niż jeden wsad.` }
  return { ok: true }
}

/** Sekwencja sesji dla finishSession: czyste najpierw, mieszana OSTATNIA (domyka zlecenie). */
export function splitToBatches(split: MixingSplit): FinishBatch[] {
  const batches: FinishBatch[] = split.pure.map(p => ({
    kg: p.kg, lotAllocations: [{ meatLotId: p.meatLotId, kg: p.kg }],
  }))
  if (split.mixed.length > 0) {
    batches.push({
      kg: r3(split.mixed.reduce((s, e) => s + e.kg, 0)),
      lotAllocations: split.mixed.map(m => ({ meatLotId: m.meatLotId, kg: m.kg })),
    })
  }
  return batches
}
```

- [ ] **Step 4: Uruchom testy — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/features/products/lib/mixingSplit.test.ts`
Expected: PASS (wszystkie).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/products/lib/mixingSplit.ts src/features/products/lib/mixingSplit.test.ts
git commit -m "feat: mixingSplit — podział masowania na partie źródłowe (propozycja mod 200 + walidacja + sekwencja sesji)"
```

---

## Task 2: Dialog `ConfirmMixingSplitDialog.tsx`

**Files:**
- Create: `src/features/products/components/ConfirmMixingSplitDialog.tsx`

**Interfaces:**
- Consumes z Task 1: `proposeMixingSplit`, `buildSplit`, `validateMixingSplit`, `splitToBatches`, typy `SplitLotInput`, `FinishBatch`.
- Produces (używane w Task 3):
  - `ConfirmMixingSplitDialog(props: { open: boolean; recipeName: string; meatKg: number; lots: SplitLotInput[]; loading: boolean; onCancel: () => void; onConfirm: (batches: FinishBatch[]) => void })`

- [ ] **Step 1: Zaimplementuj dialog**

Utwórz `src/features/products/components/ConfirmMixingSplitDialog.tsx`:

```tsx
/**
 * ConfirmMixingSplitDialog — potwierdzenie masowania z podziałem na partie źródłowe
 * (bez HMI). Biuro widzi proponowany podział (czyste per partia + jedna mieszana),
 * edytuje kg mieszane per partia; czyste przeliczają się automatycznie. Na potwierdzenie
 * zwraca sekwencję sesji do finishSession. Patrz spec 2026-07-12-masowanie-podzial-partii.
 */
import { useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtKg } from '@/lib/utils'
import {
  proposeMixingSplit, buildSplit, validateMixingSplit, splitToBatches,
  type SplitLotInput, type FinishBatch,
} from '../lib/mixingSplit'

export function ConfirmMixingSplitDialog({
  open, recipeName, meatKg, lots, loading, onCancel, onConfirm,
}: {
  open: boolean
  recipeName: string
  meatKg: number
  lots: SplitLotInput[]
  loading: boolean
  onCancel: () => void
  onConfirm: (batches: FinishBatch[]) => void
}) {
  // Startowa propozycja (mod 200) → mapa kg mieszanych per partia; edytowalna.
  const initialMixed = useMemo(() => {
    const p = proposeMixingSplit(lots)
    const m: Record<string, string> = {}
    for (const l of lots) m[l.meatLotId] = '0'
    for (const e of p.mixed) m[e.meatLotId] = String(e.kg)
    return m
  }, [lots])

  const [mixedStr, setMixedStr] = useState<Record<string, string>>(initialMixed)

  const split = useMemo(() => {
    const byLot: Record<string, number> = {}
    for (const l of lots) byLot[l.meatLotId] = parseFloat(mixedStr[l.meatLotId] || '0') || 0
    return buildSplit(lots, byLot)
  }, [lots, mixedStr])

  const v = useMemo(() => validateMixingSplit(split, lots, meatKg), [split, lots, meatKg])
  const batches = useMemo(() => splitToBatches(split), [split])

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !loading) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Potwierdź masowanie — {recipeName}</DialogTitle>
          <DialogDescription>
            Podział {fmtKg(meatKg, 0)} kg na partie. „Mieszane" = kg z danej partii, które
            trafiły do wspólnego ostatniego wsadu; reszta zostaje partią czystą. Mieszane
            tworzą JEDNĄ partię PP tylko gdy ≥2 partie mają kg &gt; 0.
          </DialogDescription>
        </DialogHeader>

        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-ink-4 text-[11px] uppercase">
              <th className="text-left py-1">Partia</th>
              <th className="text-right py-1">Dostępne</th>
              <th className="text-right py-1">Mieszane [kg]</th>
              <th className="text-right py-1">Czyste [kg]</th>
            </tr>
          </thead>
          <tbody>
            {lots.map(l => {
              const m = parseFloat(mixedStr[l.meatLotId] || '0') || 0
              const pure = Math.round((l.kgPlanned - m) * 1000) / 1000
              return (
                <tr key={l.meatLotId} className="border-t border-surface-3">
                  <td className="py-1 font-mono font-bold">{l.lotNo}</td>
                  <td className="py-1 text-right tabular-nums">{fmtKg(l.kgPlanned, 0)}</td>
                  <td className="py-1 text-right">
                    <Input type="number" min="0" step="1" value={mixedStr[l.meatLotId] ?? '0'}
                      disabled={loading}
                      onChange={e => setMixedStr(s => ({ ...s, [l.meatLotId]: e.target.value }))}
                      className="h-7 w-20 text-right text-[13px] tabular-nums inline-block [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </td>
                  <td className="py-1 text-right tabular-nums font-semibold">{fmtKg(pure, 0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="text-[12px] text-ink-3">
          Wynik: {batches.length} {batches.length === 1 ? 'partia' : 'partie'} —{' '}
          {split.pure.map(p => `${p.lotNo} (${fmtKg(p.kg, 0)})`).join(', ')}
          {split.mixed.length > 0 &&
            `, mieszana PP (${fmtKg(split.mixed.reduce((s, e) => s + e.kg, 0), 0)}: ` +
            split.mixed.map(m => `${fmtKg(m.kg, 0)}×${m.lotNo}`).join(' + ') + ')'}
        </div>

        {v.error && <div className="text-[12px] font-semibold text-red-600">{v.error}</div>}
        {v.warning && <div className="text-[12px] font-semibold text-amber-700">{v.warning}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>Anuluj</Button>
          <Button onClick={() => onConfirm(batches)} disabled={loading || !v.ok}>
            {loading ? 'Potwierdzam…' : 'Potwierdź i zapisz partie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów. (Jeśli `DialogDescription`/`DialogFooter` nie istnieją w `@/components/ui/dialog` — sprawdź eksporty pliku i użyj dostępnych; wzór użycia: `src/features/raw-batches/components/EditRawBatchModal.tsx`.)

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/products/components/ConfirmMixingSplitDialog.tsx
git commit -m "feat: ConfirmMixingSplitDialog — edycja podziału partii przy potwierdzaniu masowania"
```

---

## Task 3: Wpięcie w `MixingDayPlanEditor.confirmExecution`

**Files:**
- Modify: `src/features/products/components/MixingDayPlanEditor.tsx`

**Interfaces:**
- Consumes z Task 1/2: `ConfirmMixingSplitDialog`, typ `FinishBatch`, `SplitLotInput`.

- [ ] **Step 1: Dodaj importy**

W bloku importów `MixingDayPlanEditor.tsx` (po istniejących importach komponentów) dodaj:

```ts
import { ConfirmMixingSplitDialog } from './ConfirmMixingSplitDialog'
import type { FinishBatch, SplitLotInput } from '../lib/mixingSplit'
```

- [ ] **Step 2: Dodaj stan dialogu**

Zaraz po `const [confirmingKey, setConfirmingKey] = useState<string | null>(null)` dodaj:

```ts
  const [splitRow, setSplitRow] = useState<PlanRowData | null>(null)
```

- [ ] **Step 3: Zmień `confirmExecution` — dla ≥2 partii otwórz dialog**

Zamień całą funkcję `confirmExecution` (obecnie kończy się na `finally { setConfirmingKey(null) }`) na:

```ts
  async function confirmExecution(row: PlanRowData) {
    if (!row.id || !isToday) return
    const kg = parseFloat(row.meatKg) || 0
    const lotsWithKg = row.lots.filter(l => (l.kgPlanned || 0) > 0)
    // ≥2 partie → dialog podziału (czyste per partia + jedna mieszana PP).
    if (lotsWithKg.length >= 2) {
      setSplitRow(row)
      return
    }
    // 0/1 partia → jak dotąd: jedno potwierdzenie całości (backend nada czysty numer).
    if (!window.confirm(
      `Potwierdzić wykonanie: ${recipes.find((r: any) => r.id === row.recipeId)?.name ?? ''} — ${fmtKg(kg, 0)} kg mięsa?\n\nMięso przyprawione wejdzie na magazyn, partie mięsa i przyprawy zostaną rozchodowane. Tej operacji nie da się cofnąć z tego ekranu.`
    )) return
    setConfirmingKey(row.rowKey)
    try {
      await mixingOrdersApi.finishSession(row.id, kg, '', [])
      await load()
      toast.success('Wykonanie potwierdzone — mięso przyprawione trafiło na magazyn')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd potwierdzenia wykonania')
    } finally {
      setConfirmingKey(null)
    }
  }

  // Potwierdzenie z podziałem: sekwencja finishSession (mieszana ostatnia domyka zlecenie).
  async function runSplitConfirm(row: PlanRowData, batches: FinishBatch[]) {
    setConfirmingKey(row.rowKey)
    try {
      for (const b of batches) {
        await mixingOrdersApi.finishSession(row.id!, b.kg, '', b.lotAllocations)
      }
      toast.success('Potwierdzone — partie zapisane (czyste + ewentualna mieszana PP)')
      setSplitRow(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd — zlecenie mogło zostać potwierdzone częściowo')
      await load()
    } finally {
      setConfirmingKey(null)
    }
  }
```

- [ ] **Step 4: Wyrenderuj dialog**

Znajdź główny `return (` komponentu i tuż po otwierającym kontenerze (pierwszy element JSX, np. `<div className="grid ...">`) dodaj render dialogu warunkowo — najprościej na końcu drzewa, przed zamknięciem najbardziej zewnętrznego kontenera. Wstaw przed ostatnim `</div>` zwracanego drzewa:

```tsx
      {splitRow && (
        <ConfirmMixingSplitDialog
          open
          recipeName={recipes.find((r: any) => r.id === splitRow.recipeId)?.name ?? ''}
          meatKg={parseFloat(splitRow.meatKg) || 0}
          lots={splitRow.lots
            .filter(l => (l.kgPlanned || 0) > 0)
            .map((l): SplitLotInput => ({
              meatLotId: l.meatLotId,
              lotNo: l.lotNo ?? '?',
              kgPlanned: l.kgPlanned || 0,
            }))}
          loading={confirmingKey === splitRow.rowKey}
          onCancel={() => { if (confirmingKey !== splitRow.rowKey) setSplitRow(null) }}
          onConfirm={batches => runSplitConfirm(splitRow, batches)}
        />
      )}
```

- [ ] **Step 5: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów. (Jeśli `SelLot` nie ma pola `lotNo` — Task poprzednie już je dodało; potwierdź że `src/features/products/components/MeatLotPicker.tsx` ma `lotNo?: string` w `SelLot`.)

- [ ] **Step 6: Pełny zestaw testów**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npm test`
Expected: PASS (w tym `mixingSplit.test.ts`).

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/products/components/MixingDayPlanEditor.tsx
git commit -m "feat: potwierdzanie masowania — dialog podziału na partie dla zleceń z ≥2 partiami"
```

---

## Task 4: Weryfikacja wizualna (dev + Playwright, na realnym planie 12.07)

**Files:** brak zmian — weryfikacja.

Środowisko: dev frontend proxy → prod backend `127.0.0.1:8010`. **Nie potwierdzaj** realnego masowania (to nieodwracalne rozchodowanie mięsa) — weryfikuj tylko, że dialog się otwiera i liczy podział poprawnie; NIE klikaj „Potwierdź i zapisz partie" na produkcji bez zgody użytkownika.

- [ ] **Step 1: Ustaw proxy na prod backend i odpal dev**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
sed -i "s#target: process.env.VITE_API_URL || 'http://localhost:8000'#target: process.env.VITE_API_URL || 'http://127.0.0.1:8010'#" vite.config.ts
npm run dev -- --port 5183
```
(uruchom w tle; poczekaj aż port 5183 nasłuchuje)

- [ ] **Step 2: Zaloguj i otwórz planowanie**

Playwright: `browser_navigate` na `http://localhost:5183/login`, zaloguj (login `am`, hasło poda użytkownik jeśli sesja wygasła), potem `http://localhost:5183/office/planowanie-masowania`. Plan na 12.07 ma BEYAZ HALAL (2 partie 408+409).

- [ ] **Step 3: Otwórz dialog na BEYAZ HALAL i sprawdź podział**

Kliknij „Potwierdź" na wierszu BEYAZ HALAL (status w kolejce). Dialog powinien pokazać:
- 408: dostępne 854, mieszane 54, czyste 800
- 409: dostępne 1346, mieszane 146, czyste 1200
- wynik: „408 (800), 409 (1200), mieszana PP (200: 54×408 + 146×409)"
Zmień mieszane 409 na 154 → czyste 409 = 1192, mieszana PP 208. Brak błędu walidacji.
Zrób `browser_take_screenshot`. **Kliknij Anuluj** (NIE potwierdzaj na produkcji).

- [ ] **Step 4: Sprzątanie**

```bash
pkill -f "vite --port 5183"
cd /opt/kebab/kebab_new/kebab_fixed && git checkout -- vite.config.ts
rm -f vite.config.ts.timestamp-*.mjs
```
`browser_close`. Jeśli Step 3 pokazał złe liczby → wróć do Task 1/2/3.
