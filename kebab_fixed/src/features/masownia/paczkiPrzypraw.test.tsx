// @vitest-environment jsdom
/**
 * Paczki przypraw — worki, numer ciągły i wybór DOPIERO po mięsie.
 *
 * Ustalenia właściciela z 18.09.2026:
 *  • przyprawy pakuje się do WORKÓW, nie do pojemników; operator na koniec
 *    ważenia wpisuje, w ilu workach je zostawia (200 kg → 1, 600 kg → 3);
 *  • numer paczki leci ciągle od 1, bez miesiąca i roku;
 *  • kafelek paczki na ekranie głównym NIE jest klikalny — paczkę wybiera się
 *    w torze załadunku, po wskazaniu mięsa;
 *  • paczka musi pasować do wsadu: ładując 600 kg, paczka na 200 kg jest
 *    zablokowana (przyprawy liczone są na konkretne kilogramy).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CartList } from './components/CartList'
import { PackPicker } from './components/PackPicker'

const paczki = [
  { id: 'c1', cart_no: 1, order_id: 'o1', order_no: 'MAS/18/09/26', recipe_name: 'KIRMIZI',
    kg_target: 200, bags: 1, ingredients: [{ seq: 0 }], status: 'prepared' },
  { id: 'c2', cart_no: 2, order_id: 'o1', order_no: 'MAS/18/09/26', recipe_name: 'YAPRAK',
    kg_target: 600, bags: 3, ingredients: [{ seq: 0 }], status: 'prepared' },
] as any[]

afterEach(() => cleanup())

describe('lista paczek na ekranie głównym', () => {
  it('pokazuje recepturę, wsad, numer i worki', () => {
    render(<CartList carts={paczki} />)
    const wiersz = screen.getByText('KIRMIZI').closest('div')!
    expect(wiersz).toHaveTextContent('200')
    expect(wiersz).toHaveTextContent(/nr 1/i)
    expect(wiersz).toHaveTextContent(/1 worek/i)
    expect(screen.getByText('YAPRAK').closest('div')!).toHaveTextContent(/3 worki/i)
  })

  it('nie jest wejściem w proces — nic tu nie klikamy', () => {
    render(<CartList carts={paczki} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('wybór paczki po wskazaniu mięsa', () => {
  it('paczka na inny wsad jest zablokowana z powodem', () => {
    render(<PackPicker carts={paczki} kgMeat={600} recipeName="YAPRAK"
      onPick={vi.fn()} onWeighNow={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /nr 2/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /nr 1/i })).toBeDisabled()
    expect(screen.getByText(/przyprawy na 200 kg/i)).toBeInTheDocument()
  })

  it('oddaje wybraną paczkę', () => {
    const onPick = vi.fn()
    render(<PackPicker carts={paczki} kgMeat={600} recipeName="YAPRAK"
      onPick={onPick} onWeighNow={vi.fn()} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /nr 2/i }))
    expect(onPick).toHaveBeenCalledWith(paczki[1])
  })

  it('bez pasującej paczki zostaje ważenie przy maszynie', () => {
    const onWeighNow = vi.fn()
    render(<PackPicker carts={paczki} kgMeat={507} recipeName="KIRMIZI"
      onPick={vi.fn()} onWeighNow={onWeighNow} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /nr 1/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /nr 2/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Odważ teraz przy maszynie/i }))
    expect(onWeighNow).toHaveBeenCalled()
  })

  it('mówi, ile worków zabrać do maszyny', () => {
    render(<PackPicker carts={paczki} kgMeat={600} recipeName="YAPRAK"
      onPick={vi.fn()} onWeighNow={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /nr 2/i })).toHaveTextContent(/3 worki/i)
  })
})
