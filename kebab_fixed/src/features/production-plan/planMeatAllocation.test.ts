/**
 * Przydział mięsa przyprawionego do pozycji planu produkcji.
 *
 * Bug źródłowy (zgłoszenie z hali/biura): planista odznaczał partię w pozycji
 * i zaznaczał ją z powrotem — ten sam komplet partii, a system nagle pokazywał
 * „brakuje X kg", jakby kg odznaczonej partii nie wróciły do magazynu.
 *
 * Dwie przyczyny:
 *  1. ponowne zaznaczenie DOPISYWAŁO partię na KOŃCU listy, a przydział idzie
 *     po kolei — zmieniona kolejność zabierała mięso innej pozycji;
 *  2. każda pozycja liczyła dostępność tak, jakby WSZYSTKIE pozostałe brały
 *     przed nią — więc dwie pozycje potrafiły jednocześnie zgłosić ten sam
 *     brak, inaczej niż backend, który symuluje jeden przebieg po kolei.
 */
import { describe, it, expect } from 'vitest'
import {
  allocatePlanMeat,
  lineBatchIds,
  toggleBatchSelection,
} from './planMeatAllocation'

const batch = (id: string, kgFree: number) => ({ id, batchNo: id, kgFree })

describe('toggleBatchSelection', () => {
  const fefo = ['A', 'B', 'C']

  it('dodaje partię w kolejności FEFO, nie na końcu listy', () => {
    expect(toggleBatchSelection(['B'], 'A', fefo)).toEqual(['A', 'B'])
  })

  it('odznaczenie usuwa partię', () => {
    expect(toggleBatchSelection(['A', 'B'], 'A', fefo)).toEqual(['B'])
  })

  it('odznaczenie i ponowne zaznaczenie wraca do TEGO SAMEGO stanu', () => {
    const start = ['A', 'B']
    const off = toggleBatchSelection(start, 'A', fefo)
    const on = toggleBatchSelection(off, 'A', fefo)
    expect(on).toEqual(start)
  })

  it('partie spoza listy FEFO nie giną — lądują na końcu', () => {
    expect(toggleBatchSelection(['X'], 'B', fefo)).toEqual(['B', 'X'])
  })
})

describe('lineBatchIds', () => {
  it('woli listę partii', () => {
    expect(lineBatchIds({ qty: '1', kgPerUnit: '1', seasonedBatchIds: ['A', 'B'], seasonedBatchId: 'A' }))
      .toEqual(['A', 'B'])
  })
  it('spada na pojedynczą partię, gdy lista pusta', () => {
    expect(lineBatchIds({ qty: '1', kgPerUnit: '1', seasonedBatchIds: [], seasonedBatchId: 'A' }))
      .toEqual(['A'])
  })
  it('brak partii = pusta lista', () => {
    expect(lineBatchIds({ qty: '1', kgPerUnit: '1' })).toEqual([])
  })
})

describe('allocatePlanMeat — całe sztuki z jednej partii (bez PM)', () => {
  it('sztuka NIE jest składana z resztek dwóch partii', () => {
    // 1 kg + 19 kg = 20 kg, ale żadna partia nie ma całych 20 kg na sztukę
    const res = allocatePlanMeat(
      [{ qty: '1', kgPerUnit: '20', seasonedBatchIds: ['A', 'B'] }],
      [batch('A', 1), batch('B', 19)],
    )
    expect(res.lines[0].pieces).toBe(0)
    expect(res.lines[0].ok).toBe(false)
    expect(res.lines[0].missingPieces).toBe(1)
  })

  it('resztka poniżej sztuki zostaje w partii, reszta idzie z następnej', () => {
    // 25 kg: A daje 1 szt (20 kg), zostaje 5 kg; brakującą sztukę daje B
    const res = allocatePlanMeat(
      [{ qty: '2', kgPerUnit: '20', seasonedBatchIds: ['A', 'B'] }],
      [batch('A', 25), batch('B', 100)],
    )
    expect(res.lines[0].pieces).toBe(2)
    expect(res.lines[0].perBatch).toEqual([
      { batchId: 'A', batchNo: 'A', pieces: 1, kg: 20 },
      { batchId: 'B', batchNo: 'B', pieces: 1, kg: 20 },
    ])
    expect(res.freeByBatch.A).toBe(5)
    expect(res.freeByBatch.B).toBe(80)
  })

  it('nie bierze więcej niż potrzeba', () => {
    const res = allocatePlanMeat(
      [{ qty: '2', kgPerUnit: '40', seasonedBatchIds: ['A'] }],
      [batch('A', 1000)],
    )
    expect(res.lines[0].allocatedKg).toBe(80)
    expect(res.freeByBatch.A).toBe(920)
  })
})

describe('allocatePlanMeat — jeden wspólny przebieg po pozycjach', () => {
  it('pozycje nie zabierają sobie tego samego mięsa dwa razy', () => {
    // 100 kg wolne, dwie pozycje po 100 kg → dokładnie JEDNA jest krótka
    const res = allocatePlanMeat(
      [
        { qty: '1', kgPerUnit: '100', seasonedBatchIds: ['A'] },
        { qty: '1', kgPerUnit: '100', seasonedBatchIds: ['A'] },
      ],
      [batch('A', 100)],
    )
    expect(res.lines[0].ok).toBe(true)
    expect(res.lines[1].ok).toBe(false)
    expect(res.lines[1].missingKg).toBe(100)
  })

  it('REGRESJA: odznaczenie i ponowne zaznaczenie partii nie zabiera mięsa innej pozycji', () => {
    const seasoned = [batch('A', 100), batch('B', 100)]
    const fefo = ['A', 'B']
    const lines = [
      { qty: '1', kgPerUnit: '100', seasonedBatchIds: ['A', 'B'] },
      { qty: '1', kgPerUnit: '100', seasonedBatchIds: ['B'] },
    ]
    const before = allocatePlanMeat(lines, seasoned)
    expect(before.lines.every(l => l.ok)).toBe(true)

    // planista odznacza A w pozycji 1 i zaznacza z powrotem
    const off = toggleBatchSelection(lines[0].seasonedBatchIds, 'A', fefo)
    const on = toggleBatchSelection(off, 'A', fefo)
    const after = allocatePlanMeat(
      [{ ...lines[0], seasonedBatchIds: on }, lines[1]],
      seasoned,
    )
    expect(after.lines.map(l => l.ok)).toEqual([true, true])
    expect(after).toEqual(before)
  })

  it('wolne kg partii schodzą o to, co wzięły pozycje', () => {
    const res = allocatePlanMeat(
      [{ qty: '3', kgPerUnit: '40', seasonedBatchIds: ['A'] }],
      [batch('A', 251.7)],
    )
    expect(res.lines[0].pieces).toBe(3)
    expect(res.freeByBatch.A).toBeCloseTo(131.7, 3)
  })

  it('pozycja bez partii nie rusza puli i nie jest liczona jako brak', () => {
    const res = allocatePlanMeat(
      [{ qty: '5', kgPerUnit: '40', seasonedBatchIds: [] }],
      [batch('A', 1000)],
    )
    expect(res.freeByBatch.A).toBe(1000)
    expect(res.lines[0].hasBatches).toBe(false)
    expect(res.lines[0].ok).toBe(true)
  })

  it('nieznana partia w pozycji nie wywraca przydziału', () => {
    const res = allocatePlanMeat(
      [{ qty: '1', kgPerUnit: '40', seasonedBatchIds: ['ZNIKNIETA', 'A'] }],
      [batch('A', 100)],
    )
    expect(res.lines[0].pieces).toBe(1)
  })
})
