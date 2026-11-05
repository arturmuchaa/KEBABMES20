import { describe, it, expect } from 'vitest'
import { mapVehicleState } from './api'
import { koloryZamowien } from '@/features/magazyn/koloryZaladunku'

it('keeps server colour identity when order position changes or another order disappears', () => {
  const raw = { orders: Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, client_name: 'TEN SAM KLIENT', color_index: i, position: i })) }
  const before = koloryZamowien(mapVehicleState(raw).orders)
  const after = koloryZamowien(mapVehicleState({ orders: raw.orders.slice(1).reverse().map((o, i) => ({ ...o, position: i })) }).orders)
  expect(new Set(before.map(o => o.color.fill)).size).toBe(5)
  expect(after.map(o => o.color)).toEqual(before.slice(1).reverse().map(o => o.color))
})

it('carries the short trade name for the colour legend; older servers give an empty one', () => {
  const s = mapVehicleState({ orders: [{ id: 'o1', client_name: 'YBM Gastro GmbH', client_short_name: 'YALCIN' }, { id: 'o2', client_name: 'X' }] })
  expect(s.orders.map(o => [o.clientName, o.clientShortName])).toEqual([['YBM Gastro GmbH', 'YALCIN'], ['X', '']])
})

describe('skład kafelków załadunku', () => {
  it('zachowuje adres i obrót oraz rozróżnia brak miejsca od braku danych', () => {
    const location = { slot: 'C4', rotation: 90, revision: 'v1' }
    const state = mapVehicleState({ orders: [{ pallets: [{ location }, { location: null }, {}] }] })
    expect(state.orders[0].pallets.map(p => p.location)).toEqual([location, null, undefined])
  })
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
