// @vitest-environment jsdom
/**
 * Wydruk zamówienia — kartka, z którą magazynier chodzi po chłodni.
 *
 * Ma nieść WSZYSTKO, co potrzebne do skompletowania (rodzaj, receptura,
 * tuleja, sztuki, waga, ile już zrobione), i mieć miejsce na odhaczenie
 * pozycji ręką. Bez kratki magazynier znaczy palcem po pamięci albo pisze
 * po marginesie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const stan = vi.hoisted(() => ({ zamowienie: null as any, palety: [] as any[], firma: null as any }))

vi.mock('@/lib/apiClient', () => ({
  clientOrdersApi: { byId: () => Promise.resolve(JSON.parse(JSON.stringify(stan.zamowienie))) },
  orderPalletsApi: { list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.palety))) },
  settingsApi: { getCompany: () => Promise.resolve(JSON.parse(JSON.stringify(stan.firma))) },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))

import { OrderPrintPage } from './OrderPrintPage'

beforeEach(() => {
  stan.firma = { name: 'FHUP Marek Księżyc', address: 'ul. Przykładowa 1', city: 'Wrocław', postalCode: '50-001' }
  stan.palety = []
  stan.zamowienie = {
    id: 'o1', orderNo: 'ZAGROS/Z/1/08/26', clientName: 'ZAGROS',
    orderDate: '2026-08-25', deliveryDate: '2026-08-28', status: 'confirmed',
    lines: [
      { id: 'l1', qty: 30, kgPerUnit: 50, totalKg: 1500, qtyStock: 30, qtyDone: 30,
        productTypeName: 'KEBAB', recipeName: 'KIRMIZI', packagingName: 'METAL 65' },
      { id: 'l2', qty: 20, kgPerUnit: 35, totalKg: 700, qtyStock: 8, qtyDone: 8,
        productTypeName: 'SEBZELI', recipeName: 'WROCŁAW', packagingName: 'KARTON 65' },
      { id: 'l3', qty: 10, kgPerUnit: 25, totalKg: 250, qtyDone: 0,
        productTypeName: 'KEBAB', recipeName: 'BEYAZ AFIYET', packagingName: '' },
      { id: 'l4', qty: 12, kgPerUnit: 20, totalKg: 240, qtyStock: 0, qtyDelivered: 12, qtyDone: 12,
        productTypeName: 'KEBAB UDO 100%', recipeName: 'KIRMIZI', packagingName: 'METAL 65' },
    ],
  }
})
afterEach(cleanup)

const pokaz = async () => {
  render(
    <MemoryRouter initialEntries={['/office/zamowienia/o1/druk']}>
      <Routes><Route path="/office/zamowienia/:id/druk" element={<OrderPrintPage />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByText(/ZAGROS\/Z\/1\/08\/26/)
}

describe('OrderPrintPage — co niesie kartka', () => {
  it('nagłówek mówi czyje to zamówienie i na kiedy', async () => {
    await pokaz()
    expect(screen.getByText('ZAGROS')).toBeTruthy()
    expect(screen.getByText(/28\.08\.2026/)).toBeTruthy()
    expect(screen.getByText(/FHUP Marek Księżyc/)).toBeTruthy()
  })

  it('każda pozycja niesie rodzaj, recepturę, tuleję, sztuki i wagę', async () => {
    await pokaz()
    const w = screen.getByTestId('pozycja-l1')
    const tresc = (w.textContent ?? '').replace(/[^0-9A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '')
    for (const tekst of ['KEBAB', 'KIRMIZI', 'METAL65', '30', '50', '1500']) {
      expect(tresc).toContain(tekst)
    }
  })

  it('pokazuje ile już zrobione i ile ZOSTAŁO — po to magazynier idzie do chłodni', async () => {
    await pokaz()
    expect(within(screen.getByTestId('pozycja-l2')).getByTestId('zrobione-l2').textContent).toContain('8')
    expect(within(screen.getByTestId('pozycja-l2')).getByTestId('zostalo-l2').textContent).toContain('12')
  })

  it('pozycja gotowa w całości nie każe niczego dowozić', async () => {
    await pokaz()
    expect(within(screen.getByTestId('pozycja-l1')).getByTestId('zostalo-l1').textContent).toMatch(/0|—/)
  })

  it('każda pozycja do skompletowania ma kratkę do odhaczenia ręką', async () => {
    await pokaz()
    for (const id of ['l1', 'l2', 'l3']) {
      expect(screen.getByTestId(`kratka-${id}`)).toBeTruthy()
    }
  })

  it('pozycja wydana klientowi nie ma czego kompletować', async () => {
    await pokaz()
    const w = screen.getByTestId('pozycja-l4')
    expect(w.textContent).toContain('WYDANE')
    expect(screen.queryByTestId('kratka-l4')).toBeNull()
  })

  it('pozycja częściowo wydana wciąż ma kratkę', async () => {
    stan.zamowienie.lines[3].qtyDelivered = 5
    stan.zamowienie.lines[3].qtyDone = 5
    await pokaz()
    expect(screen.getByTestId('kratka-l4')).toBeTruthy()
  })

  it('kolumna „na stanie" pokazuje TO, CO LEŻY — nie to, co wyjechało', async () => {
    // Magazyn wyrobu gotowego to świętość: magazynier bierze z półki.
    await pokaz()
    expect(within(screen.getByTestId('pozycja-l4')).getByTestId('zrobione-l4').textContent)
      .toMatch(/^—|0/)
  })

  it('podsumowanie zgadza się z pozycjami', async () => {
    await pokaz()
    const suma = (screen.getByTestId('podsumowanie').textContent ?? '').replace(/[^0-9A-Za-z]/g, '')
    expect(suma).toContain('72')        // 30 + 20 + 10 + 12 szt.
    expect(suma).toContain('2690')    // 1500 + 700 + 250 + 240 kg
  })

  it('jest miejsce na podpis magazyniera', async () => {
    await pokaz()
    const stopka = screen.getByTestId('podpisy').textContent ?? ''
    expect(stopka.toLowerCase()).toContain('skompletował')
    expect(stopka.toLowerCase()).toContain('podpis')
  })

  it('pusta tuleja nie drukuje się jako „undefined"', async () => {
    await pokaz()
    expect(screen.getByTestId('pozycja-l3').textContent).not.toContain('undefined')
  })
})
