import { describe, expect, it } from 'vitest'
import { decideTakeSave, takeProgress, YIELD_NORM_PCT, yieldNorm } from './partialWeighing'

describe('mięso b/s — inna norma uzysku niż z/s', () => {
  it('pasmo b/s to 50–55%, z/s zostaje 64–68%', () => {
    expect(yieldNorm('bs')).toEqual({ lo: 50, hi: 55 })
    expect(yieldNorm('zs')).toEqual(YIELD_NORM_PCT)
  })

  it('50% z pobrania b/s jest W NORMIE (dla z/s byłoby alarmem)', () => {
    const bs = takeProgress(0, 7.5, 15, 'bs')!
    expect(bs.pct).toBe(50)
    expect(bs.status).toBe('norm')
    expect(bs.missingToNormKg).toBe(0)
    expect(takeProgress(0, 7.5, 15)!.status).toBe('below')   // to samo jako z/s
  })

  it('domknięcie pobrania b/s nie pyta „część czy całość?" przy 50%', () => {
    // 7,5 z 15 kg = 50% — dla z/s to za mało (próg 62), dla b/s norma
    expect(decideTakeSave(0, 7.5, 15, 'bs')).toBe('complete')
    expect(decideTakeSave(0, 7.5, 15)).toBe('ask')
  })

  it('realnie niedoważone b/s nadal pyta (poniżej 48%)', () => {
    expect(decideTakeSave(0, 6.0, 15, 'bs')).toBe('ask')     // 40%
  })
})

describe('takeProgress — pasek postępu ważenia dzielonego', () => {
  // Scenariusz z hali (2026-07-27): pobranie 300 kg, operator waży porcjami
  // i gubi się, ile już zważył i ile brakuje do normy.
  it('pierwsza porcja: 100 z 300 kg = 33,3% i 92 kg do dolnej normy', () => {
    const p = takeProgress(0, 100, 300)!
    expect(p.totalKg).toBe(100)
    expect(p.pct).toBeCloseTo(33.33, 2)
    expect(p.normLoKg).toBe(192)          // 64% z 300
    expect(p.missingToNormKg).toBe(92)
    expect(p.missingToNormPct).toBeCloseTo(30.67, 2)
    expect(p.status).toBe('below')
  })

  it('druga porcja dolicza się do poprzednich: 100 zważone + 50 na wadze = 50%', () => {
    const p = takeProgress(100, 50, 300)!
    expect(p.takenKg).toBe(300)           // skala paska = całe pobranie
    expect(p.weighedKg).toBe(100)         // zapisane wcześniej
    expect(p.portionKg).toBe(50)          // to, co teraz na wadze
    expect(p.totalKg).toBe(150)
    expect(p.pct).toBe(50)
    expect(p.weighedPct).toBeCloseTo(33.33, 2)
    expect(p.missingToNormKg).toBe(42)    // 192 − 150
    expect(p.status).toBe('below')
  })

  it('wejście w normę zeruje brakujące kg', () => {
    const p = takeProgress(100, 95, 300)! // 195/300 = 65%
    expect(p.status).toBe('norm')
    expect(p.missingToNormKg).toBe(0)
    expect(p.missingToNormPct).toBe(0)
  })

  it('powyżej pasma normy oznacza status „above" (nie chowa nadwyżki)', () => {
    const p = takeProgress(200, 10, 300)! // 70%
    expect(p.status).toBe('above')
    expect(p.pct).toBeCloseTo(70, 5)
  })

  it('sam podgląd bez porcji na wadze pokazuje stan zapisany', () => {
    const p = takeProgress(150, 0, 300)!
    expect(p.totalKg).toBe(150)
    expect(p.portionKg).toBe(0)
    expect(p.pct).toBe(50)
  })

  it('bez pobrania nie ma czego pokazywać', () => {
    expect(takeProgress(0, 0, 0)).toBeNull()
    expect(takeProgress(10, 5, -1)).toBeNull()
  })

  it('pasmo normy to 64–68% (to, względem czego operator się rozlicza)', () => {
    expect(YIELD_NORM_PCT).toEqual({ lo: 64, hi: 68 })
    const p = takeProgress(0, 204, 300)!  // 68%
    expect(p.normHiKg).toBe(204)
    expect(p.status).toBe('norm')
  })
})

describe('decideTakeSave — jeden przycisk ZAPISZ + pytanie z %', () => {
  it('blokuje, gdy suma z już zważonym przekracza pobranie', () => {
    expect(decideTakeSave(100, 250, 300)).toBe('block')
  })
  it('blokuje bez porcji lub bez pobrania', () => {
    expect(decideTakeSave(0, 0, 300)).toBe('block')
    expect(decideTakeSave(0, 10, 0)).toBe('block')
  })
  it('pyta poniżej 62% (scenariusz z hali: 100 z 300 = 33%)', () => {
    expect(decideTakeSave(0, 100, 300)).toBe('ask')
  })
  it('pyta też przy kolejnej porcji, gdy łącznie wciąż < 62%', () => {
    expect(decideTakeSave(100, 60, 300)).toBe('ask') // 53%
  })
  it('domyka bez pytania w paśmie: 100 + 95 z 300 = 65%', () => {
    expect(decideTakeSave(100, 95, 300)).toBe('complete')
  })
  it('próg dokładnie 62% domyka bez pytania', () => {
    expect(decideTakeSave(0, 186, 300)).toBe('complete') // 186/300 = 62%
  })
})
