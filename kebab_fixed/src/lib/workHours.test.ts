import { describe, it, expect } from 'vitest'
import {
  computeHours, formatTime, isOpenCell, isSunday, mondayOf, parseTime,
  weekDays, weekGaps, type HourCell,
} from './workHours'

const cell = (over: Partial<HourCell> = {}): HourCell => ({
  workerId: 'w1', workDate: '2026-08-03', status: 'work',
  timeFrom: '6:00', timeTo: '15:00', hours: 9, ...over,
})

describe('parseTime — biuro wpisuje w pośpiechu', () => {
  it('przyjmuje skróty i pełny zapis', () => {
    expect(parseTime('6')).toBe(360)
    expect(parseTime('6:00')).toBe(360)
    expect(parseTime('06:30')).toBe(390)
  })
  it('odrzuca śmieci', () => {
    for (const bad of ['', '25:00', '6:61', 'abc']) expect(parseTime(bad)).toBeNull()
  })

  // Dwukropek wymaga Shift, więc połówki wpisuje się przecinkiem.
  it('jedna cyfra po przecinku to UŁAMEK godziny', () => {
    expect(parseTime('8,5')).toBe(8 * 60 + 30)
    expect(parseTime('8.5')).toBe(8 * 60 + 30)
    expect(parseTime('6,5')).toBe(6 * 60 + 30)
  })

  // „8,30" to naturalny zapis godziny 8:30 — potraktowanie tego jako 0,30 h
  // (8:18) cicho zaniżyłoby wypłatę, więc dwie cyfry czytamy jako MINUTY.
  it('dwie cyfry po przecinku to MINUTY', () => {
    expect(parseTime('8,30')).toBe(8 * 60 + 30)
    expect(parseTime('14,45')).toBe(14 * 60 + 45)
    expect(parseTime('6,05')).toBe(6 * 60 + 5)
  })

  it('minuty poza zakresem odrzucone', () => {
    expect(parseTime('8,60')).toBeNull()
    expect(parseTime('8,99')).toBeNull()
  })
})

describe('computeHours', () => {
  it('zwykła zmiana', () => expect(computeHours('6:00', '15:00')).toBe(9))
  it('kwadranse', () => expect(computeHours('6:15', '14:00')).toBe(7.75))
  it('przez północ', () => expect(computeHours('22:00', '6:00')).toBe(8))
  it('brak końca to null — zmiana otwarta', () => {
    expect(computeHours('6:00', '')).toBeNull()
  })
  it('równe godziny to null — pomyłka, nie 24 h', () => {
    expect(computeHours('6:00', '6:00')).toBeNull()
  })
})

describe('formatTime', () => {
  it('minuty na HH:MM', () => {
    expect(formatTime(360)).toBe('6:00')
    expect(formatTime(390)).toBe('6:30')
  })
})

describe('tydzień', () => {
  it('poniedziałek dla środy', () => expect(mondayOf('2026-08-05')).toBe('2026-08-03'))
  it('poniedziałek dla niedzieli — tydzień kończy się nią, nie zaczyna', () => {
    expect(mondayOf('2026-08-09')).toBe('2026-08-03')
  })
  it('siedem kolejnych dni', () => {
    expect(weekDays('2026-08-03')).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
      '2026-08-07', '2026-08-08', '2026-08-09',
    ])
  })
})

describe('isSunday — podstawa premii niedzielnej', () => {
  it('niedziela tak, reszta nie', () => {
    expect(isSunday('2026-08-09')).toBe(true)
    expect(isSunday('2026-08-03')).toBe(false)
    expect(isSunday('2026-08-08')).toBe(false)
  })
})

describe('isOpenCell', () => {
  it('praca bez godziny końca', () => {
    expect(isOpenCell(cell({ timeTo: '', hours: null }))).toBe(true)
  })
  it('znacznik nie jest otwarty', () => {
    expect(isOpenCell(cell({ status: 'off', timeFrom: '', timeTo: '', hours: null }))).toBe(false)
  })
})

describe('weekGaps — ściągawka przy nadrabianiu', () => {
  const days = weekDays('2026-08-03')
  const workers = ['w1', 'w2']

  it('liczy otwarte i brakujące do dziś włącznie', () => {
    const cells = [
      cell({ workerId: 'w1', workDate: '2026-08-03' }),
      cell({ workerId: 'w1', workDate: '2026-08-04', timeTo: '', hours: null }),
      cell({ workerId: 'w2', workDate: '2026-08-03' }),
    ]
    // dziś = wtorek 4.08; brakuje w2/wtorek
    expect(weekGaps(cells, workers, days, '2026-08-04')).toEqual({ open: 1, missing: 1 })
  })

  it('dni przyszłe nie są brakiem', () => {
    expect(weekGaps([], workers, days, '2026-08-03')).toEqual({ open: 0, missing: 2 })
  })

  it('dzień z dwiema zmianami: otwarta pierwsza liczy się jako otwarty', () => {
    const cells = [
      cell({ workerId: 'w1', workDate: '2026-08-03', seq: 1, timeTo: '', hours: null }),
      cell({ workerId: 'w1', workDate: '2026-08-03', seq: 2, timeFrom: '18:00', timeTo: '20:00', hours: 2 }),
      cell({ workerId: 'w2', workDate: '2026-08-03' }),
    ]
    expect(weekGaps(cells, workers, days, '2026-08-03')).toEqual({ open: 1, missing: 0 })
  })

  it('znacznik zamyka dzień — to nie brak', () => {
    const cells = workers.map(w => cell({
      workerId: w, workDate: '2026-08-03', status: 'off',
      timeFrom: '', timeTo: '', hours: null,
    }))
    expect(weekGaps(cells, workers, days, '2026-08-03')).toEqual({ open: 0, missing: 0 })
  })
})
