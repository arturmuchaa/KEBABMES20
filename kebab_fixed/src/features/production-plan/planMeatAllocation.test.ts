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
  batchIdsFromAllocation,
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

describe('allocatePlanMeat — resztka ZOSTAJE w partii (bez łączenia)', () => {
  // Sztuki z resztek kilku partii nie tworzymy: PM odpada (brak zapisu
  // w HACCP), a numer „a/b" znaczy już wyrób z dwóch rodzajów mięsa
  // (udo/filet, indyk). Do czasu ustalenia zapisu — resztka zostaje.
  it('1 kg + 19 kg NIE składa sztuki 20 kg', () => {
    const res = allocatePlanMeat(
      [{ qty: '1', kgPerUnit: '20', seasonedBatchIds: ['A', 'B'] }],
      [batch('A', 1), batch('B', 19)],
    )
    expect(res.lines[0].ok).toBe(false)
    expect(res.lines[0].pieces).toBe(0)
    expect(res.lines[0].joined).toEqual([])
    // mięso NIETKNIĘTE — planista dokłada kolejną partię
    expect(res.freeByBatch.A).toBe(1)
    expect(res.freeByBatch.B).toBe(19)
  })

  it('resztka poniżej masy sztuki zostaje w partii', () => {
    // 25 kg: A daje 1 całą szt (20 kg), 5 kg zostaje w partii
    const res = allocatePlanMeat(
      [{ qty: '2', kgPerUnit: '20', seasonedBatchIds: ['A', 'B'] }],
      [batch('A', 25), batch('B', 100)],
    )
    expect(res.lines[0].pieces).toBe(2)
    expect(res.lines[0].perBatch.map(b => [b.batchNo, b.pieces])).toEqual([['A', 1], ['B', 1]])
    expect(res.freeByBatch.A).toBe(5)
    expect(res.freeByBatch.B).toBe(80)
  })

  it('REALNY PRZYPADEK 13.08: maksimum to CAŁE sztuki, reszta jako brak', () => {
    // 1486,2 + 1238,5 + 247,7 kg przy sztuce 30 kg → 49+41+8 = 98 szt.
    // 99. sztuki nie ma z czego złożyć: 16,2+8,5+7,7 kg zostaje w partiach.
    const res = allocatePlanMeat(
      [{ qty: '99', kgPerUnit: '30', seasonedBatchIds: ['471', '472', 'PP12'] }],
      [batch('471', 1486.2), batch('472', 1238.5), batch('PP12', 247.7)],
    )
    const l = res.lines[0]
    expect(l.pieces).toBe(98)
    expect(l.missingPieces).toBe(1)
    expect(l.joined).toEqual([])
    expect(l.perBatch.map(b => [b.batchNo, b.pieces])).toEqual([
      ['471', 49], ['472', 41], ['PP12', 8],
    ])
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

describe('batchIdsFromAllocation', () => {
  it('czyta wszystkie partie pozycji, nie tylko główną', () => {
    // REGRESJA 13.08: po kliknięciu ołówka pozycja wielopartyjna gubiła
    // wszystkie partie poza główną i pokazywała „brakuje mięsa"
    expect(batchIdsFromAllocation({
      '55U': { pieces: 8, kg: 240, batch_id: 'id-55U' },
      '472': { pieces: 51, kg: 1530, batch_id: 'id-472' },
    }, ['55U', '472'])).toEqual(['id-55U', 'id-472'])
  })

  it('wyciąga partie ze sztuki z resztek (kubełek parts)', () => {
    expect(batchIdsFromAllocation({
      '472': { pieces: 51, kg: 1530, batch_id: 'id-472' },
      '55U/472': { pieces: 1, kg: 30, parts: {
        '55U': { kg: 7.7, batch_id: 'id-55U' },
        '472': { kg: 22.3, batch_id: 'id-472' },
      } },
    }, ['472', '55U/472'])).toEqual(['id-472', 'id-55U'])
  })

  it('KOLEJNOŚĆ z seasoned_batch_nos, nie z kluczy JSON', () => {
    // JS stawia klucze liczbowopodobne („472") przed tekstowymi („55U"),
    // więc bez podanej kolejności przydział szedłby inną trasą niż zapisany
    const alloc = {
      '55U': { pieces: 8, batch_id: 'id-55U' },
      '472': { pieces: 51, batch_id: 'id-472' },
    }
    expect(Object.keys(alloc)).toEqual(['472', '55U'])          // tak widzi to JS
    expect(batchIdsFromAllocation(alloc, ['55U', '472'])).toEqual(['id-55U', 'id-472'])
  })

  it('nie dubluje partii występującej w kilku kubełkach', () => {
    expect(batchIdsFromAllocation({
      '470': { pieces: 5, batch_id: 'a' },
      '470/472': { pieces: 1, parts: { '470': { batch_id: 'a' }, '472': { batch_id: 'b' } } },
    })).toEqual(['a', 'b'])
  })

  it('pusta albo wadliwa alokacja nie wywraca formularza', () => {
    expect(batchIdsFromAllocation({})).toEqual([])
    expect(batchIdsFromAllocation(null)).toEqual([])
    expect(batchIdsFromAllocation({ x: null, y: 'nie-obiekt' } as any)).toEqual([])
  })
})
