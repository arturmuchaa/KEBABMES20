/**
 * Prognoza końca dnia musi liczyć CYKLEM RECEPTURY, nie zawsze pięćdziesiątką
 * (właściciel 18.09.2026: YAPRAK masuje się 30 minut). Inaczej dzień na
 * krótkich recepturach wygląda o godziny dłużej, niż jest naprawdę.
 */
import { describe, it, expect } from 'vitest'
import { etaDnia } from './components/DayBar'

const O_10 = new Date('2026-09-18T10:00:00').getTime()

describe('etaDnia', () => {
  it('bez podanego cyklu liczy standardowe 50 minut', () => {
    // 1000 kg to jedna runda na trzech maszynach (200+200+600).
    expect(etaDnia(1000, O_10)).toBe('10:50')
  })

  it('krótsza receptura kończy dzień wcześniej', () => {
    expect(etaDnia(1000, O_10, 30)).toBe('10:30')
  })

  it('dwie rundy to dwa cykle', () => {
    expect(etaDnia(1500, O_10, 30)).toBe('11:00')
  })

  it('nic do zrobienia = zrobione', () => {
    expect(etaDnia(0, O_10, 30)).toBe('Zrobione')
  })

  it('bezsensowny cykl nie psuje prognozy — wraca standard', () => {
    expect(etaDnia(1000, O_10, 0)).toBe('10:50')
  })
})
