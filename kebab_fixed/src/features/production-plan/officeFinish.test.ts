/**
 * Ręczne potwierdzanie wykonanej produkcji PRZEZ BIURO.
 *
 * Hala nie ma jeszcze kiosku, więc biuro wpisuje wykonane sztuki z kartki
 * i zatwierdza plan. Wpisy muszą mieć DOKŁADNIE ten sam kształt co te
 * z tabletu — idą tą samą, sprawdzoną ścieżką (tablet-finish →
 * office-confirm → finish_day), która tworzy wyroby gotowe, zwalnia
 * rezerwacje i zamyka plan.
 */
import { describe, it, expect } from 'vitest'
import { buildOfficeFinishEntries, officeFinishSummary } from './officeFinish'

const line = (o: Partial<any> = {}): any => ({
  id: 'l1', qty: 30, qtyDone: 30, kgPerUnit: 25,
  productTypeId: 'pt1', productTypeName: 'KEBAB UDO 100%',
  recipeId: 'r1', recipeName: 'KIRMIZI',
  packagingId: 'p1', packagingName: 'METAL 65CM',
  clientOrderId: 'co1', clientOrderNo: 'ZAM/1', clientName: 'ZAGROS',
  seasonedBatchNos: ['470'],
  ...o,
})

describe('buildOfficeFinishEntries', () => {
  it('przenosi komplet pól pozycji — jak wpis z tabletu', () => {
    const [e] = buildOfficeFinishEntries({ lines: [line()] } as any)
    expect(e).toEqual({
      planLineId: 'l1', qty: 30, workerNames: [], kgPerUnit: 25,
      productTypeId: 'pt1', productTypeName: 'KEBAB UDO 100%',
      recipeId: 'r1', recipeName: 'KIRMIZI',
      packagingId: 'p1', packagingName: 'METAL 65CM',
      clientOrderId: 'co1', clientOrderNo: 'ZAM/1', clientName: 'ZAGROS',
      seasonedBatchNos: ['470'],
    })
  })

  it('pomija pozycje bez wykonania — nie tworzymy wyrobu z zera', () => {
    const entries = buildOfficeFinishEntries({
      lines: [line({ id: 'a', qtyDone: 0 }), line({ id: 'b', qtyDone: 12 })],
    } as any)
    expect(entries.map(e => e.planLineId)).toEqual(['b'])
    expect(entries[0].qty).toBe(12)
  })

  it('przenosi wykonanie częściowe, nie planowane', () => {
    const [e] = buildOfficeFinishEntries({ lines: [line({ qty: 30, qtyDone: 18 })] } as any)
    expect(e.qty).toBe(18)
  })

  it('spada na pojedynczy numer partii, gdy brak listy', () => {
    const [e] = buildOfficeFinishEntries({
      lines: [line({ seasonedBatchNos: undefined, seasonedBatchNo: '472' })],
    } as any)
    expect(e.seasonedBatchNos).toEqual(['472'])
  })

  it('brak jakiegokolwiek wykonania = brak wpisów', () => {
    expect(buildOfficeFinishEntries({ lines: [line({ qtyDone: 0 })] } as any)).toEqual([])
  })

  it('„zatwierdź wszystko" bierze PEŁNĄ zaplanowaną ilość, nie wpisane wykonanie', () => {
    const entries = buildOfficeFinishEntries({
      lines: [line({ id: 'a', qty: 30, qtyDone: 0 }), line({ id: 'b', qty: 20, qtyDone: 5 })],
    } as any, { all: true })
    expect(entries.map(e => [e.planLineId, e.qty])).toEqual([['a', 30], ['b', 20]])
  })

  it('„zatwierdź wszystko" pomija pozycje bez ilości', () => {
    expect(buildOfficeFinishEntries({ lines: [line({ qty: 0 })] } as any, { all: true }))
      .toEqual([])
  })
})

describe('officeFinishSummary', () => {
  it('liczy sztuki, kg i pozycje do zatwierdzenia', () => {
    const s = officeFinishSummary({
      lines: [
        line({ id: 'a', qty: 30, qtyDone: 30, kgPerUnit: 25 }),
        line({ id: 'b', qty: 20, qtyDone: 10, kgPerUnit: 40 }),
        line({ id: 'c', qty: 10, qtyDone: 0 }),
      ],
    } as any)
    expect(s).toEqual({ lines: 2, pieces: 40, kg: 30 * 25 + 10 * 40, partial: 1 })
  })

  it('sygnalizuje pozycje wykonane częściowo', () => {
    expect(officeFinishSummary({ lines: [line({ qty: 30, qtyDone: 30 })] } as any).partial).toBe(0)
    expect(officeFinishSummary({ lines: [line({ qty: 30, qtyDone: 29 })] } as any).partial).toBe(1)
  })
})
