import { describe, it, expect } from 'vitest'
import {
  sanitaryCards, temperatureCards, sanitaryCardNo, receptionCards, receptionCardNo,
} from './haccpCardHistory'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('sanitaryCards', () => {
  it('idzie dzień po dniu wstecz, najnowsza karta pierwsza', () => {
    const rows = sanitaryCards(4, d('2026-08-03'))
    // 2026-08-02 to niedziela — pominięta, zakład nie pracuje
    expect(rows.map(r => r.day)).toEqual(['2026-08-03', '2026-08-01', '2026-07-31', '2026-07-30'])
    expect(rows[0].current).toBe(true)
    expect(rows[1].current).toBeFalsy()
  })

  it('numeruje karty PORZĄDKOWO, bez dziur po niedzielach', () => {
    // 1.08.2026 sobota → 1, 2.08 niedziela wolna, 3.08 poniedziałek → 2
    expect(sanitaryCardNo(d('2026-08-01'))).toBe('1/08/26')
    expect(sanitaryCardNo(d('2026-08-03'))).toBe('2/08/26')
    expect(sanitaryCardNo(d('2026-08-04'))).toBe('3/08/26')
    expect(sanitaryCardNo(d('2026-08-05'))).toBe('4/08/26')
    expect(sanitaryCards(1, d('2026-08-03'))[0].no).toBe('2/08/26')
  })

  it('resetuje numerację z nowym miesiącem', () => {
    expect(sanitaryCardNo(d('2026-07-31'))).toBe('27/07/26') // 31 dni − 4 niedziele
    expect(sanitaryCardNo(d('2026-08-01'))).toBe('1/08/26')
  })

  it('pierwszy dzień roboczy miesiąca to zawsze nr 1', () => {
    expect(sanitaryCardNo(d('2026-07-01'))).toBe('1/07/26') // środa
    expect(sanitaryCardNo(d('2026-03-02'))).toBe('1/03/26') // 1.03 to niedziela
  })

  it('numery idą bez dziur przez cały miesiąc', () => {
    const numery = sanitaryCards(20, d('2026-08-31')).map(r => Number(r.no.split('/')[0]))
    expect(numery).toEqual([...numery].sort((a, b) => b - a))          // malejąco
    expect(new Set(numery).size).toBe(numery.length)                    // bez duplikatów
    expect(numery[0] - numery[numery.length - 1]).toBe(numery.length - 1) // bez dziur
  })

  it('przechodzi przez granicę miesiąca bez gubienia dni', () => {
    // 2026-03-01 to niedziela → lista startuje od soboty 28.02
    const rows = sanitaryCards(3, d('2026-03-01'))
    expect(rows.map(r => r.day)).toEqual(['2026-02-28', '2026-02-27', '2026-02-26'])
  })

  it('pomija WYŁĄCZNIE niedziele — soboty są dniem produkcyjnym', () => {
    const rows = sanitaryCards(12, d('2026-08-05'))
    const dni = rows.map(r => new Date(`${r.day}T00:00:00`).getDay())
    expect(dni).not.toContain(0)          // żadnej niedzieli
    expect(dni).toContain(6)              // sobota zostaje
    expect(rows).toHaveLength(12)         // liczba kart bez dziur
  })

  it('w niedzielę nie oznacza żadnej karty jako bieżącej', () => {
    const rows = sanitaryCards(3, d('2026-08-02')) // niedziela
    expect(rows[0].day).toBe('2026-08-01')
    expect(rows.some(r => r.current)).toBe(false)
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

describe('receptionCards — rejestr przyjęcia 1.1.1 i 1.1.1/2', () => {
  it('idzie miesiąc po miesiącu wstecz, bieżący pierwszy', () => {
    const rows = receptionCards(3, d('2026-08-10'))
    expect(rows.map(r => r.no)).toEqual(['08/2026', '07/2026', '06/2026'])
    // dzień w wierszu to zawsze 1. dnia miesiąca — z niego budujemy URL wydruku
    expect(rows.map(r => r.day)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01'])
    expect(rows[0].current).toBe(true)
  })

  it('każdy dzień miesiąca trafia w tę samą kartę', () => {
    const karty = ['2026-08-01', '2026-08-17', '2026-08-31'].map(x => receptionCards(1, d(x))[0])
    for (const k of karty) {
      expect(k.no).toBe('08/2026')
      expect(k.day).toBe('2026-08-01')
    }
  })

  it('przeskok przez początek roku nie gubi grudnia', () => {
    const rows = receptionCards(2, d('2027-01-05'))
    expect(rows.map(r => r.no)).toEqual(['01/2027', '12/2026'])
    expect(rows[1].day).toBe('2026-12-01')
  })

  it('numer karty to miesiąc i rok', () => {
    expect(receptionCardNo(d('2026-08-03'))).toBe('08/2026')
    expect(receptionCardNo(d('2026-12-31'))).toBe('12/2026')
  })
})
