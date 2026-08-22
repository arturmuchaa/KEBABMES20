/**
 * Arkusz dostawy do czytania. Sumy z tego ekranu biuro porównuje z papierem
 * dostawcy, więc anulowane pozycje i brak kalibru muszą być widoczne, a nie
 * cicho wliczone.
 */
import { describe, it, expect } from 'vitest'

import { previewRows, receptionPreviewSummary } from './receptionPreview'

const LOT = (no: string, kg: number) => ({
  supplierBatchNo: no, kgReceived: kg,
  slaughterDate: '2026-08-04', expiryDate: '2026-08-18',
})

const REC = {
  id: 'rec1', receptionNo: '12/08/2026', receivedDate: '2026-08-12',
  supplierId: 'sup1', supplierName: 'KOKO', documentNo: 'WZ 1', hdiNo: 'HDI 1',
  hdiScan: '', notes: '', kgTotal: 9000,
  batches: [
    {
      id: 'b1', internalBatchNo: '471', kgReceived: 3000, kgAvailable: 3000,
      kgUsed: 0, kgMeat: 0, containerKg: 15, containersCount: null,
      slaughterDate: '2026-08-04', expiryDate: '2026-08-18',
      supplierBatchNo: '4577', supplierBatches: [LOT('4577', 1500), LOT('4578', 1500)],
    },
    {
      id: 'b2', internalBatchNo: '472', kgReceived: 6000, kgAvailable: 4000,
      kgUsed: 2000, kgMeat: 0, containerKg: 15, containersCount: null,
      slaughterDate: '2026-08-05', expiryDate: '2026-08-19',
      supplierBatchNo: '4579', supplierBatches: [LOT('4579', 6000)],
    },
  ],
} as any

describe('receptionPreview — arkusz dostawy', () => {
  it('sumuje kilogramy dokumentu i to, co już z niego zeszło', () => {
    const s = receptionPreviewSummary(REC)
    expect(s.kg).toBe(9000)
    expect(s.kgUsed).toBe(2000)
    expect(s.batches).toBe(2)
  })

  it('liczy partie dostawcy bez powtórzeń — ten sam lot bywa w dwóch pozycjach', () => {
    const rec = { ...REC, batches: [
      REC.batches[0],
      { ...REC.batches[1], supplierBatches: [LOT('4577', 6000)] },
    ] }
    expect(receptionPreviewSummary(rec).supplierLots).toBe(2)
  })

  it('anulowany numer porządkowy wypada z sumy, ale zostaje widoczny', () => {
    const rec = { ...REC, batches: [
      REC.batches[0], { ...REC.batches[1], status: 'cancelled' },
    ] }
    const s = receptionPreviewSummary(rec)
    expect(s.kg).toBe(3000)
    expect(s.kgCancelled).toBe(6000)
    expect(s.cancelledBatches).toBe(1)
    expect(previewRows(rec)).toHaveLength(2)
  })

  it('pojemniki liczy z kalibru, a ręczne przeliczenie ma pierwszeństwo', () => {
    const rec = { ...REC, batches: [{ ...REC.batches[0], containersCount: 199 }] }
    expect(previewRows(rec)[0].containers).toBe(199)
    expect(previewRows(REC)[0].containers).toBe(200)
  })

  it('surowiec bez kalibru zeruje SUMĘ pojemników, zamiast podać niepełną', () => {
    const rec = { ...REC, batches: [
      REC.batches[0], { ...REC.batches[1], containerKg: null },
    ] }
    expect(receptionPreviewSummary(rec).containers).toBeNull()
  })

  it('podaje najkrótszy termin dokumentu — po nim idzie FEFO', () => {
    expect(receptionPreviewSummary(REC).earliestExpiry).toBe('2026-08-18')
  })

  it('pozycja bez rozbicia HDI pokazuje numer wpisany na przyjęciu', () => {
    const rec = { ...REC, batches: [{ ...REC.batches[0], supplierBatches: [] }] }
    expect(previewRows(rec)[0].supplierLots).toEqual(['4577'])
  })

  it('brak dokumentu nie wywraca ekranu', () => {
    expect(previewRows(null)).toEqual([])
    expect(receptionPreviewSummary(null).kg).toBe(0)
  })
})
