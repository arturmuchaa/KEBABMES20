import { describe, expect, it } from 'vitest'
import { mapClientOrder, mapOrderFulfillment } from './api'

describe('mapowanie pokrycia zamówienia', () => {
  it('zachowuje kilogramy pozycji i dokumentu oraz źródło historyczne', () => {
    const raw = { ordered_kg: '201.25', stock_kg: '40.25', delivered_kg: '60.375', covered_kg: '100.625', remaining_kg: '100.625' }
    const result = mapClientOrder({ id: 'o', coverage_basis: 'closed_order', fulfillment: raw, lines: [{ id: 'l', fulfillment: raw, packaging_name: 'METAL 80 cm' }] })
    expect(result.fulfillment).toEqual({ orderedKg: 201.25, stockKg: 40.25, deliveredKg: 60.375, coveredKg: 100.625, remainingKg: 100.625 })
    expect(result.lines[0].fulfillment).toEqual(result.fulfillment)
    expect(result.lines[0].packagingName).toBe('METAL 80 cm')
    expect(result.coverageBasis).toBe('closed_order')
  })

  it.each([undefined, null, {}, { ordered_kg: 'bad' }, { ordered_kg: 0, stock_kg: null }])('nie maskuje niepełnych danych (%s) zerami', raw => {
    expect(mapOrderFulfillment(raw)).toBeNull()
  })
})
