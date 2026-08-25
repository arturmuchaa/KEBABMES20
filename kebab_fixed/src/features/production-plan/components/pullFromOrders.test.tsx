// @vitest-environment jsdom
/**
 * „Importuj z zamówień" — wejście zamówień do planu produkcji.
 *
 * Zgłoszenie z biura (25.08.2026): kilka zamówień dawało ponad pięćdziesiąt
 * pozycji na płaskiej liście i „nie da się w tym połapać, co jest co".
 * Planista myśli klientami: najpierw dla KOGO dziś produkuje, potem CO.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

import { PullFromOrders } from './PullFromOrders'

afterEach(cleanup)

const ZAMOWIENIA = [
  { id: 'o1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli sp. z o.o.', status: 'confirmed',
    lines: [
      { id: 'l1', qty: 20, kgPerUnit: 35, recipeId: 'r1', productTypeId: 'pt1', packagingId: 't1' },
      { id: 'l2', qty: 10, kgPerUnit: 30, recipeId: 'r2', productTypeId: 'pt1', packagingId: 't1' },
    ] },
  { id: 'o2', orderNo: 'ZAM/2', clientId: 'c2', clientName: 'Zagros', status: 'confirmed',
    lines: [{ id: 'l3', qty: 6, kgPerUnit: 40, recipeId: 'r1', productTypeId: 'pt1', packagingId: 't1' }] },
] as any

const RECEPTURY = [{ id: 'r1', name: 'WROCŁAW' }, { id: 'r2', name: 'KIRMIZI' }]

const otworz = (onPull = vi.fn()) => {
  render(<PullFromOrders orders={ZAMOWIENIA} progress={{}} recipes={RECEPTURY}
    onPull={onPull} onClose={() => {}} />)
  return onPull
}

describe('PullFromOrders — nazwa i grupowanie', () => {
  it('nazywa się IMPORT, bo to jest ta czynność', () => {
    otworz()
    expect(screen.getByText(/Importuj z zamówień/i)).toBeTruthy()
  })

  it('pozycje stoją w grupach klientów, z sumą grupy', () => {
    otworz()
    const bulli = screen.getByTestId('grupa-c1')
    expect(within(bulli).getByText(/Bulli/)).toBeTruthy()
    expect(within(bulli).getByTestId('pozycja-l1')).toBeTruthy()
    expect(within(bulli).getByTestId('pozycja-l2')).toBeTruthy()
    expect(within(bulli).getByTestId('grupa-suma-c1').textContent).toContain('1000')  // 700 + 300 kg
    expect(within(screen.getByTestId('grupa-c2')).getByTestId('pozycja-l3')).toBeTruthy()
  })

  it('wiersz mówi CO produkujemy, nie tylko dla kogo', () => {
    otworz()
    expect(within(screen.getByTestId('pozycja-l1')).getByText('WROCŁAW')).toBeTruthy()
    expect(within(screen.getByTestId('pozycja-l2')).getByText('KIRMIZI')).toBeTruthy()
  })
})

describe('PullFromOrders — zaznaczanie', () => {
  it('nic nie jest zaznaczone z góry — import 50 pozycji przez przypadek to katastrofa', () => {
    otworz()
    expect(screen.getByTestId('stopka').textContent).toMatch(/nic nie wybrano/i)
    expect((screen.getByTestId('importuj') as HTMLButtonElement).disabled).toBe(true)
  })

  it('grupa klienta zaznacza się i odznacza jednym kliknięciem', () => {
    otworz()
    fireEvent.click(screen.getByTestId('grupa-zaznacz-c1'))
    expect(screen.getByTestId('stopka').textContent).toContain('2')

    fireEvent.click(screen.getByTestId('grupa-zaznacz-c1'))
    expect(screen.getByTestId('stopka').textContent).toMatch(/nic nie wybrano/i)
  })

  it('zaznacz wszystkie / odznacz wszystkie obejmuje wszystkich klientów', () => {
    otworz()
    fireEvent.click(screen.getByTestId('zaznacz-wszystkie'))
    expect(screen.getByTestId('stopka').textContent).toContain('3')

    fireEvent.click(screen.getByTestId('zaznacz-wszystkie'))
    expect(screen.getByTestId('stopka').textContent).toMatch(/nic nie wybrano/i)
  })

  it('stopka podaje sumę kilogramów wybranych pozycji', () => {
    otworz()
    fireEvent.click(screen.getByTestId('pozycja-l1'))
    expect(screen.getByTestId('stopka').textContent).toContain('700')
  })
})

describe('PullFromOrders — szukanie i import', () => {
  it('filtr zawęża listę po kliencie i recepturze', () => {
    otworz()
    fireEvent.change(screen.getByTestId('szukaj'), { target: { value: 'zagros' } })
    expect(screen.queryByTestId('grupa-c1')).toBeNull()
    expect(screen.getByTestId('grupa-c2')).toBeTruthy()

    fireEvent.change(screen.getByTestId('szukaj'), { target: { value: 'kirmizi' } })
    expect(screen.getByTestId('pozycja-l2')).toBeTruthy()
    expect(screen.queryByTestId('pozycja-l1')).toBeNull()
  })

  it('filtr NIE gubi tego, co już zaznaczone', () => {
    const onPull = otworz()
    fireEvent.click(screen.getByTestId('pozycja-l1'))
    fireEvent.change(screen.getByTestId('szukaj'), { target: { value: 'zagros' } })
    fireEvent.click(screen.getByTestId('pozycja-l3'))
    fireEvent.click(screen.getByTestId('importuj'))

    expect(onPull).toHaveBeenCalledTimes(1)
    expect(onPull.mock.calls[0][0]).toHaveLength(2)
  })

  it('import oddaje pozycje planu z ilością POZOSTAŁĄ do zrobienia', () => {
    const onPull = vi.fn()
    render(<PullFromOrders orders={ZAMOWIENIA} progress={{ l1: { qtyRemaining: 12 } } as any}
      recipes={RECEPTURY} onPull={onPull} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('pozycja-l1'))
    fireEvent.click(screen.getByTestId('importuj'))

    expect(onPull.mock.calls[0][0][0]).toMatchObject({ qty: '12' })
  })
})
