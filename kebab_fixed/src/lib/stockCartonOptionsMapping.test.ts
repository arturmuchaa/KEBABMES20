import { describe, it, expect } from 'vitest'
import { mapStockCartonOption, mapStockCartonOptions } from './api'

/**
 * Przegląd kartonów z magazynu dla zamówienia (stock-carton-options).
 * Pole, które mapper po cichu zgubi, przechodzi przez kompilator i znika
 * dopiero na ekranie — np. powód blokady albo liczba przypisanych sztuk.
 */
const kartonSnake = {
  carton_id: 'c1', carton_no: 101, client_name: 'DÖNER GMBH', generic: false,
  status: 'packed', in_cold_storage: true, loaded: true, shipped: false,
  packed_qty: 6, target_qty: 6, units: 6, batches: ['P-77', 12],
  lines: [{ recipe_name: 'KIRMIZI', product_type_name: 'KEBAB', packaging_name: 'TULEJA 30', kg_per_unit: '17.5', packed_qty: 6, target_qty: 6 }],
  reason: 'inna tuleja', can_detach: false, detach_blocked_reason: 'karton jest na aucie',
}

describe('mapStockCartonOption', () => {
  it('przepisuje wszystkie pola z snake_case', () => {
    const c = mapStockCartonOption(kartonSnake)
    expect(c).toEqual({
      cartonId: 'c1', cartonNo: 101, clientName: 'DÖNER GMBH', generic: false,
      status: 'packed', inColdStorage: true, loaded: true, shipped: false,
      packedQty: 6, targetQty: 6, units: 6, scannerless: false, batches: ['P-77', '12'],
      lines: [{ recipeName: 'KIRMIZI', productTypeName: 'KEBAB', packagingName: 'TULEJA 30', kgPerUnit: 17.5, packedQty: 6, targetQty: 6 }],
      reason: 'inna tuleja', canDetach: false, detachBlockedReason: 'karton jest na aucie',
    })
  })

  it('przepisuje camelCase i flagi prawdziwe', () => {
    const c = mapStockCartonOption({
      cartonId: 'c2', cartonNo: 5, generic: true, inColdStorage: false, canDetach: true,
      detachBlockedReason: null, units: 3, packedQty: 3, targetQty: 4, scannerless: true,
    })
    expect(c.scannerless).toBe(true)
    expect(c.cartonId).toBe('c2')
    expect(c.generic).toBe(true)
    expect(c.canDetach).toBe(true)
    expect(c.detachBlockedReason).toBeNull()
    expect(c.units).toBe(3)
    expect(c.targetQty).toBe(4)
  })

  it('braki i wartości falsy dają bezpieczne domyślne, a nie undefined/NaN', () => {
    const c = mapStockCartonOption({})
    expect(c).toEqual({
      cartonId: '', cartonNo: null, clientName: '', generic: false, status: '',
      inColdStorage: false, loaded: false, shipped: false,
      packedQty: 0, targetQty: 0, units: 0, scannerless: false, batches: [], lines: [],
      reason: null, canDetach: false, detachBlockedReason: null,
    })
    // Zero sztuk to zero, nie brak — i nie przechodzi w „domyślne" coś innego.
    const z = mapStockCartonOption({ carton_no: 0, units: 0, generic: 0, can_detach: 0, batches: 'P-1' })
    expect(z.cartonNo).toBe(0)
    expect(z.units).toBe(0)
    expect(z.generic).toBe(false)
    expect(z.canDetach).toBe(false)
    expect(z.batches).toEqual([])
  })
})

describe('mapStockCartonOptions', () => {
  it('przepisuje nagłówek, trzy listy i sumy przypisanych', () => {
    const o = mapStockCartonOptions({
      order_id: 'o1', order_no: 'ZAM/7', order_status: 'confirmed',
      assign_blocked_reason: 'wystawiono WZ/3',
      available: [kartonSnake], assigned: [kartonSnake, kartonSnake], unavailable: [],
      assigned_totals: { cartons: 2, units: '12' },
    })
    expect(o.orderId).toBe('o1')
    expect(o.orderNo).toBe('ZAM/7')
    expect(o.orderStatus).toBe('confirmed')
    expect(o.assignBlockedReason).toBe('wystawiono WZ/3')
    expect(o.available).toHaveLength(1)
    expect(o.assigned).toHaveLength(2)
    expect(o.assigned[0].cartonNo).toBe(101)
    expect(o.unavailable).toEqual([])
    expect(o.assignedTotals).toEqual({ cartons: 2, units: 12 })
  })

  it('camelCase z serwera też działa', () => {
    const o = mapStockCartonOptions({ orderId: 'o2', assignBlockedReason: null, assignedTotals: { cartons: 1, units: 4 } })
    expect(o.orderId).toBe('o2')
    expect(o.assignBlockedReason).toBeNull()
    expect(o.assignedTotals).toEqual({ cartons: 1, units: 4 })
  })

  it('pusta / null odpowiedź: puste listy, zerowe sumy, brak blokady', () => {
    for (const r of [null, undefined, {}]) {
      expect(mapStockCartonOptions(r)).toEqual({
        orderId: '', orderNo: '', orderStatus: '', assignBlockedReason: null,
        available: [], assigned: [], unavailable: [],
        assignedTotals: { cartons: 0, units: 0 },
      })
    }
  })
})
