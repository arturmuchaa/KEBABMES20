/**
 * Testy doboru zastępczej partii mięsa (batchCandidates.ts).
 * Czysta logika — bez DOM, bez sieci.
 */
import { describe, it, expect } from 'vitest'
import { buildBatchCandidates, type RawMeatStock } from './batchCandidates'

function stock(over: Partial<RawMeatStock>): RawMeatStock {
  return {
    id: 'ms1', lotNo: 'LOT-1', rawBatchNo: 'P-1', materialTypeId: 'mat-A',
    materialName: 'Łopatka', kgAvailable: 100, kgReserved: 0,
    expiryDate: '2026-07-01', expiryStatus: 'OK', status: 'AVAILABLE', ...over,
  }
}

describe('buildBatchCandidates', () => {
  it('mapuje pola na BatchCandidate', () => {
    const [c] = buildBatchCandidates([stock({ id: 'X', lotNo: 'L9', rawBatchNo: 'P9', materialName: 'Karkówka', kgAvailable: 42 })])
    expect(c).toMatchObject({
      meatStockId: 'X', lotNo: 'L9', rawBatchNo: 'P9', materialName: 'Karkówka', kgFree: 42,
    })
  })

  it('REGRESJA: kgFree = kgAvailable (już netto = kg_free), NIE odejmuje kgReserved drugi raz', () => {
    // kgAvailable z mapMeatStock pochodzi z kg_free (= available - reserved).
    // Gdyby kod odjął kgReserved ponownie, kgFree=70 zamiast 100 → błędna blokada.
    const [c] = buildBatchCandidates([stock({ kgAvailable: 100, kgReserved: 30 })])
    expect(c.kgFree).toBe(100)
  })

  it('akceptuje kgAvailable jako string (deserializacja JSON)', () => {
    const [c] = buildBatchCandidates([stock({ kgAvailable: '55.5' as any })])
    expect(c.kgFree).toBeCloseTo(55.5)
  })

  it('odrzuca partie DEPLETED', () => {
    const out = buildBatchCandidates([stock({ id: 'a', status: 'DEPLETED' }), stock({ id: 'b' })])
    expect(out.map(c => c.meatStockId)).toEqual(['b'])
  })

  it('odrzuca partie bez wolnych kg (≤ 0.01)', () => {
    const out = buildBatchCandidates([stock({ id: 'a', kgAvailable: 0 }), stock({ id: 'b', kgAvailable: 0.005 }), stock({ id: 'c', kgAvailable: 5 })])
    expect(out.map(c => c.meatStockId)).toEqual(['c'])
  })

  it('pomija partie z excludeStockIds', () => {
    const out = buildBatchCandidates(
      [stock({ id: 'a' }), stock({ id: 'b' }), stock({ id: 'c' })],
      null,
      ['b'],
    )
    expect(out.map(c => c.meatStockId)).toEqual(['a', 'c'])
  })

  it('zawęża do materialTypeId gdy podany', () => {
    const out = buildBatchCandidates(
      [stock({ id: 'a', materialTypeId: 'mat-A' }), stock({ id: 'b', materialTypeId: 'mat-B' })],
      'mat-A',
    )
    expect(out.map(c => c.meatStockId)).toEqual(['a'])
  })

  it('bez materialTypeId (null) nie filtruje po materiale', () => {
    const out = buildBatchCandidates(
      [stock({ id: 'a', materialTypeId: 'mat-A' }), stock({ id: 'b', materialTypeId: 'mat-B' })],
      null,
    )
    expect(out.map(c => c.meatStockId).sort()).toEqual(['a', 'b'])
  })

  it('sortuje FEFO — najwcześniejszy termin pierwszy', () => {
    const out = buildBatchCandidates([
      stock({ id: 'late', expiryDate: '2026-08-01' }),
      stock({ id: 'soon', expiryDate: '2026-06-20' }),
      stock({ id: 'mid', expiryDate: '2026-07-10' }),
    ])
    expect(out.map(c => c.meatStockId)).toEqual(['soon', 'mid', 'late'])
  })

  it('puste / undefined wejście → []', () => {
    expect(buildBatchCandidates([])).toEqual([])
    expect(buildBatchCandidates(undefined as any)).toEqual([])
  })

  it('pomija pozycje bez id', () => {
    const out = buildBatchCandidates([stock({ id: undefined }), stock({ id: 'ok' })])
    expect(out.map(c => c.meatStockId)).toEqual(['ok'])
  })
})
