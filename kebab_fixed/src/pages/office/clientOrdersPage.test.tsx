// @vitest-environment jsdom
/**
 * Lista zamówień: bieżące OSOBNO od zrealizowanych.
 *
 * Zrealizowane i anulowane mieszały się z tym, nad czym biuro pracuje
 * (zgłoszenie 27.08.2026). Zamknięte schodzą do zwiniętej sekcji — widać je
 * dopiero, gdy ktoś ich szuka.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({ zamowienia: [] as any[] }))
const api = vi.hoisted(() => ({ cofnij: [] as string[] }))

vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({ data: stan.zamowienia, loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('@/lib/apiClient', () => ({ clientOrdersApi: { list: vi.fn(), remove: vi.fn(), updateStatus: vi.fn(),
  cofnijRealizacje: (id: string) => { api.cofnij.push(id); return Promise.resolve({}) } } }))
vi.mock('@/lib/api', () => ({ hdiApi: {}, wzApi: {} }))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/components/PageHeader', () => ({ usePageHeaderActions: () => {} }))
vi.mock('@/components/cmr/CmrFormModal', () => ({ CmrFormModal: () => null }))
vi.mock('@/components/orders/PalletsEditor', () => ({ PalletsEditor: () => null }))
vi.mock('@/features/finished-goods/components/StockCartonSuggestions', () => ({ StockCartonSuggestions: () => null }))
vi.mock('@/features/orders/MaterialSummaryCard', () => ({ MaterialSummaryCard: () => null }))
vi.mock('@/features/orders/OrderMaterialShortfall', () => ({ OrderMaterialShortfall: () => null }))

import { ClientOrdersPage } from './ClientOrdersPage'

const zam = (id: string, orderNo: string, status: string) => ({
  id, orderNo, status, clientName: 'YALCIN', orderDate: '2026-08-27',
  deliveryDate: '', totalUnits: 10, totalKg: 100, notes: '',
  lines: [{ id: `${id}-l1`, qty: 10, kgPerUnit: 10, totalKg: 100, qtyDone: 0,
            recipeName: 'KIRMIZI', productTypeName: 'UDO', packagingName: '' }],
})

beforeEach(() => {
  stan.zamowienia = [
    zam('a', 'YALCIN/Z/2/08/26', 'confirmed'),
    zam('b', 'TRUVA/Z/1/08/26', 'done'),
    zam('c', 'VATAN/Z/1/08/26', 'cancelled'),
  ]
})
afterEach(cleanup)

const pokaz = () => render(<MemoryRouter><ClientOrdersPage /></MemoryRouter>)

describe('ClientOrdersPage — bieżące osobno od zrealizowanych', () => {
  it('lista bieżących nie miesza się ze zrealizowanymi', () => {
    pokaz()
    expect(screen.getByText('YALCIN/Z/2/08/26')).toBeTruthy()
    expect(screen.queryByText('TRUVA/Z/1/08/26')).toBeNull()
    expect(screen.queryByText('VATAN/Z/1/08/26')).toBeNull()
  })

  it('zamknięte są policzone i dostępne po rozwinięciu', () => {
    pokaz()
    const przelacznik = screen.getByRole('button', { name: /Zrealizowane i anulowane/i })
    expect(przelacznik.textContent).toContain('2')

    fireEvent.click(przelacznik)

    expect(screen.getByText('TRUVA/Z/1/08/26')).toBeTruthy()
    expect(screen.getByText('VATAN/Z/1/08/26')).toBeTruthy()
  })

  it('gdy nie ma nic bieżącego, mówi to wprost zamiast pustej tabeli', () => {
    stan.zamowienia = [zam('b', 'TRUVA/Z/1/08/26', 'done')]
    pokaz()
    expect(screen.getByText(/Brak bieżących zamówień/i)).toBeTruthy()
  })

  it('bez zamkniętych nie ma po co pokazywać przełącznika', () => {
    stan.zamowienia = [zam('a', 'YALCIN/Z/2/08/26', 'confirmed')]
    pokaz()
    expect(screen.queryByRole('button', { name: /Zrealizowane i anulowane/i })).toBeNull()
  })
})

// 25.09.2026, SAS ISSA: po anulowanym WZ zamówienie zostało zrealizowane,
// a HDI zamkniętego zamówienia wychodzi zamrożone. Cofnięcie realizacji
// dotąd wymagało zmiany w bazie.
describe('ClientOrdersPage — cofnięcie realizacji', () => {
  beforeEach(() => { api.cofnij = []; vi.spyOn(window, 'confirm').mockReturnValue(true) })

  it('zrealizowane ma przycisk i woła serwer', async () => {
    pokaz()
    fireEvent.click(screen.getByRole('button', { name: /Zrealizowane i anulowane/i }))
    const wiersz = screen.getByText('TRUVA/Z/1/08/26').closest('tr')!
    fireEvent.click(within(wiersz).getByTitle(/Cofnij realizację/i))
    await Promise.resolve()
    expect(api.cofnij).toEqual(['b'])
  })

  it('bieżące i anulowane go nie mają', () => {
    pokaz()
    fireEvent.click(screen.getByRole('button', { name: /Zrealizowane i anulowane/i }))
    for (const nr of ['YALCIN/Z/2/08/26', 'VATAN/Z/1/08/26']) {
      const wiersz = screen.getByText(nr).closest('tr')!
      expect(within(wiersz).queryByTitle(/Cofnij realizację/i)).toBeNull()
    }
  })
})
