/**
 * getProductionDate — dzień produkcyjny musi być liczony w strefie LOKALNEJ
 * kiosku (Europe/Warsaw), nie w UTC.
 *
 * Audyt 2026-07-22: implementacja przez toISOString() (UTC) dawała między
 * 00:00 a 01:59 czasu PL (lato, UTC+2) dzień o JEDEN ZA WCZEŚNIE — np.
 * 22.07 01:30 PL → „przedwczoraj" 20.07 zamiast 21.07. Kafelki pracowników
 * (takenOnProductionDay) grupowały wtedy wpisy w złym dniu.
 *
 * TZ ustawiamy per test — globalny runner chodzi z TZ=UTC (package.json),
 * gdzie stara implementacja przypadkiem działała.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { getProductionDate } from './index'

const ORIG_TZ = process.env.TZ

afterAll(() => { process.env.TZ = ORIG_TZ })

describe('getProductionDate — strefa lokalna kiosku', () => {
  it('01:30 czasu PL (lato) należy do POPRZEDNIEGO dnia lokalnego', () => {
    process.env.TZ = 'Europe/Warsaw'
    // 2026-07-22T01:30 lokalnie (UTC+2) = 2026-07-21T23:30Z
    const d = new Date(2026, 6, 22, 1, 30)
    expect(getProductionDate(d)).toBe('2026-07-21')
  })

  it('05:00 czasu PL to bieżący dzień lokalny', () => {
    process.env.TZ = 'Europe/Warsaw'
    const d = new Date(2026, 6, 22, 5, 0)
    expect(getProductionDate(d)).toBe('2026-07-22')
  })

  it('23:30 czasu PL zostaje w bieżącym dniu lokalnym', () => {
    process.env.TZ = 'Europe/Warsaw'
    const d = new Date(2026, 6, 22, 23, 30)
    expect(getProductionDate(d)).toBe('2026-07-22')
  })
})
