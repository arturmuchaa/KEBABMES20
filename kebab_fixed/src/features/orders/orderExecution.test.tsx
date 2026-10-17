// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OrderLinesTable } from './OrderLinesTable'
import { progressTotals, lineProgress, mixingTotals, summarizeOrders } from './orderPlanning'
import type { ClientOrder, OrderLine } from '@/lib/mockApi'
import { mapClientOrder, toSnakeOrderDto } from '@/lib/api'

const line = (qty: number, weight: number, done: number): OrderLine => ({ id: `${weight}`, qty, kgPerUnit: weight, recipeId: 'r', recipeName: 'BEYAZ', productTypeId: 'udo', productTypeName: 'UDO', totalKg: qty * weight,
  qtyDone: Math.min(qty, done), qtyStock: done, qtyDelivered: 0,
  fulfillment: { orderedKg: qty * weight, stockKg: Math.min(qty, done) * weight, deliveredKg: 0, coveredKg: Math.min(qty, done) * weight, remainingKg: Math.max(0, qty - done) * weight },
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
    const values = [...view.container.querySelectorAll('.order-progress-heading > strong')].map(n => n.textContent)
    expect(values).toEqual(['5 / 40 szt.', '18 / 20 szt.'])
    expect(screen.getAllByText('700 kg').length).toBeGreaterThan(0)
    expect(screen.getAllByText('80 kg').length).toBeGreaterThan(0)
    expect(view.container.textContent).toContain('Tuleja 80 cm')
  })
  it('nadwyżka innego wariantu nie ukrywa braków, procent jest ważony masą', () => {
    const lines = [line(10, 20, 15), line(10, 40, 0)]
    expect(progressTotals(lines).remainingKg).toBe(400)
    expect(progressTotals(lines).percent).toBeCloseTo(100 / 3)
    expect(progressTotals(lines).readyQty).toBe(10)
  })
  it('pełny magazyn bez raportów oznacza GOTOWE 45/45, a nie fałszywe zero', () => {
    const position = {
      ...line(45, 50, 0), recipeName: 'KIRMIZI', packagingName: 'METAL 65CM', qtyStock: 45, qtyDelivered: 0,
      fulfillment: { orderedKg: 2250, stockKg: 2250, deliveredKg: 0, coveredKg: 2250, remainingKg: 0 },
      mixing: { ...line(45, 50, 0).mixing!, remainingQty: 0, remainingKg: 0, meatKg: 0, additivesKg: 0 },
      notes: 'Zachowana uwaga pozycji',
    }
    const view = render(<OrderLinesTable order={{ id: 'o', orderNo: 'ZAGROS/Z/4/10/26', status: 'confirmed', lines: [position] } as ClientOrder} />)
    expect(view.container.querySelector('.order-production')?.textContent).toContain('45 / 45 szt.')
    expect(view.container.querySelector('.order-line-remaining')?.textContent).toContain('0 kg0 szt.')
    expect(view.container.textContent).not.toContain('Brak raportów')
    expect(view.container.textContent).toContain('Magazyn: 45 · Wydano: 0 szt.')
    expect(screen.getByText('Zachowana uwaga pozycji')).toBeTruthy()
    expect(screen.getByText(/METAL 65CM/)).toBeTruthy()
  })
  it('brak danych jednego wariantu nie zamienia sumy mięsa na częściową', () => {
    const lines = [line(10, 20, 5), { ...line(10, 40, 0), fulfillment: null, mixing: null }]
    expect(progressTotals(lines).readyKg).toBeNull()
    expect(mixingTotals(lines).meatKg).toBeNull()
  })
  it('raporty planów nie zwiększają GOTOWE bez magazynu', () => {
    const p = { ...line(120, 15, 0), production: line(120, 15, 120).production }
    expect(lineProgress(p)).toMatchObject({ readyQty: 0, remainingQty: 120, remainingKg: 1800, percent: 0 })
    expect(progressTotals([p]).readyQty).toBe(0)
  })
  it('wydanie z magazynu nie cofa postępu i nie dolicza raportu drugi raz', () => {
    const before = line(120, 15, 30)
    const after = { ...before, qtyStock: 20, qtyDelivered: 10,
      fulfillment: { ...before.fulfillment!, stockKg: 300, deliveredKg: 150 } }
    expect(lineProgress(after)).toMatchObject({ readyQty: 30, remainingQty: 90, remainingKg: 1350, percent: 25 })
    expect(progressTotals([after])).toEqual(progressTotals([before]))
  })
  it('brak raportów nie blokuje postępu przy wiarygodnym magazynie', () => {
    expect(lineProgress({ ...line(120, 15, 30), production: null })).toMatchObject({ readyQty: 30, readyKg: 450 })
  })
  it.each([undefined, -1, NaN, Infinity, 2.5])('nieprawidłowa ilość magazynowa %s nie oznacza zera', qtyStock => {
    expect(lineProgress({ ...line(120, 15, 0), qtyStock })).toBeNull()
  })
  it('niespójne kilogramy pokrycia nie generują sprzecznych sztuk postępu', () => {
    expect(lineProgress({ ...line(120, 15, 0), qtyStock: 20 })).toBeNull()
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
