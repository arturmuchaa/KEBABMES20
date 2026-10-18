// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ClientOrder, OrderLine } from '@/lib/mockApi'
import { OrderPlanningSummary } from './OrderPlanningSummary'
import { meatKgText, mixingTotals, roundedMeatTotal, summarizeOrders } from './orderPlanning'

const line = (id: string, recipeId: string, meatKg: number | null): OrderLine => ({
  id, recipeId, recipeName: recipeId === 'r1' ? 'BEYAZ AFIYET' : 'KIRMIZI', qty: 100, kgPerUnit: 40, totalKg: 4000,
  productTypeId: 'udo', productTypeName: 'UDO', packagingName: 'METAL 65CM', qtyStock: 20, qtyDelivered: 10,
  fulfillment: { orderedKg: 4000, stockKg: 800, deliveredKg: 400, coveredKg: 1200, remainingKg: 2800 },
  mixing: { meatKg, remainingQty: 70, remainingKg: 2800, additivesKg: null, outputPer100kg: null, growthPct: null,
    basis: 'stock_and_documents', source: 'recipe_ingredients_per_100kg', reason: meatKg === null ? 'Brak składu' : null },
})
const summaryFor = (lines: OrderLine[]) => summarizeOrders([{ id: 'o', orderNo: 'Z/1', clientName: 'Klient', status: 'confirmed', lines } as ClientOrder])
const defaultLines = () => [line('a', 'r1', 1614.1), line('b', 'r1', 1614.2), line('c', 'r2', 10.1)]
afterEach(cleanup)

describe('KPI oraz zwijane zapotrzebowanie', () => {
  it('startuje z samymi KPI; klikanie i aktualizacja danych nie zmieniają zaznaczenia ani stanu rozwinięcia', () => {
    const onClear = vi.fn()
    const view = render(<OrderPlanningSummary summary={summaryFor(defaultLines())} count={1} hiddenCount={0} onClear={onClear} />)
    const toggle = screen.getByRole('button', { name: /Zapotrzebowanie na mięso/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Zestawienie receptur' })).toBeNull()
    expect(screen.getByRole('group', { name: 'W magazynie' }).textContent?.replace(/\s/g, ' ')).toContain('2 400 kg')
    expect(screen.getByRole('group', { name: 'Wydano' }).textContent?.replace(/\s/g, ' ')).toContain('1 200 kg')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Zestawienie receptur' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'BEYAZ AFIYET' }))
    view.rerender(<OrderPlanningSummary summary={summaryFor(defaultLines())} count={1} hiddenCount={1} onClear={onClear} />)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'BEYAZ AFIYET' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.queryByRole('region', { name: 'Zestawienie receptur' })).toBeNull()
    expect(onClear).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Odznacz wszystkie' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('zaokrągla w górę na recepturze, sumuje zaokrąglone receptury i nie zmienia dokładnych danych', () => {
    const lines = defaultLines(), summary = summaryFor(lines)
    render(<OrderPlanningSummary summary={summary} count={1} hiddenCount={0} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Zapotrzebowanie na mięso/ }))
    expect(screen.getByRole('heading', { name: /Mięso bazowe: 3\s240 kg/ })).toBeTruthy()
    const row = screen.getByRole('button', { name: 'BEYAZ AFIYET' }).closest('tr')!
    expect(within(row).getByText('3 229 kg')).toBeTruthy()
    expect(within(row).queryByText(/3 228,3 kg/)).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filtruj receptury' }), { target: { value: 'BEYAZ' } })
    expect(screen.queryByRole('button', { name: 'KIRMIZI' })).toBeNull()
    expect(screen.getByRole('heading', { name: /Mięso bazowe: 3\s240 kg/ })).toBeTruthy()
    expect(roundedMeatTotal(summary.recipes)).toBe(3240)
    expect(mixingTotals(lines.slice(0, 2)).meatKg).toBe(3228.3)
    expect(lines[0].mixing!.meatKg).toBe(1614.1)
  })

  it.each([[0, '0 kg'], [12, '12 kg'], [12.001, '13 kg'], [0.001, '1 kg'], [null, '—']] as const)('wyświetla %s jako %s', (value, result) => {
    expect(meatKgText(value)).toBe(result)
  })

  it('nieznane mięso nie staje się zerem ani sumą częściową; powód pozostaje dostępny', () => {
    const summary = summaryFor([line('a', 'r1', 1.1), line('b', 'r2', null)])
    expect(roundedMeatTotal(summary.recipes)).toBeNull()
    render(<OrderPlanningSummary summary={summary} count={1} hiddenCount={0} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Zapotrzebowanie na mięso/ }))
    expect(screen.getByRole('heading', { name: 'Mięso bazowe: —' })).toBeTruthy()
    expect(screen.getByText('KIRMIZI: Brak składu')).toBeTruthy()
  })
})
