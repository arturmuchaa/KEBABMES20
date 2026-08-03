import { describe, it, expect } from 'vitest'
import { cardPeriod, CARD_DAYS } from './temperatureLogCard'

const d = (s: string) => new Date(`${s}T00:00:00`)
const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`

describe('cardPeriod', () => {
  it('daje tydzień pon–ndz niezależnie od dnia, którym trafimy w tydzień', () => {
    const fromWed = cardPeriod(d('2026-06-10'))
    expect(fromWed.days.map(iso)).toEqual([
      '2026-06-08', '2026-06-09', '2026-06-10',
      '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
    ])
    expect(fromWed.days).toHaveLength(CARD_DAYS)
    // ten sam tydzień = ta sama karta, kto by jej nie drukował
    expect(cardPeriod(d('2026-06-08'))).toEqual(fromWed) // poniedziałek
    expect(cardPeriod(d('2026-06-14'))).toEqual(fromWed) // niedziela
  })

  it('tydzień kończący się w nowym miesiącu otwiera jego numerację', () => {
    // 1–2.08.2026 (sob–ndz) to końcówka tygodnia zaczętego 27.07 — karta 01/08
    const pierwsza = cardPeriod(d('2026-08-01'))
    expect(pierwsza.no).toBe('01/08/2026')
    expect(iso(pierwsza.days[0])).toBe('2026-07-27')
    expect(iso(pierwsza.days[6])).toBe('2026-08-02')
    expect(cardPeriod(d('2026-08-02'))).toEqual(pierwsza)
    expect(cardPeriod(d('2026-07-27'))).toEqual(pierwsza)

    // kolejny tydzień to druga karta sierpnia
    const druga = cardPeriod(d('2026-08-03'))
    expect(druga.no).toBe('02/08/2026')
    expect(iso(druga.days[0])).toBe('2026-08-03')
  })

  it('numeruje kolejne tygodnie miesiąca bez dziur i duplikatów', () => {
    expect(cardPeriod(d('2026-08-10')).no).toBe('03/08/2026')
    expect(cardPeriod(d('2026-08-17')).no).toBe('04/08/2026')
    expect(cardPeriod(d('2026-08-24')).no).toBe('05/08/2026')
    // 31.08 to poniedziałek tygodnia kończącego się 6.09 — już wrzesień
    expect(cardPeriod(d('2026-08-31')).no).toBe('01/09/2026')
  })

  it('miesiąc kończący się niedzielą nie oddaje ostatniego tygodnia', () => {
    // 31.05.2026 to niedziela — tydzień 25–31.05 zostaje w maju
    expect(cardPeriod(d('2026-05-25')).no).toBe('05/05/2026')
    expect(cardPeriod(d('2026-06-01')).no).toBe('01/06/2026')
  })

  it('tydzień na przełomie roku nie gubi dni', () => {
    const ny = cardPeriod(d('2026-01-01'))
    expect(ny.no).toBe('01/01/2026') // kończy się 4.01.2026
    expect(ny.days.map(iso)).toEqual([
      '2025-12-29', '2025-12-30', '2025-12-31',
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
    ])
  })
})
