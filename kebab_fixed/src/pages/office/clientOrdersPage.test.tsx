// @vitest-environment jsdom
/**
 * Lista zamówień: bieżące OSOBNO od zrealizowanych.
 *
 * Zrealizowane i anulowane mieszały się z tym, nad czym biuro pracuje
 * (zgłoszenie 27.08.2026). Zamknięte schodzą do zwiniętej sekcji — widać je
 * dopiero, gdy ktoś ich szuka.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({ zamowienia: [] as any[], loading: false, error: null as string | null, refetch: vi.fn() }))
const api = vi.hoisted(() => ({ cofnij: [] as string[] }))

vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({ data: stan.zamowienia, loading: stan.loading, error: stan.error, refetch: stan.refetch }),
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
vi.mock('@/features/orders/OrphanPalletsPanel', () => ({ OrphanPalletsPanel: () => null }))
vi.mock('@/features/orders/OrderMaterialShortfall', () => ({ OrderMaterialShortfall: () => null }))

import { ClientOrdersPage } from './ClientOrdersPage'

const zam = (id: string, orderNo: string, status: string) => ({
  id, orderNo, status, clientName: 'YALCIN', orderDate: '2026-08-27',
  deliveryDate: '', totalUnits: 10, totalKg: 100, notes: '',
  lines: [{ id: `${id}-l1`, qty: 10, kgPerUnit: 10, totalKg: 100, qtyDone: 0,
            recipeName: 'KIRMIZI', productTypeName: 'UDO', packagingName: '' }],
})

beforeEach(() => {
  stan.loading = false; stan.error = null; stan.refetch.mockClear()
  stan.zamowienia = [
    zam('a', 'YALCIN/Z/2/08/26', 'confirmed'),
    zam('b', 'TRUVA/Z/1/08/26', 'done'),
    zam('c', 'VATAN/Z/1/08/26', 'cancelled'),
  ]
})

describe('ClientOrdersPage — zaznaczanie i planowanie', () => {
  beforeEach(() => {
    stan.zamowienia = [zam('a', 'YALCIN/1', 'confirmed'), zam('b', 'YALCIN/2', 'confirmed'), zam('c', 'TRUVA/1', 'confirmed')]
    for (const [i, o] of stan.zamowienia.entries()) {
      o.clientName = i === 2 ? 'TRUVA' : 'YALCIN'
      o.lines[0].recipeId = 'r1'
      o.lines[0].fulfillment = { orderedKg: 100, stockKg: i === 0 ? 40 : 0, deliveredKg: i === 0 ? 10 : 0, coveredKg: i === 0 ? 50 : 0, remainingKg: i === 0 ? 50 : 100 }
      o.lines[0].packagingName = i === 1 ? 'METAL 80 cm' : 'METAL 65 cm'
    }
  })

  const summary = () => screen.getByRole('region', { name: 'Podsumowanie zaznaczonych zamówień' })
  const select = (no: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Zaznacz ${no}` }))

  it('zaznacza jedno, nie rozwija, a rozwijanie nie zmienia zaznaczenia', () => {
    pokaz()
    select('YALCIN/1')
    expect(screen.getByRole('button', { name: 'Szczegóły YALCIN/1' }).getAttribute('aria-expanded')).toBe('false')
    expect(within(summary()).getByText(/Podsumowanie zaznaczonych zamówień/).textContent).toContain('(1)')
    expect(summary().textContent).toContain('50 kg')
    fireEvent.click(screen.getByRole('button', { name: 'Szczegóły YALCIN/1' }))
    expect((screen.getByRole('checkbox', { name: 'Zaznacz YALCIN/1' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Pozycje zamówienia (1)')).toBeTruthy()
  })

  it('sumuje klientów i zachowuje gramatury i długości po rozwinięciu receptury', () => {
    pokaz()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }))
    const panel = within(summary())
    expect(panel.getAllByText('300 kg')).toHaveLength(3)
    expect(panel.getAllByText('250 kg')).toHaveLength(3)
    fireEvent.click(panel.getByRole('button', { name: /KIRMIZI/ }))
    expect(panel.getByText('METAL 80 cm')).toBeTruthy()
    expect(panel.getAllByText('METAL 65 cm')).toHaveLength(2)
    expect(panel.getByText('TRUVA/1')).toBeTruthy()
    expect(panel.getAllByText('10 kg × 10 szt.')).toHaveLength(3)
  })

  it('filtr i sortowanie nie gubią zaznaczeń; wszystkie widoczne nie usuwa ukrytych', () => {
    pokaz()
    select('YALCIN/1')
    fireEvent.change(screen.getByRole('textbox', { name: 'Szukaj zamówień' }), { target: { value: 'TRUVA' } })
    expect(summary().textContent).toContain('1 zaznaczonych poza widoczną listą')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }))
    expect(summary().textContent).toContain('(2)')
    fireEvent.change(screen.getByRole('combobox', { name: 'Sortowanie zamówień' }), { target: { value: 'clientName' } })
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }))
    expect((screen.getByRole('checkbox', { name: 'Zaznacz YALCIN/1' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Zaznacz TRUVA/1' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }) as HTMLInputElement).indeterminate).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Odznacz wszystkie' }))
    expect(screen.queryByRole('region', { name: 'Podsumowanie zaznaczonych zamówień' })).toBeNull()
  })

  it('zaznaczenie znika po usunięciu na serwerze, pozostałe przeliczają nowe dane', () => {
    const view = pokaz()
    select('YALCIN/1'); select('YALCIN/2')
    stan.zamowienia = stan.zamowienia.slice(1).map(o => ({ ...o, lines: o.lines.map((l: any) => ({ ...l, fulfillment: { ...l.fulfillment, stockKg: 100, coveredKg: 100, remainingKg: 0 } })) }))
    view.rerender(<MemoryRouter><ClientOrdersPage /></MemoryRouter>)
    expect(summary().textContent).toContain('(1)')
    expect(within(summary()).getAllByText('0 kg').length).toBeGreaterThan(0)
    expect((screen.getByRole('checkbox', { name: 'Zaznacz YALCIN/2' }) as HTMLInputElement).checked).toBe(true)
  })

  it('zamknięte są poza zaznaczaniem widocznych, anulowane nie zwiększają sum', () => {
    stan.zamowienia[2].status = 'cancelled'
    pokaz()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }))
    expect(summary().textContent).toContain('(2)')
    fireEvent.click(screen.getByRole('button', { name: /Zrealizowane i anulowane/ }))
    select('TRUVA/1')
    expect(summary().textContent).toContain('(3)')
    expect(summary().textContent).toContain('Pominięto anulowane zamówienia: 1')
    expect(within(summary()).getAllByText('200 kg')).toHaveLength(3)
  })

  it('błąd odświeżenia nie usuwa listy ani zaznaczenia', () => {
    const view = pokaz()
    select('YALCIN/1')
    stan.error = 'Brak połączenia'
    view.rerender(<MemoryRouter><ClientOrdersPage /></MemoryRouter>)
    expect(screen.getByRole('alert').textContent).toContain('dane mogą być nieaktualne')
    expect(summary().textContent).toContain('(1)')
    fireEvent.click(screen.getByRole('button', { name: 'Ponów pobieranie' }))
    expect(stan.refetch).toHaveBeenCalledOnce()
  })

  it('odświeża dane w tle bez utraty zaznaczeń i nie ponawia równoległego żądania', async () => {
    vi.useFakeTimers()
    let resolve!: () => void
    stan.refetch.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
    try {
      pokaz(); select('YALCIN/1')
      act(() => { vi.advanceTimersByTime(30_000) })
      expect(stan.refetch).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(30_000) })
      expect(stan.refetch).toHaveBeenCalledOnce()
      expect(summary().textContent).toContain('(1)')
      await act(async () => { resolve(); await Promise.resolve() })
    } finally { vi.useRealTimers() }
  })

  it('stronicuje długą listę, a zaznacz wszystkie dotyczy tylko widocznej strony', () => {
    stan.zamowienia = Array.from({ length: 51 }, (_, i) => ({ ...stan.zamowienia[0], id: `${i}`, orderNo: `Z/${i}` }))
    pokaz()
    expect(screen.getAllByRole('checkbox')).toHaveLength(51)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }))
    fireEvent.click(screen.getByRole('button', { name: 'Następna' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(summary().textContent).toContain('50 zaznaczonych poza widoczną listą')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie widoczne' }))
    expect(summary().textContent).toContain('(51)')
  })
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
