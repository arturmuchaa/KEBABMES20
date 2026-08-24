// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { PlanLinesTable, type PlanLineRow } from './PlanLinesTable'

/**
 * Pozycje planu w stałych kolumnach — ten sam idiom, co lista pozycji
 * zamówienia. Stary ekran rozpisywał pozycję na kilka wierszy pól formularza,
 * więc przy dziesięciu pozycjach (tyle mają realne plany) nie dawało się
 * rzucić okiem, co jest czym ani czego brakuje.
 */
const ROWS: PlanLineRow[] = [
  { qty: '20', kgPerUnit: '35', productTypeName: 'Kebab drobiowy',
    recipeName: 'WROCŁAW', clientName: 'Bulli', batchNos: ['495'], frozen: false },
  { qty: '12', kgPerUnit: '8,5', productTypeName: 'Kebab z indyka',
    recipeName: 'BULLI', clientName: '', batchNos: [], frozen: true },
]

const pokaz = (rows = ROWS, over: Partial<React.ComponentProps<typeof PlanLinesTable>> = {}) =>
  render(<PlanLinesTable rows={rows} editingIdx={null} onEdit={vi.fn()} onRemove={vi.fn()} {...over} />)

const wiersz = (i: number) => screen.getAllByTestId('plan-line')[i]

afterEach(cleanup)

describe('PlanLinesTable', () => {
  it('ma nagłówek kolumn', () => {
    pokaz()
    const h = screen.getByTestId('plan-head')
    for (const k of ['Rodzaj', 'Receptura', 'Klient', 'Partie', 'Razem'])
      expect(within(h).getByText(k)).toBeTruthy()
  })

  it('kilogramy bez ozdobnego zera', () => {
    pokaz()
    expect(within(wiersz(0)).getByTestId('plan-ilosc').textContent).toBe('20×35')
    expect(within(wiersz(0)).getByTestId('plan-razem').textContent).toContain('700')
  })

  it('waga ułamkowa zostaje ułamkiem', () => {
    pokaz()
    expect(within(wiersz(1)).getByTestId('plan-ilosc').textContent).toBe('12×8,5')
    expect(within(wiersz(1)).getByTestId('plan-razem').textContent).toContain('102')
  })

  it('pozycja bez partii nie udaje przypisanej', () => {
    pokaz()
    expect(within(wiersz(1)).getByTestId('plan-partie').textContent).toBe('—')
  })

  it('kilka partii w pozycji wypisuje wszystkie', () => {
    pokaz([{ ...ROWS[0], batchNos: ['495', '496'] }])
    expect(within(wiersz(0)).getByTestId('plan-partie').textContent).toBe('495, 496')
  })

  it('brak klienta to myślnik, nie pustka', () => {
    pokaz()
    expect(within(wiersz(1)).getByTestId('plan-klient').textContent).toBe('—')
  })

  it('pozycji rozpoczętej na hali nie da się usunąć', () => {
    pokaz()
    expect(within(wiersz(0)).getByTitle(/Usuń/)).toBeTruthy()
    expect(within(wiersz(1)).queryByTitle(/Usuń/)).toBeNull()
  })

  it('kosz oddaje numer pozycji', () => {
    const onRemove = vi.fn()
    pokaz(ROWS, { onRemove })
    fireEvent.click(within(wiersz(0)).getByTitle(/Usuń/))
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('suma planu stoi w stopce', () => {
    pokaz()
    expect(screen.getByTestId('plan-suma').textContent).toContain('802')
  })
})
