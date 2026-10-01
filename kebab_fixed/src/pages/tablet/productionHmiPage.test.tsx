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
 *
 * Flow od 01.10.2026: plan stoi po lewej cały czas, panel liczenia po prawej.
 * Osobę wybiera się JAWNIE, odejmowanie siedzi w „Korekta", tuleja
 * i rozliczenie w szczegółach pozycji, skan tylko z „Skanuj tę pozycję".
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
  odczyty: [] as string[],
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
  /** Świeży odczyt planu przed zapisem pada (brak łączności). */
  odczytBlad: false,
  /** Świeży odczyt czeka, aż test go puści (`puscOdczyt`). */
  wstrzymajOdczyt: false,
  puscOdczyt: (() => {}) as () => void,
  /** PATCH postępu pada. */
  patchBlad: false,
  /** PATCH czeka, aż test go puści (`puscPatch`). */
  wstrzymajPatch: false,
  puscPatch: (() => {}) as () => void,
  /** Lista planów zamrożona na starym stanie (zawieszone/stare odpytywanie). */
  staraLista: null as any[] | null,
}))

const kopia = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

vi.mock('@/lib/api', () => ({
  productionPlansApi: {
    list: () => Promise.resolve(kopia(wolania.staraLista ?? stan.plany)),
    byId: (id: string) => {
      wolania.odczyty.push(id)
      if (wolania.odczytBlad) return Promise.reject(new Error('timeout'))
      const odczytaj = () => {
        const p = stan.plany.find((x: any) => x.id === id)
        return p ? Promise.resolve(kopia(p)) : Promise.reject(new Error('404'))
      }
      if (wolania.wstrzymajOdczyt) return new Promise((r, j) => { wolania.puscOdczyt = () => { odczytaj().then(r, j) } })
      return odczytaj()
    },
    updateLineProgress: (planId: string, lineId: string, body: any) => {
      wolania.postep.push({ planId, lineId, body })
      if (wolania.patchBlad) return Promise.reject(new Error('brak łączności'))
      const zastosuj = () => {
        const l = stan.plany[0].lines.find((x: any) => x.id === lineId)
        // Serwer przycina qtyDone do planu — jak backend.
        l.qtyDone = Math.min(body.qtyDone, l.qty); l.workerEntries = body.workerEntries; l.lineStatus = body.lineStatus
        return { ok: true, line_id: lineId, qty_done: l.qtyDone, line_status: l.lineStatus }
      }
      if (wolania.wstrzymajPatch) return new Promise(r => { wolania.puscPatch = () => r(zastosuj()) })
      return Promise.resolve(zastosuj())
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
    // Jak serwer: start otwiera przerwę, koniec ją zamyka — odświeżenie
    // przerw po zapisie nie może jej „zgubić".
    startBreak: (planId: string) => {
      wolania.przerwy.push({ planId, co: 'start' })
      if (!stan.przerwy.some((b: any) => !b.endedAt)) {
        stan.przerwy.push({ id: `b${stan.przerwy.length + 1}`, startedAt: new Date().toISOString(), endedAt: null })
      }
      return Promise.resolve({ ok: true })
    },
    endBreak: (planId: string) => {
      wolania.przerwy.push({ planId, co: 'end' })
      for (const b of stan.przerwy) if (!b.endedAt) b.endedAt = new Date().toISOString()
      return Promise.resolve({ ok: true })
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
    // Skan NIE rusza qtyDone — tak jak backend: `done` to liczba SKANÓW pozycji.
    scanProduced: (code: string, _trolleyId?: string, planLineId?: string) => {
      wolania.skany.push({ code, planLineId })
      const l = stan.plany[0].lines.find((x: any) => x.id === planLineId) ?? stan.plany[0].lines[0]
      const s = stan.skanPozycji[l.id] ?? { total: l.qty, scanned: 0 }
      stan.skanPozycji[l.id] = { total: s.total, scanned: s.scanned + 1 }
      return Promise.resolve({
        ok: true, unitId: 'u1', status: 'produced', clientName: 'Bulli sp. z o.o.',
        batchNo: '250826 344', weightKg: 35, done: s.scanned + 1, total: s.total, onStock: true,
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
  wolania.postep = []; wolania.odczyty = []; wolania.finish = []; wolania.pobranie = []; wolania.zwrot = []
  wolania.foliowanieZapis = []; wolania.skany = []
  wolania.odczytBlad = false; wolania.patchBlad = false; wolania.wstrzymajPatch = false
  wolania.wstrzymajOdczyt = false; wolania.puscOdczyt = () => {}
  wolania.puscPatch = () => {}; wolania.staraLista = null
  // Domyślnie biuro wydrukowało etykiety na obie pozycje, ale nic jeszcze
  // nie zeskanowano — czyli stan, w którym hala zaczyna dzień.
  stan.skanPozycji = { l1: { total: 20, scanned: 0 }, l2: { total: 10, scanned: 0 } }
  stan.przerwy = []; wolania.przerwy = []
})
afterEach(cleanup)

// ── Pomocniki flow: pozycja z listy → osoba → ilość → „Dodaj" ──
const ekran = () => render(<ProductionHmiPage buildLabel="test" />)
const wiersz = async (id: string) => fireEvent.click(await screen.findByTestId(`pozycja-planu-${id}`))
const osoba = (id: string) => fireEvent.click(screen.getByTestId(`pracownik-${id}`))
const przycisk = (id: string) => screen.getByTestId(id) as HTMLButtonElement
const dodaj = () => fireEvent.click(screen.getByTestId('zapisz'))
/** Zapis zakończony: blokada zdjęta, przycisk znów żyje. */
const poZapisie = () => waitFor(() => expect(przycisk('zapisz').disabled).toBe(false))
const szczegoly = () => fireEvent.click(screen.getByTestId('szczegoly'))

describe('ProductionHmiPage — okablowanie', () => {
  it('plan dnia wczytuje się SAM, bez wybierania z listy', async () => {
    ekran()
    expect(await screen.findByText('WROCŁAW')).toBeTruthy()
    expect(screen.getByText('KIRMIZI')).toBeTruthy()
  })

  it('nagłówek liczy plan w kilogramach i podaje procent', async () => {
    stan.plany[0].lines[0].qtyDone = 10   // 350 z 1100 kg = 32%
    ekran()
    expect(await screen.findByText('1100 kg')).toBeTruthy()
    expect(screen.getByText('350 kg')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
  })

  it('zapis sztuk trafia do WŁAŚCIWEJ pozycji i właściwego pracownika', async () => {
    ekran()
    await wiersz('l2')
    osoba('w2')
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    dodaj()

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    const w = wolania.postep[0]
    expect(w.lineId).toBe('l2')
    expect(w.body.qtyDone).toBe(2)
    expect(w.body.workerEntries[0]).toMatchObject({ workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 2 })
  })

  it('licznik pozycji rośnie po zapisie — bierze stan z serwera, nie z kopii', async () => {
    ekran()
    await wiersz('l1')
    osoba('w1')
    dodaj()
    await waitFor(() => expect(screen.getByTestId('wykonano').textContent).toBe('1/20'))
  })

  it('PRZERWA blokuje zapis sztuk, dopóki operator jej nie wyłączy', async () => {
    ekran()
    await wiersz('l1')
    osoba('w1')
    fireEvent.click(screen.getByRole('button', { name: 'Przerwa' }))

    expect(await screen.findByText(/nie zapisze sztuk/i)).toBeTruthy()
    dodaj()
    expect(wolania.postep).toHaveLength(0)
    expect(wolania.odczyty).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Wracam do pracy/i }))
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
  })

  it('zmiana planu w tle podnosi pasek i nie znika bez potwierdzenia', async () => {
    ekran()
    await screen.findByText('WROCŁAW')

    stan.plany[0].lines.push(pozycja({ id: 'l3', qty: 4, kgPerUnit: 12, recipeName: 'BULLI' }))
    expect(await screen.findByText('doszła BULLI 4×12 kg', {}, { timeout: 8000 })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Rozumiem/i }))
    await waitFor(() => expect(screen.queryByText('doszła BULLI 4×12 kg')).toBeNull())
  }, 12000)

  it('JEDNĄ zmianę też da się przeczytać w całości — bez rozpychania listy', async () => {
    ekran()
    await screen.findByText('WROCŁAW')
    stan.plany[0].lines.push(pozycja({ id: 'l3', qty: 4, kgPerUnit: 12, recipeName: 'BULLI' }))
    await screen.findByText('doszła BULLI 4×12 kg', {}, { timeout: 8000 })

    fireEvent.click(screen.getByTestId('zmiany-rozwin'))
    expect(within(screen.getByTestId('zmiany-lista')).getByText('doszła BULLI 4×12 kg')).toBeTruthy()
  }, 12000)

  it('wejście na ekran NIE zgłasza całego planu jako zmiany', async () => {
    // Migawka wzięta przed wczytaniem planu jest pusta — wtedy każda pozycja
    // wygląda na nowo dodaną i operator uczy się ignorować pasek.
    ekran()
    await screen.findByText('WROCŁAW')
    expect(screen.queryByText(/Plan zmieniony przez biuro/i)).toBeNull()
  })

  it('druga zmiana przed potwierdzeniem pierwszej NIE ginie', async () => {
    ekran()
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
    ekran()
    fireEvent.click(await screen.findByRole('button', { name: /Statystyki/i }))

    const w = (await screen.findByText('DAWID')).closest('tr')!
    expect(within(w).getByText('140')).toBeTruthy()   // 4 × 35 kg
    expect(within(w).getByText('4')).toBeTruthy()     // sztuki obok kilogramów
  })

  it('zakończenie dnia zwraca folię i wysyła wpisy do biura', async () => {
    stan.plany[0].lines[0].qtyDone = 3
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 3, addedAt: '' }]
    ekran()
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
    ekran()
    expect(await screen.findByText(/czeka na potwierdzenie/i)).toBeTruthy()
  })

  it('brak planu na dziś mówi to wprost, zamiast pustej tabeli', async () => {
    stan.plany = []
    ekran()
    expect(await screen.findByText(/Biuro nie zaplanowało/i)).toBeTruthy()
  })
})

describe('ProductionHmiPage — plan obok panelu, seria zapisów', () => {
  it('lista stoi cały czas: l2 → DAWID 3 → DENYS 5 → qtyDone 8 i właściwe wpisy', async () => {
    ekran()
    await wiersz('l2')
    expect(screen.getByTestId('plan-lista')).toBeTruthy()
    expect(screen.getByTestId('panel-pozycji')).toBeTruthy()

    osoba('w1'); fireEvent.click(screen.getByTestId('ile-3')); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    await poZapisie()
    osoba('w2'); fireEvent.click(screen.getByTestId('ile-5')); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(2))

    const drugi = wolania.postep[1]
    expect(drugi.lineId).toBe('l2')
    expect(drugi.body.qtyDone).toBe(8)
    expect(drugi.body.workerEntries.map((e: any) => [e.workerId, e.pieces])).toEqual([['w1', 3], ['w2', 5]])
    await waitFor(() => expect(screen.getByTestId('wykonano').textContent).toBe('8/10'))
    // Plan po lewej ani na moment nie zniknął.
    expect(screen.getByTestId('pozycja-planu-l1')).toBeTruthy()
  })

  it('po dobiciu planu pozycji panel ZOSTAJE — teraz się ją skanuje', async () => {
    stan.plany[0].lines[1].qtyDone = 8
    stan.plany[0].lines[1].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 8, addedAt: '10:00' }]
    ekran()
    await wiersz('l2')
    osoba('w2'); fireEvent.click(screen.getByRole('button', { name: 'więcej' })); dodaj()
    await waitFor(() => expect(screen.getByTestId('wykonano').textContent).toBe('10/10'))
    expect(screen.getByTestId('panel-pozycji')).toBeTruthy()
    expect(screen.getByTestId('plan-lista')).toBeTruthy()
    expect(przycisk('zapisz').textContent).toMatch(/komplet/)
    expect(przycisk('skanuj-pozycje').disabled).toBe(false)
  })

  it('bez wybranej osoby zapis jest zablokowany i nic nie idzie na serwer', async () => {
    ekran()
    await wiersz('l1')
    expect(przycisk('zapisz').disabled).toBe(true)
    expect(przycisk('zapisz').textContent).toMatch(/Wybierz osobę/)
    dodaj()
    expect(wolania.odczyty).toHaveLength(0)
    expect(wolania.postep).toHaveLength(0)
  })

  it('zmiana pozycji zdejmuje wybór osoby', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    await wiersz('l2')
    expect(przycisk('zapisz').disabled).toBe(true)
    expect(przycisk('pracownik-w1').getAttribute('aria-pressed')).toBe('false')
  })

  it('bez załogi produkcji — jasny komunikat i zero zapisów', async () => {
    stan.operatorzy = []
    ekran()
    await wiersz('l1')
    expect(await screen.findByTestId('brak-pracownikow')).toBeTruthy()
    expect(przycisk('zapisz').disabled).toBe(true)
  })

  it('limit liczy się z AKTUALNEGO serwera, nie z ekranu sprzed chwili', async () => {
    ekran()
    await wiersz('l2')
    // Ktoś inny w międzyczasie dobił pozycję do 9/10 — ekran jeszcze nie wie.
    stan.plany[0].lines[1].qtyDone = 9
    stan.plany[0].lines[1].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' }]
    osoba('w2'); fireEvent.click(screen.getByTestId('ile-5')); dodaj()

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.odczyty).toEqual(['p1'])
    expect(wolania.postep[0].body.qtyDone).toBe(10)
    expect(wolania.postep[0].body.workerEntries).toEqual([
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      expect.objectContaining({ workerId: 'w2', pieces: 1 }),
    ])
    expect(await screen.findByText(/Dodano 1 szt\./)).toBeTruthy()
  })

  it('stary poll po pierwszym zapisie NIE nadpisuje go w kolejnym', async () => {
    ekran()
    await wiersz('l2')
    // Od teraz lista planów oddaje stan sprzed zapisów (zawieszone odpytywanie).
    wolania.staraLista = kopia(stan.plany)
    osoba('w1'); fireEvent.click(screen.getByTestId('ile-3')); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    await poZapisie()
    osoba('w2'); fireEvent.click(screen.getByTestId('ile-5')); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(2))

    expect(wolania.postep[1].body.qtyDone).toBe(8)
    expect(wolania.postep[1].body.workerEntries.map((e: any) => e.workerId)).toEqual(['w1', 'w2'])
    expect(stan.plany[0].lines[1].qtyDone).toBe(8)
  })

  it('podwójne dotknięcie przy zapisie w locie wysyła JEDEN odczyt i JEDEN PATCH', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.wstrzymajPatch = true
    dodaj(); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    dodaj()
    expect(wolania.odczyty).toHaveLength(1)
    expect(przycisk('zapisz').disabled).toBe(true)

    wolania.puscPatch()
    await poZapisie()
    expect(wolania.postep).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('wykonano').textContent).toBe('1/20'))
  })

  it('zapis w locie blokuje skan, zmianę tulei i przepisanie tej pozycji', async () => {
    stan.plany[0].lines[0].qtyDone = 2
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 2, addedAt: '10:00' }]
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.wstrzymajPatch = true
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))

    expect(przycisk('skanuj-pozycje').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('skanuj-pozycje'))
    expect(screen.queryByTestId('okno-skanu')).toBeNull()
    fireEvent.click(screen.getByTestId('korekta'))
    expect(przycisk('przepisz').disabled).toBe(true)
    szczegoly()
    expect(przycisk('zmien-tuleje').disabled).toBe(true)
    expect(przycisk('rozliczenie-w1').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('zmien-tuleje'))
    expect(wolania.tuleja).toHaveLength(0)
    fireEvent.click(screen.getByTestId('zamknij-szczegoly'))

    wolania.puscPatch()
    await waitFor(() => expect(przycisk('skanuj-pozycje').disabled).toBe(false))
  })

  it('przejście na inną pozycję w trakcie zapisu: sztuki idą tam, gdzie kliknięto, wynik w dymku', async () => {
    ekran()
    await wiersz('l2'); osoba('w2')
    wolania.wstrzymajPatch = true
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    await wiersz('l1')
    wolania.puscPatch()

    expect(await screen.findByText(/Poz\. 2: Dodano 1 szt\./)).toBeTruthy()
    expect(wolania.postep[0].lineId).toBe('l2')
    expect(stan.plany[0].lines[0].qtyDone).toBe(0)
    expect(stan.plany[0].lines[1].qtyDone).toBe(1)
  })

  it('błąd odczytu stanu = zero PATCH i jasny komunikat; ponowienie działa', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.odczytBlad = true
    dodaj()
    expect(await screen.findByText(/nie udało się pobrać stanu pozycji/i)).toBeTruthy()
    expect(wolania.postep).toHaveLength(0)

    wolania.odczytBlad = false
    await poZapisie()
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(await screen.findByText(/Dodano 1 szt\./)).toBeTruthy()
  })

  it('błąd PATCH nie udaje sukcesu; ponowienie liczy od stanu serwera', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.patchBlad = true
    dodaj()
    expect(await screen.findByText(/Nie zapisano — brak łączności/)).toBeTruthy()
    expect(stan.plany[0].lines[0].qtyDone).toBe(0)

    wolania.patchBlad = false
    await poZapisie()
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(2))
    expect(wolania.postep[1].body.qtyDone).toBe(1)
    await waitFor(() => expect(screen.getByTestId('wykonano').textContent).toBe('1/20'))
  })

  it('pozycja zdjęta z planu przez biuro: zapis odmówiony, bez PATCH', async () => {
    ekran()
    await wiersz('l2'); osoba('w1')
    stan.plany[0].lines = stan.plany[0].lines.filter((l: any) => l.id !== 'l2')
    dodaj()
    expect(await screen.findByText(/Tej pozycji nie ma już w planie/)).toBeTruthy()
    expect(wolania.postep).toHaveLength(0)
  })

  it('zapis, potem zakończenie dnia przez tabletFinish niesie zapisane sztuki', async () => {
    ekran()
    await wiersz('l1'); osoba('w1'); fireEvent.click(screen.getByTestId('ile-3')); dodaj()
    await waitFor(() => expect(screen.getByTestId('wykonano').textContent).toBe('3/20'))
    fireEvent.click(screen.getByRole('button', { name: /Zakończ dzień/i }))
    fireEvent.click(await screen.findByTestId('zakoncz'))

    await waitFor(() => expect(wolania.finish).toHaveLength(1))
    expect(wolania.finish[0].entries[0]).toMatchObject({ planLineId: 'l1', qty: 3, workerNames: ['DAWID NOWAK'] })
  })

  it('przerwa rozpoczęta w trakcie odczytu stanu: zero PATCH i jasny komunikat', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.wstrzymajOdczyt = true
    dodaj()
    await waitFor(() => expect(wolania.odczyty).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Przerwa' }))
    wolania.puscOdczyt()

    expect(await screen.findByText(/Przerwa — nie zapisano/)).toBeTruthy()
    expect(wolania.postep).toHaveLength(0)
  })

  it('odejmowanie osoby z kilkoma wpisami schodzi po wszystkich jej wpisach, innych nie rusza', async () => {
    stan.plany[0].lines[0].qtyDone = 10
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 2, addedAt: '08:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 5, addedAt: '08:30' },
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 3, addedAt: '09:00' },
    ]
    ekran()
    await wiersz('l1'); osoba('w1')
    fireEvent.click(screen.getByTestId('korekta'))
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))   // 4 szt.
    fireEvent.click(screen.getByTestId('odejmij'))

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.postep[0].body.qtyDone).toBe(6)
    expect(wolania.postep[0].body.workerEntries).toEqual([
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 1, addedAt: '08:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 5, addedAt: '08:30' },
    ])
  })

  it('odmontowanie z zapisem w locie nie stawia już timera dymka', async () => {
    const { unmount } = ekran()
    await wiersz('l2'); osoba('w2')
    wolania.wstrzymajPatch = true
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    await wiersz('l1')          // wynik pójdzie do dymka, nie do panelu
    unmount()
    const timery = vi.spyOn(globalThis, 'setTimeout')
    try {
      wolania.puscPatch()
      await new Promise(r => setTimeout(r, 30))
      expect(timery.mock.calls.filter(c => c[1] === 3000)).toHaveLength(0)
    } finally { timery.mockRestore() }
  })
})

describe('ProductionHmiPage — zakończenie dnia pod blokadą', () => {
  it('stary poll po zapisie: zakończenie bierze ŚWIEŻY plan, nie listę z ekranu', async () => {
    ekran()
    await wiersz('l1')
    wolania.staraLista = kopia(stan.plany)   // ekran już nie zobaczy zapisu
    osoba('w1'); fireEvent.click(screen.getByTestId('ile-3')); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    await poZapisie()

    fireEvent.click(screen.getByRole('button', { name: /Zakończ dzień/i }))
    fireEvent.click(await screen.findByTestId('zakoncz'))

    await waitFor(() => expect(wolania.finish).toHaveLength(1))
    expect(wolania.odczyty).toEqual(['p1', 'p1'])
    expect(wolania.finish[0].entries).toHaveLength(1)
    expect(wolania.finish[0].entries[0]).toMatchObject({ planLineId: 'l1', qty: 3, workerNames: ['DAWID NOWAK'] })
  })

  it('zapis w locie (PATCH) blokuje „Zakończ dzień"', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.wstrzymajPatch = true
    dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))

    const zakoncz = screen.getByRole('button', { name: /Zakończ dzień/i }) as HTMLButtonElement
    expect(zakoncz.disabled).toBe(true)
    fireEvent.click(zakoncz)
    expect(screen.queryByTestId('zakoncz')).toBeNull()

    wolania.puscPatch()
    await waitFor(() => expect(zakoncz.disabled).toBe(false))
    expect(wolania.finish).toHaveLength(0)
  })

  it('odczyt przed zapisem w locie (GET) też blokuje „Zakończ dzień"', async () => {
    ekran()
    await wiersz('l1'); osoba('w1')
    wolania.wstrzymajOdczyt = true
    dodaj()
    await waitFor(() => expect(wolania.odczyty).toHaveLength(1))
    expect((screen.getByRole('button', { name: /Zakończ dzień/i }) as HTMLButtonElement).disabled).toBe(true)

    wolania.puscOdczyt()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    await poZapisie()
    expect((screen.getByRole('button', { name: /Zakończ dzień/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('nieudany odczyt planu: ani zwrot folii, ani tabletFinish', async () => {
    stan.plany[0].lines[0].qtyDone = 3
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 3, addedAt: '' }]
    ekran()
    fireEvent.click(await screen.findByRole('button', { name: /Zakończ dzień/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'więcej rolek' }))
    wolania.odczytBlad = true
    fireEvent.click(screen.getByTestId('zakoncz'))

    expect(await screen.findByText(/Nie zamknięto dnia — nie udało się pobrać planu/)).toBeTruthy()
    expect(wolania.zwrot).toHaveLength(0)
    expect(wolania.finish).toHaveLength(0)
    // Okno zostaje — operator może spróbować jeszcze raz.
    await waitFor(() => expect((screen.getByTestId('zakoncz') as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('ProductionHmiPage — pasek dnia i foliowanie', () => {
  it('pasek dnia pokazuje kilogramy, postęp i tempo cały czas na oku', async () => {
    stan.plany[0].lines[0].qtyDone = 10          // 350 z 1100 kg
    ekran()
    await screen.findByText('WROCŁAW')

    expect(screen.getByText('Zrobione')).toBeTruthy()
    expect(screen.getByText('350 kg')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
    expect(screen.getByText(/Foliowanie/)).toBeTruthy()
  })

  it('kafel foliowania otwiera okno i zapisuje podział po równo', async () => {
    stan.plany[0].lines[0].qtyDone = 20          // 700 kg zrobione
    ekran()
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
    ekran()
    expect(await screen.findByText('4000 kg')).toBeTruthy()
  })
})

describe('ProductionHmiPage — szczegóły pozycji: partie i tuleja', () => {
  it('partie NIE stoją na pierwszym ekranie — dopiero w szczegółach', async () => {
    ekran()
    await wiersz('l1')
    expect(screen.queryByText('PP13')).toBeNull()
    szczegoly()
    expect(within(await screen.findByTestId('partie')).getByText('PP13')).toBeTruthy()
  })

  it('„Zmień tuleję" w szczegółach otwiera wybór z kartoteki', async () => {
    ekran()
    await wiersz('l1'); szczegoly()
    fireEvent.click(await screen.findByTestId('zmien-tuleje'))

    expect(await screen.findByTestId('tuleja-opcja-pk2')).toBeTruthy()
    expect(screen.queryByTestId('szczegoly-pozycji')).toBeNull()
  })

  it('wybór tulei idzie na WŁAŚCIWĄ pozycję i odświeża plan oraz stan tulei', async () => {
    ekran()
    await wiersz('l2'); szczegoly()
    fireEvent.click(await screen.findByTestId('zmien-tuleje'))
    fireEvent.click(await screen.findByTestId('tuleja-opcja-pk2'))

    await waitFor(() => expect(wolania.tuleja).toHaveLength(1))
    expect(wolania.tuleja[0]).toMatchObject({ planId: 'p1', lineId: 'l2', packagingId: 'pk2' })
    // plan pokazuje nową tuleję bez odświeżania ekranu przez operatora
    await waitFor(() => expect(within(screen.getByTestId('pozycja-planu-l2')).getByText(/KARTON 65/)).toBeTruthy())
  })

  it('okno mówi, ile tulei wróci na magazyn', async () => {
    stan.plany[0].lines[0].packagingUsed = 7
    ekran()
    await wiersz('l1'); szczegoly()
    fireEvent.click(await screen.findByTestId('zmien-tuleje'))
    expect((await screen.findByTestId('tuleje-do-oddania')).textContent).toMatch(/7 tulei/)
  })

  it('nieudana zmiana mówi to operatorowi i nie zostawia otwartego okna w martwym stanie', async () => {
    wolania.tulejaBlad = true
    ekran()
    await wiersz('l1'); szczegoly()
    fireEvent.click(await screen.findByTestId('zmien-tuleje'))
    fireEvent.click(await screen.findByTestId('tuleja-opcja-pk2'))

    expect(await screen.findByText(/Nie udało się zmienić tulei/i)).toBeTruthy()
    expect(screen.queryByTestId('tuleja-opcja-pk2')).toBeNull()
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
    ekran()
    await wiersz('l1'); szczegoly()
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
    await waitFor(() => expect(screen.getByTestId('pracownik-w1').textContent).toContain('5 szt.'))
    expect(screen.getByTestId('wykonano').textContent).toBe('12/20')
  })

  it('„Przepisz na…" z korekty w panelu otwiera to samo okno dla wybranej osoby', async () => {
    stan.plany[0].lines[0].qtyDone = 4
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 4, addedAt: '11:00' }]
    ekran()
    await wiersz('l1'); osoba('w2')
    fireEvent.click(screen.getByTestId('korekta'))
    fireEvent.click(screen.getByTestId('przepisz'))
    fireEvent.click(await screen.findByTestId('na-w1'))
    fireEvent.click(screen.getByTestId('przenies'))

    await waitFor(() => expect(wolania.przeniesienia).toHaveLength(1))
    expect(wolania.przeniesienia[0].body).toMatchObject({ fromWorkerId: 'w2', toWorkerId: 'w1', pieces: 1 })
  })

  it('gotowa pozycja też daje się poprawić', async () => {
    stan.plany[0].lines[0].qtyDone = 20
    stan.plany[0].lines[0].lineStatus = 'DONE'
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 20, addedAt: '10:00' },
    ]
    ekran()
    await wiersz('l1'); szczegoly()
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
    ekran()
    await wiersz('l1'); szczegoly()
    fireEvent.click(screen.getByTestId('rozliczenie-w1'))
    fireEvent.click(await screen.findByTestId('na-w2'))
    wolania.przeniesienieBlad = true
    fireEvent.click(screen.getByTestId('przenies'))

    expect(await screen.findByText(/Nie udało się przenieść/i)).toBeTruthy()
  })

  it('następny zapis sztuk po przepisaniu liczy od wpisów PO przepisaniu', async () => {
    stan.plany[0].lines[0].qtyDone = 5
    stan.plany[0].lines[0].workerEntries = [{ workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 5, addedAt: '10:00' }]
    ekran()
    await wiersz('l1'); szczegoly()
    fireEvent.click(screen.getByTestId('rozliczenie-w1'))
    fireEvent.click(await screen.findByTestId('na-w2'))
    fireEvent.click(screen.getByTestId('przenies'))
    await waitFor(() => expect(wolania.przeniesienia).toHaveLength(1))

    osoba('w1'); await poZapisie(); dodaj()
    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.postep[0].body.qtyDone).toBe(6)
    expect(wolania.postep[0].body.workerEntries.map((e: any) => [e.workerId, e.pieces])).toEqual([['w1', 5], ['w2', 1]])
  })
})

describe('ProductionHmiPage — skanowanie na magazyn', () => {
  it('jedna droga: pozycja z listy → „Skanuj tę pozycję" → skan niesie jej id', async () => {
    ekran()
    await wiersz('l2')
    fireEvent.click(screen.getByTestId('skanuj-pozycje'))

    expect((await screen.findByTestId('wybrana-pozycja')).textContent).toMatch(/KIRMIZI/)
    const pole = screen.getByTestId('pole-skanu')
    fireEvent.change(pole, { target: { value: 'KEBAB-u1' } })
    fireEvent.submit((pole as HTMLInputElement).closest('form')!)

    await waitFor(() => expect(wolania.skany).toEqual([{ code: 'KEBAB-u1', planLineId: 'l2' }]))
    expect(await screen.findByText(/Na magazynie/i)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('postep-pozycji').textContent).toBe('1 / 10'))
    // Skan NIE dolicza sztuk — liczy je operator, skan tylko potwierdza.
    expect(wolania.postep).toHaveLength(0)
  })

  it('kafel „Zeskanowane" na pasku to sam licznik, nie drugie wejście do skanu', async () => {
    ekran()
    await screen.findByText('WROCŁAW')
    expect(screen.getByTestId('kafel-skanowanie').tagName).not.toBe('BUTTON')
    fireEvent.click(screen.getByTestId('kafel-skanowanie'))
    expect(screen.queryByTestId('okno-skanu')).toBeNull()
  })

  it('pasek dnia liczy ZESKANOWANE, nie policzone sztuki', async () => {
    stan.plany[0].lines[0].qtyDone = 12          // policzone, ale niezeskanowane
    stan.skanPozycji = { l1: { total: 20, scanned: 3 }, l2: { total: 10, scanned: 0 } }
    ekran()

    expect(await screen.findByText('3 / 30')).toBeTruthy()
  })

  // Potwierdzenie pozycji przychodzi ze skanów, nie z licznika sztuk.
  it('pozycja zeskanowana w całości melduje się na liście jako POTWIERDZONA', async () => {
    stan.plany[0].lines[0].qtyDone = 20
    stan.skanPozycji = { l1: { total: 20, scanned: 20 }, l2: { total: 10, scanned: 0 } }
    ekran()

    expect(await screen.findByText('Potwierdzone')).toBeTruthy()
  })
})

describe('ProductionHmiPage — korekta (odejmowanie przed skanem)', () => {
  const dwieOsoby = () => {
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 3, addedAt: '11:00' },
    ]
  }

  it('odejmowanie schodzi WYBRANEJ osobie i obniża postęp pozycji', async () => {
    dwieOsoby()
    ekran()
    await wiersz('l1'); osoba('w2')
    fireEvent.click(screen.getByTestId('korekta'))
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
    dwieOsoby()
    ekran()
    await wiersz('l1'); osoba('w2')
    fireEvent.click(screen.getByTestId('korekta'))
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByTestId('odejmij'))

    await waitFor(() => expect(wolania.postep).toHaveLength(1))
    expect(wolania.postep[0].body.qtyDone).toBe(9)
    expect(wolania.postep[0].body.workerEntries.map((e: any) => e.workerId)).toEqual(['w1'])
  })

  it('zmiana osoby WYŁĄCZA korektę — nie odejmie się następnemu pracownikowi', async () => {
    dwieOsoby()
    ekran()
    await wiersz('l1'); osoba('w2')
    fireEvent.click(screen.getByTestId('korekta'))
    expect(screen.getByTestId('odejmij')).toBeTruthy()
    osoba('w1')
    expect(screen.queryByTestId('odejmij')).toBeNull()
    expect(przycisk('zapisz').textContent).toMatch(/Dodaj 1 szt\. · DAWID/)
  })

  it('odejmowanie liczy z AKTUALNEGO serwera: dorobek osoby zmalał w międzyczasie', async () => {
    dwieOsoby()
    ekran()
    await wiersz('l1'); osoba('w2')
    fireEvent.click(screen.getByTestId('korekta'))
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))
    fireEvent.click(screen.getByRole('button', { name: 'więcej' }))   // 3 szt. na ekranie
    stan.plany[0].lines[0].qtyDone = 10
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 9, addedAt: '10:00' },
      { workerId: 'w2', workerName: 'DENYS KOVAL', pieces: 1, addedAt: '11:00' },
    ]
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
    ekran()
    await wiersz('l1'); osoba('w1')
    fireEvent.click(screen.getByTestId('korekta'))

    await waitFor(() => expect(przycisk('odejmij').disabled).toBe(true))
    expect(wolania.postep).toHaveLength(0)
  })

  it('nadwyżkę ponad zeskanowane wolno jeszcze skasować', async () => {
    stan.plany[0].lines[0].qtyDone = 12
    stan.plany[0].lines[0].workerEntries = [
      { workerId: 'w1', workerName: 'DAWID NOWAK', pieces: 12, addedAt: '10:00' },
    ]
    stan.skanPozycji = { l1: { total: 20, scanned: 10 }, l2: { total: 10, scanned: 0 } }
    ekran()
    await wiersz('l1'); osoba('w1')
    fireEvent.click(screen.getByTestId('korekta'))
    await waitFor(() => expect(przycisk('odejmij').disabled).toBe(false))
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
    ekran()
    await wiersz('l1')

    expect(await screen.findByTestId('pracownik-w1')).toBeTruthy()
    expect(screen.queryByTestId('pracownik-kier')).toBeNull()
  })

  it('foliowanie proponuje zaznaczonych foliowczyków, nie całą zmianę', async () => {
    stan.operatorzy = [
      { id: 'w1', name: 'DAWID NOWAK', role: 'WORKER_PRODUCTION', active: true },
      { id: 'w2', name: 'VLAD FOLIA', role: 'WORKER_PRODUCTION', active: true, is_wrapper: true },
      { id: 'w3', name: 'ADAM FOLIA', role: 'WORKER_PRODUCTION', active: true, is_wrapper: true },
    ]
    ekran()
    fireEvent.click(await screen.findByText(/Foliowanie/i))

    const okno = await screen.findByTestId('okno-foliowania')
    expect(within(okno).getByText('VLAD FOLIA')).toBeTruthy()
    expect(within(okno).getByText('ADAM FOLIA')).toBeTruthy()
    expect(within(okno).queryByText('DAWID NOWAK')).toBeNull()
  })

  it('pobranie folii siedzi w oknie foliowania, nie na głównym ekranie', async () => {
    ekran()
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
    ekran()
    expect((await screen.findByTestId('kafel-prognoza')).textContent).toMatch(/—/)
  })

  it('dotknięcie kafla otwiera uzasadnienie', async () => {
    ekran()
    fireEvent.click(await screen.findByTestId('kafel-prognoza'))
    expect(await screen.findByText(/Przewidywane zakończenie/i)).toBeTruthy()
  })

  it('przerwa idzie na serwer, a nie tylko w stan ekranu', async () => {
    ekran()
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
    ekran()

    expect(await screen.findByText(/Liczenie sztuk jest wstrzymane/i)).toBeTruthy()
  })

  it('przerwa zamknięta na serwerze NIE blokuje liczenia', async () => {
    stan.przerwy = [
      { id: 'b1', startedAt: '2026-08-27T09:00:00.000Z', endedAt: '2026-08-27T09:20:00.000Z' },
    ]
    ekran()
    await wiersz('l1'); osoba('w1')

    await waitFor(() => expect(przycisk('zapisz').disabled).toBe(false))
  })

  it('zakończenie przerwy melduje się serwerowi', async () => {
    stan.przerwy = [{ id: 'b1', startedAt: '2026-08-27T09:00:00.000Z', endedAt: null }]
    ekran()
    fireEvent.click(await screen.findByText(/Wracam do pracy/i))

    await waitFor(() => expect(wolania.przerwy).toEqual([{ planId: 'p1', co: 'end' }]))
  })
})
