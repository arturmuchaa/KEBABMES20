// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { RawBatchesTable } from './components/RawBatchesTable'
import type { MeatStockMap } from './deliveryView'

/**
 * Zakładka „Wszystko" — jedna lista wszystkich przyjęć.
 *
 * Numery porządkowe są wspólne dla całego zakładu, a przełącznik rodzaju
 * surowca rozbijał je na osobne listy: szukany numer „ginął", bo leżał pod
 * Filetem, a biuro patrzyło na Ćwiartkę. Ta zakładka pokazuje ciągły rząd
 * numerów bez względu na rodzaj, wiek dostawy i anulowanie.
 */

vi.mock('@/lib/apiClient', () => ({
  receptionsApi: { hdiScanUrl: () => '', attachHdiScan: vi.fn(), hdiScanBlob: vi.fn() },
}))

const BASE = {
  supplierId: 'sup1', supplierName: 'KOKO', supplierBatchNo: 'A-1',
  slaughterDate: '2026-08-04', expiryDate: '2026-08-18',
  kgUsed: 0, utilizationPct: 0, pricePerKg: 5.4,
  receptionId: 'rec1', receptionNo: '12/08/2026',
  createdAt: '2026-08-12T08:00:00Z',
}

const CWIARTKA = {
  ...BASE, id: 'b501', internalBatchNo: '501', internalBatchSeq: 501,
  materialTypeId: 'mat-cwiartka', receivedDate: '2026-08-22',
  kgReceived: 1000, kgAvailable: 250,
} as any

/** Filet: backend zeruje kg_available dostawy już przy przyjęciu — prawdziwy
 *  stan leży w locie magazynu mięsa pod tym samym numerem. */
const FILET = {
  ...BASE, id: 'b502', internalBatchNo: '502', internalBatchSeq: 502,
  materialTypeId: 'mat-filet', receivedDate: '2026-08-21',
  kgReceived: 400, kgAvailable: 0,
} as any

/** Dostawa sprzed ponad roku — poza domyślnym okresem historii. */
const STARA = {
  ...BASE, id: 'b301', internalBatchNo: '301', internalBatchSeq: 301,
  materialTypeId: 'mat-cwiartka', receivedDate: '2025-01-15',
  kgReceived: 900, kgAvailable: 0,
} as any

/** Anulowana: w bazie numer podmieniony na ANUL-<id>, pierwotny w seq. */
const ANULOWANA = {
  ...BASE, id: 'b499', internalBatchNo: 'ANUL-370da2b718c2', internalBatchSeq: 499,
  materialTypeId: 'mat-mieso-zs', receivedDate: '2026-08-20',
  kgReceived: 300, kgAvailable: 0, status: 'cancelled',
} as any

const MEAT_STOCK: MeatStockMap = {
  '502': { kgAvailable: 400, kgReserved: 0, kgInitial: 400 },
}

const NAZWY: Record<string, string> = {
  'mat-cwiartka': 'Ćwiartka z kurczaka',
  'mat-filet':    'Filet z kurczaka',
  'mat-mieso-zs': 'Mięso z/s',
}

function pokazWszystko(batches: any[] = [CWIARTKA, FILET, STARA, ANULOWANA]) {
  render(
    <RawBatchesTable
      batches={batches}
      loading={false}
      variant="all"
      materialLabel={b => NAZWY[(b as any).materialTypeId ?? ''] ?? '—'}
      requiresDeboning={b => ((b as any).materialTypeId ?? 'mat-cwiartka') === 'mat-cwiartka'}
      meatStock={MEAT_STOCK}
    />,
  )
}

/** Wiersze danych (bez nagłówka). */
function wiersze(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1)
}

/** Numery porządkowe w kolejności wyświetlenia (pierwsza komórka wiersza). */
function numeryWKolejnosci(): string[] {
  return wiersze().map(r => r.querySelector('td')?.textContent?.trim() ?? '')
}

/** Zawartość kolumny „Zostało kg" w wierszu o podanym numerze porządkowym. */
function zostaloKg(nr: string): string {
  const wiersz = wiersze().find(r => r.querySelector('td')?.textContent?.trim() === nr)
  const komorki = wiersz?.querySelectorAll('td') ?? []
  // Nr · Rodzaj · Przyjęcie · Dostawca · Nr dostawcy · Przyjęto · Ubój ·
  // Ważność · Przyjęto kg · [Zostało kg]
  return komorki[9]?.textContent?.trim() ?? ''
}

afterEach(cleanup)

describe('RawBatchesTable — zakładka „Wszystko"', () => {
  it('pokazuje rodzaj surowca przy każdym numerze', () => {
    pokazWszystko()
    expect(screen.getByText('Rodzaj')).toBeTruthy()
    expect(screen.getByText('Filet z kurczaka')).toBeTruthy()
  })

  it('nie ucina dostaw starszych niż domyślny okres historii', () => {
    pokazWszystko()
    expect(numeryWKolejnosci()).toContain('301')
  })

  it('anulowanych nie pokazuje domyślnie — lista ma zostać czytelna', () => {
    pokazWszystko()
    expect(numeryWKolejnosci()).not.toContain('499')
  })

  it('anulowane wracają po zaznaczeniu „Pokaż anulowane"', () => {
    pokazWszystko()
    fireEvent.click(screen.getByLabelText('Pokaż anulowane'))
    expect(numeryWKolejnosci()).toContain('499')
  })

  it('ustawia numery w ciągły rząd malejąco, mieszając rodzaje surowca', () => {
    pokazWszystko()
    fireEvent.click(screen.getByLabelText('Pokaż anulowane'))
    expect(numeryWKolejnosci()).toEqual(['502', '501', '499', '301'])
  })

  it('czyta stan fileta z magazynu mięsa, a ćwiartki z dostawy', () => {
    pokazWszystko([CWIARTKA, FILET])
    // Filet ma na dostawie kg_available = 0 — 400 kg widać wyłącznie wtedy,
    // gdy wiersz sięgnął do lotu magazynu mięsa.
    expect(zostaloKg('502')).toBe('400,00 kg')
    expect(zostaloKg('501')).toBe('250,00 kg')
  })

  it('rodzaju nie pokazuje tam, gdzie lista i tak jest jednorodna', () => {
    render(<RawBatchesTable batches={[CWIARTKA]} loading={false} variant="live" />)
    expect(screen.queryByText('Rodzaj')).toBeNull()
  })
})
