import { describe, it, expect } from 'vitest'
import { splitEntriesByStatus, calcSessionSummary } from './index'

const base = {
  kgBones: 0, kgBacks: 0, workerId: 'w1', rawBatchId: 'b1', yieldPct: 70,
}

describe('splitEntriesByStatus', () => {
  it('rozdziela pending i complete', () => {
    const { pending, complete } = splitEntriesByStatus([
      { ...base, status: 'pending', kgTaken: 60, kgMeat: 0 },
      { ...base, status: 'complete', kgTaken: 100, kgMeat: 70 },
    ] as any)
    expect(pending).toHaveLength(1)
    expect(complete).toHaveLength(1)
    expect((pending[0] as any).kgTaken).toBe(60)
  })

  it('brak status traktuje jak complete', () => {
    const { complete } = splitEntriesByStatus([{ ...base, kgTaken: 100, kgMeat: 70 }] as any)
    expect(complete).toHaveLength(1)
  })
})

describe('calcSessionSummary pomija pending', () => {
  it('pending nie zanizaja wydajnosci ani liczby wpisow', () => {
    const s = calcSessionSummary([
      { ...base, status: 'complete', kgTaken: 100, kgMeat: 70 },
      { ...base, status: 'pending', kgTaken: 60, kgMeat: 0 },
    ] as any)
    expect(s.entryCount).toBe(1)
    expect(s.totalKgTaken).toBe(100)
    expect(Math.round(s.avgYieldPct)).toBe(70)
  })
})
