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
}))

/** Propsy przechwycone z komponentów-dzieci — tak sprawdzamy okablowanie. */
const zlapane = vi.hoisted(() => ({ bulk: null as any, uboczne: null as any }))

vi.mock('@/lib/apiClient', () => ({
  rawBatchesApi: { list: async () => ({ data: stan.batches }) },
  usersApi:      { list: async () => [] },
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
    session: { id: 's1', productionDate: '2026-08-24' }, timeWindow: 'open',
    loading: false, startDay: vi.fn(), startLoading: false, closeDay: vi.fn(), closeLoading: false,
  }),
  useDeboningEntries: () => ({
    entries: [], addEntry: vi.fn(), addTake: vi.fn(), completeTake: vi.fn(),
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
const partia = (nr: string, over: any = {}) => ({
  id: `b-${nr}`, internalBatchNo: nr, internalBatchSeq: Number(nr),
  supplierName: 'KOKO', supplierBatchNo: 'A-1',
  slaughterDate: '2026-08-21', receivedDate: '2026-08-22', expiryDate: '2026-08-28',
  kgReceived: 3390, kgAvailable: 1000, kgUsed: 0, utilizationPct: 0, pricePerKg: 5,
  createdAt: '2026-08-24T06:00:00Z', ...over,
})
const lot = (nr: string, kgInitial: number, kgBulkFree: number) => ({
  id: `ms-${nr}`, lotNo: nr, kgInitial, kgAvailable: kgInitial, kgBulkFree,
  expiryDate: '2026-08-28', productionDate: '2026-08-24', recipeId: '', status: 'AVAILABLE',
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
    expect(zlapane.uboczne.batch.expiryDate).toBe('2026-08-28')
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
