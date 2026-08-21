// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { StockPickerDialog } from './components/StockPickerDialog'

/**
 * Wybór towaru przeniesiony z ekranu do okna (Insert) — ekran wystawiania ma
 * pokazywać DOKUMENT, a nie magazyn. Okno musi jednak zachować wszystko, na
 * czym biuro pracowało: podział ubocznych na frakcje, „dodaj wszystkie"
 * i oznaczenie pozycji już dołożonych.
 */
const FG = [
  { id: 'g1', recipe_name: 'Kebab drobiowy', kg_per_unit: 10, batch_no: '471',
    qty_available: 40, client_name: 'KRAK-TOL' },
  { id: 'g2', recipe_name: 'Kebab wołowy', kg_per_unit: 5, batch_no: '472',
    qty_available: 12, client_name: 'GRASO' },
]
const RAW = [
  { id: 'r1', stock_type: 'raw', name: 'Ćwiartka z kurczaka', internal_batch_no: '470',
    kg_available: 900, supplier_name: 'KOKO', containers: 60 },
  { id: 'r2', stock_type: 'byproduct', name: 'Grzbiety', internal_batch_no: '468',
    kg_available: 320.5, containers: 22 },
  { id: 'r3', stock_type: 'byproduct', name: 'Kości', internal_batch_no: '468',
    kg_available: 210, containers: 15 },
]

function pokaz(props: Partial<React.ComponentProps<typeof StockPickerDialog>> = {}) {
  const onAddFg = vi.fn(); const onAddRaw = vi.fn(); const onAddRawMany = vi.fn()
  render(
    <StockPickerDialog
      open
      onClose={props.onClose ?? vi.fn()}
      fg={props.fg ?? FG}
      raw={props.raw ?? RAW}
      addedIds={props.addedIds ?? new Set<string>()}
      clientName={props.clientName ?? ''}
      clientAliases={props.clientAliases ?? new Set<string>()}
      onAddFg={props.onAddFg ?? onAddFg}
      onAddRaw={props.onAddRaw ?? onAddRaw}
      onAddRawMany={props.onAddRawMany ?? onAddRawMany}
    />,
  )
  return { onAddFg, onAddRaw, onAddRawMany }
}

afterEach(cleanup)

describe('StockPickerDialog — wybór towaru na dokument', () => {
  it('startuje na wyrobach gotowych z ich partią i stanem', () => {
    pokaz()
    expect(screen.getByText(/Kebab drobiowy/)).toBeTruthy()
    expect(screen.getByLabelText('Stan g1').textContent).toContain('40')
  })

  it('dodanie wyrobu oddaje pozycję rodzicowi', () => {
    const { onAddFg } = pokaz()
    fireEvent.click(screen.getByLabelText('Dodaj g1'))
    expect(onAddFg).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
  })

  it('pozycja już dołożona nie da się dodać drugi raz', () => {
    pokaz({ addedIds: new Set(['g1']) })
    expect((screen.getByLabelText('Dodaj g1') as HTMLButtonElement).disabled).toBe(true)
  })

  it('zakładka surowców dzieli stan na frakcje, żeby kości nie mieszały się z ćwiartką', () => {
    pokaz()
    fireEvent.click(screen.getByLabelText('Surowce'))
    expect(screen.getByLabelText('Grupa Ćwiartka')).toBeTruthy()
    expect(screen.getByLabelText('Grupa Grzbiety')).toBeTruthy()
    expect(screen.getByLabelText('Grupa Kości')).toBeTruthy()
  })

  it('„dodaj wszystkie" bierze całą frakcję jednym kliknięciem', () => {
    const { onAddRawMany } = pokaz()
    fireEvent.click(screen.getByLabelText('Surowce'))
    fireEvent.click(screen.getByLabelText('Dodaj wszystkie Grzbiety'))
    expect(onAddRawMany).toHaveBeenCalledWith([expect.objectContaining({ id: 'r2' })])
  })

  it('szukajka zawęża listę w obrębie zakładki', () => {
    pokaz()
    fireEvent.change(screen.getByLabelText('Szukaj towaru'), { target: { value: 'wołowy' } })
    expect(screen.queryByLabelText('Dodaj g1')).toBeNull()
    expect(screen.getByLabelText('Dodaj g2')).toBeTruthy()
  })

  it('szuka surowca po numerze partii i po dostawcy', () => {
    pokaz()
    fireEvent.click(screen.getByLabelText('Surowce'))
    fireEvent.change(screen.getByLabelText('Szukaj towaru'), { target: { value: 'KOKO' } })
    expect(screen.getByLabelText('Dodaj r1')).toBeTruthy()
    expect(screen.queryByLabelText('Dodaj r2')).toBeNull()
  })

  it('po wybraniu klienta pokazuje najpierw JEGO wyroby', () => {
    // Magazyn stempluje wyroby nazwą klienta; przy wystawianiu dla KRAK-TOL
    // biuro nie chce przewijać wyrobów innych odbiorców.
    pokaz({ clientName: 'KRAK-TOL', clientAliases: new Set(['krak-tol']) })
    expect(screen.getByLabelText('Dodaj g1')).toBeTruthy()
    expect(screen.queryByLabelText('Dodaj g2')).toBeNull()
  })

  it('przełącznik „Wszystkie" wraca do pełnego magazynu', () => {
    pokaz({ clientName: 'KRAK-TOL', clientAliases: new Set(['krak-tol']) })
    fireEvent.click(screen.getByLabelText('Pokaż wszystkie wyroby'))
    expect(screen.getByLabelText('Dodaj g2')).toBeTruthy()
  })

  it('bez wybranego klienta nie ma czego filtrować', () => {
    pokaz()
    expect(screen.queryByLabelText('Pokaż wszystkie wyroby')).toBeNull()
  })

  it('pusty wynik mówi wprost, że nic nie znaleziono', () => {
    pokaz()
    fireEvent.change(screen.getByLabelText('Szukaj towaru'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Brak wyników/)).toBeTruthy()
  })
})
