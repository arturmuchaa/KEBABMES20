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
