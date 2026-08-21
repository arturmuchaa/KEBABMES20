// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { WzLinesGrid } from './components/WzLinesGrid'
import type { WzRow } from './rowMath'

/**
 * Siatka pozycji to miejsce, w którym biuro wpisuje kilogramy i ceny idące
 * na dokument dla klienta. Ekran ma czytać się jak w programie do
 * fakturowania: Lp, towar, ilość, cena, wartość — jedna tabela, bez
 * przeskakiwania między dwiema listami.
 */
const ROWS: WzRow[] = [
  { stockType: 'fg', stockId: 'g1', name: 'Kebab drobiowy 10kg', unit: 'szt',
    qtyStr: '40', priceStr: '12,50', available: 100, kgPerUnit: 10, batchNo: '471' },
  { stockType: 'byproduct', stockId: 'b1', name: 'Grzbiety z kurczaka', unit: 'kg',
    qtyStr: '320,5', priceStr: '1,20', available: 400, batchNo: '468', containersStr: '22' },
]

function pokaz(props: Partial<React.ComponentProps<typeof WzLinesGrid>> = {}) {
  const onChange = vi.fn(); const onDelete = vi.fn(); const onAdd = vi.fn()
  render(
    <WzLinesGrid
      rows={props.rows ?? ROWS}
      valued={props.valued ?? true}
      sym={props.sym ?? 'zł'}
      onChange={props.onChange ?? onChange}
      onDelete={props.onDelete ?? onDelete}
      onAdd={props.onAdd ?? onAdd}
    />,
  )
  return { onChange, onDelete, onAdd }
}

afterEach(cleanup)

describe('WzLinesGrid — siatka pozycji dokumentu', () => {
  it('numeruje pozycje po kolei, jak w programie do fakturowania', () => {
    pokaz()
    expect(screen.getByLabelText('Lp 1').textContent).toBe('1')
    expect(screen.getByLabelText('Lp 2').textContent).toBe('2')
  })

  it('pokazuje towar i partię w jednym wierszu', () => {
    pokaz()
    expect(screen.getByText('Kebab drobiowy 10kg')).toBeTruthy()
    expect(screen.getByLabelText('Partia 1').textContent).toBe('471')
  })

  it('wyrób gotowy wyceniany za kilogram — 40 szt × 10 kg × 12,50', () => {
    pokaz()
    expect(screen.getByLabelText('Wartość 1').textContent).toContain('5000,00')
  })

  it('pokazuje wagę pozycji, bo dokument idzie na kilogramy', () => {
    pokaz()
    expect(screen.getByLabelText('Waga 1').textContent).toContain('400')
  })

  it('wpisana ilość wraca do rodzica bez prostowania w trakcie pisania', () => {
    const { onChange } = pokaz()
    fireEvent.change(screen.getByLabelText('Ilość 2'), { target: { value: '300,25' } })
    expect(onChange).toHaveBeenCalledWith(1, 'qtyStr', '300,25')
  })

  it('ilość ponad stan jest widocznie oznaczona', () => {
    pokaz({ rows: [{ ...ROWS[0], qtyStr: '500' }] })
    expect(screen.getByLabelText('Ilość ponad stan 1')).toBeTruthy()
  })

  it('dokument bez cen nie pokazuje kolumn cenowych', () => {
    pokaz({ valued: false })
    expect(screen.queryByLabelText('Cena 1')).toBeNull()
    expect(screen.queryByLabelText('Wartość 1')).toBeNull()
  })

  it('stopka sumuje pozycje, kilogramy, pojemniki i wartość', () => {
    pokaz()
    expect(screen.getByLabelText('Suma pozycji').textContent).toBe('2')
    expect(screen.getByLabelText('Suma kg').textContent).toContain('720,5')
    expect(screen.getByLabelText('Suma pojemników').textContent).toBe('22')
    expect(screen.getByLabelText('Razem wartość').textContent).toContain('5384,60')
  })

  it('kosz usuwa właściwy wiersz', () => {
    const { onDelete } = pokaz()
    fireEvent.click(screen.getByLabelText('Usuń pozycję 2'))
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('pusty dokument zaprasza do dodania pozycji zamiast pokazywać pustą tabelę', () => {
    const { onAdd } = pokaz({ rows: [] })
    fireEvent.click(screen.getByLabelText('Dodaj pozycję'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('klawisz Insert otwiera wybór towaru — jak w Subiekcie', () => {
    const { onAdd } = pokaz()
    fireEvent.keyDown(window, { key: 'Insert' })
    expect(onAdd).toHaveBeenCalled()
  })
})
