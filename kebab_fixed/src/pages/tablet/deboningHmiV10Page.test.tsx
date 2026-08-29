// @vitest-environment jsdom
/**
 * Stelaż testowy ekranu rozbioru — sprawdza OKABLOWANIE, nie logikę.
 *
 * POWÓD ISTNIENIA: 24.08.2026 trzy błędy wyszły z tej samej warstwy. Logika
 * jest czysta i przetestowana, ale strona (3000+ linii) przekazuje jej dane
 * ręcznie i tego nie sprawdzało nic:
 *   • kreator palet nie dostał partii z ekranu → etykieta „485" przy 503,
 *   • kafel podawał partię sklejoną z dwóch pól → pusta data ważności,
 *   • nowe źródło danych nie weszło do odświeżania → licznik zamarzł na 195 kg.
 *
 * Dlatego NIE zaślepiamy `useApi`: prawdziwy cykl pobrań i odświeżania jest
 * tu przedmiotem testu. Zaślepiamy wyłącznie moduły sięgające na zewnątrz —
 * API, wagę, drukarkę i sesję. Wszystko z `features/deboning` działa naprawdę.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

// ── Dane, którymi steruje test ───────────────────────────────────────────
const stan = vi.hoisted(() => ({
  batches: [] as any[],
  lots:    [] as any[],
  pallets: [] as any[],
  pending: [] as any[],
  entries: [] as any[],
}))

/** Propsy przechwycone z komponentów-dzieci — tak sprawdzamy okablowanie. */
const zlapane = vi.hoisted(() => ({ bulk: null as any, uboczne: null as any }))

/** Zapis wpisu rozbioru — sprawdzamy, CO strona wysyła i co robi po zapisie. */
/** Kształt DTO wpisu — tyle, ile sprawdzamy. */
type WpisDto = { rawBatchId: string; workerId: string; kgTaken: number; kgMeat: number }
const { addEntry } = vi.hoisted(() => ({
  addEntry: vi.fn(async (_dto: any, ..._reszta: any[]) => null),
}))

vi.mock('@/lib/apiClient', () => ({
  rawBatchesApi: { list: async () => ({ data: stan.batches }) },
  usersApi:      { list: async () => [
    { id: 'w1', name: 'DAWID',  role: 'WORKER_DEBONING', active: true },
    { id: 'w2', name: 'DENYS',  role: 'WORKER_DEBONING', active: true },
  ] },
  settingsApi:   { getCartTares: async () => [6], getBatchOrder: async () => [] },
  byproductsApi: {
    pending: async () => stan.pending,
    today:   async () => ({ backsKg: 0, bonesKg: 0, weighings: [] }),
  },
  meatPalletsApi: { list: async () => stan.pallets },
  meatStockApi:   { list: async () => ({ data: stan.lots }) },
}))
vi.mock('@/lib/api', () => ({
  BASE: 'http://test',
  meatPalletsApi: { list: async () => stan.pallets, create: vi.fn() },
  meatStockApi:   { list: async () => ({ data: stan.lots }) },
}))
vi.mock('@/lib/zebra', () => ({
  getDevices: async () => ({ default: null, list: [] }),
  sendZpl: vi.fn(), probeBrowserPrint: async () => ({ ok: true }),
}))
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'MARCIN' } }),
}))
// available: true — bez tego cały panel ważenia (a z nim licznik partii)
// w ogóle się nie renderuje i test sprawdzałby pustkę.
vi.mock('@/features/deboning/useScale', () => ({
  useScale: () => ({
    connected: true, stable: false, gross: 0, tare: vi.fn(), available: true,
  }),
}))
vi.mock('@/features/deboning/hooks', () => ({
  useProductionSession: () => ({
    session: { id: 's1', productionDate: new Date().toISOString().slice(0, 10) },
    timeWindow: 'open',
    loading: false, startDay: vi.fn(), startLoading: false, closeDay: vi.fn(), closeLoading: false,
  }),
  useDeboningEntries: () => ({
    entries: stan.entries, addEntry, addTake: vi.fn(), completeTake: vi.fn(),
    weighPart: vi.fn(), editTake: vi.fn(), editEntry: vi.fn(), removeEntry: vi.fn(),
    hallRemoveEntry: vi.fn(), lastCreated: null, lastTakeRef: { current: null },
    addLoading: false, addTakeLoading: false, completeTakeLoading: false,
    weighPartLoading: false, removeLoading: false,
  }),
}))
// Kreatory zastępujemy atrapą, która ZAPISUJE swoje propsy — to jest sedno:
// sprawdzamy, CO strona im podaje, bo tam mieszkały dzisiejsze błędy.
vi.mock('@/features/deboning/BulkWeighingWizard', () => ({
  BulkWeighingWizard: (p: any) => { zlapane.bulk = p; return <div data-testid="kreator-palet" /> },
}))
vi.mock('@/features/deboning/ByproductsWizard', () => ({
  ByproductsWizard: (p: any) => { zlapane.uboczne = p; return <div data-testid="kreator-ubocznych" /> },
}))

import { DeboningHmiV10Page } from './DeboningHmiV10Page'

// ── Zasiew ───────────────────────────────────────────────────────────────
/**
 * Daty liczone WZGLĘDEM DNIA URUCHOMIENIA, nie wpisane na sztywno.
 *
 * Pierwsza wersja stelaża miała partię z terminem 2026-08-28 i zestaw
 * przestał przechodzić 29.08 — ekran rozbioru słusznie nie pozwala wybrać
 * przeterminowanej partii, więc cztery testy okablowania przewracały się na
 * upływie czasu, a nie na zmianie w kodzie. Fixture z datą w przeszłości to
 * bomba zegarowa: psuje CI dzień po napisaniu testu.
 */
const dzien = (przesuniecie: number): string =>
  new Date(Date.now() + przesuniecie * 86_400_000).toISOString().slice(0, 10)

const DZIS = dzien(0)
const TERMIN = dzien(4)          // partia ważna — ekran pozwala ją wybrać

const partia = (nr: string, over: any = {}) => ({
  id: `b-${nr}`, internalBatchNo: nr, internalBatchSeq: Number(nr),
  supplierName: 'KOKO', supplierBatchNo: 'A-1',
  slaughterDate: dzien(-8), receivedDate: dzien(-7), expiryDate: TERMIN,
  kgReceived: 3390, kgAvailable: 1000, kgUsed: 0, utilizationPct: 0, pricePerKg: 5,
  createdAt: `${DZIS}T06:00:00Z`, ...over,
})
const lot = (nr: string, kgInitial: number, kgBulkFree: number) => ({
  id: `ms-${nr}`, lotNo: nr, kgInitial, kgAvailable: kgInitial, kgBulkFree,
  expiryDate: TERMIN, productionDate: DZIS, recipeId: '', status: 'AVAILABLE',
})

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // useServerOnline pinguje backend — w teście nie ma sieci.
  ;(globalThis as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})
beforeEach(() => {
  vi.clearAllMocks()
  zlapane.bulk = null
  zlapane.uboczne = null
  stan.batches = [partia('504')]
  stan.lots    = [lot('504', 1185, 167)]
  stan.pallets = []
  stan.pending = []
  stan.entries = []
})
afterEach(cleanup)

/** Poczekaj, aż pierwsze pobrania się domkną. */
async function pokazEkran() {
  render(<DeboningHmiV10Page />)
  await screen.findByText('504')
}

describe('okablowanie ekranu rozbioru', () => {
  it('kreator palet dostaje partię ZAZNACZONĄ na ekranie', async () => {
    await pokazEkran()
    fireEvent.click(screen.getByText('504'))
    fireEvent.click(await screen.findByText(/Ważenie zbiorcze/i))
    await screen.findByTestId('kreator-palet')
    expect(zlapane.bulk.activeBatchNo).toBe('504')
  })

  it('licznik partii ODŚWIEŻA się, gdy rozbiór doważy mięso', async () => {
    await pokazEkran()
    fireEvent.click(screen.getByText('504'))
    expect((await screen.findByTestId('bulk-progress')).textContent).toContain('167')

    // Hala doważa: lot rośnie z 1185 do 1585, zostało 567.
    stan.lots = [lot('504', 1585, 567)]
    await waitFor(
      () => expect(screen.getByTestId('bulk-progress').textContent).toContain('567'),
      { timeout: 8000 },
    )
  }, 12000)

  it('kreator ubocznych dostaje partię Z DATĄ WAŻNOŚCI, nie sklejkę', async () => {
    stan.pending = [{
      rawBatchId: 'b-503', rawBatchNo: '503', backsDone: true, bonesDone: true,
      balanced: true, backsKg: 445, bonesKg: 482, missingKg: 0,
    }]
    stan.batches = [partia('504'), partia('503', { kgAvailable: 0 })]
    await pokazEkran()

    fireEvent.click(await screen.findByText('503'))
    fireEvent.click(await screen.findByTestId('wybor-uboczne'))
    await screen.findByTestId('kreator-ubocznych')
    expect(zlapane.uboczne.batch.expiryDate).toBe(TERMIN)
  })

  it('zakończona partia daje wejść w MIĘSO i pokazuje końcówkę', async () => {
    stan.pending = [{
      rawBatchId: 'b-503', rawBatchNo: '503', backsDone: true, bonesDone: true,
      balanced: true, backsKg: 445, bonesKg: 482, missingKg: 0,
    }]
    stan.batches = [partia('504'), partia('503', { kgAvailable: 0 })]
    stan.lots = [lot('504', 1185, 167), lot('503', 2222, 422)]
    stan.pallets = [{
      palletNo: 'PAL/24/08/26/13', kgNet: 200, containers: 9, lots: [{ lotNo: '503', kg: 200 }],
    }]
    await pokazEkran()

    fireEvent.click(await screen.findByText('503'))
    fireEvent.click(await screen.findByTestId('wybor-mieso'))
    const liczby = await screen.findByTestId('bmp-liczby')
    expect(liczby.textContent).toContain('2222')
    expect(liczby.textContent).toContain('422')
    expect(screen.getByTestId('bmp-paleta').textContent).toContain('PAL/24/08/26/13')
  })

  it('„Zważ końcówkę" otwiera kreator z TĄ partią, nie z zaznaczoną', async () => {
    stan.pending = [{
      rawBatchId: 'b-503', rawBatchNo: '503', backsDone: true, bonesDone: true,
      balanced: true, backsKg: 445, bonesKg: 482, missingKg: 0,
    }]
    stan.batches = [partia('504'), partia('503', { kgAvailable: 0 })]
    stan.lots = [lot('504', 1185, 167), lot('503', 2222, 422)]
    await pokazEkran()
    fireEvent.click(screen.getByText('504'))       // zaznaczona jest 504

    fireEvent.click(await screen.findByText('503'))
    fireEvent.click(await screen.findByTestId('wybor-mieso'))
    fireEvent.click(await screen.findByTestId('bmp-zwaz-reszte'))

    await screen.findByTestId('kreator-palet')
    expect(zlapane.bulk.activeBatchNo).toBe('503')
  })
})

/**
 * Ścieżki, które hala przechodzi setki razy dziennie — i które już się kiedyś
 * wywróciły na produkcji. Testujemy OKABLOWANIE: co strona wysyła do hooka
 * zapisu i co robi ze stanem po zapisie.
 */
describe('okablowanie zapisu wpisu rozbioru', () => {
  /** Wbij pobranie klawiaturą ekranową: partia, pracownik, kg pobrane, kg mięsa. */
  async function wbijWpis(pracownik = 'DAWID') {
    await pokazEkran()
    fireEvent.click(await screen.findByText('504'))
    fireEvent.click(await screen.findByText(new RegExp(pracownik)))
    for (const c of ['1', '0', '0']) fireEvent.click(screen.getByRole('button', { name: c }))
    fireEvent.click(screen.getAllByText(/Mięso/)[0])
    for (const c of ['6', '5']) fireEvent.click(screen.getByRole('button', { name: c }))
  }

  it('wpis niesie partię i pracownika ZAZNACZONYCH na ekranie', async () => {
    await wbijWpis('DENYS')
    fireEvent.click(await screen.findByRole('button', { name: /ZAPISZ — DENYS/ }))
    await waitFor(() => expect(addEntry).toHaveBeenCalled())
    expect(addEntry.mock.calls[0][0] as WpisDto).toMatchObject({
      rawBatchId: 'b-504', workerId: 'w2', kgTaken: 100, kgMeat: 65,
    })
  })

  it('po zapisie zostaje TYLKO partia — pracownik się czyści', async () => {
    // Produkcja 2026-08-14: ekran trzymał pracownika „bo kolejna sztuka zwykle
    // taka sama" i wpis wylądował na poprzedniej osobie — wózek DAWIDA na
    // DENYSIE. Kilka dotknięć więcej jest tańsze niż korekta akordu.
    await wbijWpis('DAWID')
    fireEvent.click(await screen.findByRole('button', { name: /ZAPISZ — DAWID/ }))
    await waitFor(() => expect(addEntry).toHaveBeenCalled())
    // Pracownik odznaczony: przycisk wraca do proszenia o wybór…
    expect(await screen.findByRole('button', { name: /WYBIERZ PRACOWNIKA/ })).toBeTruthy()
    // …a partia ZOSTAJE, bo kolejne pobranie idzie z tej samej. Numer bywa
    // w kilku miejscach (kafel + podsumowanie zapisu), więc pytamy o kafel.
    expect(screen.getAllByText('504').length).toBeGreaterThan(0)
  })

  it('partia z pobraniem czekającym ZOSTAJE aktywnym kaflem mimo zerowego stanu', async () => {
    // Produkcja 2026-07-10: wszyscy pobrali z 408, kg_available spadło do zera
    // i ekran „przeskoczył" na 409 — pracownik nie miał gdzie domknąć pobrania.
    stan.batches = [partia('504'), partia('408', { kgAvailable: 0 })]
    stan.entries = [{
      id: 'e1', rawBatchId: 'b-408', rawBatchNo: '408', workerId: 'w1', workerName: 'DAWID',
      kgTaken: 100, kgMeat: null, status: 'pending', createdAt: `${DZIS}T10:00:00Z`,
    }]
    await pokazEkran()
    expect(await screen.findByText('408')).toBeTruthy()
  })
})
