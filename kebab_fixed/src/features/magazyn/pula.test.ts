import { describe, it, expect } from 'vitest'
import { etykietaDnia, pulaPoDniach, krotkaData } from './pula'

const DZIS = new Date(2026, 8, 25)

describe('pula do spakowania po dniach', () => {
  it('dziś i wczoraj to normalna robota, starsze to zaległe', () => {
    expect(etykietaDnia('2026-09-25', DZIS)).toEqual({ etykieta: 'dziś', zalegle: false })
    expect(etykietaDnia('2026-09-24', DZIS)).toEqual({ etykieta: 'wczoraj', zalegle: false })
    expect(etykietaDnia('2026-09-22', DZIS).zalegle).toBe(true)
    expect(etykietaDnia('', DZIS).zalegle).toBe(true)
  })

  it('wczoraj liczy się przez granicę miesiąca', () => {
    expect(etykietaDnia('2026-08-31', new Date(2026, 8, 1)).etykieta).toBe('wczoraj')
  })

  it('grupuje po dniu i sumuje sztuki, kolejność z backendu', () => {
    const p = (d: string, qty: number) => ({ producedDate: d, clientName: 'X', recipeName: 'R',
      productTypeName: '', tuleja: '', kgPerUnit: 15, qty })
    const dni = pulaPoDniach([p('2026-09-18', 3), p('2026-09-24', 30), p('2026-09-24', 2)], DZIS)
    expect(dni.map(d => [d.data, d.sztuk, d.zalegle])).toEqual([
      ['2026-09-18', 3, true], ['2026-09-24', 32, false]])
  })

  it('krótka data', () => {
    expect(krotkaData('2026-09-18')).toBe('18.09')
    expect(krotkaData('')).toBe('—')
  })
})
