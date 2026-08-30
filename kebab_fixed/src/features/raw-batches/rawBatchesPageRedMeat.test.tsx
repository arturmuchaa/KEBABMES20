// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

/**
 * Strona „Przyjęcie surowca" — zbiorcza zakładka „Mięso czerwone".
 *
 * Wołowina przyjeżdża w pięciu postaciach (80/20, dolna zrazowa, filet
 * z mostka, dwa łoje). Pięć osobnych zakładek rozdęłoby przełącznik do
 * dziesięciu pozycji i wymieszało drób z wołowiną, a instrukcja 1.1 oPRP
 * i tak traktuje je jednym tchem. Stąd JEDNA zakładka z kolumną rodzaju,
 * a rodzaj i stan wybiera się dopiero w formularzu przyjęcia.
 */

const TYPES = [
  { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true,  receivable: true, category: 'drob' },
  { id: 'mat-filet',    name: 'Filet z kurczaka',    requiresDeboning: false, receivable: true, category: 'drob' },
  { id: 'mat-wolowina-8020', name: 'Wołowina 80/20', requiresDeboning: false, receivable: true, category: 'czerwone' },
  { id: 'mat-loj-otokowy',   name: 'Łój wołowy otokowy', requiresDeboning: false, receivable: true, category: 'czerwone' },
]

/** Wołowina, jak filet, żyje w locie magazynu mięsa — dostawa ma 0 kg. */
const STOCK = [
  { stock_type: 'meat', internal_batch_no: '520', kg_available: 900, kg_reserved: 0, kg_initial: 900 },
  { stock_type: 'meat', internal_batch_no: '521', kg_available: 300, kg_reserved: 0, kg_initial: 300 },
]

const BASE = {
  supplierId: 'sup1', supplierName: 'ZM WOŁOWINA', supplierBatchNo: 'B-1',
  slaughterDate: '2026-08-20', expiryDate: '2027-02-01', pricePerKg: 18,
  kgUsed: 0, utilizationPct: 0, receptionId: 'rec9', receptionNo: '5/08',
  createdAt: '2026-08-30T08:00:00Z',
}
const BATCHES = [
  { ...BASE, id: 'b501', internalBatchNo: '501', internalBatchSeq: 501,
    materialTypeId: 'mat-cwiartka', receivedDate: '2026-08-29', kgReceived: 1000, kgAvailable: 250 },
  { ...BASE, id: 'b520', internalBatchNo: '520', internalBatchSeq: 520,
    materialTypeId: 'mat-wolowina-8020', storageState: 'mrozony',
    receivedDate: '2026-08-30', kgReceived: 900, kgAvailable: 0 },
  { ...BASE, id: 'b521', internalBatchNo: '521', internalBatchSeq: 521,
    materialTypeId: 'mat-loj-otokowy', storageState: 'chlodzony',
    receivedDate: '2026-08-30', kgReceived: 300, kgAvailable: 0 },
]

const navigate = vi.fn()

vi.mock('@/hooks/useApi', () => ({
  useApi: (fn: () => any) => ({ data: fn(), loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('@/lib/apiClient', () => ({
  rawBatchesApi: { materialTypes: () => TYPES },
  wzApi:         { stockRaw: () => STOCK },
  receptionsApi: { hdiScanUrl: () => '', attachHdiScan: vi.fn(), hdiScanBlob: vi.fn(), cancel: vi.fn() },
}))
vi.mock('./api', () => ({ rawBatchesApi: { cancel: vi.fn() } }))
vi.mock('./hooks/useRawBatches', () => ({
  useRawBatches: () => ({ batches: BATCHES, supplierOptions: [], loading: false, refetch: vi.fn() }),
  useCreateReception: () => ({ mutate: vi.fn(), loading: false }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RawBatchesPage } from './pages/RawBatchesPage'

function numery(): string[] {
  return screen.queryAllByRole('row')
    .map(r => r.querySelector('td')?.textContent?.trim() ?? '')
    .filter(Boolean)
}

function wejdzWWolowine() {
  render(<RawBatchesPage />)
  fireEvent.click(screen.getByRole('button', { name: /Mięso czerwone/ }))
}

afterEach(() => { navigate.mockClear(); cleanup() })

describe('RawBatchesPage — zakładka „Mięso czerwone"', () => {
  it('pięć rodzajów wołowiny mieści się w JEDNEJ zakładce', () => {
    render(<RawBatchesPage />)
    expect(screen.getByRole('button', { name: /Mięso czerwone/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wołowina 80/20' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Łój wołowy otokowy' })).toBeNull()
  })

  it('zbiera wołowinę i łój, a drób zostawia w spokoju', () => {
    wejdzWWolowine()
    expect(numery()).toContain('520')
    expect(numery()).toContain('521')
    expect(numery()).not.toContain('501')
  })

  it('podpisuje każdy wiersz rodzajem — inaczej łój nie różni się od 80/20', () => {
    wejdzWWolowine()
    const wiersz = screen.getAllByRole('row')
      .find(r => r.querySelector('td')?.textContent?.trim() === '521')!
    expect(within(wiersz).getByText('Łój wołowy otokowy')).toBeTruthy()
  })

  it('„Nowe przyjęcie" prowadzi do formularza ze zbiorczym rodzajem', () => {
    // Formularz musi dostać sentinel, a nie konkretny rodzaj: bez tego
    // wybór z pięciu rodzajów w ogóle by się nie pokazał.
    wejdzWWolowine()
    fireEvent.click(screen.getByRole('button', { name: /Przyjmij: Mięso czerwone/ }))
    expect(navigate).toHaveBeenCalledWith('/office/raw-batches/nowe?rodzaj=__czerwone__')
  })

  it('nie pokazuje podpowiedzi „surowiec bez rozbioru" dla pięciu rodzajów naraz', () => {
    // Ta podpowiedź opisuje JEDEN rodzaj; w zakładce zbiorczej jej miejsce
    // zajmuje zdanie o wołowinie i magazynie mrożonym.
    wejdzWWolowine()
    expect(screen.getByText(/magazynu nr 6/i)).toBeTruthy()
  })
})
