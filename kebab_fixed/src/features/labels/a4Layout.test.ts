import { describe, it, expect } from 'vitest'
import { groupA4Units } from './a4Layout'
import type { FinishedUnitCard } from '@/lib/api'

const units = [{ id: 'u1' }, { id: 'u2' }] as FinishedUnitCard[]
describe('original A4 sheet and slot identity', () => {
  it('preserves default legacy grouping without changing inputs', () => {
    expect(groupA4Units(units, 2)).toEqual([[{ unit: units[0], slot: 0 }, { unit: units[1], slot: 1 }]])
  })
  it('supports sparse historical sheets without allocating empty pages', () => {
    expect(groupA4Units(units, 2, [{ sheet: 500000, slot: 1 }, { sheet: 2, slot: 0 }]))
      .toEqual([[{ unit: units[1], slot: 0 }], [{ unit: units[0], slot: 1 }]])
  })
  it.each([
    [], [{ sheet: 0, slot: 1 }, { sheet: 0, slot: 1 }],
    [{ sheet: 0, slot: 2 }, { sheet: 1, slot: 0 }],
    [{ sheet: -1, slot: 0 }, { sheet: 1, slot: 0 }],
  ].map(placements => ({ placements })))('rejects malformed placements rather than guessing new slots: %j', ({ placements }) => {
    expect(() => groupA4Units(units, 2, placements)).toThrow()
  })
})
