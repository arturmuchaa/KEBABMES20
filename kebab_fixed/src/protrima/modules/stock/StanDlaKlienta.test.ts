import { describe, it, expect } from 'vitest'
import { zestawienie, klientPozycji, WOLNE } from './StanDlaKlienta'
import type { StockPos } from '../../data/stock'

const pos = (o: Partial<StockPos>): StockPos => ({
  id: Math.random().toString(36), product: 'KEBAB UDO 100%', recipe: 'BEYAZ', recipeId: 'r1', kgPerUnit: 25, packaging: 'METAL 65CM',
  batch: '291026 669', location: '', qty: 1, cartons: [], status: 'stock', movements: [], seasonedBatches: [], producedBy: [], ...o,
})

describe('stan magazynowy dla klienta', () => {
  const stock = [
    pos({ orderNo: 'ISSA/Z/1', clientName: 'ISSA DISTRIB', qty: 3, batch: 'A' }),
    pos({ orderNo: 'ISSA/Z/2', clientName: 'ISSA DISTRIB', qty: 2, batch: 'B' }),
    pos({ orderNo: 'ISSA/Z/2', clientName: 'ISSA DISTRIB', qty: 4, kgPerUnit: 30 }),
    pos({ orderNo: 'X/Z/1', clientName: 'YALCIN', qty: 9 }),
    pos({ qty: 7 }),
  ]
  it('łączy partie tego samego wyrobu, rozdziela gramatury, pomija innych klientów i wolny wyrób', () => {
    const r = zestawienie(stock, 'ISSA DISTRIB')
    expect(r.map(w => [w.kgPerUnit, w.qty, w.kg])).toEqual([[25, 5, 125], [30, 4, 120]])
    expect(r[0].batches.map(b => b.batch)).toEqual(['A', 'B'])
  })
  it('wiersz bez zamówienia to wolny wyrób', () => {
    expect(klientPozycji(stock[4])).toBe(WOLNE)
    expect(zestawienie(stock, WOLNE)[0].qty).toBe(7)
  })
})
