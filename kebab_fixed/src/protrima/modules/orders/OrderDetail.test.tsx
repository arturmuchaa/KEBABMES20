// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import React from 'react'
import { mapClientOrder } from '@/lib/api'
import { AppCtx, type AppApi } from '../../shell/context'
import { mapujZamowienie } from '../../data/mapuj'
import { computeMetrics, kg, pct } from '../../data/model'
import { OrderDetail } from './OrderDetail'

/**
 * Operator widzi TRZY osobne miary (produkcja, pokrycie, wydano) — nigdy jeden
 * wspólny procent — i liczby równe wynikom lineShipping. Dane syntetyczne
 * w kształcie odpowiedzi /api/client-orders?planning=true.
 */
afterEach(cleanup)

const RAW = {
  id: 'o1', order_no: 'TEST/Z/1/10/26', client_id: 'c1', client_name: 'TEST', order_date: '2026-10-28',
  delivery_date: '2099-11-05', status: 'confirmed', created_at: '2026-10-28T09:00:00+00:00',
  fulfillment: { ordered_kg: 1000, stock_kg: 300, delivered_kg: 100, covered_kg: 400, remaining_kg: 600 },
  lines: [{
    id: 'l1', qty: 50, kg_per_unit: 20, total_kg: 1000, recipe_id: 'r1', recipe_name: 'KIRMIZI', product_type_name: 'KEBAB UDO 100%',
    packaging_name: 'METAL 65CM', qty_stock: 15, qty_delivered: 5, qty_done: 20,
    fulfillment: { ordered_kg: 1000, stock_kg: 300, delivered_kg: 100, covered_kg: 400, remaining_kg: 600 },
    production: { reported_qty: 35, reported_kg: 700, remaining_qty: 15, remaining_kg: 300, unposted_qty: 15, source: 'linked_plan_reports' },
    mixing: { remaining_qty: 30, remaining_kg: 600, meat_kg: 480.5, additives_kg: 119.5, output_per_100kg: 124.8, growth_pct: 24.8, reason: null, basis: 'stock_and_documents', source: 'x' },
  }],
}

const app = { toast: vi.fn(), openOrder: vi.fn(), gotoOrders: vi.fn(), gotoStock: vi.fn(), openModule: vi.fn(), newOrder: vi.fn(), setStatusCtx: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi

function mount() {
  const order = mapujZamowienie(mapClientOrder(RAW), { clients: [], pallets: {}, wz: [], planByLine: {} })
  render(<AppCtx.Provider value={app}><OrderDetail order={order} tab="overview" onTab={() => {}} mode="page" onConfirm={() => {}} /></AppCtx.Provider>)
  return { order, m: computeMetrics(order) }
}

describe('OrderDetail — trzy miary osobno', () => {
  it('nagłówek: produkcja 70%, pokrycie 40% z brakiem 600 kg, wydano 10%', () => {
    const { m } = mount()
    const figs = screen.getByLabelText('Kluczowe liczby')
    expect(m.prodPct).toBe(70)
    expect(m.coverPct).toBe(40)
    expect(m.shipPct).toBe(10)
    expect(within(figs).getByText('Produkcja').parentElement!.textContent).toContain(pct(70))
    expect(within(figs).getByText('Produkcja').parentElement!.textContent).toContain(kg(700))
    expect(within(figs).getByText('Pokrycie').parentElement!.textContent).toContain(pct(40))
    expect(within(figs).getByText('Pokrycie').parentElement!.textContent).toContain(`brak ${kg(600)}`)
    expect(within(figs).getByText('Wydano').parentElement!.textContent).toContain(pct(10))
  })

  it('przegląd: osobne opisy, pokrycie = magazyn + wydano', () => {
    mount()
    const box = screen.getByLabelText('Trzy osobne miary realizacji')
    expect(box.textContent).toContain(`W magazynie ${kg(300)} + wydano ${kg(100)}`)
    expect(box.textContent).toContain('nie zwiększa pokrycia')
  })

  it('następny krok: bez palet — „Rozpisz palety” (nie zapis, tylko przejście do zakładki)', () => {
    mount()
    expect(screen.getByRole('button', { name: /Rozpisz palety/ })).toBeTruthy()
    expect(app.toast).not.toHaveBeenCalled()
  })
})
