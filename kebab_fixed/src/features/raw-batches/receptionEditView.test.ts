import { describe, it, expect } from 'vitest'
import { documentToForm, formToUpdatePayload } from './receptionEditView'

const REC = {
  id: 'rec1', receptionNo: '16/08', receivedDate: '2026-08-14',
  supplierId: 'sup1', documentNo: 'FA/274/08/2026', notes: '',
  batches: [
    { id: 'b1', internalBatchNo: '479', kgReceived: 167, pricePerKg: 10,
      materialTypeId: 'mat-filet-kurczak', kgUsed: 0, frozenReason: null,
      supplierBatches: [{ supplierBatchNo: '17/08', kg: 167,
                          slaughterDate: '2026-08-12', expiryDate: '2026-08-19' }] },
    { id: 'b2', internalBatchNo: '480', kgReceived: 100, pricePerKg: 10,
      materialTypeId: 'mat-filet-kurczak', kgUsed: 0,
      frozenReason: 'w rozbiorze', supplierBatches: [] },
  ],
} as any

describe('documentToForm — dostawa z API na stan formularza', () => {
  it('każdy numer porządkowy staje się grupą, z numerem do odesłania', () => {
    const { groups } = documentToForm(REC)
    expect(groups.map(g => g.batchNo)).toEqual(['479', '480'])
    expect(groups[0].kg).toBe(167)
  })

  it('pozycje HDI trafiają do swojej grupy', () => {
    const { groups } = documentToForm(REC)
    expect(groups[0].lines.map(l => l.supplierBatchNo)).toEqual(['17/08'])
    expect(groups[0].lines[0].group).toBe(0)
  })

  it('powód zamrożenia jedzie po batchId — formularz wyszarza wiersz', () => {
    expect(documentToForm(REC).frozen).toEqual({ b2: 'w rozbiorze' })
  })

  it('nagłówek przenosi dokument, datę i rodzaj surowca', () => {
    const { header } = documentToForm(REC)
    expect(header.documentNo).toBe('FA/274/08/2026')
    expect(header.receivedDate).toBe('2026-08-14')
    expect(header.materialTypeId).toBe('mat-filet-kurczak')
  })
})

describe('formToUpdatePayload — stan formularza na żądanie PUT', () => {
  it('istniejąca grupa niesie batchId, nowa nie', () => {
    const { header, groups } = documentToForm(REC)
    const nowa = { ...groups[0], batchId: undefined, batchNo: '481', kg: 50, lines: [] }
    const dto = formToUpdatePayload(header, [...groups, nowa as any])
    expect(dto.groups.map(g => g.batchId)).toEqual(['b1', 'b2', undefined])
    expect(dto.groups[2].kgReceived).toBe(50)
  })

  it('zdjęta grupa po prostu nie wchodzi do żądania', () => {
    const { header, groups } = documentToForm(REC)
    const dto = formToUpdatePayload(header, [groups[0]])
    expect(dto.groups.map(g => g.batchId)).toEqual(['b1'])
  })
})
