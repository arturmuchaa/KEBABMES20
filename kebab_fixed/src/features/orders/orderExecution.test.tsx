// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OrderLinesTable } from './OrderLinesTable'
import { productionTotals, mixingTotals, summarizeOrders } from './orderPlanning'
import type { ClientOrder, OrderLine } from '@/lib/mockApi'
import { mapClientOrder, toSnakeOrderDto } from '@/lib/api'

const line = (qty: number, weight: number, done: number): OrderLine => ({ id: `${weight}`, qty, kgPerUnit: weight, recipeId: 'r', recipeName: 'BEYAZ', productTypeId: 'udo', productTypeName: 'UDO', totalKg: qty * weight,
  production: { reportedQty: done, reportedKg: done * weight, remainingQty: Math.max(0, qty - done), remainingKg: Math.max(0, qty - done) * weight, unpostedQty: 0, source: 'linked_plan_reports' },
  mixing: { remainingQty: Math.max(0, qty - done), remainingKg: Math.max(0, qty - done) * weight, meatKg: Math.max(0, qty - done) * weight / 1.25, additivesKg: Math.max(0, qty - done) * weight / 5, growthPct: 25, outputPer100kg: 125, reason: null, source: 'recipe_ingredients_per_100kg', basis: 'stock_and_documents' },
})
afterEach(cleanup)
describe('Realizacja sztuk i mieszanie', () => {
  it('zapis zachowuje identyfikator pozycji i uwagi, więc nie zrywa powiązań palet', () => {
    const dto = toSnakeOrderDto({ clientId: 'c', orderDate: '2026-10-15', lines: [{ id: 'saved-line', qty: 40, kgPerUnit: 20, productTypeId: 'udo', recipeId: 'r', packagingId: '65', notes: 'Wariant handlowy' }] })
    expect(dto.lines[0]).toMatchObject({ id: 'saved-line', notes: 'Wariant handlowy', packaging_id: '65', qty: 40, kg_per_unit: 20 })
  })
  it('pokazuje 5/40 i 18/20, pozostałe 700 kg i 80 kg oraz wariant', () => {
    const a = line(40, 20, 5), b = line(20, 40, 18)
    a.packagingName = 'Tuleja 65 cm'; b.packagingName = 'Tuleja 80 cm'
    const view = render(<OrderLinesTable order={{ id: 'o', orderNo: 'Z/1', status: 'confirmed', lines: [a, b] } as ClientOrder} />)
    const values = [...view.container.querySelectorAll('.order-production > strong')].map(n => n.textContent)
    expect(values).toEqual(['5 / 40 szt.', '18 / 20 szt.'])
    expect(screen.getAllByText('700 kg').length).toBeGreaterThan(0)
    expect(screen.getAllByText('80 kg').length).toBeGreaterThan(0)
    expect(view.container.textContent).toContain('Tuleja 80 cm')
  })
  it('nadwyżka innego wariantu nie ukrywa braków, procent jest ważony masą', () => {
    const lines = [line(10, 20, 15), line(10, 40, 0)]
    expect(productionTotals(lines).remainingKg).toBe(400)
    expect(productionTotals(lines).percent).toBeCloseTo(100 / 3)
  })
  it('brak danych jednego wariantu nie zamienia sumy mięsa na częściową', () => {
    const lines = [line(10, 20, 5), { ...line(10, 40, 0), production: null, mixing: null }]
    expect(productionTotals(lines).reportedKg).toBeNull()
    expect(mixingTotals(lines).meatKg).toBeNull()
  })
  it('sumowanie po recepturze zachowuje różne typy i gramatury', () => {
    const lines = [line(40, 20, 5), { ...line(20, 40, 18), productTypeId: 'mix' }]
    const summary = summarizeOrders([{ id: 'o', status: 'confirmed', lines } as ClientOrder])
    expect(summary.recipes).toHaveLength(1)
    expect(summary.recipes[0].details).toHaveLength(2)
    expect(mixingTotals(summary.recipes[0].details.map(d => d.line)).meatKg).toBe(624)
  })
  it('mapper zachowuje nowe projekcje, zero oraz nieznane wartości bez zerowania', () => {
    const order = mapClientOrder({ lines: [{ id: 'l', production: { reported_qty: '5', reported_kg: '100', remaining_qty: 35, remaining_kg: 700, unposted_qty: 0, source: 'linked_plan_reports' }, mixing: { remaining_qty: 35, remaining_kg: 700, meat_kg: 560, additives_kg: 140, growth_pct: 25, output_per_100kg: 125 } }] })
    expect(order.lines[0].production?.reportedQty).toBe(5)
    expect(order.lines[0].mixing?.meatKg).toBe(560)
    expect(mapClientOrder({ lines: [{}] }).lines[0].production).toBeNull()
    expect(mapClientOrder({ lines: [{ mixing: { meat_kg: null } }] }).lines[0].mixing?.meatKg).toBeNull()
  })
})
