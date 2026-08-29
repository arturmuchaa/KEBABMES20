import { describe, expect, it } from 'vitest'
import {
  FINISHED_BATCHES_LIMIT,
  batchRequiresDeboning,
  filterDeboningBatches,
  lastFinishedBatches,
  sortMeatGroupsByExpiry,
  type MaterialTypeFlag,
} from './dashboardLists'

// Słownik rodzajów tak, jak zwraca /raw-batches/material-types.
const RODZAJE: MaterialTypeFlag[] = [
  { id: 'mat-cwiartka',      requiresDeboning: true },
  { id: 'mat-filet-kurczak', requiresDeboning: false },
  { id: 'mat-mieso-indyk',   requiresDeboning: false },
  { id: 'mat-mieso-zs',      requiresDeboning: false },
  { id: 'mat-mieso-bs',      requiresDeboning: false },
]

describe('batchRequiresDeboning', () => {
  it('ćwiartka idzie na rozbiór', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-cwiartka' }, RODZAJE)).toBe(true)
  })

  // Zgłoszenie 21.08.2026: partia 501 (mięso z/s, 3020 kg) i 497 (indyk, 311 kg)
  // wisiały na karcie rozbioru jako „→ 0 kg", bo ich mięso poszło prosto do magazynu.
  it('dostawa mięsa z/s i indyka nie idzie na rozbiór', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-mieso-zs' }, RODZAJE)).toBe(false)
    expect(batchRequiresDeboning({ materialTypeId: 'mat-mieso-indyk' }, RODZAJE)).toBe(false)
  })

  it('partia bez rodzaju to ćwiartka (dane sprzed kolumny material_type_id)', () => {
    expect(batchRequiresDeboning({}, RODZAJE)).toBe(true)
    expect(batchRequiresDeboning({ materialTypeId: '' }, RODZAJE)).toBe(true)
  })

  it('pusty słownik nie gasi karty — partie zostają widoczne', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-mieso-zs' }, [])).toBe(true)
  })

  it('rodzaj spoza słownika traktujemy jak rozbiorowy', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-wolowina' }, RODZAJE)).toBe(true)
  })
})

describe('filterDeboningBatches', () => {
  it('zdejmuje z listy dostawy bez rozbioru, resztę zostawia w kolejności', () => {
    const partie = [
      { internalBatchSeq: 499, materialTypeId: 'mat-cwiartka' },
      { internalBatchSeq: 497, materialTypeId: 'mat-mieso-indyk' },
      { internalBatchSeq: 500, materialTypeId: 'mat-cwiartka' },
      { internalBatchSeq: 501, materialTypeId: 'mat-mieso-zs' },
    ]
    expect(filterDeboningBatches(partie, RODZAJE).map(b => b.internalBatchSeq))
      .toEqual([499, 500])
  })
})

describe('lastFinishedBatches', () => {
  const historia = Array.from({ length: 40 }, (_, i) => ({ internalBatchSeq: 460 + i }))

  it('pokazuje pięć ostatnich, od najnowszej', () => {
    expect(lastFinishedBatches(historia).map(b => b.internalBatchSeq))
      .toEqual([499, 498, 497, 496, 495])
    expect(FINISHED_BATCHES_LIMIT).toBe(5)
  })

  it('krótsza historia przechodzi w całości', () => {
    expect(lastFinishedBatches([{ internalBatchSeq: 12 }, { internalBatchSeq: 9 }]))
      .toHaveLength(2)
  })

  it('nie mutuje wejścia', () => {
    const wejscie = [{ internalBatchSeq: 1 }, { internalBatchSeq: 7 }]
    lastFinishedBatches(wejscie)
    expect(wejscie.map(b => b.internalBatchSeq)).toEqual([1, 7])
  })
})

describe('sortMeatGroupsByExpiry', () => {
  it('najkrótszy termin na górze, nie największa masa', () => {
    const grupy = [
      { rawBatchNo: '500', kg: 2400, earliestExpiry: '2026-08-30' },
      { rawBatchNo: '498', kg: 310,  earliestExpiry: '2026-08-23' },
      { rawBatchNo: '499', kg: 1800, earliestExpiry: '2026-08-25' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo))
      .toEqual(['498', '499', '500'])
  })

  it('partia bez terminu ląduje na końcu', () => {
    const grupy = [
      { rawBatchNo: 'bez', kg: 9999, earliestExpiry: '' },
      { rawBatchNo: '498', kg: 100,  earliestExpiry: '2026-08-23' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo)).toEqual(['498', 'bez'])
  })

  it('ten sam termin — najpierw najniższy numer partii', () => {
    const grupy = [
      { rawBatchNo: '489', kg: 3156.5, earliestExpiry: '2026-08-25' },
      { rawBatchNo: '488', kg: 2774.0, earliestExpiry: '2026-08-25' },
      { rawBatchNo: '490', kg: 260.0,  earliestExpiry: '2026-08-25' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo))
      .toEqual(['488', '489', '490'])
  })

  // Numer partii to tekst — porównanie leksykalne postawiłoby „99" nad „501".
  it('numer partii porównywany liczbowo, nie po znakach', () => {
    const grupy = [
      { rawBatchNo: '501', kg: 100, earliestExpiry: '2026-08-25' },
      { rawBatchNo: '99',  kg: 100, earliestExpiry: '2026-08-25' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo)).toEqual(['99', '501'])
  })

  it('partia bez numeru („—") schodzi pod numerowane', () => {
    const grupy = [
      { rawBatchNo: '—',   kg: 100, earliestExpiry: '2026-08-25' },
      { rawBatchNo: '488', kg: 100, earliestExpiry: '2026-08-25' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo)).toEqual(['488', '—'])
  })
})

/**
 * Wykonanie pozycji zamówienia w rozwinięciu na pulpicie (26.08.2026).
 *
 * Rozwinięcie liczyło TYLKO z linii planów produkcji, więc wyrób dodany
 * ręcznie z biura nie pokazywał się wcale — a sekcja Zamówienia (licząca
 * z wyrobu gotowego) pokazywała go poprawnie. Ta sama pozycja miała dwie
 * różne prawdy na jednym ekranie.
 */
import { orderLineDone } from './dashboardLists'

describe('orderLineDone — ile tej pozycji faktycznie zrobiono', () => {
  it('bierze wyrób gotowy, gdy plan o niczym nie wie (wpis ręczny z biura)', () => {
    expect(orderLineDone({ zPlanow: 0, zWyrobu: 17 })).toBe(17)
  })

  it('bierze plan, gdy wyrób gotowy jeszcze nie powstał (biuro nie potwierdziło dnia)', () => {
    expect(orderLineDone({ zPlanow: 12, zWyrobu: 0 })).toBe(12)
  })

  it('NIE sumuje — po potwierdzeniu dnia te same sztuki są w obu źródłach', () => {
    expect(orderLineDone({ zPlanow: 20, zWyrobu: 20 })).toBe(20)
  })

  it('gdy źródła się różnią, wygrywa większe — praca już się wydarzyła', () => {
    expect(orderLineDone({ zPlanow: 8, zWyrobu: 20 })).toBe(20)
    expect(orderLineDone({ zPlanow: 25, zWyrobu: 20 })).toBe(25)
  })

  it('śmieci i brak danych to zero, nie NaN', () => {
    expect(orderLineDone({} as any)).toBe(0)
    expect(orderLineDone({ zPlanow: NaN as any, zWyrobu: undefined as any })).toBe(0)
  })
})

/**
 * Postęp CAŁEGO zamówienia na pulpicie (29.08.2026).
 *
 * Zgłoszenie właściciela: „TRUVA w Zamówieniach ma 100% i to prawda, a na
 * pulpicie 57%". Pulpit liczył wykonanie ze sztuk OSTEMPLOWANYCH numerem
 * zamówienia (`finished_goods.client_order_no`) plus aktywnych planów, więc
 * 230 z 534 sztuk — wyprodukowanych na magazyn, bez stempla — nie liczyło się
 * wcale. Sekcja Zamówienia liczy z pokrycia (zapas klienta + wydania) i widzi
 * je poprawnie. Nagłówek wiersza musi mówić to samo, co rozwinięcie pod nim.
 */
import { orderDoneQty } from './dashboardLists'

describe('orderDoneQty — ile sztuk zamówienia jest zrobionych', () => {
  const zam = (lines: any[]) => ({ lines })

  it('liczy z pokrycia backendu, nie ze stempla numeru zamówienia', () => {
    // TRUVA: pozycje pokryte w całości zapasem klienta, plany o nich nie wiedzą.
    const o = zam([{ id: 'a', qty: 64, qtyDone: 64 }, { id: 'b', qty: 80, qtyDone: 80 }])
    expect(orderDoneQty(o, new Map())).toBe(144)
  })

  it('bierze pracę z hali, zanim biuro potwierdzi dzień', () => {
    const o = zam([{ id: 'a', qty: 50, qtyDone: 0 }])
    expect(orderDoneQty(o, new Map([['a', 30]]))).toBe(30)
  })

  it('NIE sumuje dwóch źródeł tej samej pozycji', () => {
    const o = zam([{ id: 'a', qty: 50, qtyDone: 40 }])
    expect(orderDoneQty(o, new Map([['a', 40]]))).toBe(40)
  })

  it('nadprodukcja jednej pozycji nie zalicza innej — cap na ilości pozycji', () => {
    const o = zam([{ id: 'a', qty: 50, qtyDone: 0 }, { id: 'b', qty: 50, qtyDone: 0 }])
    expect(orderDoneQty(o, new Map([['a', 70]]))).toBe(50)
  })

  it('zamówienie bez pozycji to zero, nie NaN', () => {
    expect(orderDoneQty({ lines: [] } as any, new Map())).toBe(0)
    expect(orderDoneQty({} as any, new Map())).toBe(0)
  })
})
