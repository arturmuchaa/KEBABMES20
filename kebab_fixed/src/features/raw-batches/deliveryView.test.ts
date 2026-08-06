/**
 * Testy czystej logiki widoku Przyjęcia surowca.
 * Daty podawane jawnie (parametr `today`) — zero zależności od zegara.
 */
import { describe, it, expect } from 'vitest'
import {
  splitDeliveries,
  sortDeliveries,
  filterHistory,
  deliveryStatusBadgeKey,
  liveSummary,
  pluralDostawy,
  type DeliveryLike,
} from './deliveryView'

function batch(over: Partial<DeliveryLike> = {}): DeliveryLike {
  return {
    internalBatchNo:  '400',
    internalBatchSeq: 400,
    supplierName:     'Drob-Pol',
    supplierBatchNo:  'DP/1',
    receivedDate:     '2026-08-01',
    slaughterDate:    '2026-07-30',
    expiryDate:       '2026-08-06',
    kgReceived:       1000,
    kgAvailable:      0,
    status:           'active',
    ...over,
  }
}

describe('splitDeliveries', () => {
  it('dostawa z resztą surowca trafia do obiegu', () => {
    const { live, history } = splitDeliveries([batch({ kgAvailable: 250 })])
    expect(live).toHaveLength(1)
    expect(history).toHaveLength(0)
  })

  it('dostawa rozliczona trafia do historii', () => {
    const { live, history } = splitDeliveries([batch({ kgAvailable: 0 })])
    expect(live).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('anulowana trafia do historii nawet z resztą kg', () => {
    const { live, history } = splitDeliveries([
      batch({ status: 'cancelled', kgAvailable: 800 }),
    ])
    expect(live).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('zachowuje kolejność wejściową w obu koszykach', () => {
    const { live, history } = splitDeliveries([
      batch({ internalBatchNo: '1', kgAvailable: 10 }),
      batch({ internalBatchNo: '2', kgAvailable: 0 }),
      batch({ internalBatchNo: '3', kgAvailable: 20 }),
      batch({ internalBatchNo: '4', kgAvailable: 0 }),
    ])
    expect(live.map(b => b.internalBatchNo)).toEqual(['1', '3'])
    expect(history.map(b => b.internalBatchNo)).toEqual(['2', '4'])
  })
})

describe('sortDeliveries', () => {
  it('po dacie przyjęcia malejąco — najnowsza pierwsza', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', receivedDate: '2026-08-01' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
      batch({ internalBatchNo: 'C', receivedDate: '2026-08-03' }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['B', 'C', 'A'])
  })

  it('przy tej samej dacie przyjęcia wyżej wyższy numer partii', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: '463', internalBatchSeq: 463, receivedDate: '2026-08-06' }),
      batch({ internalBatchNo: '464', internalBatchSeq: 464, receivedDate: '2026-08-06' }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['464', '463'])
  })

  it('numery partii porównuje liczbowo, nie tekstowo (9 < 100)', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: '100', internalBatchSeq: 100 }),
      batch({ internalBatchNo: '9',   internalBatchSeq: 9 }),
    ], 'internalBatchNo', 'asc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['9', '100'])
  })

  it('kilogramy porównuje liczbowo mimo stringów z backendu', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', kgReceived: '900.000' }),
      batch({ internalBatchNo: 'B', kgReceived: '1200.000' }),
    ], 'kgReceived', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['B', 'A'])
  })

  it('nie mutuje tablicy wejściowej', () => {
    const rows = [
      batch({ internalBatchNo: 'A', receivedDate: '2026-08-01' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
    ]
    sortDeliveries(rows, 'receivedDate', 'desc')
    expect(rows.map(b => b.internalBatchNo)).toEqual(['A', 'B'])
  })

  it('puste daty lądują na końcu przy sortowaniu malejącym', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', receivedDate: '' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['B', 'A'])
  })
})

describe('filterHistory', () => {
  const rows = [
    batch({ internalBatchNo: '464', receivedDate: '2026-08-06', supplierName: 'Drob-Pol', supplierBatchNo: 'DP/77' }),
    batch({ internalBatchNo: '430', receivedDate: '2026-07-20', supplierName: 'Animex',   supplierBatchNo: 'AX/12' }),
    batch({ internalBatchNo: '300', receivedDate: '2026-06-15', supplierName: 'Drob-Pol', supplierBatchNo: 'DP/01' }),
    batch({ internalBatchNo: '299', receivedDate: '2026-07-25', status: 'cancelled' }),
  ]

  it('domyślnie ukrywa anulowane', () => {
    const out = filterHistory(rows, { period: 0, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).not.toContain('299')
  })

  it('pokazuje anulowane po włączeniu', () => {
    const out = filterHistory(rows, { period: 0, showCancelled: true, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).toContain('299')
  })

  it('okres 30 dni odcina starsze dostawy', () => {
    const out = filterHistory(rows, { period: 30, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).toEqual(['464', '430'])
  })

  it('okres 90 dni sięga dalej niż 30 dni', () => {
    const out = filterHistory(rows, { period: 90, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).toEqual(['464', '430', '300'])
  })

  it('okres 0 znaczy wszystko', () => {
    const out = filterHistory(rows, { period: 0, today: '2026-08-06' })
    expect(out).toHaveLength(3)
  })

  it('granica okresu jest domknięta — dokładnie 30 dni wstecz wchodzi', () => {
    const out = filterHistory([batch({ internalBatchNo: 'X', receivedDate: '2026-07-07' })],
      { period: 30, today: '2026-08-06' })
    expect(out).toHaveLength(1)
  })

  it('szuka po numerze partii, dostawcy i numerze dostawcy', () => {
    const opts = { period: 0 as const, today: '2026-08-06' }
    expect(filterHistory(rows, { ...opts, query: '430' }).map(b => b.internalBatchNo)).toEqual(['430'])
    expect(filterHistory(rows, { ...opts, query: 'animex' }).map(b => b.internalBatchNo)).toEqual(['430'])
    expect(filterHistory(rows, { ...opts, query: 'dp/77' }).map(b => b.internalBatchNo)).toEqual(['464'])
  })

  it('szukanie jest niewrażliwe na wielkość liter', () => {
    const out = filterHistory(rows, { period: 0, query: 'DROB-POL', today: '2026-08-06' })
    expect(out).toHaveLength(2)
  })

  it('dostawa bez daty przyjęcia nie znika przy filtrze okresu', () => {
    const out = filterHistory([batch({ internalBatchNo: 'Z', receivedDate: '' })],
      { period: 30, today: '2026-08-06' })
    expect(out).toHaveLength(1)
  })
})

describe('deliveryStatusBadgeKey', () => {
  it('rozbiór — etykiety rozbiorowe', () => {
    expect(deliveryStatusBadgeKey('awaiting', true)).toBe('delivery_awaiting_deboning')
    expect(deliveryStatusBadgeKey('in_progress', true)).toBe('delivery_in_progress_deboning')
    expect(deliveryStatusBadgeKey('processed', true)).toBe('delivery_processed_deboning')
  })

  it('bez rozbioru — etykiety magazynowe', () => {
    expect(deliveryStatusBadgeKey('awaiting', false)).toBe('delivery_awaiting_stock')
    expect(deliveryStatusBadgeKey('in_progress', false)).toBe('delivery_in_progress_stock')
    expect(deliveryStatusBadgeKey('processed', false)).toBe('delivery_processed_stock')
  })

  it('anulowana ma jeden klucz niezależnie od rodzaju surowca', () => {
    expect(deliveryStatusBadgeKey('cancelled', true)).toBe('delivery_cancelled')
    expect(deliveryStatusBadgeKey('cancelled', false)).toBe('delivery_cancelled')
  })
})

describe('liveSummary', () => {
  it('liczy dostawy i sumuje pozostałe kilogramy', () => {
    const out = liveSummary([
      batch({ kgAvailable: '1485.000' }),
      batch({ kgAvailable: 515 }),
    ])
    expect(out).toEqual({ count: 2, kg: 2000 })
  })

  it('pusty obieg to zero, nie NaN', () => {
    expect(liveSummary([])).toEqual({ count: 0, kg: 0 })
  })
})

describe('pluralDostawy', () => {
  it('odmienia po polsku', () => {
    expect(pluralDostawy(1)).toBe('dostawa')
    expect(pluralDostawy(2)).toBe('dostawy')
    expect(pluralDostawy(4)).toBe('dostawy')
    expect(pluralDostawy(5)).toBe('dostaw')
    expect(pluralDostawy(0)).toBe('dostaw')
    expect(pluralDostawy(12)).toBe('dostaw')
    expect(pluralDostawy(22)).toBe('dostawy')
    expect(pluralDostawy(21)).toBe('dostaw')
    expect(pluralDostawy(101)).toBe('dostaw')
  })
})
