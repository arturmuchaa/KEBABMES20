// @vitest-environment jsdom
/**
 * Okno „Dodaj wyrób gotowy" — wejście biura na czas, gdy produkcja i masownia
 * nie mają jeszcze komputerów (ok. miesiąc).
 *
 * Dwie rzeczy decydują o tym, czy wpis się przyda:
 *  • POWIĄZANIE — pokrycie zamówienia liczy się po trójce numer zamówienia +
 *    receptura + waga sztuki, więc te pola biorą się z POZYCJI zamówienia;
 *  • TEMPO — biuro wpisuje cały dzień produkcji naraz, więc pozycje wybiera
 *    się wielokrotnie, grupami po kliencie, jednym kliknięciem na grupę.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const stan = vi.hoisted(() => ({ zamowienia: [] as any[], partie: [] as any[], opakowania: [] as any[], receptury: [] as any[], klienci: [] as any[] }))
const wolania = vi.hoisted(() => ({ zapisy: [] as any[], blad: false }))
const kopia = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

vi.mock('@/lib/api', () => ({
  clientOrdersApi: { list: () => Promise.resolve(kopia(stan.zamowienia)) },
  seasonedMeatApi: { list: () => Promise.resolve(kopia(stan.partie)) },
  packagingApi: { all: () => Promise.resolve(kopia(stan.opakowania)) },
  recipesApi: { list: () => Promise.resolve(kopia(stan.receptury)) },
  clientsApi: { list: () => Promise.resolve(kopia(stan.klienci)) },
  finishedGoodsApi: {
    createBulk: (items: any[]) => {
      wolania.zapisy.push(items)
      return wolania.blad ? Promise.reject(new Error('brak łączności')) : Promise.resolve(items)
    },
  },
}))

import { AddFinishedGoodModal } from './AddFinishedGoodModal'

const pozycja = (over: any = {}) => ({
  id: 'ol1', qty: 20, qtyDone: 8, kgPerUnit: 35, recipeId: 'r1', recipeName: 'WROCŁAW',
  productTypeId: 'pt1', productTypeName: 'KEBAB', packagingId: 't1', packagingName: 'METAL 65',
  ...over,
})

beforeEach(() => {
  stan.zamowienia = [
    { id: 'o1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli sp. z o.o.', status: 'new',
      lines: [pozycja(), pozycja({ id: 'ol2', qty: 10, qtyDone: 0, kgPerUnit: 17.5, recipeName: 'KIRMIZI', recipeId: 'r2' })] },
    { id: 'o2', orderNo: 'ZAM/2', clientId: 'c2', clientName: 'Zagros', status: 'new',
      lines: [pozycja({ id: 'ol3', qty: 6, qtyDone: 0, kgPerUnit: 40 })] },
    { id: 'o3', orderNo: 'ZAM/0', clientId: 'c1', clientName: 'Bulli sp. z o.o.', status: 'done',
      lines: [pozycja({ id: 'ol9' })] },
  ]
  stan.partie = [
    { id: 'sm1', batchNo: '344', recipeName: 'WROCŁAW', kgAvailable: 800 },
    { id: 'sm2', batchNo: 'PP13', recipeName: 'KIRMIZI', kgAvailable: 400 },
  ]
  stan.opakowania = [{ id: 't1', name: 'METAL 65', type: 'tuleja', kgAvailable: 500 }]
  stan.receptury = [{ id: 'r1', name: 'WROCŁAW' }, { id: 'r2', name: 'KIRMIZI' }]
  stan.klienci = [
    { id: 'c1', name: 'Bulli sp. z o.o.', displayName: '' },
    // Nazwa prawna vs handlowa: biuro mówi „ZAGROS", w kartotece siedzi
    // „OKAYTEKIN KG" — na ekranie ma stać ta, którą hala zna.
    { id: 'c2', name: 'OKAYTEKIN KG', displayName: 'ZAGROS' },
  ]
  wolania.zapisy = []; wolania.blad = false
})
afterEach(cleanup)

const otworz = () => render(<AddFinishedGoodModal onClose={() => {}} onSaved={() => {}} />)

describe('AddFinishedGoodModal — pozycje pogrupowane klientami', () => {
  it('grupuje zamówienia po kliencie, nie sypie wszystkiego na jedną kupę', async () => {
    otworz()
    const bulli = await screen.findByTestId('grupa-c1')
    expect(within(bulli).getByText(/Bulli/)).toBeTruthy()
    expect(within(bulli).getByTestId('pozycja-ol1')).toBeTruthy()
    expect(within(bulli).getByTestId('pozycja-ol2')).toBeTruthy()
    expect(within(screen.getByTestId('grupa-c2')).getByTestId('pozycja-ol3')).toBeTruthy()
  })

  it('zamówienia zrealizowane nie zaśmiecają listy', async () => {
    otworz()
    await screen.findByTestId('grupa-c1')
    expect(screen.queryByTestId('pozycja-ol9')).toBeNull()
  })

  it('grupa klienta zaznacza się i odznacza jednym kliknięciem', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('grupa-zaznacz-c1'))
    expect(screen.getByTestId('koszyk').textContent).toContain('2 pozycje')

    fireEvent.click(screen.getByTestId('grupa-zaznacz-c1'))
    expect(screen.getByTestId('koszyk').textContent).toContain('nic nie wybrano')
  })

  it('zaznacz/odznacz wszystko obejmuje wszystkich klientów', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('zaznacz-wszystko'))
    expect(screen.getByTestId('koszyk').textContent).toContain('3 pozycje')

    fireEvent.click(screen.getByTestId('zaznacz-wszystko'))
    expect(screen.getByTestId('koszyk').textContent).toContain('nic nie wybrano')
  })

  it('pozycja startuje z brakującą ilością, którą da się poprawić', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    const ile = screen.getByTestId('ilosc-ol1') as HTMLInputElement
    expect(ile.value).toBe('12')

    fireEvent.change(ile, { target: { value: '5' } })
    expect(screen.getByTestId('koszyk').textContent).toContain('175')   // 5 × 35 kg
  })

  it('zapis wysyła JEDNO żądanie ze wszystkimi pozycjami', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('zaznacz-wszystko'))
    fireEvent.click(screen.getByTestId('partia-344'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    const paczka = wolania.zapisy[0]
    expect(paczka).toHaveLength(3)
    expect(paczka[0]).toMatchObject({ clientOrderNo: 'ZAM/1', recipeId: 'r1', kgPerUnit: 35, qty: 12 })
    expect(paczka[2]).toMatchObject({ clientOrderNo: 'ZAM/2', kgPerUnit: 40, qty: 6 })
  })
})

describe('AddFinishedGoodModal — numer partii', () => {
  it('domyślnie bierze partię z magazynu przyprawionego i zdejmuje mięso', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0][0]).toMatchObject({ seasonedBatchNos: ['344'], consumeSeasoned: true })
  })

  it('tryb ręczny bierze numer partii wprost z klawiatury i NIE rusza masowni', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-tryb-recznie'))
    fireEvent.change(screen.getByTestId('partia-reczna'), { target: { value: '250826 344' } })
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0][0]).toMatchObject({ batchNo: '250826 344', consumeSeasoned: false })
  })

  it('pokazuje wprost, jaki numer stanie na wyrobie — z masowni', async () => {
    otworz()
    fireEvent.change(screen.getByTestId('pole-data'), { target: { value: '2026-08-23' } })
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))

    expect(screen.getByTestId('partia-podglad').textContent).toContain('230826 344')
  })

  it('sam numer porządkowy dostaje datę produkcji — nie trzeba jej wpisywać', async () => {
    otworz()
    fireEvent.change(screen.getByTestId('pole-data'), { target: { value: '2026-08-23' } })
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-tryb-recznie'))
    fireEvent.change(screen.getByTestId('partia-reczna'), { target: { value: '456' } })
    expect(screen.getByTestId('partia-podglad').textContent).toContain('230826 456')

    fireEvent.click(screen.getByTestId('zapisz-wyrob'))
    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0][0].batchNo).toBe('230826 456')
  })

  it('wpisany pełny numer nie dostaje daty drugi raz', async () => {
    otworz()
    fireEvent.change(screen.getByTestId('pole-data'), { target: { value: '2026-08-23' } })
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-tryb-recznie'))
    fireEvent.change(screen.getByTestId('partia-reczna'), { target: { value: '230826 456' } })
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0][0].batchNo).toBe('230826 456')
  })

  it('tryb ręczny bez numeru nie przechodzi — wyrób bez partii jest bezużyteczny', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-tryb-recznie'))
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    expect(await screen.findByText('Wpisz numer partii')).toBeTruthy()
    expect(wolania.zapisy).toHaveLength(0)
  })
})

describe('AddFinishedGoodModal — wpis całkowicie ręczny', () => {
  it('bez zamówienia da się wpisać 20 × 40 kg z recepturą, tuleją i klientem', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('tryb-recznie'))
    fireEvent.change(screen.getByTestId('reczne-receptura'), { target: { value: 'r2' } })
    fireEvent.change(screen.getByTestId('reczne-waga'), { target: { value: '40' } })
    fireEvent.change(screen.getByTestId('reczne-sztuki'), { target: { value: '20' } })
    fireEvent.change(screen.getByTestId('reczne-tuleja'), { target: { value: 't1' } })
    // Lista klientów pokazuje nazwę HANDLOWĄ.
    expect(within(screen.getByTestId('reczne-klient')).getByText('ZAGROS')).toBeTruthy()
    expect(within(screen.getByTestId('reczne-klient')).queryByText('OKAYTEKIN KG')).toBeNull()
    fireEvent.change(screen.getByTestId('reczne-klient'), { target: { value: 'c2' } })
    fireEvent.click(screen.getByTestId('partia-tryb-recznie'))
    fireEvent.change(screen.getByTestId('partia-reczna'), { target: { value: '250826 PP13' } })
    fireEvent.click(screen.getByTestId('dodaj-do-koszyka'))

    expect(screen.getByTestId('koszyk').textContent).toContain('800')     // 20 × 40 kg
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    await waitFor(() => expect(wolania.zapisy).toHaveLength(1))
    expect(wolania.zapisy[0][0]).toMatchObject({
      recipeId: 'r2', kgPerUnit: 40, qty: 20, packagingId: 't1',
      // Na backend leci nazwa Z KARTOTEKI — po niej wiąże się zamówienia
      // i dokumenty; „ZAGROS" jest tylko tym, co widzi operator.
      clientId: 'c2', clientName: 'OKAYTEKIN KG', batchNo: '250826 PP13', clientOrderNo: '',
    })
  })

  it('ręczna pozycja da się usunąć z koszyka przed zapisem', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('tryb-recznie'))
    fireEvent.change(screen.getByTestId('reczne-receptura'), { target: { value: 'r1' } })
    fireEvent.change(screen.getByTestId('reczne-waga'), { target: { value: '35' } })
    fireEvent.change(screen.getByTestId('reczne-sztuki'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('dodaj-do-koszyka'))
    
    expect(screen.getByTestId('koszyk').textContent).toContain('1 pozycja')

    fireEvent.click(screen.getByTestId('usun-reczna-0'))
    expect(screen.getByTestId('koszyk').textContent).toContain('nic nie wybrano')
  })
})

describe('AddFinishedGoodModal — czego pilnuje', () => {
  it('nie zapisze pustego koszyka', async () => {
    otworz()
    await screen.findByTestId('grupa-c1')
    fireEvent.click(screen.getByTestId('zapisz-wyrob'))

    expect(await screen.findByText(/Wybierz/i)).toBeTruthy()
    expect(wolania.zapisy).toHaveLength(0)
  })

  it('mówi wprost, ile tulei i mięsa zejdzie ze stanu', async () => {
    otworz()
    fireEvent.click(await screen.findByTestId('pozycja-ol1'))
    fireEvent.click(screen.getByTestId('partia-344'))

    const skutki = screen.getByTestId('skutki')
    expect(skutki.textContent).toContain('12')     // tuleje
    expect(skutki.textContent).toContain('420')    // kg mięsa
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
