import { describe, expect, it } from 'vitest'
import type { ClientOrder, OrderLine } from '@/lib/mockApi'
import { coveragePercent, productionState, summarizeOrders, totalLines } from './orderPlanning'

function line(id: string, qty = 10, kg = 20, stock = 0, delivered = 0): OrderLine {
  return { id, qty, kgPerUnit: kg, totalKg: qty * kg, recipeId: 'r1', recipeName: 'BEYAZ', productTypeId: 'udo', productTypeName: 'UDO', packagingId: '65', packagingName: 'METAL 65 cm',
    fulfillment: { orderedKg: qty * kg, stockKg: stock * kg, deliveredKg: delivered * kg, coveredKg: (stock + delivered) * kg, remainingKg: (qty - stock - delivered) * kg } }
}
function order(id: string, lines: OrderLine[], clientId = 'c1', status: ClientOrder['status'] = 'confirmed'): ClientOrder {
  return { id, orderNo: `Z/${id}`, clientId, clientName: clientId, status, lines, orderDate: '', createdAt: '', totalUnits: 0, totalKg: 0 }
}

describe('podsumowanie zamówień', () => {
  it.each([[0, 0, 'none', 200], [3, 2, 'partial', 100], [10, 0, 'complete', 0], [0, 10, 'complete', 0]] as const)(
    'stan %s i wydania %s pozostają odrębne', (stock, delivered, state, remaining) => {
      const result = summarizeOrders([order('1', [line('l', 10, 20, stock, delivered)])])
      expect(result.totals.remainingKg).toBe(remaining)
      expect(result.totals.stockKg).toBe(stock * 20)
      expect(result.totals.deliveredKg).toBe(delivered * 20)
      expect(productionState(result.totals)).toBe(state)
    })

  it('sumuje po identyfikatorze receptury ponad klientami, nie scala wariantów', () => {
    const a = order('a', [line('a1', 10, 20, 3)])
    const b = order('b', [{ ...line('b1', 4, 40, 1), packagingId: '80', packagingName: 'METAL 80 cm' }])
    const c = order('c', [{ ...line('c1', 2, 30, 0, 1), productTypeId: 'mix', productTypeName: 'MIX' }], 'c2')
    const result = summarizeOrders([a, b, c])
    expect(result.recipes).toHaveLength(1)
    expect(result.recipes[0].details.map(d => d.line.id)).toEqual(['a1', 'b1', 'c1'])
    expect(result.totals).toEqual({ orderedKg: 420, coveredKg: 130, stockKg: 100, deliveredKg: 30, remainingKg: 290 })
    expect(result.recipes[0].totals).toEqual(result.totals)
  })

  it('identyczna nazwa nie łączy różnych receptur ani nieznanych identyfikatorów', () => {
    const result = summarizeOrders([order('a', [line('1'), { ...line('2'), recipeId: 'r2' }, { ...line('3'), recipeId: '' }, { ...line('4'), recipeId: '' }])])
    expect(result.recipes).toHaveLength(4)
  })

  it('procent jest ważony kilogramami, nie sztukami', () => {
    const totals = totalLines([line('small', 1, 10, 1), line('large', 1, 90)])
    expect(coveragePercent(totals)).toBe(10)
  })

  it('anulowane nie zwiększa zapotrzebowania; zamknięte i szkice są oznaczone', () => {
    const result = summarizeOrders([order('a', [line('1')], 'c', 'cancelled'), order('b', [line('2', 10, 20, 0, 10)], 'c', 'done'), order('c', [line('3')], 'c', 'draft')])
    expect(result.excludedCount).toBe(1)
    expect(result.closedCount).toBe(1)
    expect(result.draftCount).toBe(1)
    expect(result.totals.remainingKg).toBe(200)
    expect(result.totals.orderedKg).toBe(400)
  })

  it('brak danych nie udaje zera produkcji ani pełnego zapotrzebowania', () => {
    const result = summarizeOrders([order('a', [{ ...line('1'), fulfillment: null, qtyDone: 10 }])])
    expect(result.totals.orderedKg).toBe(200)
    expect(result.totals.remainingKg).toBeNull()
    expect(result.totals.coveredKg).toBeNull()
    expect(result.unknownCount).toBe(1)
  })

  it('małe masy sumują się dokładnie, suma receptur zgadza się z całością', () => {
    const result = summarizeOrders([order('a', [line('1', 1, 0.1), { ...line('2', 1, 0.2), recipeId: 'other' }])])
    expect(result.totals.orderedKg).toBe(0.3)
    expect(Math.round(result.recipes.reduce((s, r) => s + r.totals.orderedKg, 0) * 1000)).toBe(300)
    expect(summarizeOrders([]).totals.remainingKg).toBe(0)
  })
})
