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
  opakowania: [] as any[],
  /** Postęp skanowania per pozycja planu: { [planLineId]: { total, scanned } }. */
  skanPozycji: {} as Record<string, { total: number; scanned: number }>,
  przerwy: [] as any[],
}))
const wolania = vi.hoisted(() => ({
  postep: [] as any[],
  finish: [] as any[],
  pobranie: [] as any[],
  zwrot: [] as any[],
  foliowanieZapis: [] as any[],
  tuleja: [] as any[],
  tulejaBlad: false,
  przeniesienia: [] as any[],
  przeniesienieBlad: false,
  skany: [] as any[],
  przerwy: [] as any[],
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
    moveLinePieces: (planId: string, lineId: string, body: any) => {
      wolania.przeniesienia.push({ planId, lineId, body })
      if (wolania.przeniesienieBlad) return Promise.reject(new Error('brak łączności'))
      const l = stan.plany[0].lines.find((x: any) => x.id === lineId)
      const z = l.workerEntries.find((e: any) => e.workerId === body.fromWorkerId)
      z.pieces -= body.pieces
      const na = l.workerEntries.find((e: any) => e.workerId === body.toWorkerId)
      if (na) na.pieces += body.pieces
      else l.workerEntries.push({ workerId: body.toWorkerId, workerName: body.toWorkerName, pieces: body.pieces, addedAt: '12:00' })
      l.workerEntries = l.workerEntries.filter((e: any) => e.pieces > 0)
      return Promise.resolve({ ok: true, moved: body.pieces })
    },
    startBreak: (planId: string) => {
      wolania.przerwy.push({ planId, co: 'start' }); return Promise.resolve({ ok: true })
    },
    endBreak: (planId: string) => {
      wolania.przerwy.push({ planId, co: 'end' }); return Promise.resolve({ ok: true })
    },
    breaks: () => Promise.resolve(kopia(stan.przerwy)),
    changeLinePackaging: (planId: string, lineId: string, packagingId: string) => {
      wolania.tuleja.push({ planId, lineId, packagingId })
      if (wolania.tulejaBlad) return Promise.reject(new Error('brak łączności'))
      const l = stan.plany[0].lines.find((x: any) => x.id === lineId)
      const pkg = stan.opakowania.find((p: any) => p.id === packagingId)
      l.packagingId = packagingId; l.packagingName = pkg?.name ?? ''
      return Promise.resolve({ ok: true, moved: l.packagingUsed ?? 0 })
    },
  },
  packagingApi: { all: () => Promise.resolve(kopia(stan.opakowania)) },
  productionRatesApi: {
    current: () => Promise.resolve({ seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} }),
  },
  finishedUnitsApi: {
    scanProduced: (code: string, _trolleyId?: string, planLineId?: string) => {
      wolania.skany.push({ code, planLineId })
      const l = stan.plany[0].lines.find((x: any) => x.id === planLineId) ?? stan.plany[0].lines[0]
      l.qtyDone = (l.qtyDone ?? 0) + 1
      const s = stan.skanPozycji[l.id] ?? { total: l.qty, scanned: 0 }
      stan.skanPozycji[l.id] = { total: s.total, scanned: s.scanned + 1 }
      return Promise.resolve({
        ok: true, unitId: 'u1', status: 'produced', clientName: 'Bulli sp. z o.o.',
        batchNo: '250826 344', weightKg: 35, done: l.qtyDone, total: l.qty, onStock: true,
        planLineId: l.id,
      })
    },
    planScanProgress: () => Promise.resolve(
      (stan.plany[0]?.lines ?? []).map((l: any) => ({
        planLineId: l.id,
        total: stan.skanPozycji[l.id]?.total ?? 0,
        scanned: stan.skanPozycji[l.id]?.scanned ?? 0,
      })),
    ),
  },
  wrappingApi: {
    forDay: () => Promise.resolve(kopia(stan.foliowanie)),
    save: (workDate: string, entries: any[]) => {
      wolania.foliowanieZapis.push({ workDate, entries })
      stan.foliowanie = entries
      return Promise.resolve({ ok: true, entries: entries.length })
    },
  },
  usersApi: { list: () => Promise.resolve(kopia(stan.operatorzy)) },
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
  stan.operatorzy = [
    { id: 'w1', name: 'DAWID NOWAK', role: 'WORKER_PRODUCTION', active: true },
    { id: 'w2', name: 'DENYS KOVAL', role: 'WORKER_PRODUCTION', active: true },
  ]
  stan.materialy = [{ packagingId: 'f1', name: 'Folia stretch', unit: 'rolek', pobrane: 40, zwrocone: 0, zuzyte: 40, moves: [] }]
  stan.foliowanie = []
  stan.opakowania = [
    { id: 'pk1', name: 'Tuleja 120', type: 'tuleja', kgAvailable: 200 },
    { id: 'pk2', name: 'KARTON 65', type: 'tuleja', kgAvailable: 80 },
    { id: 'f1', name: 'Folia stretch', type: 'FOLIA', kgAvailable: 30 },
  ]
  wolania.tuleja = []; wolania.tulejaBlad = false; wolania.przeniesienia = []; wolania.przeniesienieBlad = false
  wolania.postep = []; wolania.finish = []; wolania.pobranie = []; wolania.zwrot = []
  wolania.foliowanieZapis = []; wolania.skany = []
  // Domyślnie biuro wydrukowało etykiety na obie pozycje, ale nic jeszcze
  // nie zeskanowano — czyli stan, w którym hala zaczyna dzień.
  stan.skanPozycji = { l1: { total: 20, scanned: 0 }, l2: { total: 10, scanned: 0 } }
  stan.przerwy = []; wolania.przerwy = []
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

describe('ProductionHmiPage — zmiana tulei z hali', () => {
  it('dotknięcie tulei otwiera wybór z kartoteki, nie licznik sztuk', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByTestId('tuleja-l1'))

    expect(await screen.findByText('Zmień tuleję')).toBeTruthy()
    expect(screen.getByTestId('tuleja-opcja-pk2')).toBeTruthy()
    expect(screen.queryByText(/Wykonano/)).toBeNull()      // licznik się nie otworzył
  })

  it('wybór tulei idzie na WŁAŚCIWĄ pozycję i odświeża plan oraz stan tulei', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByTestId('tuleja-l2'))
    fireEvent.click(await screen.findByTestId('tuleja-opcja-pk2'))

    await waitFor(() => expect(wolania.tuleja).toHaveLength(1))
    expect(wolania.tuleja[0]).toMatchObject({ planId: 'p1', lineId: 'l2', packagingId: 'pk2' })
    // plan pokazuje nową tuleję bez odświeżania ekranu przez operatora
    await waitFor(() => expect(within(screen.getByTestId('tuleja-l2')).getByText('KARTON 65')).toBeTruthy())
  })

  it('okno mówi, ile tulei wróci na magazyn', async () => {
    stan.plany[0].lines[0].packagingUsed = 7
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByTestId('tuleja-l1'))
    expect((await screen.findByTestId('tuleje-do-oddania')).textContent).toMatch(/7 tulei/)
  })

  it('nieudana zmiana mówi to operatorowi i nie zostawia otwartego okna w martwym stanie', async () => {
    wolania.tulejaBlad = true
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByTestId('tuleja-l1'))
    fireEvent.click(await screen.findByTestId('tuleja-opcja-pk2'))

    expect(await screen.findByText(/Nie udało się zmienić tulei/i)).toBeTruthy()
    expect(screen.queryByText('Zmień tuleję')).toBeNull()
  })
})

describe('ProductionHmiPage — poprawka „nie ta osoba"', () => {
  it('przepisanie sztuk idzie od WŁAŚCIWEJ osoby na właściwą, postęp bez zmian', async () => {
    // Źródłem jest DRUGI operator z listy — inaczej test przeszedłby też
    // wtedy, gdyby ekran zawsze brał pierwszego z brzegu.
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 3, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 9, addedAt: '11:00' },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByTestId('rozliczenie-w2'))
    fireEvent.click(await screen.findByTestId('na-w1'))
    fireEvent.click(within(screen.getByTestId('okno-przeniesienia')).getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('przenies'))

    await waitFor(() => expect(wolania.przeniesienia).toHaveLength(1))
    expect(wolania.przeniesienia[0]).toMatchObject({
      planId: 'p1', lineId: 'l1',
      body: { fromWorkerId: 'w2', toWorkerId: 'w1', toWorkerName: 'DAWID NOWAK', pieces: 2 },
    })
    // ekran pokazuje nowy podział, a licznik pozycji stoi w miejscu
    await waitFor(() => expect(screen.getByTestId('rozliczenie-w1').textContent).toContain('5 szt.'))
    expect(screen.getByText(/Wykonano/).textContent).toContain('12')
  })

  it('gotowa pozycja też daje się poprawić', async () => {
    stan.plany[0].lines[0].qtyDone = 20
    stan.plany[0].lines[0].lineStatus = 'DONE'
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 20, addedAt: '10:00' },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByTestId('rozliczenie-w1'))
    fireEvent.click(await screen.findByTestId('na-w2'))
    fireEvent.click(screen.getByTestId('przenies'))

    await waitFor(() => expect(wolania.przeniesienia).toHaveLength(1))
    expect(wolania.przeniesienia[0].body.pieces).toBe(1)
  })

  it('nieudane przeniesienie mówi to operatorowi', async () => {
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 5, addedAt: '10:00' },
    ]
    stan.plany[0].lines[0].qtyDone = 5
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByTestId('rozliczenie-w1'))
    fireEvent.click(await screen.findByTestId('na-w2'))
    wolania.przeniesienieBlad = true
    fireEvent.click(screen.getByTestId('przenies'))

    expect(await screen.findByText(/Nie udało się przenieść/i)).toBeTruthy()
  })
})

describe('ProductionHmiPage — skanowanie na magazyn', () => {
  it('kafel skanowania prowadzi przez WYBÓR POZYCJI, a skan niesie jej id', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText(/Skanowanie/i))

    // Najpierw pozycja — operator przekłada wózek pozycja po pozycji.
    fireEvent.click(await screen.findByTestId('pozycja-l2'))
    const pole = await screen.findByTestId('pole-skanu')
    fireEvent.change(pole, { target: { value: 'KEBAB-u1' } })
    fireEvent.submit((pole as HTMLInputElement).closest('form')!)

    await waitFor(() => expect(wolania.skany).toEqual([{ code: 'KEBAB-u1', planLineId: 'l2' }]))
    expect(await screen.findByText(/Na magazynie/i)).toBeTruthy()
    // plan sam pokazuje nowy postęp — bez wychodzenia z panelu
    await waitFor(() => expect(screen.getByTestId('postep-pozycji').textContent).toBe('1 / 10'))
  })

  it('„Skanuj tę pozycję" z licznika wchodzi od razu w skan tej pozycji', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('KIRMIZI'))
    fireEvent.click(screen.getByTestId('skanuj-pozycje'))

    expect((await screen.findByTestId('wybrana-pozycja')).textContent).toMatch(/KIRMIZI/)
    expect(screen.getByTestId('pole-skanu')).toBeTruthy()
  })

  it('pasek dnia liczy ZESKANOWANE, nie policzone sztuki', async () => {
    stan.plany[0].lines[0].qtyDone = 12          // policzone, ale niezeskanowane
    stan.skanPozycji = { l1: { total: 20, scanned: 3 }, l2: { total: 10, scanned: 0 } }
    render(<ProductionHmiPage buildLabel="test" />)

    expect(await screen.findByText('3 / 30')).toBeTruthy()
  })

  // Potwierdzenie pozycji przychodzi ze skanów, nie z licznika sztuk.
  it('pozycja zeskanowana w całości melduje się na liście jako POTWIERDZONA', async () => {
    stan.plany[0].lines[0].qtyDone = 20
    stan.skanPozycji = { l1: { total: 20, scanned: 20 }, l2: { total: 10, scanned: 0 } }
    render(<ProductionHmiPage buildLabel="test" />)

    expect(await screen.findByText('Potwierdzone')).toBeTruthy()
  })
})

describe('ProductionHmiPage — poprawianie sztuk przed skanem', () => {
  it('odejmowanie schodzi WYBRANEJ osobie i obniża postęp pozycji', async () => {
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByTestId('pracownik-w2'))
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))   // 2 szt.
    fireEvent.click(screen.getByTestId('odejmij'))

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.postep[0].body.qtyDone).toBe(10)
    expect(wolania.postep[0].body.workerEntries).toEqual([
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 1, addedAt: '11:00' },
    ])
  })

  it('odjęcie całego dorobku ZDEJMUJE osobę z pozycji, zamiast zostawiać zero', async () => {
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    fireEvent.click(screen.getByTestId('pracownik-w2'))
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('odejmij'))

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.postep[0].body.qtyDone).toBe(9)
    expect(wolania.postep[0].body.workerEntries.map((e: any) => e.workerId)).toEqual(['w1'])
  })

  // Zeskanowana sztuka leży na magazynie wyrobu gotowego — HMI nie ma czego cofać.
  it('zeskanowanych sztuk nie da się odjąć', async () => {
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 12, addedAt: '10:00' },
    ]
    stan.skanPozycji = { l1: { total: 20, scanned: 12 }, l2: { total: 10, scanned: 0 } }
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))

    await waitFor(() => expect((screen.getByTestId('odejmij') as HTMLButtonElement).disabled).toBe(true))
    expect(wolania.postep).toHaveLength(0)
  })

  it('nadwyżkę ponad zeskanowane wolno jeszcze skasować', async () => {
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 12, addedAt: '10:00' },
    ]
    stan.skanPozycji = { l1: { total: 20, scanned: 10 }, l2: { total: 10, scanned: 0 } }
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))
    await waitFor(() => expect((screen.getByTestId('odejmij') as HTMLButtonElement).disabled).toBe(false))
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('odejmij'))

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.postep[0].body.qtyDone).toBe(10)          // zeszła tylko nadwyżka
  })
})

describe('ProductionHmiPage — kto stoi na liście', () => {
  it('kierownik obsługujący panel NIE jest na liście liczenia sztuk', async () => {
    stan.operatorzy = [
      { id: 'w1', name: 'DAWID NOWAK', role: 'WORKER_PRODUCTION', active: true },
      { id: 'kier', name: 'VOVA KIEROWNIK', role: 'WORKER_GENERAL', active: true },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))

    expect(screen.getByRole('button', { name: 'DAWID' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'VOVA' })).toBeNull()
  })

  it('foliowanie proponuje zaznaczonych foliowczyków, nie całą zmianę', async () => {
    stan.operatorzy = [
      { id: 'w1', name: 'DAWID NOWAK', role: 'WORKER_PRODUCTION', active: true },
      { id: 'w2', name: 'VLAD FOLIA', role: 'WORKER_PRODUCTION', active: true, is_wrapper: true },
      { id: 'w3', name: 'ADAM FOLIA', role: 'WORKER_PRODUCTION', active: true, is_wrapper: true },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText(/Foliowanie/i))

    const okno = await screen.findByTestId('okno-foliowania')
    expect(within(okno).getByText('VLAD FOLIA')).toBeTruthy()
    expect(within(okno).getByText('ADAM FOLIA')).toBeTruthy()
    expect(within(okno).queryByText('DAWID NOWAK')).toBeNull()
  })

  it('pobranie folii siedzi w oknie foliowania, nie na głównym ekranie', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    await screen.findByText('WROCŁAW')
    expect(screen.queryByText(/Dołóż rolki/i)).toBeNull()      // główna wolna od tego

    fireEvent.click(screen.getByText(/Foliowanie/i))
    fireEvent.click(await screen.findByText(/Dołóż rolki/i))
    fireEvent.click(await screen.findByRole('button', { name: '+10' }))

    await waitFor(() => expect(wolania.pobranie).toHaveLength(1))
    expect(wolania.pobranie[0]).toMatchObject({ workDate: DZIEN, packagingId: 'f1', qty: 10 })
  })
})


describe('ProductionHmiPage — prognoza zakończenia', () => {
  it('na starcie dnia kafel nie zgaduje godziny', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    expect((await screen.findByTestId('kafel-prognoza')).textContent).toMatch(/—/)
  })

  it('dotknięcie kafla otwiera uzasadnienie', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByTestId('kafel-prognoza'))
    expect(await screen.findByText(/Przewidywane zakończenie/i)).toBeTruthy()
  })

  it('przerwa idzie na serwer, a nie tylko w stan ekranu', async () => {
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('Przerwa'))
    await waitFor(() => expect(wolania.przerwy).toEqual([{ planId: 'p1', co: 'start' }]))
  })
})


// Serwer jest źródłem prawdy od 27.08.2026. Kiosk potrafi się odświeżyć
// (auto-update, zerwana sesja), a przerwa trzymana wyłącznie w pamięci ekranu
// znikała razem z blokadą zapisu sztuk — hala liczyła wtedy w trakcie przerwy.
describe('ProductionHmiPage — przerwy z serwera', () => {
  it('trwająca przerwa z serwera zatrzymuje ekran po wejściu', async () => {
    stan.przerwy = [{ id: 'b1', startedAt: '2026-08-27T09:00:00.000Z', endedAt: null }]
    render(<ProductionHmiPage buildLabel="test" />)

    expect(await screen.findByText(/Liczenie sztuk jest wstrzymane/i)).toBeTruthy()
  })

  it('przerwa zamknięta na serwerze NIE blokuje liczenia', async () => {
    stan.przerwy = [
      { id: 'b1', startedAt: '2026-08-27T09:00:00.000Z', endedAt: '2026-08-27T09:20:00.000Z' },
    ]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText('WROCŁAW'))

    await waitFor(() => expect((screen.getByTestId('zapisz') as HTMLButtonElement).disabled).toBe(false))
  })

  it('zakończenie przerwy melduje się serwerowi', async () => {
    stan.przerwy = [{ id: 'b1', startedAt: '2026-08-27T09:00:00.000Z', endedAt: null }]
    render(<ProductionHmiPage buildLabel="test" />)
    fireEvent.click(await screen.findByText(/Wracam do pracy/i))

    await waitFor(() => expect(wolania.przerwy).toEqual([{ planId: 'p1', co: 'end' }]))
  })
})
