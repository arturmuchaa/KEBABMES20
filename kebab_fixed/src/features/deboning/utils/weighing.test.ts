import { describe, it, expect } from 'vitest'
import {
  computeWeighing, sanitizeCartTares, driveOffStep, DRIVE_OFF_IDLE,
  E2_TARE_KG, CART_TARES_KG, isByproductBelowNorm, TYPICAL_BYPRODUCT_PCT_MIN,
  byproductTareOptions, PALLET_TARES, yieldBandError,
} from './weighing'

describe('byproductTareOptions — nośniki do ważenia ubocznych', () => {
  it('paleta, potem wózki z systemu (rosnąco), na końcu „bez"', () => {
    const opts = byproductTareOptions([6.5, 5.5])
    expect(opts.map(o => o.tareLabel)).toEqual(['H1', 'wózek 5,5', 'wózek 6,5', 'bez palety'])
    expect(opts.map(o => o.kg)).toEqual([18, 5.5, 6.5, 0])
  })

  it('etykieta wózka niesie tarę — w dzienniku widać, na czym ważono', () => {
    const cart = byproductTareOptions([6])[1]
    expect(cart.tareLabel).toBe('wózek 6,0')
    expect(cart.title).toBe('6,0')
    expect(cart.sub).toBe('kg · wózek')
  })

  it('brak wózków (stara konfiguracja) → sama paleta + „bez", bez pustych kafli', () => {
    expect(byproductTareOptions([]).map(o => o.tareLabel)).toEqual(['H1', 'bez palety'])
  })

  it('śmieci z backendu/cache nie tworzą kafli-widm', () => {
    expect(byproductTareOptions(undefined as unknown as number[]).map(o => o.tareLabel))
      .toEqual(['H1', 'bez palety'])
  })

  it('„bez palety" zostaje etykietą historyczną (tara 0) — nie psuje starych ważeń', () => {
    const opts = byproductTareOptions([5.5])
    const none = opts[opts.length - 1]
    expect(none).toMatchObject({ tareLabel: 'bez palety', kg: 0 })
    expect(PALLET_TARES[0]).toMatchObject({ label: 'H1', kg: 18 })
  })
})

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

describe('yieldBandError — lustro pasma wydajności', () => {
  it('przepuszcza typową wydajność', () => {
    expect(yieldBandError(300, 198)).toBeNull()   // 66,0%
  })

  it('łapie wagę wózka w mięsie (442/ANATOLII: 298,5 z 300)', () => {
    expect(yieldBandError(300, 298.5)).toMatch(/wózek/)
  })

  it('łapie równe 100% (443/SERHII: 150 z 150)', () => {
    // Stary warunek kgMeat > kgQuarter tego NIE łapał.
    expect(yieldBandError(150, 150)).not.toBeNull()
  })

  it('podpowiada niezważoną resztę przy zbyt niskiej wydajności', () => {
    expect(yieldBandError(150, 82.5)).toMatch(/zważone/)  // 55,0%
  })

  it('domyka obie granice pasma z/s', () => {
    expect(yieldBandError(100, 60)).toBeNull()
    expect(yieldBandError(100, 71)).toBeNull()
    expect(yieldBandError(100, 59.9)).not.toBeNull()
    expect(yieldBandError(100, 71.1)).not.toBeNull()
  })

  it('ma osobne pasmo dla mięsa bez skóry', () => {
    // b/s ma uzysk ~50–55%; wspólne pasmo blokowałoby prawdziwy towar.
    expect(yieldBandError(150, 85, 'bs')).toBeNull()      // 56,7%
    expect(yieldBandError(100, 45, 'bs')).toBeNull()      // dokładnie 45,0%
    expect(yieldBandError(100, 60, 'bs')).toBeNull()      // dokładnie 60,0%
    expect(yieldBandError(100, 66, 'bs')).not.toBeNull()  // norma z/s, nie b/s
  })

  it('nieznany rodzaj mięsa leci po paśmie z/s', () => {
    expect(yieldBandError(100, 66, 'cokolwiek')).toBeNull()
    expect(yieldBandError(100, 55, null)).not.toBeNull()
  })

  it('zwalnia pobrania poniżej 30 kg', () => {
    expect(yieldBandError(15, 8.5)).toBeNull()    // 56,7%, ale małe pobranie
    expect(yieldBandError(29.9, 29.9)).toBeNull() // 100%, ale < 30 kg
  })

  it('formatuje liczby po polsku', () => {
    expect(yieldBandError(300, 298.5)).toContain('99,5%')
    expect(yieldBandError(300, 298.5)).toContain('298,5 kg')
  })

  it('mówi DOKŁADNIE to samo co backend', () => {
    // Skopiowane z odpowiedzi validate_yield_band (deboning_service.py).
    // Operator nie może zobaczyć dwóch różnych tekstów dla tego samego błędu
    // zależnie od tego, czy zdążył zadziałać kiosk, czy odpowiedź z API.
    expect(yieldBandError(300, 298.5)).toBe(
      'Wydajność 99,5% — mięso 298,5 kg z 300,0 kg ćwiartki. ' +
      'Sprawdź, czy wybrałeś właściwy wózek (tara). Zapis wymaga kodu serwisowego.',
    )
    expect(yieldBandError(150, 82.5)).toBe(
      'Wydajność 55,0% — mięso 82,5 kg z 150,0 kg ćwiartki. ' +
      'Sprawdź, czy całe mięso z pobrania zostało zważone. Zapis wymaga kodu serwisowego.',
    )
  })
})
