/**
 * Testy czystej logiki FEFO / HACCP (fefo.ts).
 *
 * Data "dziś" jest przypięta przez fake timers, a TZ=UTC ustawia skrypt `test`,
 * więc obliczenia dni do wygaśnięcia są deterministyczne na każdej maszynie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  sortFefo,
  getExpiryStatus,
  checkUsability,
  deriveRawBatchStatus,
  isExpired,
  isActiveForProduction,
  isHighPriority,
  type FefoSortable,
} from './fefo'

const TODAY = '2026-06-16T12:00:00Z'

function lot(over: Partial<FefoSortable>): FefoSortable {
  return { expiryDate: '2026-07-01', internalBatchSeq: 0, createdAt: '2026-06-01T00:00:00Z', ...over }
}

describe('sortFefo', () => {
  it('sortuje rosnąco po expiryDate (najwcześniej wygasająca pierwsza)', () => {
    const out = sortFefo([
      lot({ expiryDate: '2026-07-10' }),
      lot({ expiryDate: '2026-07-01' }),
      lot({ expiryDate: '2026-07-05' }),
    ])
    expect(out.map(l => l.expiryDate)).toEqual(['2026-07-01', '2026-07-05', '2026-07-10'])
  })

  it('przy tej samej dacie rozstrzyga internalBatchSeq (mniejszy pierwszy)', () => {
    const out = sortFefo([
      lot({ expiryDate: '2026-07-01', internalBatchSeq: 5 }),
      lot({ expiryDate: '2026-07-01', internalBatchSeq: 2 }),
    ])
    expect(out.map(l => l.internalBatchSeq)).toEqual([2, 5])
  })

  it('przy tej samej dacie i seq rozstrzyga createdAt (wcześniejszy pierwszy)', () => {
    const out = sortFefo([
      lot({ internalBatchSeq: 1, createdAt: '2026-06-05T00:00:00Z' }),
      lot({ internalBatchSeq: 1, createdAt: '2026-06-01T00:00:00Z' }),
    ])
    expect(out.map(l => l.createdAt)).toEqual(['2026-06-01T00:00:00Z', '2026-06-05T00:00:00Z'])
  })

  it('nie mutuje oryginalnej tablicy', () => {
    const input = [lot({ expiryDate: '2026-07-10' }), lot({ expiryDate: '2026-07-01' })]
    const snapshot = input.map(l => l.expiryDate)
    sortFefo(input)
    expect(input.map(l => l.expiryDate)).toEqual(snapshot)
  })
})

describe('getExpiryStatus (HACCP)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(TODAY)) })
  afterEach(() => { vi.useRealTimers() })

  it('wczoraj → EXPIRED, zablokowana, daysLeft < 0', () => {
    const s = getExpiryStatus('2026-06-15')
    expect(s.level).toBe('EXPIRED')
    expect(s.blocked).toBe(true)
    expect(s.daysLeft).toBe(-1)
  })

  it('dziś → CRITICAL, daysLeft 0, NIE zablokowana', () => {
    const s = getExpiryStatus('2026-06-16')
    expect(s.level).toBe('CRITICAL')
    expect(s.daysLeft).toBe(0)
    expect(s.blocked).toBe(false)
  })

  it('jutro (granica CRITICAL=1) → CRITICAL', () => {
    expect(getExpiryStatus('2026-06-17').level).toBe('CRITICAL')
  })

  it('za 3 dni (granica WARNING=3) → WARNING', () => {
    expect(getExpiryStatus('2026-06-19').level).toBe('WARNING')
  })

  it('za 4 dni → OK', () => {
    const s = getExpiryStatus('2026-06-20')
    expect(s.level).toBe('OK')
    expect(s.daysLeft).toBe(4)
  })
})

describe('checkUsability — hierarchia blokad', () => {
  it('EXPIRED wygrywa nad wszystkim → usable false, expired', () => {
    const r = checkUsability({ level: 'EXPIRED', daysLeft: -2, blocked: true }, { inQuarantine: true, kgAvailable: 0 })
    expect(r).toEqual({ usable: false, reason: 'expired' })
  })

  it('kwarantanna blokuje partię nie-przeterminowaną', () => {
    const r = checkUsability({ level: 'OK', daysLeft: 10, blocked: false }, { inQuarantine: true })
    expect(r).toEqual({ usable: false, reason: 'quarantine' })
  })

  it('brak kg (≤0) → depleted', () => {
    const r = checkUsability({ level: 'OK', daysLeft: 10, blocked: false }, { kgAvailable: 0 })
    expect(r).toEqual({ usable: false, reason: 'depleted' })
  })

  it('WARNING/CRITICAL → usable true, ale z reason low_expiry (ostrzeżenie, nie blokada)', () => {
    const r = checkUsability({ level: 'WARNING', daysLeft: 2, blocked: false }, { kgAvailable: 100 })
    expect(r).toEqual({ usable: true, reason: 'low_expiry' })
  })

  it('OK z dostępnymi kg → usable true, bez reason', () => {
    const r = checkUsability({ level: 'OK', daysLeft: 10, blocked: false }, { kgAvailable: 100 })
    expect(r).toEqual({ usable: true })
  })
})

describe('deriveRawBatchStatus', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(TODAY)) })
  afterEach(() => { vi.useRealTimers() })

  it('kg ≤ 0 → used (niezależnie od daty)', () => {
    expect(deriveRawBatchStatus('2026-12-31', 0)).toBe('used')
  })

  it('przeterminowana z kg → expired', () => {
    expect(deriveRawBatchStatus('2026-06-10', 50)).toBe('expired')
  })

  it('wygasa wkrótce → low_expiry', () => {
    expect(deriveRawBatchStatus('2026-06-18', 50)).toBe('low_expiry')
  })

  it('świeża z kg → active', () => {
    expect(deriveRawBatchStatus('2026-12-31', 50)).toBe('active')
  })
})

describe('twarde guardy HACCP', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(TODAY)) })
  afterEach(() => { vi.useRealTimers() })

  it('isExpired true tylko po terminie', () => {
    expect(isExpired('2026-06-15')).toBe(true)
    expect(isExpired('2026-06-16')).toBe(false)
  })

  it('isActiveForProduction: false gdy brak kg lub przeterminowana', () => {
    expect(isActiveForProduction('2026-12-31', 0)).toBe(false)
    expect(isActiveForProduction('2026-06-10', 50)).toBe(false)
    expect(isActiveForProduction('2026-12-31', 50)).toBe(true)
  })

  it('isHighPriority: true dla dziś/jutro, false po terminie i dla odległych', () => {
    expect(isHighPriority('2026-06-16')).toBe(true)
    expect(isHighPriority('2026-06-17')).toBe(true)
    expect(isHighPriority('2026-06-15')).toBe(false)
    expect(isHighPriority('2026-07-01')).toBe(false)
  })
})
