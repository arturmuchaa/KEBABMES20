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
