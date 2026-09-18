// @vitest-environment jsdom
/**
 * Stelaż okablowania panelu masowania — sprawdza POŁĄCZENIA, nie logikę.
 * Zaślepiamy wyłącznie moduły sięgające na zewnątrz (API, sesja).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const stan = vi.hoisted(() => ({
  zlecenia: [] as any[],
  pojemniki: [] as any[],
  wsady: [] as any[],
  mieso: { pallets: [] as any[], lots: [] as any[], taken: {} as Record<string, number> },
  receptury: [] as any[],
}))

vi.mock('@/lib/api', () => ({
  masowniaApi: {
    meat: vi.fn(async () => stan.mieso),
    carts: vi.fn(async () => stan.pojemniki),
    charges: vi.fn(async () => stan.wsady),
    createCart: vi.fn(async () => ({})),
    weighIngredient: vi.fn(async () => ({})),
    cancelCart: vi.fn(async () => ({})),
    load: vi.fn(async () => ({})),
    finish: vi.fn(async () => ({})),
  },
  mixingOrdersApi: {
    list: vi.fn(async () => { throw new Error('panel ma czytac PLAN DNIA, nie wszystkie zlecenia') }),
    dayPlan: vi.fn(async () => ({ items: stan.zlecenia, rev: 'r1', planDate: '2026-09-17' })),
  },
  recipesApi: { list: vi.fn(async () => stan.receptury) },
}))

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Mehmet' } }),
}))

import { MasowanieHmiPage } from '@/pages/tablet/MasowanieHmiPage'

beforeEach(() => {
  stan.zlecenia = [{
    id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
    meatKg: 1000, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [],
  }]
  stan.pojemniki = [{
    id: 'c1', cart_no: 2, order_id: 'o1', order_no: 'MAS/17/09/26',
    kg_target: 200, ingredients: [], status: 'prepared',
  }]
  stan.wsady = [{
    id: 'ch1', machine_id: 3, order_id: 'o1', order_no: 'MAS/17/09/26',
    recipe_name: 'KIRMIZI', kg_meat: 600, water_l: 108, batch_no: '511',
    started_at: new Date().toISOString(), status: 'mixing', meat: [],
  }]
  stan.mieso = { pallets: [], lots: [], taken: {} }
  stan.receptury = [{
    id: 'r1', name: 'KIRMIZI',
    ingredients: [
      { ingredientName: 'Przyprawa', qtyPer100kg: 6, unit: 'kg' },
      { ingredientName: 'Woda', qtyPer100kg: 18, unit: 'L' },
    ],
  }]
})

afterEach(() => cleanup())

describe('MasowanieHmiPage', () => {
  it('pokazuje trzy masownice z wielkościami wsadu', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 1')).toBeInTheDocument())
    expect(screen.getByText('Masownica 3')).toBeInTheDocument()
    expect(screen.getAllByText('wsad 200 kg')).toHaveLength(2)
    expect(screen.getByText('wsad 600 kg')).toBeInTheDocument()
  })

  it('NIE pokazuje cichego zapasu ponad nominał', async () => {
    // Wypisane „max 660" zrobiłoby z zapasu normę — hala widzi 200 i 600.
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 3')).toBeInTheDocument())
    expect(screen.queryByText(/660/)).not.toBeInTheDocument()
    expect(screen.queryByText(/260/)).not.toBeInTheDocument()
  })

  it('pokazuje zlecenie z kolejki dnia', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText('KIRMIZI').length).toBeGreaterThan(0))
  })

  it('pokazuje stojący pojemnik z przyprawami', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/pojemnik 2/i)).toBeInTheDocument())
  })

  it('masownica z wsadem odlicza czas do końca masowania', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
  })

  it('wsad po 50 minutach woła o odbiór', async () => {
    stan.wsady[0].started_at = new Date(Date.now() - 51 * 60_000).toISOString()
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText(/Gotowe — odbierz/i).length).toBeGreaterThan(0))
  })

  it('pusta masownia mówi, co teraz robić', async () => {
    stan.wsady = []
    stan.pojemniki = []
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Przygotuj przyprawy/i)).toBeInTheDocument())
    expect(screen.getByText(/Załaduj masownicę/i)).toBeInTheDocument()
  })

  it('zlecenie na filet krzyczy o tym już w kolejce dnia', async () => {
    // Właściciel wrzucił filet do planu na dziś i pyta, czy operator to widzi.
    // Kolejka to PIERWSZY ekran, na którym da się to powiedzieć — przyprawy
    // waży się do zlecenia, zanim ktokolwiek dotknie mięsa.
    stan.zlecenia = [{
      id: 'o1', orderNo: 'MAS/18/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
      meatKg: 507, kgDone: 0, daySeq: 1, status: 'confirmed',
      meatLots: [{ meatLotNo: '569', meatLotId: 'ms-569', kgPlanned: 507 }],
    }]
    stan.mieso = {
      pallets: [],
      lots: [{ meatStockId: 'ms-569', lotNo: '569', materialName: 'Filet z kurczaka',
               materialTypeId: 'mat-filet-kurczak', kgFree: 0, expiryDate: '2026-10-05',
               reservedByOrder: { o1: 507 } }],
      taken: {},
    }
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText('KIRMIZI').length).toBeGreaterThan(0))
    expect(screen.getByText('FILET Z KURCZAKA')).toBeInTheDocument()
  })

  it('zlecenie na zwykłe z/s nie dostaje plakietki', async () => {
    stan.zlecenia = [{
      id: 'o1', orderNo: 'MAS/18/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
      meatKg: 200, kgDone: 0, daySeq: 1, status: 'confirmed',
      meatLots: [{ meatLotNo: '563', meatLotId: 'ms-563', kgPlanned: 200 }],
    }]
    stan.mieso = {
      pallets: [],
      lots: [{ meatStockId: 'ms-563', lotNo: '563', materialName: 'Mięso z/s',
               materialTypeId: 'mat-mieso-zs', kgFree: 800, expiryDate: '2026-10-01' }],
      taken: {},
    }
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText('KIRMIZI').length).toBeGreaterThan(0))
    expect(screen.queryByText(/MIĘSO Z\/S/)).toBeNull()
  })

  it('pracująca masownica mówi, ile mięsa z niej wyjdzie', async () => {
    // 600 kg mięsa + 6 % przypraw + 18 % wody = 744 kg na wyjściu.
    stan.wsady[0].recipe_id = 'r1'
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
    expect(screen.getByText(/744/)).toBeInTheDocument()
  })

  it('wsad z dwóch partii jest podpisany jako mieszany, bez zmyślonego numeru', async () => {
    stan.wsady[0].recipe_id = 'r1'
    stan.wsady[0].batch_no = ''
    stan.wsady[0].meat = [
      { pallet_id: 'p1', lot_no: '511', meat_stock_id: 'ms-511', kg: 300 },
      { pallet_id: 'p2', lot_no: '513', meat_stock_id: 'ms-513', kg: 300 },
    ]
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
    expect(screen.getByText(/partia mieszana/i)).toBeInTheDocument()
    expect(screen.getByText(/511 \+ 513/)).toBeInTheDocument()
    expect(screen.queryByText(/PP\d/)).toBeNull()
  })

  it('przytrzymanie nagłówka otwiera menu serwisowe', async () => {
    // Masownia to osobny komputer od kiosku rozbioru: serwisant podpinający
    // wagę stoi przy nim ZALOGOWANY, więc wejście z ekranu logowania nie
    // wystarczy (uwaga właściciela 17.09.2026).
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 1')).toBeInTheDocument())
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(screen.getByText('Masowanie'))
      await act(async () => { vi.advanceTimersByTime(3200) })
      expect(screen.getByText('Menu serwisowe')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ścieżka załadunku — od maszyny do bramki partii', () => {
  it('operator wskazuje maszynę i zlecenie, a potem widzi tylko partie biura', async () => {
    stan.wsady = []
    stan.pojemniki = []
    stan.zlecenia = [
      { id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
        meatKg: 200, kgDone: 0, daySeq: 1, status: 'confirmed',
        meatLots: [{ meatLotNo: '511', meatLotId: 'ms-511', kgPlanned: 200 }] },
    ]
    stan.mieso = {
      pallets: [
        { id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-10-01',
          lots: [{ lotNo: '511', kg: 200 }] },
        { id: 'p2', palletNo: 'PAL/17/09/26/2', kgNet: 200, expiryDate: '2026-10-01',
          lots: [{ lotNo: '513', kg: 200 }] },
      ],
      lots: [
        { meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
        { meatStockId: 'ms-513', lotNo: '513', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
      ],
      taken: {},
    }

    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Załaduj masownicę/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Załaduj masownicę/i }))
    await waitFor(() => expect(screen.getByText('Wsad i masownica')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Masownica 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wsad MAS/17/09/26' }))
    fireEvent.click(screen.getByRole('button', { name: /Dalej — mięso/ }))

    await waitFor(() => expect(screen.getByText('Mięso do wsadu')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ })).toBeDisabled()
    expect(screen.getByText(/Biuro wskazało partię: 511/)).toBeInTheDocument()
  })

  it('bez partii u biura cały magazyn jest do wzięcia', async () => {
    stan.wsady = []
    stan.pojemniki = []
    stan.zlecenia = [
      { id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
        meatKg: 200, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] },
    ]
    stan.mieso = {
      pallets: [
        { id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-10-01',
          lots: [{ lotNo: '511', kg: 200 }] },
        { id: 'p2', palletNo: 'PAL/17/09/26/2', kgNet: 200, expiryDate: '2026-10-01',
          lots: [{ lotNo: '513', kg: 200 }] },
      ],
      lots: [
        { meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
        { meatStockId: 'ms-513', lotNo: '513', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
      ],
      taken: {},
    }

    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Załaduj masownicę/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Załaduj masownicę/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Masownica 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wsad MAS/17/09/26' }))
    fireEvent.click(screen.getByRole('button', { name: /Dalej — mięso/ }))

    await waitFor(() => expect(screen.getByText('Mięso do wsadu')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ })).toBeEnabled()
  })
})

describe('plan dnia i dolny pasek', () => {
  it('kolejka bierze PLAN DNIA, nie wszystkie zlecenia masowania', async () => {
    // `list()` w zaslepce rzuca — gdyby panel go uzyl, ekran pokazalby blad.
    // Hala ma widziec dzisiejszy plan, a nie historie masowan z calego miesiaca.
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText('KIRMIZI').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Brak łączności/)).not.toBeInTheDocument()
  })

  it('dolny pasek pokazuje liczby dnia', async () => {
    stan.zlecenia = [
      { id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
        meatKg: 1000, kgDone: 250, daySeq: 1, status: 'in_progress', meatLots: [] },
    ]
    stan.wsady = [{
      id: 'ch1', machine_id: 3, order_id: 'o1', order_no: 'MAS/17/09/26',
      recipe_name: 'KIRMIZI', kg_meat: 600, water_l: 108, batch_no: '511',
      started_at: new Date().toISOString(), status: 'mixing', meat: [],
    }]
    stan.pojemniki = [{ id: 'c1', cart_no: 2, order_id: 'o1', order_no: 'MAS/17/09/26',
                        kg_target: 200, ingredients: [], status: 'prepared' }]

    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Zaplanowane')).toBeInTheDocument())
    expect(screen.getByText('Wymieszane')).toBeInTheDocument()
    expect(screen.getByText('W maszynach')).toBeInTheDocument()
    expect(screen.getByText('Przyprawy gotowe')).toBeInTheDocument()
    expect(screen.getByText('Postęp')).toBeInTheDocument()

    const pasek = screen.getByTestId('pasek-dnia')
    expect(pasek).toHaveTextContent('1000 kg')   // zaplanowane
    expect(pasek).toHaveTextContent('250 kg')    // wymieszane
    expect(pasek).toHaveTextContent('25%')       // postep
    expect(pasek).toHaveTextContent('600 kg')    // w maszynach
    expect(pasek).toHaveTextContent('200 kg')    // przyprawy gotowe
  })

  it('pusty dzien nie dzieli przez zero', async () => {
    stan.zlecenia = []
    stan.wsady = []
    stan.pojemniki = []
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByTestId('pasek-dnia')).toBeInTheDocument())
    expect(screen.getByTestId('pasek-dnia')).toHaveTextContent('0%')
  })
})

describe('nic nie powstaje bez zważenia', () => {
  it('wejście i wyjście z ważenia NIE zakłada pojemnika', async () => {
    // Hala: „wszedłem i wyszedłem i pojawiło się, że przyprawy przygotowane,
    // a tak nie było". Pojemnik ma powstać dopiero po zatwierdzeniu całości.
    const { masowniaApi } = await import('@/lib/api')
    stan.wsady = []; stan.pojemniki = []
    stan.zlecenia = [{ id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
                       meatKg: 1000, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }]

    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Przygotuj przyprawy/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Przygotuj przyprawy/i }))
    await waitFor(() => expect(screen.getByText(/Na które zlecenie/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /MAS\/17\/09\/26/ }))
    await waitFor(() => expect(screen.getByText(/Typowe wsady|Przyprawy ważysz/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^200 kg/ }))
    await waitFor(() => expect(screen.getByText(/Przyprawy do pojemnika/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Wróć/ }))

    expect(masowniaApi.createCart).not.toHaveBeenCalled()
  })

  it('załadunek bez gotowych przypraw prowadzi przez wagę, nie prosto do wody', async () => {
    stan.wsady = []; stan.pojemniki = []
    stan.zlecenia = [{ id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
                       meatKg: 200, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }]
    stan.mieso = {
      pallets: [{ id: 'p1', palletNo: 'PAL/1', kgNet: 200, expiryDate: '2026-10-01',
                  lots: [{ lotNo: '511', kg: 200 }] }],
      lots: [{ meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s',
               materialTypeId: 'mat-mieso-zs', kgFree: 200, expiryDate: '2026-10-01' }],
      taken: {},
    }

    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Załaduj masownicę/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Załaduj masownicę/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Masownica 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wsad MAS/17/09/26' }))
    fireEvent.click(screen.getByRole('button', { name: /Dalej — mięso/ }))
    await waitFor(() => expect(screen.getByText('Mięso do wsadu')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /PAL\/1/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Załaduj/ }))

    await waitFor(() => expect(screen.getByText(/Przyprawy do masownicy/i)).toBeInTheDocument())
    expect(screen.queryByText(/Zadaj dawkę/i)).not.toBeInTheDocument()
  })
})

/**
 * Wsad niestandardowy przy PRZYGOTOWANIU PRZYPRAW (właściciel, 18.09.2026:
 * „nie mogę przygotować przypraw dla fileta 507 kg, mamy tylko 200 i 600").
 *
 * Standardy zostają, bo na nich stoi codzienna robota, ale reszta zlecenia
 * dostaje własny kafelek — inaczej niestandardowej ilości nie da się odważyć
 * w ogóle, a operator nie ma jak dopiąć zlecenia.
 */
describe('wielkość wsadu przy przygotowaniu przypraw', () => {
  const przygotujPrzyprawy = async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Przygotuj przyprawy/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Przygotuj przyprawy/i }))
    // Zlecenie wskazuje się w środku toru, nie na ekranie głównym.
    await waitFor(() => expect(screen.getByText(/Na które zlecenie/i)).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: /MAS\// })[0])
  }

  beforeEach(() => {
    stan.wsady = []
    stan.pojemniki = []
    stan.mieso = { pallets: [], lots: [], taken: {} }
  })

  it('507 kg fileta dostaje własny kafelek obok standardów', async () => {
    stan.zlecenia = [{ id: 'o1', orderNo: 'MAS/18/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
                       meatKg: 507, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }]
    await przygotujPrzyprawy()
    await waitFor(() => expect(screen.getByRole('button', { name: /^600 kg/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^200 kg/ })).toBeInTheDocument()
    const reszta = screen.getByRole('button', { name: /^507 kg/ })
    expect(reszta).toBeEnabled()
    expect(reszta).toHaveTextContent(/masownica 3/i)
  })

  it('kafelek reszty prowadzi do ważenia dokładnie na tyle kilogramów', async () => {
    stan.zlecenia = [{ id: 'o1', orderNo: 'MAS/18/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
                       meatKg: 440, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }]
    await przygotujPrzyprawy()
    await waitFor(() => expect(screen.getByRole('button', { name: /^440 kg/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^440 kg/ }))
    await waitFor(() => expect(screen.getByText(/Przyprawy do pojemnika/i)).toBeInTheDocument())
  })

  it('zlecenie ponad jeden wsad nie dostaje kafelka reszty', async () => {
    // 2400 kg to nie jest jeden wsad — żadna masownica tego nie weźmie.
    stan.zlecenia = [{ id: 'o1', orderNo: 'MAS/18/09/26/2', recipeId: 'r1', recipeName: 'BEYAZ',
                       meatKg: 2400, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }]
    await przygotujPrzyprawy()
    await waitFor(() => expect(screen.getByRole('button', { name: /^600 kg/ })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^2400 kg/ })).toBeNull()
    expect(screen.queryByText(/Reszta zlecenia/i)).toBeNull()
  })

  it('reszta równa standardowi nie dubluje kafelka', async () => {
    stan.zlecenia = [{ id: 'o1', orderNo: 'MAS/18/09/26/3', recipeId: 'r1', recipeName: 'KIRMIZI',
                       meatKg: 600, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }]
    await przygotujPrzyprawy()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^600 kg/ })).toHaveLength(1))
  })
})

/**
 * Jedno wejście w proces (właściciel, 18.09.2026: „z lewej strony przez
 * zlecenie mogę wejść do procesu" — i to się myliło z kafelkami).
 *
 * Kolejka dnia jest TABLICĄ, nie przyciskiem: mówi, co i na ile zrobione.
 * Robotę zaczyna się wyłącznie kafelkami, a zlecenie wybiera się w środku.
 */
describe('jedno wejście w proces', () => {
  beforeEach(() => {
    stan.wsady = []
    stan.pojemniki = []
    stan.mieso = { pallets: [], lots: [], taken: {} }
    stan.zlecenia = [
      { id: 'o1', orderNo: 'MAS/18/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
        meatKg: 1000, kgDone: 250, daySeq: 1, status: 'confirmed', meatLots: [] },
      { id: 'o2', orderNo: 'MAS/18/09/26/2', recipeId: 'r1', recipeName: 'BEYAZ',
        meatKg: 600, kgDone: 600, daySeq: 2, status: 'confirmed', meatLots: [] },
    ]
  })

  it('kliknięcie zlecenia w kolejce NIE wchodzi w przyprawy', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText('KIRMIZI').length).toBeGreaterThan(0))
    const wiersz = screen.getAllByText('KIRMIZI')[0]
    fireEvent.click(wiersz)
    expect(screen.queryByText(/Przyprawy do pojemnika/i)).toBeNull()
    expect(screen.queryByText(/Wielkość wsadu|Odważ teraz/i)).toBeNull()
  })

  it('kafelek przypraw pyta o zlecenie, zamiast brać pierwsze z brzegu', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Przygotuj przyprawy/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Przygotuj przyprawy/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /MAS\/18\/09\/26 /i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /MAS\/18\/09\/26 /i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^600 kg/ })).toBeInTheDocument())
  })

  it('kolejka pokazuje procent ukończenia zlecenia', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('25%')).toBeInTheDocument())
  })

  it('zrobione zlecenie jest zielone i na 100%', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument())
    expect(screen.getAllByText(/Gotowe/i).length).toBeGreaterThan(0)
  })
})

/**
 * Czas masowania z receptury + widoczny ruch maszyny (właściciel 18.09.2026).
 */
describe('czas masowania i animacja', () => {
  it('wsad na 30 minut kończy się po 30, nie po 50', async () => {
    stan.wsady = [{
      id: 'ch1', machine_id: 3, order_id: 'o1', order_no: 'MAS/18/09/26',
      recipe_name: 'YAPRAK', recipe_id: 'r1', kg_meat: 600, water_l: 108, batch_no: '511',
      mix_minutes: 30, status: 'mixing', meat: [],
      started_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    }]
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText(/Gotowe — odbierz/i).length).toBeGreaterThan(0))
  })

  it('ten sam wsad na standardowych 50 minut jeszcze pracuje', async () => {
    stan.wsady = [{
      id: 'ch1', machine_id: 3, order_id: 'o1', order_no: 'MAS/18/09/26',
      recipe_name: 'KIRMIZI', recipe_id: 'r1', kg_meat: 600, water_l: 108, batch_no: '511',
      status: 'mixing', meat: [],
      started_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    }]
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
    expect(screen.queryByText(/Gotowe — odbierz/i)).toBeNull()
  })

  it('pracująca masownica się kręci — widać, że robota idzie', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
    expect(document.querySelector('[data-testid="beben-masownicy"]')).toBeTruthy()
  })

  it('wolna masownica nie kręci niczym', async () => {
    stan.wsady = []
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText(/Wolna/i).length).toBeGreaterThan(0))
    expect(document.querySelector('[data-testid="beben-masownicy"]')).toBeNull()
  })
})
