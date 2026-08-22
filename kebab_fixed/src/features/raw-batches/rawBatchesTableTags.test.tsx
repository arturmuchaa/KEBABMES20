// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { RawBatchesTable } from './components/RawBatchesTable'

/**
 * Zawieszki gubią się i rozmazują, a BrowserPrint bywa wyłączony w chwili
 * przyjęcia — druk MUSI dać się powtórzyć z rejestru dostaw, inaczej jedyną
 * drogą byłoby ponowne zarejestrowanie dostawy.
 */

vi.mock('@/lib/apiClient', () => ({
  receptionsApi: { hdiScanUrl: () => '', attachHdiScan: vi.fn(), hdiScanBlob: vi.fn() },
}))

const BATCH = {
  id: 'b1', internalBatchNo: '471', internalBatchSeq: 471,
  supplierId: 'sup1', supplierName: 'KOKO', supplierBatchNo: 'A-1',
  slaughterDate: '2026-08-04', receivedDate: '2026-08-12', expiryDate: '2026-08-18',
  kgReceived: 3000, kgAvailable: 3000, kgUsed: 0, utilizationPct: 0,
  pricePerKg: 5.4, receptionId: 'rec1', receptionNo: '12/08/2026',
  createdAt: '2026-08-12T08:00:00Z',
} as any

afterEach(cleanup)

describe('RawBatchesTable — druk zawieszek z rejestru dostaw', () => {
  it('daje przy dostawie przycisk zawieszek', () => {
    render(<RawBatchesTable batches={[BATCH]} loading={false} onPrintTags={vi.fn()} />)
    expect(screen.getByTitle(/Zawieszki/)).toBeTruthy()
  })

  it('przycisk oddaje dostawę, której zawieszki mamy wydrukować', () => {
    const onPrintTags = vi.fn()
    render(<RawBatchesTable batches={[BATCH]} loading={false} onPrintTags={onPrintTags} />)
    fireEvent.click(screen.getByTitle(/Zawieszki/))
    expect(onPrintTags).toHaveBeenCalledWith(expect.objectContaining({ receptionId: 'rec1' }))
  })

  it('dostawa bez dokumentu przyjęcia nie kusi przyciskiem donikąd', () => {
    render(<RawBatchesTable batches={[{ ...BATCH, receptionId: undefined }]}
                           loading={false} onPrintTags={vi.fn()} />)
    expect(screen.queryByTitle(/Zawieszki/)).toBeNull()
  })
})

/**
 * Podgląd arkusza dostawy. Biuro oglądało dokument przez EDYCJĘ, bo innej drogi
 * nie było — a w historii edycji już nie ma, więc rozliczonej dostawy nie dało
 * się przejrzeć wcale.
 */
describe('RawBatchesTable — podgląd arkusza dostawy', () => {
  it('daje przycisk podglądu przy dostawie w obiegu', () => {
    const onPreview = vi.fn()
    render(<RawBatchesTable batches={[BATCH]} loading={false} onPreview={onPreview} />)
    fireEvent.click(screen.getByTitle(/Podgląd arkusza/))
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ receptionId: 'rec1' }))
  })

  it('podgląd jest też w HISTORII, gdzie edycji nie ma', () => {
    const onPreview = vi.fn()
    render(
      <RawBatchesTable
        batches={[BATCH]} loading={false} variant="history"
        onPreview={onPreview} onEdit={vi.fn()} onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle(/Podgląd arkusza/))
    expect(onPreview).toHaveBeenCalled()
    // …ale sama historia nadal nie pozwala nic zmienić.
    expect(screen.queryByTitle('Edytuj')).toBeNull()
    expect(screen.queryByTitle(/Anuluj przyjęcie/)).toBeNull()
  })

  it('dostawa bez dokumentu nie dostaje podglądu — nie ma czego pokazać', () => {
    render(
      <RawBatchesTable
        batches={[{ ...BATCH, receptionId: undefined }]} loading={false} onPreview={vi.fn()}
      />,
    )
    expect(screen.queryByTitle(/Podgląd arkusza/)).toBeNull()
  })
})
