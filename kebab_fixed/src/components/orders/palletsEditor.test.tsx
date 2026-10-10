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
import { orderPalletsApi } from '@/lib/apiClient'

const LINIE = [
  { id: 'l1', qty: 10, kgPerUnit: 80, recipeName: 'BEYAZ AFIYET', productTypeName: 'KEBAB UDO 100%' },
  { id: 'l2', qty: 5,  kgPerUnit: 40, recipeName: 'KIRMIZI',      productTypeName: 'KEBAB UDO 100%' },
] as any

beforeEach(() => {
  vi.mocked(orderPalletsApi.save).mockReset().mockResolvedValue([])
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
  it('edycja kartonu zachowuje id i numer QR zamiast wysyłać nową paletę z numerem zero', async () => {
    stan.palety[2].cartonNo = '000366'
    await pokaz()
    expect(screen.getByText('Karton 000366 · P3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj paletę nr 3' }))
    expect(screen.getByText(/Po zmianie zawartości wydrukuj ponownie/)).toBeTruthy()
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz zmiany' }))
    await waitFor(() => expect(orderPalletsApi.save).toHaveBeenCalledTimes(1))
    const saved = vi.mocked(orderPalletsApi.save).mock.calls[0][1]
    expect(saved[2]).toMatchObject({ id: 'p3', palletNo: 3, cartonNo: '000366', items: [{ orderLineId: 'l2', qty: 4 }] })
    expect(saved.slice(0, 2)).toEqual(stan.palety.slice(0, 2))
  })

  it('usunięcie pierwszej palety nie przenumerowuje pozostałych w żądaniu', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    await pokaz()
    fireEvent.click(screen.getByRole('button', { name: 'Usuń paletę nr 1' }))
    await waitFor(() => expect(orderPalletsApi.save).toHaveBeenCalledTimes(1))
    expect(vi.mocked(orderPalletsApi.save).mock.calls[0][1]).toEqual(stan.palety.slice(1))
  })

  it('odmowa zapisu nie zamyka formularza i nie gubi korekty operatora', async () => {
    vi.mocked(orderPalletsApi.save).mockRejectedValueOnce(new Error('Paleta jest w obiegu skanowania'))
    await pokaz()
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj paletę nr 3' }))
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz zmiany' }))
    await screen.findByText('Paleta jest w obiegu skanowania')
    expect(screen.getByText('Edycja palety nr 3')).toBeTruthy()
    expect(screen.getAllByRole('spinbutton')[1]).toHaveProperty('value', '4')
  })

  it('dołącza zielony karton magazynowy do sumy, ale nie do etykiet PAL', async () => {
    const carton = { cartonId: 'stock343', cartonNo: 343, packedQty: 0, targetQty: 20,
      lines: [{ targetQty: 20, kgPerUnit: 40, recipeName: 'BEYAZ', packagingName: 'METAL 65CM' }] } as any
    const view = render(<PalletsEditor orderId="o1" lines={LINIE} assignedCartons={[carton]} />)
    await screen.findByText('Paleta nr 1')
    expect(screen.getByTestId('assigned-stock-pallet').textContent).toContain('Karton 000343')
    expect(screen.getByTestId('assigned-stock-pallet').textContent).toContain('20 × 40 kg BEYAZ')
    expect(screen.getByTestId('assigned-stock-pallet').textContent).toContain('Spakowano 0/20')
    const totals = screen.getByTestId('combined-pallet-totals').textContent!.replace(/\s/g, '')
    expect(totals).toContain('4palet/kartonów·1800kg·35szt')
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /drukuj wszystkie/i }))
    expect(otwarte.url).toBe('/office/zamowienia/o1/palety/druk')
    view.rerender(<PalletsEditor orderId="o1" lines={LINIE} assignedCartons={[]} />)
    expect(screen.queryByTestId('assigned-stock-pallet')).toBeNull()
    expect(screen.queryByTestId('combined-pallet-totals')).toBeNull()
  })

  it('brak aktualnej migawki nie udaje zerowej liczby kartonów', async () => {
    render(<PalletsEditor orderId="o1" lines={LINIE} assignedCartons={null} />)
    await screen.findByText('Paleta nr 1')
    expect(screen.getByText(/suma palet powyżej jest częściowa/)).toBeTruthy()
  })

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
