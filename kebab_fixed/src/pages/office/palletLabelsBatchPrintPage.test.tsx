// @vitest-environment jsdom
/**
 * Druk kartek dla WIELU palet naraz.
 *
 * Właściciel (2026-09-09): „możliwość drukowania wszystkich lub zaznaczeniu
 * wielu kartek na palety, aby nie drukować pojedynczo" oraz „na jedną paletę
 * drukujemy 2 kartki tego samego i naklejamy 2 na karton".
 *
 * Kartki jednej palety muszą wyjść OBOK SIEBIE — magazynier zdejmuje parę
 * z drukarki i idzie z nią do palety. Przeplot (wszystkie pierwsze kopie,
 * potem wszystkie drugie) zmusiłby go do sortowania stosu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const stan = vi.hoisted(() => ({ zamowienie: null as any, palety: [] as any[] }))

vi.mock('@/lib/apiClient', () => ({
  clientOrdersApi: { byId: () => Promise.resolve(JSON.parse(JSON.stringify(stan.zamowienie))) },
  orderPalletsApi: { list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.palety))) },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:image/png;base64,AAA') } }))

import { PalletLabelsBatchPrintPage } from './PalletLabelsBatchPrintPage'

beforeEach(() => {
  stan.zamowienie = {
    id: 'o1', orderNo: 'YALCIN/Z/4/09/26', clientName: 'YALCIN',
    lines: [
      { id: 'l1', qty: 10, kgPerUnit: 80, recipeName: 'BEYAZ AFIYET', packagingName: 'METAL 60CM' },
      { id: 'l2', qty: 5,  kgPerUnit: 40, recipeName: 'KIRMIZI',      packagingName: 'METAL 80CM' },
    ],
  }
  stan.palety = [
    { id: 'p1', palletNo: 1, cartonNo: '000001', items: [{ orderLineId: 'l1', qty: 10 }] },
    { id: 'p2', palletNo: 2, cartonNo: '000002', items: [{ orderLineId: 'l2', qty: 5 }] },
    { id: 'p3', palletNo: 3, cartonNo: '000003', items: [
      { orderLineId: 'l1', qty: 4 }, { orderLineId: 'l2', qty: 2 }] },
  ]
})
afterEach(cleanup)

async function pokaz(query: string) {
  render(
    <MemoryRouter initialEntries={[`/office/zamowienia/o1/palety/druk${query}`]}>
      <Routes>
        <Route path="/office/zamowienia/:id/palety/druk" element={<PalletLabelsBatchPrintPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.queryAllByTestId('label-page').length).toBeGreaterThan(0))
}

describe('PalletLabelsBatchPrintPage — ile kartek', () => {
  it('bez parametru drukuje WSZYSTKIE palety, po dwie kartki', async () => {
    await pokaz('')
    expect(screen.getAllByTestId('label-page')).toHaveLength(6)   // 3 palety × 2
  })

  it('zaznaczone palety drukuje tylko te wskazane', async () => {
    await pokaz('?palety=1,3')
    expect(screen.getAllByTestId('label-page')).toHaveLength(4)   // 2 palety × 2
    expect(screen.getAllByText('000001')).toHaveLength(2)
    expect(screen.getAllByText('000003')).toHaveLength(2)
    expect(screen.queryAllByText('000002')).toHaveLength(0)
  })

  it('dwie kartki tej samej palety ida OBOK SIEBIE', async () => {
    await pokaz('?palety=1,2')
    const numery = screen.getAllByTestId('label-corner-no').map(el => el.textContent)
    expect(numery).toEqual(['000001', '000001', '000002', '000002'])
  })

  it('pomija numer palety, ktorej nie ma w zamowieniu', async () => {
    await pokaz('?palety=1,99')
    expect(screen.getAllByTestId('label-page')).toHaveLength(2)
  })
})

describe('PalletLabelsBatchPrintPage — tresc kartek', () => {
  it('paleta z jedna receptura ma ja osobna linia pod klientem', async () => {
    await pokaz('?palety=1')
    expect(screen.getAllByText('YALCIN')).toHaveLength(2)
    expect(screen.getAllByText('BEYAZ AFIYET')).toHaveLength(2)
    expect(screen.getAllByText('10 X 80KG')).toHaveLength(2)
  })

  it('paleta mieszana ma recepture przy KAZDEJ pozycji, bez nawiasow', async () => {
    await pokaz('?palety=3')
    expect(screen.getAllByText('4 X 80KG BEYAZ AFIYET')).toHaveLength(2)
    expect(screen.getAllByText('2 X 40KG 80CM KIRMIZI')).toHaveLength(2)
  })

  it('mowi, ktore palety poszly na wydruk', async () => {
    await pokaz('?palety=1,3')
    expect(screen.getByText(/palety 1, 3/i)).toBeTruthy()
  })

  it('zamowienie bez palet nie drukuje pustej kartki', async () => {
    stan.palety = []
    render(
      <MemoryRouter initialEntries={['/office/zamowienia/o1/palety/druk']}>
        <Routes>
          <Route path="/office/zamowienia/:id/palety/druk" element={<PalletLabelsBatchPrintPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText(/nie ma palet/i)
    expect(screen.queryAllByTestId('label-page')).toHaveLength(0)
  })
})
