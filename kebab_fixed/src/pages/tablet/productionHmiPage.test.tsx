// @vitest-environment jsdom
/**
 * Stelaż okablowania ekranu produkcyjnego — sprawdza POŁĄCZENIA, nie logikę.
 *
 * POWÓD ISTNIENIA: 24.08.2026 trzy awarie rozbioru wyszły z tej samej warstwy —
 * strona przekazywała dane komponentom ręcznie i nikt tego nie sprawdzał
 * (kreator bez partii z ekranu, kafel ze sklejonym obiektem, nowe źródło poza
 * odświeżaniem). Ekran produkcyjny dostaje ten sam stelaż od pierwszego dnia.
 *
 * Dlatego NIE zaślepiamy `useApi` ani `useLiveRefresh`: prawdziwy cykl pobrań
 * i odświeżania jest tu przedmiotem testu. Zaślepiamy wyłącznie moduły
 * sięgające na zewnątrz — API i sesję.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const stan = vi.hoisted(() => ({
  plany: [] as any[],
  operatorzy: [] as any[],
  materialy: [] as any[],
  foliowanie: [] as any[],
}))
const wolania = vi.hoisted(() => ({
  postep: [] as any[],
  finish: [] as any[],
  pobranie: [] as any[],
  zwrot: [] as any[],
  foliowanieZapis: [] as any[],
}))

const kopia = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

vi.mock('@/lib/api', () => ({
  productionPlansApi: {
    list: () => Promise.resolve(kopia(stan.plany)),
    updateLineProgress: (planId: string, lineId: string, body: any) => {
      wolania.postep.push({ planId, lineId, body })
      const l = stan.plany[0].lines.find((x: any) => x.id === lineId)
      l.qtyDone = body.qtyDone; l.workerEntries = body.workerEntries; l.lineStatus = body.lineStatus
      return Promise.resolve({})
    },
    tabletFinish: (planId: string, entries: any[]) => {
      wolania.finish.push({ planId, entries }); return Promise.resolve({})
    },
  },
  wrappingApi: {
    forDay: () => Promise.resolve(kopia(stan.foliowanie)),
    save: (workDate: string, entries: any[]) => {
      wolania.foliowanieZapis.push({ workDate, entries })
      stan.foliowanie = entries
      return Promise.resolve({ ok: true, entries: entries.length })
    },
  },
  operatorsApi: { forDepartment: (d: string) => Promise.resolve(kopia(stan.operatorzy).map((o: any) => ({ ...o, dep: d }))) },
  dayMaterialsApi: {
    forDay: () => Promise.resolve(kopia(stan.materialy)),
    take: (workDate: string, packagingId: string, qty: number) => {
      wolania.pobranie.push({ workDate, packagingId, qty })
      stan.materialy[0].pobrane += qty
      return Promise.resolve({ ok: true })
    },
    giveBack: (workDate: string, packagingId: string, qty: number) => {
      wolania.zwrot.push({ workDate, packagingId, qty }); return Promise.resolve({ ok: true })
    },
  },
}))

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'MARCIN NOWAK' }, logout: vi.fn(), loading: false }),
}))

import { ProductionHmiPage } from './ProductionHmiPage'
import { getProductionDate } from '@/features/deboning/utils'

const DZIEN = getProductionDate()

const pozycja = (over: any = {}) => ({
  id: 'l1', qty: 20, kgPerUnit: 35, totalKg: 700,
  productTypeId: 'pt1', productTypeName: 'KEBAB', recipeId: 'r1', recipeName: 'WROCŁAW',
  packagingId: 'pk1', packagingName: 'Tuleja 120', clientName: 'Bulli sp. z o.o.',
  qtyDone: 0, workerEntries: [], lineStatus: 'PLANNED', seasonedBatchNos: ['PP13'],
  ...over,
})

beforeEach(() => {
  stan.plany = [{
    id: 'p1', planNo: 'PP/1', planDate: DZIEN, status: 'active',
    tabletFinishedAt: null, officeConfirmedAt: null,
    lines: [pozycja(), pozycja({ id: 'l2', qty: 10, kgPerUnit: 40, totalKg: 400, recipeName: 'KIRMIZI', clientName: '' })],
  }]
  stan.operatorzy = [{ id: 'w1', name: 'DAWID NOWAK' }, { id: 'w2', name: 'DENYS KOVAL' }]
  stan.materialy = [{ packagingId: 'f1', name: 'Folia stretch', unit: 'rolek', pobrane: 40, zwrocone: 0, zuzyte: 40, moves: [] }]
  stan.foliowanie = []
  wolania.postep = []; wolania.finish = []; wolania.pobranie = []; wolania.zwrot = []
  wolania.foliowanieZapis = []
})
afterEach(cleanup)

describe('ProductionHmiPage — okablowanie', () => {
  it('plan dnia wczytuje się SAM, bez wybierania z listy', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    expect(await screen.findByText('WROCŁAW')).toBeTruthy()
    expect(screen.getByText('KIRMIZI')).toBeTruthy()
  })

  it('nagłówek liczy plan w kilogramach i podaje procent', async () => {
    stan.plany[0].lines[0].qtyDone = 10   // 350 z 1100 kg = 32%
    render(<ProductionHmiPage buildLabel="test" />)
    expect(await screen.findByText('1100 kg')).toBeTruthy()
    expect(screen.getByText('350 kg')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
  })

  it('zapis sztuk trafia do WŁAŚCIWEJ pozycji i właściwego pracownika', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('KIRMIZI'))          // druga pozycja
    fireEvent.click(await screen.findByRole('button', { name: 'DENYS' }))
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('zapisz'))

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    const w = wolania.postep[0]
    expect(w.lineId).toBe('l2')
    expect(w.body.qtyDone).toBe(2)
    expect(w.body.workerEntries[0]).toMatchObject({ workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 2 })
  })

  it('licznik pozycji rośnie po zapisie — bierze stan z serwera, nie z kopii', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByTestId('zapisz'))
    await waitFor(() => expect(screen.getByText(/Wykonano/).textContent).toContain('1'))
  })

  it('PRZERWA blokuje zapis sztuk, dopóki operator jej nie wyłączy', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByRole('button', { name: 'Przerwa' }))

    expect(await screen.findByText(/nie zapisze sztuk/i)).toBeTruthy()
    fireEvent.click(screen.getByTestId('zapisz'))
    expect(wolania.postep).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Wracam do pracy/i }))
    fireEvent.click(screen.getByTestId('zapisz'))
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
  })

  it('zmiana planu w tle podnosi pasek i nie znika bez potwierdzenia', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    await screen.findByText('WROCŁAW')

    stan.plany[0].lines.push(pozycja({ id: 'l3', qty: 4, kgPerUnit: 12, recipeName: 'BULLI' }))
    expect(await screen.findByText('doszła BULLI 4×12 kg', {}, { timeout: 8000 })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Rozumiem/i }))
    await waitFor(() => expect(screen.queryByText('doszła BULLI 4×12 kg')).toBeNull())
  }, 12000)

  it('wejście na ekran NIE zgłasza całego planu jako zmiany', async () => {
    // Migawka wzięta przed wczytaniem planu jest pusta — wtedy każda pozycja
    // wygląda na nowo dodaną i operator uczy się ignorować pasek.
    render(<ProductionHmiPage buildLabel="test" />)
    await screen.findByText('WROCŁAW')
    expect(screen.queryByText(/Plan zmieniony przez biuro/i)).toBeNull()
  })

  it('druga zmiana przed potwierdzeniem pierwszej NIE ginie', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    await screen.findByText('WROCŁAW')

    stan.plany[0].lines.push(pozycja({ id: 'l3', qty: 4, kgPerUnit: 12, recipeName: 'BULLI' }))
    await screen.findByText('doszła BULLI 4×12 kg', {}, { timeout: 8000 })

    stan.plany[0].lines[0].qty = 32
    expect(await screen.findByText('WROCŁAW 20 → 32 szt.', {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.getByText('doszła BULLI 4×12 kg')).toBeTruthy()
  }, 20000)

  it('pobranie folii idzie na dzisiejszy dzień i właściwą kartotekę', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByRole('button', { name: /Dołóż rolki/i }))
    fireEvent.click(screen.getByRole('button', { name: '+20' }))

    await waitFor(() => expect(wolania.pobranie).toHaveLength(1))
    expect(wolania.pobranie[0]).toMatchObject({ workDate: DZIEN, packagingId: 'f1', qty: 20 })
  })

  it('statystyki zmiany liczą kilogramy z wagi sztuki tej pozycji', async () => {
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w1', workerName: 'DAWID', pieces: 4, addedAt: '' }]
    stan.plany[0].lines[0].qtyDone = 4
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByRole('button', { name: /Statystyki/i }))

    const wiersz = (await screen.findByText('DAWID')).closest('tr')!
    expect(within(wiersz).getByText('140')).toBeTruthy()   // 4 × 35 kg
    expect(within(wiersz).getByText('4')).toBeTruthy()     // sztuki obok kilogramów
  })

  it('zakończenie dnia zwraca folię i wysyła wpisy do biura', async () => {
    stan.plany[0].lines[0].qtyDone = 3
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 3, addedAt: '' }]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByRole('button', { name: /Zakończ dzień/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'więcej rolek' }))
    fireEvent.click(screen.getByTestId('zakoncz'))

    await waitFor(() => expect(wolania.finish).toHaveLength(1))
    expect(wolania.zwrot[0]).toMatchObject({ packagingId: 'f1', qty: 1 })
    const e = wolania.finish[0].entries
    expect(e).toHaveLength(1)                       // tylko pozycje z postępem
    expect(e[0]).toMatchObject({ planLineId: 'l1', qty: 3, kgPerUnit: 35, workerNames: ['DAWID NOWAK'] })
  })

  it('plan wysłany do biura mówi to operatorowi', async () => {
    stan.plany[0].tabletFinishedAt = '2026-08-25T14:00:00'
    render(<ProductionHmiPage buildLabel="test" />)
    expect(await screen.findByText(/czeka na potwierdzenie/i)).toBeTruthy()
  })

  it('brak planu na dziś mówi to wprost, zamiast pustej tabeli', async () => {
    stan.plany = []
    render(<ProductionHmiPage buildLabel="test" />)
    expect(await screen.findByText(/Biuro nie zaplanowało/i)).toBeTruthy()
  })
})

describe('ProductionHmiPage — pasek dnia i foliowanie', () => {
  it('pasek dnia pokazuje kilogramy, postęp i tempo cały czas na oku', async () => {
    stan.plany[0].lines[0].qtyDone = 10          // 350 z 1100 kg
    render(<ProductionHmiPage buildLabel="test" />)
    await screen.findByText('WROCŁAW')

    expect(screen.getByText('Zrobione')).toBeTruthy()
    expect(screen.getByText('350 kg')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
    expect(screen.getByText(/Foliowanie/)).toBeTruthy()
  })

  it('kafel foliowania otwiera okno i zapisuje podział po równo', async () => {
    stan.plany[0].lines[0].qtyDone = 20          // 700 kg zrobione
    render(<ProductionHmiPage buildLabel="test" />)
    await screen.findByText('WROCŁAW')

    fireEvent.click(screen.getByRole('button', { name: /Foliowanie/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'DAWID NOWAK' }))
    fireEvent.click(screen.getByRole('button', { name: 'DENYS KOVAL' }))
    fireEvent.click(screen.getByRole('button', { name: /Podziel po równo/ }))
    fireEvent.click(screen.getByTestId('zapisz-foliowanie'))

    await waitFor(() => expect(wolania.foliowanieZapis).toHaveLength(1))
    expect(wolania.foliowanieZapis[0].workDate).toBe(DZIEN)
    expect(wolania.foliowanieZapis[0].entries).toEqual([
      { workerId: 'w1', workerName: 'DAWID NOWAK', kg: 350 },
      { workerId: 'w2', workerName: 'DENYS KOVAL', kg: 350 },
    ])
  })

  it('zapisane foliowanie widać na pasku bez wchodzenia w okno', async () => {
    stan.foliowanie = [{ workerId: 'w1', workerName: 'DAWID NOWAK', kg: 4000 }]
    render(<ProductionHmiPage buildLabel="test" />)
    expect(await screen.findByText('4000 kg')).toBeTruthy()
  })
})
