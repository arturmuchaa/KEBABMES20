/**
 * Wciąganie pozycji zamówień do planu dnia.
 *
 * Plan powstaje „po połowie": część z zamówień, część z decyzji szefa. Kluczowa
 * liczba to ILE JESZCZE ZOSTAŁO z pozycji zamówienia — pozycja częściowo
 * wyprodukowana nie może wjechać do planu w pełnej ilości, bo zakład zrobiłby
 * ją drugi raz.
 */
import { describe, it, expect } from 'vitest'
import { pullableLines, toPlanLines } from './pullFromOrders'

const ZAMOWIENIA = [
  {
    id: 'z1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli', status: 'confirmed',
    lines: [
      { id: 'l1', qty: 20, kgPerUnit: 35, productTypeId: 'pt1', recipeId: 'r1', packagingId: 'tul65' },
      { id: 'l2', qty: 10, kgPerUnit: 10, productTypeId: 'pt1', recipeId: 'r2', packagingId: null },
    ],
  },
  {
    id: 'z2', orderNo: 'ZAM/2', clientId: 'c2', clientName: 'Kowalski', status: 'confirmed',
    lines: [{ id: 'l3', qty: 5, kgPerUnit: 8.5, productTypeId: 'pt2', recipeId: 'r3' }],
  },
] as any[]

describe('pullableLines', () => {
  it('bez danych o postępie bierze całą ilość', () => {
    const out = pullableLines(ZAMOWIENIA, {})
    expect(out.map(l => [l.lineId, l.qtyRemaining])).toEqual([['l1', 20], ['l2', 10], ['l3', 5]])
  })

  it('pozycja częściowo wyprodukowana oddaje TYLKO resztę', () => {
    const out = pullableLines(ZAMOWIENIA, { l1: { qtyRemaining: 8 } })
    expect(out.find(l => l.lineId === 'l1')!.qtyRemaining).toBe(8)
  })

  it('pozycja zrobiona w całości znika z listy — nie ma czego planować', () => {
    const out = pullableLines(ZAMOWIENIA, { l1: { qtyRemaining: 0 } })
    expect(out.map(l => l.lineId)).toEqual(['l2', 'l3'])
  })

  it('liczy kilogramy z RESZTY, nie z całego zamówienia', () => {
    const out = pullableLines(ZAMOWIENIA, { l1: { qtyRemaining: 8 } })
    expect(out.find(l => l.lineId === 'l1')!.kg).toBe(280)
  })

  it('niesie klienta i numer zamówienia — plan musi wiedzieć, dla kogo produkuje', () => {
    const l = pullableLines(ZAMOWIENIA, {}).find(x => x.lineId === 'l3')!
    expect(l).toMatchObject({ orderNo: 'ZAM/2', clientId: 'c2', clientName: 'Kowalski' })
  })

  it('zamówienia niepotwierdzone nie wchodzą do planu', () => {
    const szkic = [{ ...ZAMOWIENIA[0], id: 'z9', status: 'draft' }] as any[]
    expect(pullableLines(szkic, {})).toEqual([])
  })
})

describe('toPlanLines', () => {
  it('zachowuje powiązanie z pozycją zamówienia — po nim rozlicza się zamówienie', () => {
    const [p] = toPlanLines(pullableLines(ZAMOWIENIA, {}).slice(0, 1))
    expect(p).toMatchObject({
      qty: '20', kgPerUnit: '35', productTypeId: 'pt1', recipeId: 'r1',
      packagingId: 'tul65', clientId: 'c1', clientName: 'Bulli',
      clientOrderId: 'z1', clientOrderNo: 'ZAM/1', clientOrderLineId: 'l1',
    })
  })

  it('wciągnięta pozycja nie ma jeszcze partii — dobierze je FEFO', () => {
    const [p] = toPlanLines(pullableLines(ZAMOWIENIA, {}).slice(0, 1))
    expect(p.seasonedBatchIds).toEqual([])
    expect(p.batchesManual).toBe(false)
  })

  it('brak tulei to pusty string, nie null — formularz oczekuje napisu', () => {
    const p = toPlanLines(pullableLines(ZAMOWIENIA, {})).find(x => x.clientOrderLineId === 'l2')!
    expect(p.packagingId).toBe('')
  })
})

// ── Grupowanie do importu ────────────────────────────────────────────────
import { groupPullableByClient, type PullableLine } from './pullFromOrders'

const poz = (over: Partial<PullableLine> = {}): PullableLine => ({
  orderId: 'o1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli',
  lineId: 'l1', productTypeId: 'pt1', recipeId: 'r1', packagingId: 't1',
  kgPerUnit: 35, qtyRemaining: 12, kg: 420, ...over,
})

describe('groupPullableByClient', () => {
  it('składa pozycje w grupy klientów z sumami', () => {
    const g = groupPullableByClient([
      poz(),
      poz({ lineId: 'l2', kg: 180, qtyRemaining: 6, kgPerUnit: 30 }),
      poz({ lineId: 'l3', clientId: 'c2', clientName: 'Zagros', kg: 240 }),
    ])
    expect(g.map(x => x.clientName)).toEqual(['Bulli', 'Zagros'])
    expect(g[0]).toMatchObject({ pozycji: 2, kg: 600 })
    expect(g[1]).toMatchObject({ pozycji: 1, kg: 240 })
  })

  it('klienci po alfabecie — lista ma nie skakać', () => {
    const g = groupPullableByClient([
      poz({ clientId: 'c9', clientName: 'Zagros' }),
      poz({ lineId: 'l2', clientId: 'c1', clientName: 'Alfa' }),
    ])
    expect(g.map(x => x.clientName)).toEqual(['Alfa', 'Zagros'])
  })

  it('w grupie pozycje idą po numerze zamówienia — tak je czyta biuro', () => {
    const g = groupPullableByClient([
      poz({ lineId: 'l2', orderNo: 'ZAM/9' }),
      poz({ lineId: 'l1', orderNo: 'ZAM/2' }),
    ])
    expect(g[0].lines.map(l => l.orderNo)).toEqual(['ZAM/2', 'ZAM/9'])
  })

  it('pusto na wejściu to pusto na wyjściu', () => {
    expect(groupPullableByClient([])).toEqual([])
    expect(groupPullableByClient(null as any)).toEqual([])
  })
})
