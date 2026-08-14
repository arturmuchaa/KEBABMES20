import { describe, it, expect } from 'vitest'
import { haccpReportNo } from './haccpReportNo'

describe('haccpReportNo', () => {
  it('numeruje karty po kolei, pomijając dni bez produkcji', () => {
    // 1.08.2026 sobota, 2.08 niedziela wolna, 3.08 poniedziałek
    const dni = ['2026-08-01', '2026-08-03', '2026-08-04']
    expect(haccpReportNo('2026-08-01', dni)).toBe('R/1/2026')
    expect(haccpReportNo('2026-08-03', dni)).toBe('R/2/2026')
    expect(haccpReportNo('2026-08-04', dni)).toBe('R/3/2026')
  })

  it('resetuje numerację z nowym miesiącem', () => {
    const dni = ['2026-07-30', '2026-07-31', '2026-08-03']
    expect(haccpReportNo('2026-07-31', dni)).toBe('R/2/2026')
    expect(haccpReportNo('2026-08-03', dni)).toBe('R/1/2026')
  })

  it('nie zależy od kolejności ani duplikatów na wejściu', () => {
    const dni = ['2026-08-04', '2026-08-01', '2026-08-03', '2026-08-01']
    expect(haccpReportNo('2026-08-03', dni)).toBe('R/2/2026')
  })

  it('numer nie zmienia się wstecz, gdy dojdą kolejne dni', () => {
    const przed = ['2026-08-01', '2026-08-03']
    const po = [...przed, '2026-08-04', '2026-08-05']
    expect(haccpReportNo('2026-08-03', przed)).toBe(haccpReportNo('2026-08-03', po))
  })

  it('dzień spoza listy dostaje kolejny numer po poprzednim produkcyjnym', () => {
    expect(haccpReportNo('2026-08-05', ['2026-08-01', '2026-08-03'])).toBe('R/3/2026')
  })

  it('pierwsza karta miesiąca to zawsze R/1', () => {
    expect(haccpReportNo('2026-08-17', ['2026-08-17'])).toBe('R/1/2026')
    expect(haccpReportNo('2026-02-28', [])).toBe('R/1/2026')
  })

  // Instrukcja 2.1 pkt 4.4a: „R/numer kolejny w miesiącu/rok" — rok pełny,
  // czterocyfrowy, bez miesiąca w numerze.
  it('rok jest pełny i bez miesiąca — format z instrukcji 2.1', () => {
    expect(haccpReportNo('2026-12-01', ['2026-12-01'])).toBe('R/1/2026')
    expect(haccpReportNo('2027-01-04', ['2027-01-04'])).toBe('R/1/2027')
  })
})
