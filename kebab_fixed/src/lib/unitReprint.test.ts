import { describe, it, expect } from 'vitest'
import { filterUnitsByIds, isScanned } from './unitReprint'

const units = [
  { id: 'a', status: 'planned' },
  { id: 'b', status: 'produced' },
  { id: 'c', status: 'packed' },
]

describe('filterUnitsByIds — podzbiór sztuk do dodruku', () => {
  it('zwraca tylko wskazane idy', () => {
    expect(filterUnitsByIds(units, ['b']).map(u => u.id)).toEqual(['b'])
  })
  it('kilka idów', () => {
    expect(filterUnitsByIds(units, ['a', 'c']).map(u => u.id)).toEqual(['a', 'c'])
  })
  it('pusta lista idów → wszystkie (brak filtra)', () => {
    expect(filterUnitsByIds(units, []).map(u => u.id)).toEqual(['a', 'b', 'c'])
  })
  it('nieistniejący id → puste', () => {
    expect(filterUnitsByIds(units, ['zzz'])).toEqual([])
  })
})

describe('isScanned — czy sztuka zeskanowana w produkcji', () => {
  it('planned → false (niezeskanowana)', () => {
    expect(isScanned('planned')).toBe(false)
  })
  it('produced/packed/shipped → true', () => {
    expect(isScanned('produced')).toBe(true)
    expect(isScanned('packed')).toBe(true)
    expect(isScanned('shipped')).toBe(true)
  })
  it('nieznany status → false', () => {
    expect(isScanned('whatever')).toBe(false)
  })
})
