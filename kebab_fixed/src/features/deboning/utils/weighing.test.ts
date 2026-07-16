import { describe, it, expect } from 'vitest'
import {
  computeWeighing, sanitizeCartTares, driveOffStep, DRIVE_OFF_IDLE,
  E2_TARE_KG, CART_TARES_KG,
} from './weighing'

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

describe('driveOffStep (kreator ubocznych: zjazd z wagi bez „Dodaj do sumy")', () => {
  const snap = { tareKg: 18, tareLabel: 'H1', containers: 12, net: 496.0 }
  const onScale = { connected: true, stable: true, gross: 538.0 }
  const offScale = { connected: true, stable: false, gross: 0 }

  it('stabilny kompletny odczyt uzbraja tracker (kandydat na paletę)', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, onScale, snap)
    expect(s.armed).toEqual({ tareLabel: 'H1', tareKg: 18, containers: 12, gross: 538.0, net: 496.0 })
    expect(s.prompt).toBeNull()
  })

  it('zjazd z wagi → prompt z ostatnim odczytem, armed się czyści', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, snap)
    const s = driveOffStep(armed, offScale, { ...snap, net: 0 })
    expect(s.prompt).toEqual(armed.armed)
    expect(s.armed).toBeNull()
  })

  it('drganie przy zjeżdżaniu (niestabilne odczyty nad progiem) nie gubi odczytu', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, snap)
    const mid = driveOffStep(armed, { connected: true, stable: false, gross: 214.0 }, snap)
    expect(mid.armed).toEqual(armed.armed)
    const s = driveOffStep(mid, offScale, { ...snap, net: 0 })
    expect(s.prompt).toEqual(armed.armed)
  })

  it('bez wybranej tary nie uzbraja (odczyt niekompletny)', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, onScale, { ...snap, tareKg: null })
    expect(s).toEqual(DRIVE_OFF_IDLE)
  })

  it('prompt czeka na decyzję — kolejne odczyty go nie nadpisują', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, snap)
    const prompted = driveOffStep(armed, offScale, { ...snap, net: 0 })
    const next = driveOffStep(prompted, { connected: true, stable: true, gross: 320.0 }, { ...snap, net: 287.0 })
    expect(next).toEqual(prompted)
  })

  it('utrata połączenia z wagą (watchdog → OFF) też ratuje odczyt promptem', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, snap)
    const s = driveOffStep(armed, { connected: false, stable: false, gross: 0 }, { ...snap, net: 0 })
    expect(s.prompt).toEqual(armed.armed)
  })

  it('nowszy stabilny odczyt nadpisuje armed (operator poprawia pojemniki na wadze)', () => {
    const first = driveOffStep(DRIVE_OFF_IDLE, onScale, snap)
    const s = driveOffStep(first, { connected: true, stable: true, gross: 534.0 }, { ...snap, containers: 10, net: 500.0 })
    expect(s.armed).toEqual({ tareLabel: 'H1', tareKg: 18, containers: 10, gross: 534.0, net: 500.0 })
  })

  it('netto zaokrągla do 0,1 kg przy uzbrajaniu', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, onScale, { ...snap, net: 495.9499999 })
    expect(s.armed?.net).toBe(495.9)
  })

  it('pusta waga bez armed → nic (spokój na starcie kreatora)', () => {
    expect(driveOffStep(DRIVE_OFF_IDLE, offScale, { ...snap, net: 0 })).toEqual(DRIVE_OFF_IDLE)
  })
})
