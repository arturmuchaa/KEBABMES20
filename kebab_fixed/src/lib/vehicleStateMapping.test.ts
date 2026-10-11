import { describe, it, expect } from 'vitest'
import { mapVehicleState } from './api'

describe('skład kafelków załadunku', () => {
  it('odróżnia brak ważenia od starego serwera i zachowuje niezgodną wagę', () => {
    const s = mapVehicleState({ orders: [{ pallets: [{}, { weighing: null }, {
      weighing: { id: 'w1', gross_kg: '655.5', diff_kg: '-12', ok: false, weighed_at: '2026-10-11T10:00:00Z' },
    }] }] })
    expect(s.orders[0].pallets[0].weighing).toBeUndefined()
    expect(s.orders[0].pallets[1].weighing).toBeNull()
    expect(s.orders[0].pallets[2].weighing).toEqual({ id: 'w1', grossKg: 655.5, diffKg: -12, ok: false, weighedAt: '2026-10-11T10:00:00Z' })
  })
  it('zachowuje recepturę, rodzaj i tuleję przy tej samej wadze', () => {
    const state = mapVehicleState({ orders: [{ id: 'o1', pallets: [{ items: [
      { qty: '12', kg_per_unit: '70', recipe_name: 'BEYAZ', product_type_name: 'UDO', packaging_name: '80 cm' },
      { qty: 3, kg_per_unit: 70, recipe_name: 'BEYAZ', packaging_name: '100 cm' },
    ] }] }] })
    expect(state.orders[0].pallets[0].items).toEqual([
      { qty: 12, kgPerUnit: 70, recipeName: 'BEYAZ', productTypeName: 'UDO', packagingName: '80 cm' },
      { qty: 3, kgPerUnit: 70, recipeName: 'BEYAZ', productTypeName: '', packagingName: '100 cm' },
    ])
  })
  it('obsługuje stary serwer bez nazw i bez items', () => {
    const state = mapVehicleState({ orders: [{ pallets: [{ items: [{ qty: 2, kg_per_unit: 30 }] }, {}] }] })
    expect(state.orders[0].pallets[0].items[0].recipeName).toBe('')
    expect(state.orders[0].pallets[1].items).toEqual([])
  })
})
