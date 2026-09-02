import { describe, expect, it } from 'vitest'
import { sortOrderLines } from './orderLineSort'
import type { LineForm } from './order-form/types'

/** Skrót do czytelnych przypadków: receptura + waga sztuki. */
const l = (recipeId: string, kgPerUnit: number, qty = 1): LineForm => ({
  productTypeId: 'pt-udo', recipeId, packagingId: '',
  qty: String(qty), kgPerUnit: String(kgPerUnit), notes: '',
} as LineForm)

/** (receptura, kg) — tożsamość wiersza widoczna dla biura. */
const ksztalt = (ls: LineForm[]) => ls.map(x => [x.recipeId, Number(x.kgPerUnit)])

describe('sortOrderLines — grupy receptur', () => {
  it('trzyma pozycje jednej receptury razem', () => {
    const out = sortOrderLines([
      l('gold', 40), l('yalcin', 30), l('gold', 25), l('yalcin', 15),
    ])
    expect(ksztalt(out)).toEqual([
      ['gold', 40], ['gold', 25], ['yalcin', 30], ['yalcin', 15],
    ])
  })

  it('grupa idzie w kolejności PIERWSZEGO wpisania, nie alfabetycznie', () => {
    const out = sortOrderLines([l('yalcin', 30), l('gold', 40)])
    expect(ksztalt(out)).toEqual([['yalcin', 30], ['gold', 40]])
  })

  it('dopisana pozycja wchodzi do swojej grupy, nie na koniec dokumentu', () => {
    // Dokładnie przypadek z biura: edycja zamówienia YALCIN, dopisana
    // pozycja pierwszej receptury lądowała za wszystkimi pozycjami drugiej.
    const out = sortOrderLines([
      l('gold', 40), l('gold', 25), l('yalcin', 30), l('gold', 10),
    ])
    expect(ksztalt(out)).toEqual([
      ['gold', 40], ['gold', 25], ['gold', 10], ['yalcin', 30],
    ])
  })

  it('cięższa pozycja dopisana do drugiej grupy NIE przerzuca jej na górę', () => {
    const out = sortOrderLines([
      l('gold', 40), l('yalcin', 30), l('yalcin', 50),
    ])
    expect(ksztalt(out)).toEqual([['gold', 40], ['yalcin', 50], ['yalcin', 30]])
  })

  it('radzi sobie z trzema recepturami', () => {
    const out = sortOrderLines([
      l('gold', 10), l('mix', 20), l('yalcin', 30), l('gold', 40), l('mix', 5),
    ])
    expect(ksztalt(out)).toEqual([
      ['gold', 40], ['gold', 10], ['mix', 20], ['mix', 5], ['yalcin', 30],
    ])
  })
})

describe('sortOrderLines — wagi w grupie', () => {
  it('sortuje malejąco po kg sztuki', () => {
    const out = sortOrderLines([l('gold', 10), l('gold', 40), l('gold', 25)])
    expect(ksztalt(out)).toEqual([['gold', 40], ['gold', 25], ['gold', 10]])
  })

  it('równe wagi zostają w kolejności wpisania (sort stabilny)', () => {
    const out = sortOrderLines([l('gold', 25, 1), l('gold', 25, 2), l('gold', 25, 3)])
    expect(out.map(x => x.qty)).toEqual(['1', '2', '3'])
  })

  it('waga z przecinkiem dziesiętnym liczy się jako liczba', () => {
    const out = sortOrderLines([
      { ...l('gold', 0), kgPerUnit: '2,5' } as LineForm,
      { ...l('gold', 0), kgPerUnit: '10' } as LineForm,
    ])
    expect(out.map(x => x.kgPerUnit)).toEqual(['10', '2,5'])
  })
})

describe('sortOrderLines — bezpieczeństwo', () => {
  it('nie gubi ani nie dubluje pozycji', () => {
    const wej = [l('gold', 40), l('yalcin', 30), l('gold', 25), l('mix', 5)]
    expect(sortOrderLines(wej)).toHaveLength(4)
  })

  it('nie modyfikuje tablicy wejściowej', () => {
    const wej = [l('yalcin', 30), l('gold', 40)]
    const kopia = ksztalt(wej)
    sortOrderLines(wej)
    expect(ksztalt(wej)).toEqual(kopia)
  })

  it('pusta lista zostaje pusta', () => {
    expect(sortOrderLines([])).toEqual([])
  })

  it('pozycja bez receptury nie wywraca sortowania', () => {
    const out = sortOrderLines([l('', 5), l('gold', 40)])
    expect(out).toHaveLength(2)
  })
})
