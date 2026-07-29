import { describe, expect, it } from 'vitest'
import {
  detectScope, periodLabel, periodRange, scopeSections, scopeTitle, scopeWords, shiftPeriod,
} from './reportPeriod'

describe('periodRange — granice okresów po polsku', () => {
  it('tydzień biegnie od poniedziałku do niedzieli', () => {
    // 2026-07-28 to wtorek.
    expect(periodRange('week', '2026-07-28')).toEqual({ from: '2026-07-27', to: '2026-08-02' })
  })

  it('niedziela należy do TAMTEGO tygodnia, nie do następnego', () => {
    expect(periodRange('week', '2026-08-02')).toEqual({ from: '2026-07-27', to: '2026-08-02' })
  })

  it('miesiąc od pierwszego do ostatniego dnia', () => {
    expect(periodRange('month', '2026-07-15')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('kwartał obejmuje trzy miesiące', () => {
    expect(periodRange('quarter', '2026-07-28')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(periodRange('quarter', '2026-01-05')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
  })

  it('rok od stycznia do grudnia', () => {
    expect(periodRange('year', '2026-07-28')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('dzień to jeden dzień', () => {
    expect(periodRange('day', '2026-07-28')).toEqual({ from: '2026-07-28', to: '2026-07-28' })
  })
})

describe('shiftPeriod — przewijanie okresów strzałkami', () => {
  it('cofa i przewija tydzień o siedem dni', () => {
    expect(shiftPeriod('week', '2026-07-28', -1)).toBe('2026-07-21')
    expect(shiftPeriod('week', '2026-07-28', 1)).toBe('2026-08-04')
  })

  it('cofnięcie miesiąca nie przeskakuje przez luty', () => {
    // 31.03 − 1 miesiąc naiwnie daje 3 marca; ma dać luty.
    expect(periodRange('month', shiftPeriod('month', '2026-03-31', -1)).from).toBe('2026-02-01')
  })

  it('cofa kwartał o trzy miesiące i rok o dwanaście', () => {
    expect(periodRange('quarter', shiftPeriod('quarter', '2026-07-15', -1)).from).toBe('2026-04-01')
    expect(periodRange('year', shiftPeriod('year', '2026-07-15', -1)).from).toBe('2025-01-01')
  })
})

describe('detectScope — raport rozpoznaje, jakim jest okresem', () => {
  it('rozpoznaje dzień, tydzień, miesiąc, kwartał i rok po granicach', () => {
    expect(detectScope('2026-07-28', '2026-07-28')).toBe('day')
    expect(detectScope('2026-07-27', '2026-08-02')).toBe('week')
    expect(detectScope('2026-07-01', '2026-07-31')).toBe('month')
    expect(detectScope('2026-07-01', '2026-09-30')).toBe('quarter')
    expect(detectScope('2026-01-01', '2026-12-31')).toBe('year')
  })

  // Zakres wpisany ręcznie nie może udawać miesiąca — inaczej raport
  // obiecywałby porównania miesiąc do miesiąca dla 12 przypadkowych dni.
  it('dowolny zakres to „custom", nie najbliższy pasujący okres', () => {
    expect(detectScope('2026-07-05', '2026-07-19')).toBe('custom')
    expect(detectScope('2026-07-01', '2026-07-30')).toBe('custom')
  })
})

describe('scopeTitle — nagłówek mówi wprost, co to za raport', () => {
  it('nazywa okres po polsku', () => {
    expect(scopeTitle('day')).toMatch(/dzienny/i)
    expect(scopeTitle('week')).toMatch(/tygodniowy/i)
    expect(scopeTitle('month')).toMatch(/miesięczny/i)
    expect(scopeTitle('quarter')).toMatch(/kwartalny/i)
    expect(scopeTitle('year')).toMatch(/roczny/i)
    expect(scopeTitle('custom')).toMatch(/rozbioru/i)
  })
})

describe('scopeSections — co się drukuje w którym raporcie', () => {
  // „Codzienny ma być zwykły": jednodniowa zmiana to dokument operacyjny,
  // a nie materiał na zarząd — premie i trendy nie mają tam czego szukać.
  it('raport dzienny jest operacyjny: bez warstwy zarządczej', () => {
    const d = scopeSections('day')
    expect(d.brief).toBe(false)
    expect(d.bonus).toBe(false)
    expect(d.trend).toBe(false)
    expect(d.yieldValue).toBe(false)
    expect(d.deviations).toBe(false)
    // …ale to, co operacyjne, zostaje.
    expect(d.batches).toBe(true)
    expect(d.workers).toBe(true)
    expect(d.massBalance).toBe(true)
    expect(d.cost).toBe(true)
  })

  it('tydzień dostaje warstwę zarządczą, ale bez premii', () => {
    const w = scopeSections('week')
    expect(w.brief).toBe(true)
    expect(w.deviations).toBe(true)
    expect(w.bonus).toBe(false)
  })

  it('premia liczy się dopiero od pełnego miesiąca w górę', () => {
    expect(scopeSections('month').bonus).toBe(true)
    expect(scopeSections('quarter').bonus).toBe(true)
    expect(scopeSections('year').bonus).toBe(true)
  })

  it('wykres dnia nie ma sensu dla jednego dnia', () => {
    expect(scopeSections('day').dailyChart).toBe(false)
    expect(scopeSections('week').dailyChart).toBe(true)
  })

  it('zakres własny dostaje pełen komplet poza premią', () => {
    const c = scopeSections('custom')
    expect(c.brief).toBe(true)
    expect(c.bonus).toBe(false)
  })
})

describe('periodLabel — podpis okresu na dokumencie', () => {
  it('miesiąc podpisuje się nazwą, nie zakresem dat', () => {
    expect(periodLabel('month', '2026-07-01', '2026-07-31')).toBe('lipiec 2026')
  })

  it('kwartał i rok mają własny podpis', () => {
    expect(periodLabel('quarter', '2026-07-01', '2026-09-30')).toBe('III kwartał 2026')
    expect(periodLabel('year', '2026-01-01', '2026-12-31')).toBe('rok 2026')
  })

  it('dzień i tydzień podają daty', () => {
    expect(periodLabel('day', '2026-07-28', '2026-07-28')).toBe('28.07.2026')
    expect(periodLabel('week', '2026-07-27', '2026-08-02')).toBe('tydzień 27.07.2026 – 02.08.2026')
  })
})

describe('scopeWords — kwota za okres opisana słowem tego okresu', () => {
  // Wpadka do uniknięcia: kwota policzona z tygodnia opisana jako
  // „miesięcznie" zawyża wnioski prezesa czterokrotnie.
  it('każdy okres ma własny przysłówek', () => {
    expect(scopeWords('week').adverb).toBe('tygodniowo')
    expect(scopeWords('month').adverb).toBe('miesięcznie')
    expect(scopeWords('quarter').adverb).toBe('kwartalnie')
    expect(scopeWords('year').adverb).toBe('rocznie')
  })

  it('zakres własny nie udaje żadnego okresu kalendarzowego', () => {
    expect(scopeWords('custom').adverb).toBe('w tym okresie')
    expect(scopeWords('custom').next).toBe('kolejny okres')
  })
})
