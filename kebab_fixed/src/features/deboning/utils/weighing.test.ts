import { describe, it, expect } from 'vitest'
import { computeWeighing, sanitizeCartTares, E2_TARE_KG, CART_TARES_KG } from './weighing'

describe('sanitizeCartTares', () => {
  it('sortuje rosnąco i usuwa duplikaty (kafle od najlżejszego)', () => {
    expect(sanitizeCartTares([7, 5.5, 6.0, 5.5])).toEqual([5.5, 6.0, 7])
  })

  it('odfiltrowuje śmieci i wartości poza 0–50 kg', () => {
    expect(sanitizeCartTares([5.5, 'xx', -1, 0, 51, '6,5'])).toEqual([5.5, 6.5])
  })

  it('nie-tablica lub pustka → [] (caller bierze CART_TARES_KG)', () => {
    expect(sanitizeCartTares(null)).toEqual([])
    expect(sanitizeCartTares([])).toEqual([])
  })

  it('ważenie bez wózka: tara 0 liczy netto (brutto − same E2)', () => {
    const r = computeWeighing({ gross: 156.0, cartTareKg: 0, e2Count: 7 })
    expect(r.tareTotalKg).toBe(14.0)
    expect(r.netKg).toBe(142.0)
    expect(r.ready).toBe(true)
  })
})

describe('computeWeighing', () => {
  it('przykład z hali: 170,0 − wózek 5,5 − 7×E2 = 150,5 netto, 21,5 kg/poj (w normie)', () => {
    const r = computeWeighing({ gross: 170.0, cartTareKg: 5.5, e2Count: 7 })
    expect(r.tareE2Kg).toBe(14.0)
    expect(r.tareTotalKg).toBe(19.5)
    expect(r.netKg).toBe(150.5)
    expect(r.kgPerContainer).toBeCloseTo(21.5, 5)
    expect(r.plausible).toBe(true)
    expect(r.ready).toBe(true)
  })

  it('bez wybranego wózka nie liczy netto', () => {
    const r = computeWeighing({ gross: 170.0, cartTareKg: null, e2Count: 7 })
    expect(r.netKg).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('bez pojemników nie liczy netto', () => {
    const r = computeWeighing({ gross: 170.0, cartTareKg: 5.5, e2Count: 0 })
    expect(r.ready).toBe(false)
  })

  it('brutto poniżej tary → netto 0 (pusta waga / sam wózek)', () => {
    const r = computeWeighing({ gross: 12.0, cartTareKg: 5.5, e2Count: 7 })
    expect(r.netKg).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('poza pasmem 15–25 kg/poj → plausible=false (np. źle policzone E2)', () => {
    const r = computeWeighing({ gross: 80.0, cartTareKg: 5.5, e2Count: 7 }) // ~8,6 kg/poj
    expect(r.ready).toBe(true)
    expect(r.plausible).toBe(false)
  })

  it('zaokrągla netto do 0,1 kg (unika artefaktów float)', () => {
    const r = computeWeighing({ gross: 170.05, cartTareKg: 6.5, e2Count: 3 })
    expect(r.netKg).toBe(157.6) // 170.05−6.5−6.0 = 157.55 → 157.6
  })

  it('stałe domenowe zgodne z halą', () => {
    expect(E2_TARE_KG).toBe(2.0)
    expect(CART_TARES_KG).toEqual([5.5, 6.0, 6.5, 7.0])
  })
})
