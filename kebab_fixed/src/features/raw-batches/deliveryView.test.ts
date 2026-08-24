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
  resolveDelivery,
  liveSummary,
  pluralDostawy,
  type DeliveryLike,
  type MeatStockMap,
} from './deliveryView'

/** Ćwiartka — stan żyje w raw_batches. */
const CWIARTKA = { requiresDeboning: true }

/** Anulowana dostawa tak wygląda w bazie: numer podmieniony na ANUL-<id>,
 *  pierwotny numer zostaje wyłącznie w internal_batch_seq. */
const ANUL = 'ANUL-370da2b718c2490fb080'

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
    const { live, history } = splitDeliveries([batch({ kgAvailable: 250 })], CWIARTKA)
    expect(live).toHaveLength(1)
    expect(history).toHaveLength(0)
  })

  it('dostawa rozliczona trafia do historii', () => {
    const { live, history } = splitDeliveries([batch({ kgAvailable: 0 })], CWIARTKA)
    expect(live).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('anulowana trafia do historii nawet z resztą kg', () => {
    const { live, history } = splitDeliveries([
      batch({ status: 'cancelled', kgAvailable: 800 }),
    ], CWIARTKA)
    expect(live).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('zachowuje kolejność wejściową w obu koszykach', () => {
    const { live, history } = splitDeliveries([
      batch({ internalBatchNo: '1', kgAvailable: 10 }),
      batch({ internalBatchNo: '2', kgAvailable: 0 }),
      batch({ internalBatchNo: '3', kgAvailable: 20 }),
      batch({ internalBatchNo: '4', kgAvailable: 0 }),
    ], CWIARTKA)
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
    ], CWIARTKA)
    expect(out).toEqual({ count: 2, kg: 2000 })
  })

  it('pusty obieg to zero, nie NaN', () => {
    expect(liveSummary([], CWIARTKA)).toEqual({ count: 0, kg: 0 })
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

// ─── Anulowana dostawa: numer w bazie ≠ numer na ekranie ──────────────────────

describe('anulowana dostawa (ANUL-<id>)', () => {
  const anul = batch({ internalBatchNo: ANUL, internalBatchSeq: 432, status: 'cancelled' })

  it('szukajka znajduje ją po numerze POKAZANYM w tabeli', () => {
    const out = filterHistory([anul], { period: 0, showCancelled: true, query: '432', today: '2026-08-06' })
    expect(out).toHaveLength(1)
  })

  it('nie wywraca sortowania po numerze partii', () => {
    const out = sortDeliveries([
      anul,
      batch({ internalBatchNo: '464', internalBatchSeq: 464 }),
      batch({ internalBatchNo: '463', internalBatchSeq: 463 }),
    ], 'internalBatchNo', 'desc')
    expect(out.map(b => b.internalBatchSeq)).toEqual([464, 463, 432])
  })

  it('nie zatruwa tie-breaku przy równej dacie przyjęcia', () => {
    const day = '2026-08-06'
    const out = sortDeliveries([
      { ...anul, receivedDate: day },
      batch({ internalBatchNo: '464', internalBatchSeq: 464, receivedDate: day }),
      batch({ internalBatchNo: '463', internalBatchSeq: 463, receivedDate: day }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchSeq)).toEqual([464, 463, 432])
  })
})

describe('sortDeliveries — kierunek rosnący', () => {
  it('puste daty lądują na końcu TAKŻE przy sortowaniu rosnącym', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', receivedDate: '' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
      batch({ internalBatchNo: 'C', receivedDate: '2026-08-01' }),
    ], 'receivedDate', 'asc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['C', 'B', 'A'])
  })

  it('przy równej dacie rosnąco pierwszy jest niższy numer', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: '464', internalBatchSeq: 464, receivedDate: '2026-08-06' }),
      batch({ internalBatchNo: '463', internalBatchSeq: 463, receivedDate: '2026-08-06' }),
    ], 'receivedDate', 'asc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['463', '464'])
  })
})

// ─── Surowiec BEZ rozbioru: stan mieszka w meat_stock ─────────────────────────

describe('resolveDelivery — anulowanie ćwiartki', () => {
  it('nietknięta ćwiartka daje się anulować', () => {
    const r = resolveDelivery(batch({ kgReceived: 1000, kgAvailable: 1000 }), CWIARTKA)
    expect(r.cancellable).toBe(true)
  })

  it('napoczęta ćwiartka już nie — poszła w rozbiór', () => {
    const r = resolveDelivery(batch({ kgReceived: 1000, kgAvailable: 700 }), CWIARTKA)
    expect(r.cancellable).toBe(false)
  })
})

describe('resolveDelivery — filet i mięso z/s (bez rozbioru)', () => {
  const BS = { requiresDeboning: false }
  // Realny obraz z produkcji: 465 przyjęty dziś i nietknięty, 446 napoczęty
  // z rezerwacją planu, 435 zszedł do masowania (lot wypada z /wz/stock/raw).
  const meatStock: MeatStockMap = {
    '465': { kgAvailable: 816, kgReserved: 0,   kgInitial: 816 },
    '446': { kgAvailable: 140, kgReserved: 160, kgInitial: 300 },
  }

  it('świeży filet jest NA MAGAZYNIE, nie zużyty — mimo kg_available=0 na dostawie', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '465', internalBatchSeq: 465, kgReceived: 816, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.status).toBe('awaiting')
    expect(r.kgLeft).toBe(816)
  })

  it('napoczęty lot pokazuje wolne kg i rezerwację planu', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '446', internalBatchSeq: 446, kgReceived: 300, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.status).toBe('in_progress')
    expect(r.kgLeft).toBe(140)
    expect(r.kgReserved).toBe(160)
  })

  it('brak lotu w magazynie = wszystko zeszło do masowania', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '435', internalBatchSeq: 435, kgReceived: 210, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.status).toBe('processed')
    expect(r.kgLeft).toBe(0)
  })

  it('nigdy nie jest „nietknięta" — backend i tak blokuje edycję (jest wpis w meat_stock)', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '465', internalBatchSeq: 465, kgReceived: 816, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.untouched).toBe(false)
  })

  // Anulowanie ma WŁASNY warunek: świeżą dostawę wpisaną pod złym rodzajem
  // trzeba dać się wycofać, choć „nietknięta" jest false (prod 2026-08-14).
  it('nietknięty lot wolno anulować, mimo że dostawa nie jest „nietknięta"', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '465', internalBatchSeq: 465, kgReceived: 816, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.cancellable).toBe(true)
  })

  it('napoczęty lot z rezerwacją planu — anulować NIE wolno', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '446', internalBatchSeq: 446, kgReceived: 300, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.cancellable).toBe(false)
  })

  it('cały lot zarezerwowany, nic jeszcze nie wydane — anulować NIE wolno', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '470', internalBatchSeq: 470, kgReceived: 200, kgAvailable: 0 }),
      { ...BS, meatStock: { '470': { kgAvailable: 200, kgReserved: 200, kgInitial: 200 } } })
    expect(r.cancellable).toBe(false)
  })

  it('dostawa bez lotu (wszystko zeszło) — nie ma czego anulować', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '435', internalBatchSeq: 435, kgReceived: 210, kgAvailable: 0 }),
      { ...BS, meatStock })
    expect(r.cancellable).toBe(false)
  })

  it('sekcja W obiegu zawiera filet, który jeszcze leży', () => {
    const { live, history } = splitDeliveries([
      batch({ internalBatchNo: '465', internalBatchSeq: 465, kgReceived: 816, kgAvailable: 0 }),
      batch({ internalBatchNo: '435', internalBatchSeq: 435, kgReceived: 210, kgAvailable: 0 }),
    ], { ...BS, meatStock })
    expect(live.map(b => b.internalBatchNo)).toEqual(['465'])
    expect(history.map(b => b.internalBatchNo)).toEqual(['435'])
  })

  it('podsumowanie obiegu liczy kg z magazynu mięsa, nie z dostawy', () => {
    const out = liveSummary([
      batch({ internalBatchNo: '465', internalBatchSeq: 465, kgReceived: 816, kgAvailable: 0 }),
      batch({ internalBatchNo: '446', internalBatchSeq: 446, kgReceived: 300, kgAvailable: 0 }),
    ], { ...BS, meatStock })
    expect(out).toEqual({ count: 2, kg: 956 })
  })

  it('anulowana bez rozbioru nadal jest anulowana', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: ANUL, internalBatchSeq: 432, status: 'cancelled' }),
      { ...BS, meatStock })
    expect(r.status).toBe('cancelled')
    expect(r.cancellable).toBe(false)  // drugi raz się nie anuluje
  })
})

describe('resolveDelivery — ćwiartka (z rozbiorem)', () => {
  it('czyta stan wprost z dostawy i nie zagląda do magazynu mięsa', () => {
    const r = resolveDelivery(
      batch({ internalBatchNo: '464', internalBatchSeq: 464, kgReceived: 4305, kgAvailable: 1485 }),
      { requiresDeboning: true, meatStock: { '464': { kgAvailable: 999, kgReserved: 0, kgInitial: 999 } } })
    expect(r.kgLeft).toBe(1485)
    expect(r.status).toBe('in_progress')
  })

  it('nietknięta ćwiartka jest edytowalna', () => {
    const r = resolveDelivery(batch({ kgReceived: 1000, kgAvailable: 1000 }), CWIARTKA)
    expect(r.untouched).toBe(true)
    expect(r.status).toBe('awaiting')
  })
})

describe('sortDeliveries — kolumna „Zostało kg" bez rozbioru', () => {
  it('sortuje po stanie z magazynu mięsa, nie po zerze z dostawy', () => {
    const meatStock: MeatStockMap = {
      '465': { kgAvailable: 816, kgReserved: 0, kgInitial: 816 },
      '446': { kgAvailable: 140, kgReserved: 0, kgInitial: 300 },
    }
    const rows = [
      batch({ internalBatchNo: '446', internalBatchSeq: 446, kgAvailable: 0 }),
      batch({ internalBatchNo: '465', internalBatchSeq: 465, kgAvailable: 0 }),
    ]
    const out = sortDeliveries(rows, 'kgAvailable', 'desc', { requiresDeboning: false, meatStock })
    expect(out.map(b => b.internalBatchNo)).toEqual(['465', '446'])
  })
})

/**
 * Zakładka „Wszystko" — jedna tabela ze wszystkimi rodzajami surowca naraz.
 *
 * Numery porządkowe są wspólne dla całego zakładu, więc szukany numer bywa
 * pod innym rodzajem niż otwarta zakładka. Skoro rodzaje mieszają się
 * w jednej liście, pytanie „gdzie leży stan tej dostawy" trzeba rozstrzygać
 * per WIERSZ: ćwiartka trzyma kilogramy w dostawie, filet i mięso z/s
 * w locie magazynu mięsa.
 */
describe('requiresDeboning rozstrzygane per wiersz (zakładka Wszystko)', () => {
  const MEAT_STOCK: MeatStockMap = {
    '502': { kgAvailable: 400, kgReserved: 0, kgInitial: 400 },
  }
  /** Ćwiartka idzie na rozbiór, wszystko inne prosto na magazyn mięsa. */
  const MIESZANE = {
    requiresDeboning: (b: DeliveryLike) => (b.materialTypeId ?? 'mat-cwiartka') === 'mat-cwiartka',
    meatStock: MEAT_STOCK,
  }

  const cwiartka = batch({
    internalBatchNo: '501', internalBatchSeq: 501,
    materialTypeId: 'mat-cwiartka', kgReceived: 1000, kgAvailable: 250,
  })
  const filet = batch({
    internalBatchNo: '502', internalBatchSeq: 502,
    materialTypeId: 'mat-filet', kgReceived: 400, kgAvailable: 0,
  })

  it('ćwiartka czyta stan z dostawy', () => {
    expect(resolveDelivery(cwiartka, MIESZANE).kgLeft).toBe(250)
  })

  it('filet w tej samej liście czyta stan z lotu mięsa, nie zero z dostawy', () => {
    expect(resolveDelivery(filet, MIESZANE).kgLeft).toBe(400)
  })

  it('świeży filet nie wypada z obiegu tylko dlatego, że obok stoi ćwiartka', () => {
    const { live, history } = splitDeliveries([cwiartka, filet], MIESZANE)
    expect(live.map(b => b.internalBatchNo)).toEqual(['501', '502'])
    expect(history).toHaveLength(0)
  })

  it('podsumowanie sumuje kilogramy z właściwego źródła dla każdego rodzaju', () => {
    expect(liveSummary([cwiartka, filet], MIESZANE).kg).toBe(650)
  })

  it('sortowanie po „Zostało kg" widzi stan fileta z magazynu mięsa', () => {
    const out = sortDeliveries([cwiartka, filet], 'kgAvailable', 'desc', MIESZANE)
    expect(out.map(b => b.internalBatchNo)).toEqual(['502', '501'])
  })
})
