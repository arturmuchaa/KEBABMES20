/**
 * Prognoza godziny zakończenia produkcji.
 *
 * Kierownik podejmuje po niej decyzje (drugi kurs auta, nadgodziny), więc
 * liczba musi albo być uczciwa, albo jej nie być wcale — stąd kreska zamiast
 * zgadywania przy pustej hali i na starcie zmiany.
 */
import { describe, it, expect } from 'vitest'

import { finishForecast, type ForecastInput, type Rates } from './finishForecast'

const TEMPA: Rates = { seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} }

const linia = (over: Partial<ForecastInput['lines'][number]> = {}) => ({
  id: 'l1', qty: 20, qtyDone: 0, kgPerUnit: 40, recipeId: 'r1', ...over,
})

const wejscie = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  lines: [linia()], crew: 4, rates: TEMPA,
  todayKg: 0, todayPersonHours: 0, todayWorkedMin: 60, breakUsedMin: 0,
  now: '2026-08-27T08:00:00.000Z', ...over,
})

describe('finishForecast — zimny start na ziarnie', () => {
  it('liczy z ziarna 120 kg/h, gdy nic jeszcze nie wiadomo', () => {
    // 800 kg / (120 kg/h × 4 osoby) = 1.667 h = 100 min
    // + 30 min nierozliczonej przerwy = 130 min → 10:10
    const f = finishForecast(wejscie({ todayPersonHours: 1, todayKg: 0 }))
    expect(f.kind).toBe('eta')
    if (f.kind !== 'eta') return
    expect(f.remainingKg).toBe(800)
    expect(f.rateUsed).toBe(120)
    expect(f.breakAddedMin).toBe(30)
    expect(f.hhmm).toBe('10:10')
  })

  it('tempo receptury bije globalne, gdy jest znane', () => {
    const rates = { ...TEMPA, byRecipe: { r1: 200 } }
    const f = finishForecast(wejscie({ rates, todayPersonHours: 1 }))
    if (f.kind !== 'eta') return
    expect(f.rateUsed).toBe(200)
  })
})

describe('finishForecast — tempo dzisiejsze bije uczone', () => {
  it('po 30 min pracy dzisiejsze tempo wchodzi do mieszanki', () => {
    // dziś: 400 kg na 2 rbh = 200 kg/rbh, uczone 120 → mieszanka w (120, 200)
    const f = finishForecast(wejscie({ todayKg: 400, todayPersonHours: 2 }))
    if (f.kind !== 'eta') return
    expect(f.rateUsed).toBeGreaterThan(120)
    expect(f.rateUsed).toBeLessThanOrEqual(200)
  })

  it('im dłużej trwa dzień, tym mocniej liczy się tempo dzisiejsze', () => {
    const krotki = finishForecast(wejscie({ todayKg: 200, todayPersonHours: 1 }))
    const dlugi  = finishForecast(wejscie({ todayKg: 1600, todayPersonHours: 8 }))
    if (krotki.kind !== 'eta' || dlugi.kind !== 'eta') return
    expect(dlugi.rateUsed).toBeGreaterThan(krotki.rateUsed)
  })
})

describe('finishForecast — kiedy prognozy NIE ma', () => {
  it('bez układających pokazuje kreskę, a nie nieskończoność', () => {
    expect(finishForecast(wejscie({ crew: 0 })).kind).toBe('unknown')
  })

  it('przed 20 minutami pracy nie zgaduje', () => {
    // 4 osoby × 15 min to już 1 rbh — próg musi patrzeć na czas zegarowy,
    // inaczej duża załoga przepycha prognozę po kilku minutach.
    const f = finishForecast(wejscie({ todayWorkedMin: 15, todayPersonHours: 1, todayKg: 200 }))
    expect(f.kind).toBe('unknown')
    if (f.kind !== 'unknown') return
    expect(f.reason).toBe('za-wczesnie')
  })

  it('plan zrobiony w całości melduje koniec, a nie godzinę', () => {
    const f = finishForecast(wejscie({
      lines: [linia({ qtyDone: 20 })], todayPersonHours: 2, todayKg: 800,
    }))
    expect(f.kind).toBe('ready')
  })

  it('pusty plan to też koniec', () => {
    expect(finishForecast(wejscie({ lines: [], todayPersonHours: 2 })).kind).toBe('ready')
  })
})

describe('finishForecast — przerwy i załoga', () => {
  it('wykorzystana przerwa nie dolicza się drugi raz', () => {
    const f = finishForecast(wejscie({ todayPersonHours: 1, breakUsedMin: 30 }))
    if (f.kind !== 'eta') return
    expect(f.breakAddedMin).toBe(0)
    expect(f.hhmm).toBe('09:40')
  })

  it('przekroczona przerwa nie odejmuje czasu od prognozy', () => {
    const f = finishForecast(wejscie({ todayPersonHours: 1, breakUsedMin: 90 }))
    if (f.kind !== 'eta') return
    expect(f.breakAddedMin).toBe(0)
  })

  it('większa załoga kończy wcześniej', () => {
    const male = finishForecast(wejscie({ crew: 2, todayPersonHours: 1 }))
    const duze = finishForecast(wejscie({ crew: 8, todayPersonHours: 1 }))
    if (male.kind !== 'eta' || duze.kind !== 'eta') return
    expect(duze.hours).toBeLessThan(male.hours)
  })

  it('pozycje o różnych recepturach liczą się każda swoim tempem', () => {
    const rates = { ...TEMPA, byRecipe: { r1: 200, r2: 100 } }
    const f = finishForecast(wejscie({
      rates, crew: 1, todayPersonHours: 1,
      lines: [linia({ id: 'l1', recipeId: 'r1' }), linia({ id: 'l2', recipeId: 'r2' })],
    }))
    if (f.kind !== 'eta') return
    // 800/200 + 800/100 = 4 + 8 = 12 h
    expect(f.hours).toBeGreaterThan(11)
  })
})
