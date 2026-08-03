import { describe, it, expect } from 'vitest'
import { sanitaryCards, temperatureCards, sanitaryCardNo } from './haccpCardHistory'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('sanitaryCards', () => {
  it('idzie dzień po dniu wstecz, najnowsza karta pierwsza', () => {
    const rows = sanitaryCards(4, d('2026-08-03'))
    expect(rows.map(r => r.day)).toEqual(['2026-08-03', '2026-08-02', '2026-08-01', '2026-07-31'])
    expect(rows[0].current).toBe(true)
    expect(rows[1].current).toBeFalsy()
  })

  it('numeruje kartę datą, jak wydruk (D/MM/RR)', () => {
    expect(sanitaryCardNo(d('2026-07-01'))).toBe('1/07/26')
    expect(sanitaryCardNo(d('2026-12-31'))).toBe('31/12/26')
    expect(sanitaryCards(1, d('2026-08-03'))[0].no).toBe('3/08/26')
  })

  it('przechodzi przez granicę miesiąca bez gubienia dni', () => {
    const rows = sanitaryCards(3, d('2026-03-01'))
    expect(rows.map(r => r.day)).toEqual(['2026-03-01', '2026-02-28', '2026-02-27'])
  })
})

describe('temperatureCards', () => {
  it('idzie tydzień po tygodniu wstecz i numeruje jak wydruk', () => {
    const rows = temperatureCards(3, d('2026-08-05')) // środa
    expect(rows.map(r => r.no)).toEqual(['02/08/2026', '01/08/2026', '04/07/2026'])
    // dzień w wierszu to zawsze poniedziałek — z niego budujemy URL wydruku
    expect(rows.map(r => r.day)).toEqual(['2026-08-03', '2026-07-27', '2026-07-20'])
  })

  it('opisuje okres zakresem pon–ndz', () => {
    const [biezaca] = temperatureCards(1, d('2026-08-01')) // sobota
    expect(biezaca.no).toBe('01/08/2026')
    expect(biezaca.when).toBe('27.07 – 02.08.2026')
    expect(biezaca.day).toBe('2026-07-27')
    expect(biezaca.current).toBe(true)
  })

  it('każdy dzień tygodnia trafia w tę samą kartę', () => {
    const dni = ['2026-07-27', '2026-07-30', '2026-08-01', '2026-08-02']
    const karty = dni.map(x => temperatureCards(1, d(x))[0])
    for (const k of karty) {
      expect(k.no).toBe('01/08/2026')
      expect(k.day).toBe('2026-07-27')
    }
  })
})
