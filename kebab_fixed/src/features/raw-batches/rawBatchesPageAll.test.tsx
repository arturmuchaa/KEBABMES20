// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

/**
 * Strona „Przyjęcie surowca" — przełącznik rodzaju i zakładka „Wszystko".
 *
 * Numery porządkowe są wspólne dla zakładu, a przełącznik rozbijał je na listy
 * per rodzaj: biuro szukało numeru 502 pod Ćwiartką, a ten leżał pod Filetem.
 * Zakładka zbiorcza ma go pokazać jednym kliknięciem.
 */

const TYPES = [
  { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true,  receivable: true },
  { id: 'mat-filet',    name: 'Filet z kurczaka',    requiresDeboning: false, receivable: true },
]

/** Filet ma na dostawie kg_available = 0 — stan żyje w locie magazynu mięsa. */
const STOCK = [
  { stock_type: 'meat', internal_batch_no: '502', kg_available: 400, kg_reserved: 0, kg_initial: 400 },
]

const BASE = {
  supplierId: 'sup1', supplierName: 'KOKO', supplierBatchNo: 'A-1',
  slaughterDate: '2026-08-04', expiryDate: '2026-08-18', pricePerKg: 5.4,
  kgUsed: 0, utilizationPct: 0, receptionId: 'rec1', receptionNo: '12/08/2026',
  createdAt: '2026-08-12T08:00:00Z',
}
const BATCHES = [
  { ...BASE, id: 'b501', internalBatchNo: '501', internalBatchSeq: 501,
    materialTypeId: 'mat-cwiartka', receivedDate: '2026-08-22', kgReceived: 1000, kgAvailable: 250 },
  { ...BASE, id: 'b502', internalBatchNo: '502', internalBatchSeq: 502,
    materialTypeId: 'mat-filet', receivedDate: '2026-08-21', kgReceived: 400, kgAvailable: 0 },
]

vi.mock('@/hooks/useApi', () => ({
  // Prawdziwy useApi jest asynchroniczny; tu wołamy fabrykę wprost, bo
  // zaślepki apiClient zwracają gotowe dane, nie obietnice.
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
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RawBatchesPage } from './pages/RawBatchesPage'

/** Numery porządkowe widoczne na stronie (pierwsza komórka każdego wiersza). */
function widoczneNumery(): string[] {
  return screen.queryAllByRole('row')
    .map(r => r.querySelector('td')?.textContent?.trim() ?? '')
    .filter(Boolean)
}

afterEach(cleanup)

describe('RawBatchesPage — zakładka „Wszystko"', () => {
  it('przełącznik rodzaju zaczyna się od zakładki zbiorczej', () => {
    render(<RawBatchesPage />)
    expect(screen.getByRole('button', { name: 'Wszystko' })).toBeTruthy()
  })

  it('domyślna zakładka rodzaju dalej pokazuje tylko swój surowiec', () => {
    render(<RawBatchesPage />)
    expect(widoczneNumery()).toEqual(['501'])
  })

  it('jedno kliknięcie pokazuje numer, który leży pod innym rodzajem', () => {
    render(<RawBatchesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Wszystko' }))
    expect(widoczneNumery()).toEqual(['502', '501'])
  })

  it('zbiera wszystko w JEDNĄ tabelę, bez podziału na obieg i historię', () => {
    render(<RawBatchesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Wszystko' }))
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('przy każdym numerze podpisuje rodzaj surowca', () => {
    render(<RawBatchesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Wszystko' }))
    const wiersz502 = screen.getAllByRole('row')
      .find(r => r.querySelector('td')?.textContent?.trim() === '502')!
    expect(within(wiersz502).getByText('Filet z kurczaka')).toBeTruthy()
  })
})
