// @vitest-environment jsdom
/**
 * Zaznaczanie palet do druku zbiorczego.
 *
 * Właściciel (2026-09-09): „możliwość drukowania wszystkich lub zaznaczeniu
 * wielu kartek na palety, aby nie drukować pojedynczo".
 *
 * Zaznaczenie trzymamy po NUMERZE palety, nie po indeksie w liście — po
 * usunięciu palety indeksy się przesuwają i wydruk poszedłby na inną paletę
 * niż ta, którą biuro kliknęło.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ palety: [] as any[] }))
const otwarte = vi.hoisted(() => ({ url: '' }))

vi.mock('@/lib/apiClient', () => ({
  orderPalletsApi: {
    list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.palety))),
    save: vi.fn(() => Promise.resolve()),
  },
}))
vi.mock('@/lib/api', () => ({
  palletsApi: { batchBreakdown: () => Promise.resolve([]) },
}))

import { PalletsEditor } from './PalletsEditor'

const LINIE = [
  { id: 'l1', qty: 10, kgPerUnit: 80, recipeName: 'BEYAZ AFIYET', productTypeName: 'KEBAB UDO 100%' },
  { id: 'l2', qty: 5,  kgPerUnit: 40, recipeName: 'KIRMIZI',      productTypeName: 'KEBAB UDO 100%' },
] as any

beforeEach(() => {
  otwarte.url = ''
  vi.stubGlobal('open', vi.fn((url: string) => { otwarte.url = url; return { closed: false } }))
  stan.palety = [
    { id: 'p1', palletNo: 1, notes: '', items: [{ orderLineId: 'l1', qty: 5 }] },
    { id: 'p2', palletNo: 2, notes: '', items: [{ orderLineId: 'l1', qty: 5 }] },
    { id: 'p3', palletNo: 3, notes: '', items: [{ orderLineId: 'l2', qty: 5 }] },
  ]
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function pokaz() {
  render(<PalletsEditor orderId="o1" lines={LINIE} />)
  await screen.findByText('Paleta nr 1')
}

const zaznacz = (nr: number) =>
  fireEvent.click(screen.getByLabelText(`Zaznacz paletę nr ${nr} do druku`))

describe('PalletsEditor — druk zbiorczy', () => {
  it('bez zaznaczenia przycisk zaznaczonych jest nieaktywny', async () => {
    await pokaz()
    expect(screen.getByRole('button', { name: /drukuj zaznaczone/i })).toHaveProperty('disabled', true)
  })

  it('zaznaczone palety trafiaja do adresu wydruku', async () => {
    await pokaz()
    zaznacz(1)
    zaznacz(3)
    fireEvent.click(screen.getByRole('button', { name: /drukuj zaznaczone/i }))
    expect(otwarte.url).toBe('/office/zamowienia/o1/palety/druk?palety=1,3')
  })

  it('licznik pokazuje, ile palet jest zaznaczonych', async () => {
    await pokaz()
    zaznacz(2)
    expect(screen.getByRole('button', { name: /drukuj zaznaczone \(1\)/i })).toBeTruthy()
    zaznacz(3)
    expect(screen.getByRole('button', { name: /drukuj zaznaczone \(2\)/i })).toBeTruthy()
  })

  it('ponowne klikniecie odznacza palete', async () => {
    await pokaz()
    zaznacz(1)
    zaznacz(1)
    expect(screen.getByRole('button', { name: /drukuj zaznaczone/i })).toHaveProperty('disabled', true)
  })

  it('„Drukuj wszystkie" idzie BEZ listy palet', async () => {
    await pokaz()
    fireEvent.click(screen.getByRole('button', { name: /drukuj wszystkie/i }))
    expect(otwarte.url).toBe('/office/zamowienia/o1/palety/druk')
  })

  it('drukarka przy palecie drukuje TE palete', async () => {
    await pokaz()
    fireEvent.click(screen.getAllByTitle(/drukuj kartki tej palety/i)[1])
    expect(otwarte.url).toBe('/office/zamowienia/o1/palety/druk?palety=2')
  })

  it('gdy window.open zwroci null, nawiguje w biezacej karcie', async () => {
    // Okno Tauri potrafi wygłuszyć window.open — bez tej ścieżki druk
    // przepadłby bez śladu, patrz tauri-okna-i-inline-skrypty.
    vi.stubGlobal('open', vi.fn(() => null))
    const location = { href: '' }
    Object.defineProperty(window, 'location', { value: location, writable: true })
    await pokaz()
    fireEvent.click(screen.getByRole('button', { name: /drukuj wszystkie/i }))
    await waitFor(() => expect(location.href).toBe('/office/zamowienia/o1/palety/druk'))
  })
})
