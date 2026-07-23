import { describe, it, expect } from 'vitest'
import {
  computeWeighing, sanitizeCartTares, driveOffStep, DRIVE_OFF_IDLE,
  E2_TARE_KG, CART_TARES_KG, isByproductBelowNorm, TYPICAL_BYPRODUCT_PCT_MIN,
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

describe('driveOffStep (strażnik zjazdu z wagi)', () => {
  const pallet = { tareLabel: 'H1', tareKg: 18, containers: 12, gross: 538.0, net: 496.0 }
  const onScale = { connected: true, stable: true, gross: 538.0 }
  const offScale = { connected: true, stable: false, gross: 0 }

  it('stabilny kompletny odczyt uzbraja tracker (kandydat do zapisu)', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    expect(s.armed).toEqual(pallet)
    expect(s.prompt).toBeNull()
  })

  it('zjazd z wagi → prompt z ostatnim odczytem, armed się czyści', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const s = driveOffStep(armed, offScale, null)
    expect(s.prompt).toEqual(pallet)
    expect(s.armed).toBeNull()
  })

  it('drganie przy zjeżdżaniu (niestabilne odczyty nad progiem) nie gubi odczytu', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const mid = driveOffStep(armed, { connected: true, stable: false, gross: 214.0 }, pallet)
    expect(mid.armed).toEqual(pallet)
    const s = driveOffStep(mid, offScale, null)
    expect(s.prompt).toEqual(pallet)
  })

  it('snap = null (dane niekompletne) nie uzbraja', () => {
    expect(driveOffStep(DRIVE_OFF_IDLE, onScale, null)).toEqual(DRIVE_OFF_IDLE)
  })

  it('prompt czeka na decyzję — kolejne odczyty go nie nadpisują', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const prompted = driveOffStep(armed, offScale, null)
    const next = driveOffStep(prompted, { connected: true, stable: true, gross: 320.0 },
      { ...pallet, gross: 320.0, net: 287.0 })
    expect(next).toEqual(prompted)
  })

  it('waga rozłączona nie uzbraja', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, { connected: false, stable: true, gross: 538.0 }, pallet)
    expect(s).toEqual(DRIVE_OFF_IDLE)
  })

  it('utrata połączenia z wagą (watchdog → OFF) też ratuje odczyt promptem', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const s = driveOffStep(armed, { connected: false, stable: false, gross: 0 }, null)
    expect(s.prompt).toEqual(pallet)
  })

  it('nowszy stabilny odczyt nadpisuje armed (operator poprawia pojemniki na wadze)', () => {
    const first = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const s = driveOffStep(first, { connected: true, stable: true, gross: 534.0 },
      { ...pallet, containers: 10, gross: 534.0, net: 500.0 })
    expect(s.armed).toEqual({ tareLabel: 'H1', tareKg: 18, containers: 10, gross: 534.0, net: 500.0 })
  })

  it('zapamiętuje snapshot 1:1 — zaokrąglanie należy do wywołującego', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, onScale, { ...pallet, net: 495.9 })
    expect(s.armed?.net).toBe(495.9)
  })

  it('pusta waga bez armed → nic (spokój na starcie kreatora)', () => {
    expect(driveOffStep(DRIVE_OFF_IDLE, offScale, null)).toEqual(DRIVE_OFF_IDLE)
  })

  it('działa dla dowolnego ładunku — nie tylko palety', () => {
    const meat = { netKg: 100.0, workerName: 'Anatoli' }
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, meat)
    expect(driveOffStep(armed, offScale, null).prompt).toEqual(meat)
  })
})

describe('isByproductBelowNorm — alarm odchylenia od typowej normy (audyt partii 428)', () => {
  it('partia 428 realna: grzbiety 15,80% (poniżej normy 17,5%) → true', () => {
    expect(isByproductBelowNorm('backs', 727.5, 4605)).toBe(true)
  })

  it('partia 428 realna: kości 9,89% (poniżej normy 13,0%) → true, wyraźnie gorzej niż grzbiety', () => {
    expect(isByproductBelowNorm('bones', 455.5, 4605)).toBe(true)
  })

  it('partia w normie (427: grzbiety 21,27%, kości 17,75%) → false dla obu', () => {
    expect(isByproductBelowNorm('backs', 510.5, 2400)).toBe(false)
    expect(isByproductBelowNorm('bones', 426, 2400)).toBe(false)
  })

  it('nic jeszcze nie zważone (kg<=0) nigdy nie alarmuje — czekamy na dane', () => {
    expect(isByproductBelowNorm('backs', 0, 4605)).toBe(false)
    expect(isByproductBelowNorm('bones', -5, 4605)).toBe(false)
  })

  it('brak ćwiartki (quarterKg<=0) nie alarmuje — nie ma bazy do %', () => {
    expect(isByproductBelowNorm('backs', 500, 0)).toBe(false)
  })

  it('dokładnie na granicy → false (>= min, nie <)', () => {
    const kg = (TYPICAL_BYPRODUCT_PCT_MIN.backs / 100) * 1000
    expect(isByproductBelowNorm('backs', kg, 1000)).toBe(false)
  })

  it('tuż poniżej granicy → true', () => {
    const kg = (TYPICAL_BYPRODUCT_PCT_MIN.bones / 100) * 1000 - 0.1
    expect(isByproductBelowNorm('bones', kg, 1000)).toBe(true)
  })
})
