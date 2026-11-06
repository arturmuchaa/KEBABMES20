// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { mapClientOrder, type ZaladunekDoWydruku } from '@/lib/api'
import { AppCtx, type AppApi } from '../../../shell/context'
import { computeMetrics, TODAY, addDays } from '../../../data/model'
import { mapujZamowienie } from '../../../data/mapuj'
import { DoZrobieniaPanel } from './DoZrobienia'

/** Zamówienia w kształcie API (syntetyczne): jedna pozycja 20 × 40 kg. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const zam = (id: string, o: Record<string, unknown> = {}, linia: Record<string, unknown> = {}) => {
  const z = mapujZamowienie(mapClientOrder({
    id, order_no: `${id.toUpperCase()}/Z/1/11/26`, client_name: 'KLIENT', status: 'confirmed', order_date: iso(TODAY),
    lines: [{ id: `${id}-a`, qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 0, qty_delivered: 0, ...linia }],
    ...o,
  } as never), { clients: [], pallets: { [id]: [] }, wz: [], planByLine: {} })
  return { o: z, m: computeMetrics(z) }
}
const kurs = (id: string): ZaladunekDoWydruku => ({ id, plate: `KR${id}`, finishedAt: '', klienci: ['KLIENT'], dokumentow: 0, rozjazd: false, doWystawienia: true })
const app = { gotoOrders: vi.fn(), openKurs: vi.fn(), openModule: vi.fn() }
const mount = (p: Partial<React.ComponentProps<typeof DoZrobieniaPanel>>) =>
  render(<AppCtx.Provider value={app as unknown as AppApi}><DoZrobieniaPanel open={[]} pending={0} haccp={0} kursy={[]} {...p} /></AppCtx.Provider>)
const pas = (tytul: string) => screen.getByRole('heading', { name: new RegExp(`^${tytul}`) }).parentElement as HTMLElement
afterEach(cleanup)
beforeEach(() => Object.values(app).forEach(f => f.mockReset()))

describe('Pulpit B — Do zrobienia teraz', () => {
  it('pilne zamówienie bez wyrobu w pasie „Rozpisz palety”: brak widać przy pozycji i w stopce „Czekamy na: wyrób”', () => {
    // Przegląd 0.6.0: krok „palety” chował brak wyrobu — stopka pokazywała 0 zamówień, wbrew Przebiegowi dnia.
    const { container } = mount({ open: [zam('a', { delivery_date: iso(addDays(TODAY, 1)) }), zam('b', { delivery_date: iso(addDays(TODAY, 9)) })] })
    expect(within(pas('Rozpisz palety')).getByText(/brak 800 kg/)).toBeTruthy()
    const stopka = container.querySelector('.todo-wait') as HTMLElement
    expect(stopka.textContent).toContain('wyrób 2 zamówienia')
    expect(stopka.textContent).toContain('(1 z wyjazdem dziś/jutro lub po terminie)')
  })

  it('„i jeszcze N…” w pasie kursów przewija do panelu kursów, a w pasie szkiców otwiera widok Szkice', () => {
    const ship = document.createElement('section'); ship.className = 'p-ship'; ship.scrollIntoView = vi.fn()
    const dash = document.createElement('div'); dash.className = 'dash'; dash.appendChild(ship); document.body.appendChild(dash)
    try {
      mount({ kursy: ['1', '2', '3', '4', '5'].map(kurs), open: ['s1', 's2', 's3', 's4', 's5'].map(id => zam(id, { status: 'draft' })) })
      fireEvent.click(within(pas('Papiery kursu')).getByRole('button', { name: /i jeszcze 1/ }))
      expect(ship.scrollIntoView).toHaveBeenCalled()
      expect(app.gotoOrders).not.toHaveBeenCalled()
      fireEvent.click(within(pas('Potwierdź')).getByRole('button', { name: /i jeszcze 1/ }))
      expect(app.gotoOrders).toHaveBeenCalledWith({ view: 'drafts' })
    } finally { dash.remove() }
  })

  it('pas „Kontrola HACCP” liczy dostawy, nie jedną zbiorczą pozycję', () => {
    mount({ haccp: 5 })
    expect(within(pas('Kontrola HACCP')).getByText('5', { selector: '.badge' })).toBeTruthy()
    expect(screen.getByText(/^5 czynności dla biura/)).toBeTruthy()
  })
})
