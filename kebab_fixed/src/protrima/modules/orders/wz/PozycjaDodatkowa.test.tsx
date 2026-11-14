// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'

const wz = vi.hoisted(() => ({ stockRaw: vi.fn() }))
vi.mock('@/lib/api', async (orig) => { const o = await orig() as Record<string, object>; return { ...o, wzApi: { ...o.wzApi, ...wz } } })
import { PozycjaDodatkowaForm, grupujPartie, pasuje } from './PozycjaDodatkowa'

const PARTIE = [
  { id: 'r1', stock_type: 'raw', internal_batch_no: '731', name: 'Łój wołowy otokowy', supplier_name: 'ZM BIELSKO', kg_available: 120, expiry_date: '2026-11-28' },
  { id: 'r2', stock_type: 'raw', internal_batch_no: '740', name: 'Łój wołowy otokowy', supplier_name: 'ZM BIELSKO', kg_available: 60, expiry_date: '2026-11-20' },
  { id: 'r3', stock_type: 'raw', internal_batch_no: '735', name: 'Łój wołowy zwykły', supplier_name: 'ZM BIELSKO', kg_available: 80, expiry_date: '2026-12-02' },
  { id: 'm1', stock_type: 'meat', internal_batch_no: '714-ZS', name: 'Mięso z/s', supplier_name: 'DROBEX S.A.', kg_available: 720, expiry_date: '2026-11-18' },
  { id: 'b1', stock_type: 'byproduct', internal_batch_no: '701', name: 'Kości z kurczaka', supplier_name: '', kg_available: 300, expiry_date: null },
]
afterEach(cleanup)
beforeEach(() => { wz.stockRaw.mockReset(); wz.stockRaw.mockResolvedValue(PARTIE) })

describe('wyszukiwanie i grupy surowca', () => {
  it('bez polskich znaków i wielkości liter: „loj”, „łoj”, „ŁÓJ” znajdują łój; po partii i dostawcy też', () => {
    const p = PARTIE[0] as never
    for (const q of ['loj', 'łoj', 'ŁÓJ', 'otok', '731', 'bielsko']) expect(pasuje(p, q)).toBe(true)
    expect(pasuje(p, 'kości')).toBe(false)
    expect(pasuje(PARTIE[4] as never, 'kosci')).toBe(true)
  })
  it('grupy po nazwie: suma wolnych kg, liczba partii, partie od najkrótszego terminu', () => {
    const g = grupujPartie(PARTIE as never, {})
    const loj = g.find(x => x.nazwa === 'Łój wołowy otokowy')!
    expect([loj.kg, loj.partie.length, loj.partie[0].p.internal_batch_no]).toEqual([180, 2, '740'])
  })
})

describe('zakładka „Z magazynu surowca”', () => {
  const mount = (onDodaj = vi.fn()) => { render(<PozycjaDodatkowaForm start="surowiec" waluta="PLN" vatDomyslny={5} wartosciowy onDodaj={onDodaj} />); return onDodaj }
  it('lista rodzajów z kg; klik w rodzaj pokazuje jego partie; „loj” zawęża do łoju', async () => {
    mount()
    const rodzaje = await screen.findByRole('listbox', { name: 'Rodzaje surowca' })
    expect(within(rodzaje).getByText('Łój wołowy otokowy')).toBeTruthy()
    expect(within(rodzaje).getByText('180 kg')).toBeTruthy()
    fireEvent.click(within(rodzaje).getByText('Łój wołowy otokowy'))
    const partie = screen.getByRole('table', { name: 'Partie surowca' })
    expect(within(partie).getAllByRole('row').length).toBe(3)   // nagłówek + 2 partie
    fireEvent.change(screen.getByLabelText('Szukaj surowca'), { target: { value: 'loj' } })
    expect(within(screen.getByRole('listbox', { name: 'Rodzaje surowca' })).queryByText('Mięso z/s')).toBeNull()
    expect(within(screen.getByRole('listbox', { name: 'Rodzaje surowca' })).getByText('Łój wołowy zwykły')).toBeTruthy()
  })
  it('wybór partii i dodanie: kg, cena, partia', async () => {
    const onDodaj = mount()
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Rodzaje surowca' })).getByText('Łój wołowy otokowy'))
    fireEvent.click(within(screen.getByRole('table', { name: 'Partie surowca' })).getByText('731'))
    fireEvent.change(screen.getByLabelText('Ilość w kg'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Cena za kg'), { target: { value: '4,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj pozycję' }))
    expect(onDodaj).toHaveBeenCalledWith(expect.objectContaining({ stockId: 'r1', batchNo: '731', qtyStr: '15', priceStr: '4,50', name: 'Łój wołowy otokowy' }))
  })
})
