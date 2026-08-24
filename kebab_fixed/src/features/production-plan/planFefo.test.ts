/**
 * Przydział partii przyprawionego do pozycji planu.
 *
 * FEFO PROPONUJE, człowiek decyduje: pozycja ruszona ręcznie dostaje znacznik
 * `batchesManual` i automat jej nie nadpisuje. Bez tego każda ręczna decyzja
 * ginęłaby przy następnym wpisanym kilogramie — a bez możliwości przeliczenia
 * od nowa plan zostawałby z przydziałem sprzed połowy zmian.
 */
import { describe, it, expect } from 'vitest'
import { assignFefo, clearManual, type FefoBatch, type FefoLine } from './planFefo'

/** Partie tej samej receptury; 100 ma krótszy termin, więc idzie pierwsza. */
const PARTIE: FefoBatch[] = [
  { id: 'b100', recipeId: 'r1', batchNo: '100', expiryDate: '2026-09-01', kgFree: 300 },
  { id: 'b200', recipeId: 'r1', batchNo: '200', expiryDate: '2026-09-05', kgFree: 900 },
]

const linia = (over: Partial<FefoLine> = {}): FefoLine =>
  ({ recipeId: 'r1', qty: '10', kgPerUnit: '10', ...over })

describe('assignFefo', () => {
  it('pustej pozycji przypisuje najstarszą partię', () => {
    const [l] = assignFefo([linia()], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b100'])
    expect(l.seasonedBatchId).toBe('b100')
  })

  it('gdy najstarsza nie starczy, dokłada kolejną', () => {
    const [l] = assignFefo([linia({ qty: '50' })], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b100', 'b200'])
  })

  it('dwie pozycje nie biorą tych samych kilogramów', () => {
    const out = assignFefo([linia({ qty: '30' }), linia({ qty: '30' })], PARTIE)
    expect(out[0].seasonedBatchIds).toEqual(['b100'])
    expect(out[1].seasonedBatchIds).toEqual(['b200'])
  })

  it('pozycji ruszonej ręcznie NIE nadpisuje', () => {
    const reczna = linia({ seasonedBatchIds: ['b200'], batchesManual: true })
    const [l] = assignFefo([reczna], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b200'])
  })

  it('pozycji rozpoczętej na hali NIE rusza', () => {
    const wProdukcji = linia({ seasonedBatchIds: ['b200'], qtyDone: 3 })
    const [l] = assignFefo([wProdukcji], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b200'])
  })

  it('force przelicza wszystko poza pozycjami rozpoczętymi', () => {
    const out = assignFefo(
      [linia({ seasonedBatchIds: ['b200'], batchesManual: true }),
       linia({ seasonedBatchIds: ['b200'], qtyDone: 3 })],
      PARTIE, { force: true },
    )
    expect(out[0].seasonedBatchIds).toEqual(['b100'])
    expect(out[1].seasonedBatchIds).toEqual(['b200'])
  })

  it('partia mieszcząca mniej niż jedną CAŁĄ sztukę nie wchodzi', () => {
    const male: FefoBatch[] = [{ id: 'bm', recipeId: 'r1', kgFree: 5, expiryDate: '2026-09-01' }]
    const [l] = assignFefo([linia({ kgPerUnit: '10' })], male)
    expect(l.seasonedBatchIds ?? []).toEqual([])
  })

  it('nie bierze partii z innej receptury', () => {
    const obca: FefoBatch[] = [{ id: 'bx', recipeId: 'r9', kgFree: 900, expiryDate: '2026-09-01' }]
    const [l] = assignFefo([linia()], obca)
    expect(l.seasonedBatchIds ?? []).toEqual([])
  })

  it('pozycji bez receptury albo bez kilogramów nie dotyka', () => {
    const [a] = assignFefo([linia({ recipeId: '' })], PARTIE)
    const [b] = assignFefo([linia({ qty: '0' })], PARTIE)
    expect(a.seasonedBatchIds ?? []).toEqual([])
    expect(b.seasonedBatchIds ?? []).toEqual([])
  })

  it('opts.recipeId zawęża przeliczenie do jednej receptury', () => {
    const inna = linia({ recipeId: 'r9' })
    const out = assignFefo([inna, linia()], PARTIE, { recipeId: 'r1' })
    expect(out[0].seasonedBatchIds ?? []).toEqual([])
    expect(out[1].seasonedBatchIds).toEqual(['b100'])
  })

  it('nie mutuje wejścia', () => {
    const wej = [linia()]
    assignFefo(wej, PARTIE)
    expect(wej[0].seasonedBatchIds).toBeUndefined()
  })
})

describe('clearManual', () => {
  it('zdejmuje znaczniki ręczne, zostawiając pozycje rozpoczęte', () => {
    const out = clearManual([
      linia({ batchesManual: true }),
      linia({ batchesManual: true, qtyDone: 2 }),
    ])
    expect(out[0].batchesManual).toBe(false)
    expect(out[1].batchesManual).toBe(true)
  })
})
