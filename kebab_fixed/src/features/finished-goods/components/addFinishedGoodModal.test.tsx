// @vitest-environment jsdom
/**
 * Ręczne dodanie wyrobu gotowego — okno biura.
 *
 * Sedno: wpis ma się POŁĄCZYĆ Z ZAMÓWIENIEM. Pokrycie zamówienia liczy się
 * po trójce numer zamówienia + receptura + waga sztuki, więc formularz
 * wypełnia je z POZYCJI zamówienia, a nie z ręki operatora.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const stan = vi.hoisted(() => ({ zamowienia: [] as any[], partie: [] as any[], opakowania: [] as any[], receptury: [] as any[] }))
const wolania = vi.hoisted(() => ({ zapisy: [] as any[], blad: false }))

vi.mock('@/lib/api', () => ({
  clientOrdersApi: { list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.zamowienia))) },
  seasonedMeatApi: { list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.partie))) },
  packagingApi: { all: () => Promise.resolve(JSON.parse(JSON.stringify(stan.opakowania))) },
  recipesApi: { list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.receptury))) },
  finishedGoodsApi: {
    create: (dto: any) => {
      wolania.zapisy.push(dto)
      return wolania.blad ? Promise.reject(new Error('brak łączności')) : Promise.resolve({ id: 'fg1' })
    },
  },
}))

import { AddFinishedGoodModal } from './AddFinishedGoodModal'

beforeEach(() => {
  stan.zamowienia = [{
    id: 'o1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli sp. z o.o.', status: 'new',
    lines: [
      { id: 'ol1', qty: 20, qtyDone: 8, kgPerUnit: 35, recipeId: 'r1', recipeName: 'WROCŁAW',
        productTypeId: 'pt1', productTypeName: 'KEBAB', packagingId: 't1', packagingName: 'METAL 65' },
    ],
  }]
  stan.partie = [
    { id: 'sm1', batchNo: '344', recipeName: 'WROCŁAW', kgAvailable: 800 },
    { id: 'sm2', batchNo: 'PP13', recipeName: 'KIRMIZI', kgAvailable: 400 },
  ]
  stan.opakowania = [{ id: 't1', name: 'METAL 65', type: 'tuleja', kgAvailable: 500 }]
  stan.receptury = [{ id: 'r1', name: 'WROCŁAW' }, { id: 'r2', name: 'KIRMIZI' }]
  wolania.zapisy = []; wolania.blad = false
})
afterEach(cleanup)

const otworz = () => render(<AddFinishedGoodModal onClose={() => {}} onSaved={() => {}} />)

describe('AddFinishedGoodModal — z zamówienia', () => {
  it('pozycja zamówienia wypełnia recepturę, wagę, tuleję i klienta', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))

    expect((screen.getByTestId('pole-waga') as HTMLInputElement).value).toBe('35')
    expect(screen.getByTestId('podsumowanie').textContent).toContain('WROCŁAW')
    expect(screen.getByTestId('podsumowanie').textContent).toContain('METAL 65')
    expect(screen.getByTestId('podsumowanie').textContent).toContain('Bulli')
  })

  it('podpowiada, ile jeszcze brakuje na pozycji', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    expect((screen.getByTestId('pole-sztuki') as HTMLInputElement).value).toBe('12')
  })

  it('zapis niesie numer zamówienia, recepturę i wagę — po tej trójce liczy się pokrycie', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0]).toMatchObject({
      clientOrderNo: 'ZAM/1', clientId: 'c1', recipeId: 'r1', kgPerUnit: 35, qty: 12,
      packagingId: 't1', seasonedBatchNos: ['344'], consumeSeasoned: true,
    })
  })
})

describe('AddFinishedGoodModal — na magazyn', () => {
  it('bez zamówienia da się wpisać wyrób na magazyn', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('tryb-magazyn'))
    fireEvent.change(screen.getByTestId('pole-receptura'), { target: { value: 'r2' } })
    fireEvent.change(screen.getByTestId('pole-waga'), { target: { value: '17,5' } })
    fireEvent.change(screen.getByTestId('pole-sztuki'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0]).toMatchObject({
      recipeId: 'r2', kgPerUnit: 17.5, qty: 6, clientOrderNo: '', consumeSeasoned: false,
    })
  })
})

describe('AddFinishedGoodModal — czego pilnuje', () => {
  it('nie zapisze wyrobu bez receptury', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('tryb-magazyn'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    expect(await screen.findByText(/Wskaż recepturę/i)).toBeTruthy()
    expect(wolania.zapisy).toHaveLength(0)
  })

  it('mówi wprost, ile mięsa i tulei zejdzie ze stanu', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))

    const skutki = screen.getByTestId('skutki')
    expect(skutki.textContent).toContain('420')      // 12 × 35 kg mięsa
    expect(skutki.textContent).toContain('12')       // 12 tulei
  })

  it('odznaczone zdejmowanie mięsa nie rusza masowni', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))
    fireEvent.click(screen.getByTestId('zdejmij-mieso'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0].consumeSeasoned).toBe(false)
  })

  it('nieudany zapis mówi to operatorowi i nie zamyka okna', async () => {
    wolania.blad = true
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    expect(await screen.findByText(/brak łączności/i)).toBeTruthy()
    expect(screen.getByTestId('zapisz-wyrob')).toBeTruthy()
  })
})
