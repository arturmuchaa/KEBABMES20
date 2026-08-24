// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PlanTerminal } from './PlanTerminal'

/**
 * Pasek wsadu planu — ten sam kontrakt klawiatury co terminal zamówień:
 * wpisz fragment, ⏎, i lecisz dalej. Plan dnia ma około dziesięciu pozycji,
 * więc każde zbędne dotknięcie myszy mnoży się przez dziesięć.
 */
const PT = [{ id: 'pt1', name: 'Kebab drobiowy' }, { id: 'pt2', name: 'Kebab wołowy' }]
const RC = [
  { id: 'r1', name: 'WROCŁAW', productTypeId: 'pt1' },
  { id: 'r2', name: 'BULLI',   productTypeId: 'pt1' },
  { id: 'r3', name: 'INDYK',   productTypeId: 'pt2' },
]
const PK = [{ id: 'tul65', name: 'Tuleja 65 cm' }]
const CL = [{ id: 'c1', name: 'Bulli sp. z o.o.' }, { id: 'c2', name: 'Kowalski' }]

function pokaz(over: Partial<React.ComponentProps<typeof PlanTerminal>> = {}) {
  const onCommit = vi.fn()
  render(
    <PlanTerminal productTypes={PT} recipes={RC} packaging={PK} clients={CL}
      onCommit={over.onCommit ?? onCommit} lastLine={over.lastLine ?? null} />,
  )
  return { onCommit: (over.onCommit ?? onCommit) as ReturnType<typeof vi.fn> }
}

const pole = (n: string) => screen.getByLabelText(n) as HTMLInputElement
function wybierz(n: string, frag: string) {
  const el = pole(n)
  fireEvent.focus(el)
  fireEvent.change(el, { target: { value: frag } })
  fireEvent.keyDown(el, { key: 'Enter' })
}
function wpisz(n: string, v: string) {
  const el = pole(n)
  fireEvent.change(el, { target: { value: v } })
  fireEvent.keyDown(el, { key: 'Enter' })
}
function wbij() {
  wybierz('Rodzaj', 'drobiowy')
  wybierz('Receptura', 'WROC')
  wybierz('Tuleja', '65')
  wybierz('Klient', 'Bulli')
  wpisz('Sztuk', '20')
  wpisz('Waga sztuki', '35')
}

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(cleanup)

describe('PlanTerminal', () => {
  it('⏎ na wadze oddaje gotową pozycję', () => {
    const { onCommit } = pokaz()
    wbij()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0]).toMatchObject({
      productTypeId: 'pt1', recipeId: 'r1', packagingId: 'tul65',
      clientId: 'c1', clientName: 'Bulli sp. z o.o.', qty: '20', kgPerUnit: '35',
    })
  })

  it('lista wyboru nie rozwija się sama po wejściu na ekran', () => {
    pokaz()
    expect(screen.queryAllByRole('button').filter(b => /Kebab/.test(b.textContent ?? ''))).toHaveLength(0)
  })

  it('receptury zawężają się do wybranego rodzaju', () => {
    pokaz()
    wybierz('Rodzaj', 'wołowy')
    fireEvent.keyDown(pole('Receptura'), { key: 'ArrowDown' })
    const opcje = screen.queryAllByRole('button').map(b => b.textContent)
    expect(opcje).toContain('INDYK')
    expect(opcje).not.toContain('WROCŁAW')
  })

  it('po zatwierdzeniu tożsamość ZOSTAJE, czyszczą się tylko liczby', () => {
    pokaz()
    wbij()
    expect(pole('Rodzaj').value).toBe('Kebab drobiowy')
    expect(pole('Receptura').value).toBe('WROCŁAW')
    expect(pole('Klient').value).toBe('Bulli sp. z o.o.')
    expect(pole('Sztuk').value).toBe('')
    expect(pole('Waga sztuki').value).toBe('')
  })

  it('pozycji bez receptury nie oddaje', () => {
    const { onCommit } = pokaz()
    wybierz('Rodzaj', 'drobiowy')
    wpisz('Sztuk', '20')
    wpisz('Waga sztuki', '35')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('pokazuje kilogramy pozycji przy wpisywaniu', () => {
    pokaz()
    wybierz('Rodzaj', 'drobiowy')
    wybierz('Receptura', 'WROC')
    fireEvent.change(pole('Sztuk'), { target: { value: '20' } })
    fireEvent.change(pole('Waga sztuki'), { target: { value: '35' } })
    expect(screen.getByTestId('plan-draft-kg').textContent).toContain('700')
  })

  it('klient nie jest wymagany — produkcja na magazyn go nie ma', () => {
    const { onCommit } = pokaz()
    wybierz('Rodzaj', 'drobiowy')
    wybierz('Receptura', 'WROC')
    wpisz('Sztuk', '20')
    wpisz('Waga sztuki', '35')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
