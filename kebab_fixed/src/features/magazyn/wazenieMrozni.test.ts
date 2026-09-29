import { describe, expect, it } from 'vitest'
import { opisPozycji, roznicaPl, werdyktWagi } from './wazenieMrozni'

const EURO = { id: 'euro', name: 'EURO', tareMinKg: 33.25, tareMaxKg: 36.75, marginPct: 1 }
const JEDN = { id: 'jednorazowa', name: 'Jednorazowa', tareMinKg: 20, tareMaxKg: 30, marginPct: 1 }

describe('werdyktWagi — ta sama reguła co serwer', () => {
  it('przykład właściciela: 15 × 50 kg na EURO, brutto 780', () => {
    expect(werdyktWagi(750, 780, EURO)).toEqual({ ok: true, diffKg: -5, tareKg: 35 })
  })
  it('brak jednej sztuki = niezgodna', () => {
    expect(werdyktWagi(750, 735, EURO).ok).toBe(false)
  })
  it('granice zapasu włącznie', () => {
    expect(werdyktWagi(750, 775.75, EURO).ok).toBe(true)
    expect(werdyktWagi(750, 775.7, EURO).ok).toBe(false)
    expect(werdyktWagi(750, 794.25, EURO).ok).toBe(true)
    expect(werdyktWagi(750, 794.3, EURO).ok).toBe(false)
    expect(werdyktWagi(750, 787.5, JEDN).ok).toBe(true)
    expect(werdyktWagi(750, 788, JEDN).ok).toBe(false)
  })
})

describe('opisy', () => {
  it('pozycja i różnica', () => {
    expect(opisPozycji({ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: '' })).toBe('15 × 50 kg ZAGROS')
    expect(opisPozycji({ qty: 3, kgPerUnit: 12.5, recipeName: 'KIRMIZI', productTypeName: '' })).toBe('3 × 12,5 kg KIRMIZI')
    expect(roznicaPl(12.5)).toBe('+12,5 kg')
    expect(roznicaPl(-3)).toBe('−3 kg')
    expect(roznicaPl(0)).toBe('0 kg')
  })
})
