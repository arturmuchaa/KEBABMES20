/**
 * Czysta arytmetyka szkicu planu: zapotrzebowanie per receptura i wiersze
 * panelu partii. Wyjęte z `PlanForm`, żeby dało się to sprawdzić bez DOM-u —
 * to na tych dwóch rachunkach opiera się cała odpowiedź „czy starczy mięsa".
 */
import { describe, it, expect } from 'vitest'
import {
  demandByRecipe, usedLinesByBatch, buildBatchRows,
  type SeasonedLite,
} from './planDraftMath'
import { emptyPlanLine, type PlanLine } from './planLineModel'
import type { PlanAllocation } from './planMeatAllocation'

const linia = (over: Partial<PlanLine> = {}): PlanLine => ({ ...emptyPlanLine(), ...over })

const RECEPTURY = [
  { id: 'r1', name: 'WROCŁAW' },
  { id: 'r2', name: 'BULLI' },
  // Kebab komponentowy 70/30 — partie dobiera backend per komponent.
  { id: 'r7', name: '70/30', components: [{ materialTypeId: 'm1', materialName: 'Udo', pct: 70 }] },
]

describe('demandByRecipe', () => {
  it('sumuje kilogramy pozycji per receptura', () => {
    const d = demandByRecipe(
      [linia({ recipeId: 'r1', qty: '20', kgPerUnit: '35' }),
       linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10' })],
      RECEPTURY,
    )
    expect(d.r1).toEqual({ name: 'WROCŁAW', kg: 800 })
  })

  it('liczy pozycje BEZ przypisanych partii — saldo schodzi już przy wpisaniu', () => {
    const d = demandByRecipe([linia({ recipeId: 'r2', qty: '5', kgPerUnit: '20' })], RECEPTURY)
    expect(d.r2.kg).toBe(100)
  })

  it('receptury komponentowej NIE liczy — jej partie dobiera backend', () => {
    const d = demandByRecipe([linia({ recipeId: 'r7', qty: '10', kgPerUnit: '10' })], RECEPTURY)
    expect(d.r7).toBeUndefined()
  })

  it('pozycja bez receptury albo bez kilogramów nie wchodzi', () => {
    const d = demandByRecipe(
      [linia({ recipeId: '', qty: '5', kgPerUnit: '20' }),
       linia({ recipeId: 'r1', qty: '0', kgPerUnit: '20' })],
      RECEPTURY,
    )
    expect(Object.keys(d)).toEqual([])
  })

  it('usunięcie pozycji oddaje kilogramy', () => {
    const przed = demandByRecipe([linia({ recipeId: 'r1', qty: '20', kgPerUnit: '35' })], RECEPTURY)
    const po = demandByRecipe([], RECEPTURY)
    expect(przed.r1.kg).toBe(700)
    expect(po.r1).toBeUndefined()
  })
})

const ALLOC: PlanAllocation = {
  lines: [
    { qty: 20, neededKg: 700, pieces: 20, allocatedKg: 700, missingPieces: 0, missingKg: 0,
      hasBatches: true, ok: true, perBatch: [{ batchId: 'b1', batchNo: '495', pieces: 20, kg: 700 }], joined: [] },
    { qty: 10, neededKg: 100, pieces: 10, allocatedKg: 100, missingPieces: 0, missingKg: 0,
      hasBatches: true, ok: true, perBatch: [{ batchId: 'b2', batchNo: '496', pieces: 10, kg: 100 }], joined: [] },
    { qty: 5, neededKg: 50, pieces: 5, allocatedKg: 50, missingPieces: 0, missingKg: 0,
      hasBatches: true, ok: true, perBatch: [{ batchId: 'b1', batchNo: '495', pieces: 5, kg: 50 }], joined: [] },
  ],
  freeByBatch: { b1: 100, b2: 800 },
  usedByBatch: { b1: 750, b2: 100 },
}

describe('usedLinesByBatch', () => {
  it('mówi, które pozycje biorą z danej partii — numery od 1', () => {
    expect(usedLinesByBatch(ALLOC)).toEqual({ b1: [1, 3], b2: [2] })
  })

  it('sztuki z resztek też liczą się jako użycie partii', () => {
    const zJoined: PlanAllocation = {
      ...ALLOC,
      lines: [{ ...ALLOC.lines[0], perBatch: [],
        joined: [{ label: '495/496', pieces: 1, parts: [{ batchId: 'b9', batchNo: '499', kg: 20 }] }] }],
    }
    expect(usedLinesByBatch(zJoined)).toEqual({ b9: [1] })
  })

  it('partia nietknięta nie ma wpisu', () => {
    expect(usedLinesByBatch(ALLOC).b3).toBeUndefined()
  })
})

const PARTIE: SeasonedLite[] = [
  { id: 'b1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '495', productionDay: '2026-08-22', kgFree: 850 },
  { id: 'b2', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '496', productionDay: '2026-08-22', kgFree: 900 },
  { id: 'b3', recipeId: 'r2', recipeName: 'BULLI',   batchNo: '496', productionDay: '2026-08-22', kgFree: 1220 },
]

describe('buildBatchRows', () => {
  it('pokazuje wolne kg PO przydziale bieżącego szkicu, nie surowe', () => {
    const rows = buildBatchRows(PARTIE, ALLOC)
    expect(rows.find(r => r.id === 'b1')!.kgFreeLive).toBe(100)
  })

  it('partia bez wpisu w alokacji zachowuje swoje wolne kg', () => {
    const rows = buildBatchRows(PARTIE, ALLOC)
    expect(rows.find(r => r.id === 'b3')!.kgFreeLive).toBe(1220)
  })

  it('niesie numery pozycji, które z partii biorą', () => {
    const rows = buildBatchRows(PARTIE, ALLOC)
    expect(rows.find(r => r.id === 'b1')!.usedByLines).toEqual([1, 3])
    expect(rows.find(r => r.id === 'b3')!.usedByLines).toEqual([])
  })

  it('zachowuje kolejność wejściową — API oddaje ją po terminie (FEFO)', () => {
    expect(buildBatchRows(PARTIE, ALLOC).map(r => r.id)).toEqual(['b1', 'b2', 'b3'])
  })
})
