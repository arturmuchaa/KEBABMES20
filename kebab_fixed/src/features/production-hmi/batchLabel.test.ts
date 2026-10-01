import { describe, it, expect } from 'vitest'
import { batchLabel, batchParts } from './batchLabel'

describe('batchParts', () => {
  it('szczegóły pokazują PEŁNE rozbicie — więcej niż dwie partie, nic nie zwinięte', () => {
    expect(batchParts({
      seasonedBatchNos: ['x'],
      batchAllocation: { '472': { pieces: 2 }, 'PP13': { pieces: 6 }, 'PP14': { pieces: 3 }, 'PP15': { pieces: 0 }, '480': { pieces: 1 } },
    })).toEqual([
      // Klucze-liczby JS zwraca przed tekstowymi — liczy się komplet, nie kolejność.
      { batchNo: '472', pieces: 2 }, { batchNo: '480', pieces: 1 },
      { batchNo: 'PP13', pieces: 6 }, { batchNo: 'PP14', pieces: 3 },
    ])
  })

  it('bez rozbicia — lista partii bez sztuk', () => {
    expect(batchParts({ seasonedBatchNos: ['344', '', '355'] }))
      .toEqual([{ batchNo: '344', pieces: null }, { batchNo: '355', pieces: null }])
    expect(batchParts(null)).toEqual([])
  })
})

describe('batchLabel', () => {
  it('jedna partia to sam numer', () => {
    expect(batchLabel({ seasonedBatchNos: ['344'] })).toBe('344')
  })

  it('rozbicie pokazuje ile sztuk z której partii', () => {
    expect(batchLabel({
      batchAllocation: { '472': { pieces: 2 }, 'PP13': { pieces: 6 } },
    })).toBe('2×472 · 6×PP13')
  })

  it('rozbicie ma pierwszeństwo nad listą partii — mówi więcej', () => {
    expect(batchLabel({
      seasonedBatchNos: ['472', 'PP13'],
      batchAllocation: { '472': { pieces: 2 }, 'PP13': { pieces: 6 } },
    })).toBe('2×472 · 6×PP13')
  })

  it('przy wielu partiach skraca, żeby nie rozsadzić wiersza', () => {
    expect(batchLabel({
      batchAllocation: { a: { pieces: 1 }, b: { pieces: 2 }, c: { pieces: 3 }, d: { pieces: 4 } },
    })).toBe('1×a · 2×b +2')
  })

  it('pomija partie bez sztuk — zero to nie jest wsad', () => {
    expect(batchLabel({
      batchAllocation: { '472': { pieces: 0 }, 'PP13': { pieces: 6 } },
    })).toBe('6×PP13')
  })

  it('kilka partii bez rozbicia wypisuje po przecinku', () => {
    expect(batchLabel({ seasonedBatchNos: ['344', '355'] })).toBe('344 · 355')
  })

  it('brak partii mówi wprost, że jej nie ma', () => {
    expect(batchLabel({})).toBe('—')
    expect(batchLabel({ seasonedBatchNos: [] })).toBe('—')
    expect(batchLabel(null as any)).toBe('—')
  })

  it('znosi śmieci z API', () => {
    expect(batchLabel({ batchAllocation: 'nie-obiekt' as any, seasonedBatchNos: ['344'] })).toBe('344')
    expect(batchLabel({ seasonedBatchNos: ['', null as any, '344'] })).toBe('344')
  })
})
