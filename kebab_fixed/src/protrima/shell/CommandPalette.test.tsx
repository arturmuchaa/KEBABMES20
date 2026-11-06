// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { mapClientOrder, type WzDoc } from '@/lib/api'
import { mapujZamowienie } from '../data/mapuj'
import type { StockPos } from '../data/stock'
import { CommandPalette } from './CommandPalette'

/** Zamówienia w kształcie API (syntetyczne). */
const zam = (id: string, no: string, client: string, status = 'confirmed', wz: WzDoc[] = []) => mapujZamowienie(mapClientOrder({
  id, order_no: no, client_name: client, status,
  lines: [{ id: `${id}-a`, qty: 10, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 0 }],
} as never), { clients: [], pallets: { [id]: [] }, wz, planByLine: {} })
const wyrob = (o: Partial<StockPos>): StockPos => ({
  id: 'fg1', product: 'KEBAB UDO', recipe: 'BEYAZ AFIYET', kgPerUnit: 25, packaging: '', batch: '291026 669', location: '', qty: 7,
  cartons: [], status: 'stock', movements: [], seasonedBatches: [], producedBy: [], ...o,
} as StockPos)

const fn = () => ({ onClose: vi.fn(), openOrder: vi.fn(), openModule: vi.fn(), newOrder: vi.fn(), newReception: vi.fn(), gotoStock: vi.fn(), gotoOrders: vi.fn(), toggleTheme: vi.fn(), toggleNav: vi.fn(), showShortcuts: vi.fn() })
const mount = (p: { orders?: ReturnType<typeof zam>[]; stock?: StockPos[] } = {}) => {
  const f = fn()
  render(<CommandPalette orders={p.orders ?? []} stock={p.stock ?? []} {...f} />)
  return f
}
const szukaj = (t: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Szukaj' }), { target: { value: t } })
const wyniki = () => screen.queryAllByRole('option')
afterEach(cleanup)

describe('paleta poleceń (Ctrl+K)', () => {
  it('numer partii wyrobu gotowego znajduje wiersz magazynu i otwiera go w Wyrobie gotowym', () => {
    // Przegląd (UX-10): pole obiecywało „wyrobu, partii”, a dla „669” mówiło „Nic nie znaleziono”.
    const f = mount({ stock: [wyrob({}), wyrob({ id: 'fg2', batch: '271026 657', recipe: 'KIRMIZI' })] })
    szukaj('669')
    expect(screen.getByText('Wyrób gotowy')).toBeTruthy()
    expect(wyniki()).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Szukaj' }), { key: 'Enter' })
    expect(f.gotoStock).toHaveBeenCalledWith('fg1')
  })

  it('„nowe przyj” → polecenie „Nowe przyjęcie surowca”', () => {
    const f = mount()
    szukaj('nowe przyj')
    // Po treści, nie po nazwie dostępnej: jsdom liczy ją z odstępami między wyróżnionymi fragmentami (<mark>).
    const opcja = wyniki().find(o => o.textContent === 'Nowe przyjęcie surowca')
    expect(opcja).toBeTruthy()
    fireEvent.click(opcja!)
    expect(f.newReception).toHaveBeenCalled()
  })

  it('aktywne zamówienia przed zamkniętymi; zamkniętych najwyżej 3, resztę pokazuje lista Zamówień', () => {
    const zamkniete = [1, 2, 3, 4, 5].map(i => zam(`d${i}`, `YALCIN/Z/${i}/09/26`, 'YALCIN', 'done'))
    const f = mount({ orders: [...zamkniete, zam('a1', 'YALCIN/Z/7/10/26', 'YALCIN')] })
    szukaj('yal')
    const teksty = wyniki().map(o => o.textContent ?? '')
    expect(teksty[0]).toContain('YALCIN/Z/7/10/26')
    expect(teksty.filter(t => /YALCIN\/Z\/\d\/09\/26/.test(t))).toHaveLength(3)
    fireEvent.click(screen.getByRole('option', { name: /Pokaż wszystkie zamknięte \(5\)/ }))
    expect(f.gotoOrders).toHaveBeenCalledWith({ view: 'closed', q: 'yal' })
  })

  it('numer rejestracyjny przy zrealizowanym zamówieniu jest podpisany („auto …”)', () => {
    const wz = [{ id: 'w1', number: 'WZ/1', status: 'zatwierdzony', source_type: 'order', source_id: 'd1', vehicle_plate: 'KRA613FC', loaded_at: '2026-10-30T07:00:00Z', valued: false, lines: [], total_value: 0 }] as WzDoc[]
    mount({ orders: [zam('d1', 'ISSA/Z/3/10/26', 'ISSA', 'done', wz)] })
    szukaj('issa')
    expect(screen.getByText(/auto KRA613FC/)).toBeTruthy()
  })

  it('wpisany fragment jest wyróżniony w wyniku', () => {
    mount({ orders: [zam('a1', 'YALCIN/Z/7/10/26', 'YALCIN')] })
    szukaj('yal')
    expect([...document.querySelectorAll('.palette mark')].map(m => m.textContent?.toLowerCase())).toContain('yal')
  })
})
