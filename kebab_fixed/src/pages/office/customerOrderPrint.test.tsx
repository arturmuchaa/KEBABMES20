// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const data = vi.hoisted(() => ({ order: {} as any, companyFails: false, print: vi.fn() }))
vi.mock('@/lib/apiClient', () => ({
  clientOrdersApi: { byId: () => Promise.resolve(data.order) },
  clientsApi: { list: () => Promise.resolve([{ id: 'c', name: 'Klient Sp. z o.o.', address: 'Długa 12', postalCode: '50-001', city: 'Wrocław', nip: '1234567890' }]) },
  settingsApi: { getCompany: () => data.companyFails ? Promise.reject(new Error('Brak danych firmy')) : Promise.resolve({ name: 'Firma Księżyc', address: 'Zakładowa 1', city: 'Łódź' }) },
}))
vi.mock('@/lib/print', () => ({ drukuj: data.print }))
import { OrderPrintPage } from './OrderPrintPage'

const mount = () => render(<MemoryRouter initialEntries={['/office/zamowienia/o/druk']}><Routes><Route path="/office/zamowienia/:id/druk" element={<OrderPrintPage />} /></Routes></MemoryRouter>)
beforeEach(() => {
  data.companyFails = false; data.print.mockClear()
  data.order = { id: 'o', orderNo: 'Z/17', clientId: 'c', clientName: 'Klient', orderDate: '2026-10-15', deliveryDate: '2026-10-20', notes: 'WEWNĘTRZNA UWAGA — 1960 kg mięsa', totalKg: 999,
    lines: [
      { id: 'l1', recipeName: 'AFIYET BEYAZ', productTypeName: 'UDO', qty: 40, kgPerUnit: 20, totalKg: 800, packagingName: 'METAL 65 cm', qtyDone: 5, notes: 'WEWNĘTRZNA POZYCJA' },
      { id: 'l2', recipeName: 'AFIYET BEYAZ', productTypeName: 'MIX', qty: 20, kgPerUnit: 30, totalKg: 600, packagingName: 'METAL 80 cm' },
      { id: 'l3', recipeName: 'GUSTO KIRMIZI', qty: 15, kgPerUnit: 40, totalKg: 600 },
    ] }
})
afterEach(cleanup)
describe('Wydruk zamówienia dla klienta', () => {
  it('pokazuje zapisane warianty, dane stron i dokładne sumy, bez danych produkcyjnych', async () => {
    mount()
    const doc = await screen.findByRole('article', { name: 'Zamówienie dla klienta' })
    const view = within(doc)
    expect(view.getByText('Klient Sp. z o.o.')).toBeTruthy()
    expect(view.getByText('Długa 12')).toBeTruthy()
    expect(view.getByText('METAL 80 cm')).toBeTruthy()
    expect(view.getByTestId('customer-totals').textContent?.replace(/\s/g, '')).toContain('75Łącznamasazamówienia2000kg')
    for (const forbidden of ['Na stanie', 'Gotowe', 'Wydane', 'mroźni', '1960', 'Uzysk', 'WEWNĘTRZNA']) expect(doc.textContent).not.toContain(forbidden)
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj / zapisz PDF' }))
    expect(data.print).toHaveBeenCalledOnce()
  })
  it('nie zaokrągla gramatur do całych kg i nie korzysta z błędnych sum nagłówka', async () => {
    data.order.lines = [{ id: 'fraction', qty: 3, kgPerUnit: 20.125, recipeName: 'Żółć', totalKg: 60.375 }]
    mount()
    const row = await screen.findByTestId('customer-line-fraction')
    expect(row.textContent).toContain('20,125 kg')
    expect(row.textContent).toContain('60,375 kg')
    expect(screen.getByTestId('customer-totals').textContent).toContain('60,375 kg')
    expect(screen.getByTestId('customer-totals').textContent).not.toContain('999')
  })
  it('nie drukuje niepełnego dokumentu przy błędzie odczytu firmy', async () => {
    data.companyFails = true
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain('Brak danych firmy')
    expect((screen.getByRole('button', { name: 'Drukuj / zapisz PDF' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
