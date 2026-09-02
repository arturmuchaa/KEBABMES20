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

// ── Tuleje standardowe vs niestandardowe ───────────────────────────
//
// Właściciel (2026-09-02): „metal 80cm nie jest standardem i je bym chciał
// mieć PO standardowych od 45cm-65cm". Kolejność w grupie receptury:
// najpierw tuleje 45-65 cm wg kg malejąco, potem 70 cm i wyżej wg kg malejąco.
const NAZWY: Record<string, string> = {
  m45: 'METAL 45CM', m50: 'METAL 50CM', m60: 'METAL 60CM', m65: 'METAL 65CM',
  m75: 'METAL 75CM', m80: 'METAL 80CM',
  k60: 'KARTON 60CM', k65: 'KARTON 65CM',
  folia: 'Folia stretch',
}
const tuleja = (id: string) => NAZWY[id]

/** Pozycja z tuleją. */
const t = (recipeId: string, kgPerUnit: number, packagingId: string): LineForm => ({
  productTypeId: 'pt-udo', recipeId, packagingId,
  qty: '1', kgPerUnit: String(kgPerUnit), notes: '',
} as LineForm)

const opis = (ls: LineForm[]) => ls.map(x => `${x.kgPerUnit}/${NAZWY[x.packagingId] ?? '—'}`)

describe('sortOrderLines — tuleje', () => {
  it('niestandardowe (75, 80) idą PO standardowych, mimo wyższych kg', () => {
    const out = sortOrderLines([
      t('kirmizi', 80, 'm80'),   // najcięższa, ale niestandardowa
      t('kirmizi', 50, 'm65'),
      t('kirmizi', 25, 'm50'),
    ], tuleja)
    expect(opis(out)).toEqual(['50/METAL 65CM', '25/METAL 50CM', '80/METAL 80CM'])
  })

  it('w grupie niestandardowej też kg malejąco', () => {
    const out = sortOrderLines([
      t('kirmizi', 20, 'm75'), t('kirmizi', 40, 'm80'), t('kirmizi', 50, 'm65'),
    ], tuleja)
    expect(opis(out)).toEqual(['50/METAL 65CM', '40/METAL 80CM', '20/METAL 75CM'])
  })

  it('granice 45 i 65 są STANDARDOWE', () => {
    const out = sortOrderLines([
      t('kirmizi', 10, 'm80'), t('kirmizi', 5, 'm45'), t('kirmizi', 5, 'm65'),
    ], tuleja)
    expect(opis(out)).toEqual(['5/METAL 45CM', '5/METAL 65CM', '10/METAL 80CM'])
  })

  it('KARTON i METAL tego samego rozmiaru są tak samo standardowe', () => {
    const out = sortOrderLines([
      t('kirmizi', 30, 'k60'), t('kirmizi', 40, 'm60'),
    ], tuleja)
    expect(opis(out)).toEqual(['40/METAL 60CM', '30/KARTON 60CM'])
  })

  it('równe kg w grupie standardowej zostają w kolejności wpisania', () => {
    const out = sortOrderLines([
      t('kirmizi', 40, 'm60'), t('kirmizi', 40, 'm65'),
    ], tuleja)
    expect(opis(out)).toEqual(['40/METAL 60CM', '40/METAL 65CM'])
  })

  it('podział na tuleje działa WEWNĄTRZ receptury, nie ponad nią', () => {
    const out = sortOrderLines([
      t('kirmizi', 50, 'm65'), t('kirmizi', 40, 'm80'),
      t('beyaz', 30, 'm65'),   t('beyaz', 20, 'm80'),
    ], tuleja)
    expect(opis(out)).toEqual([
      '50/METAL 65CM', '40/METAL 80CM',   // cała receptura KIRMIZI
      '30/METAL 65CM', '20/METAL 80CM',   // potem BEYAZ
    ])
  })

  it('pozycja bez tulei nie wywraca sortowania', () => {
    const out = sortOrderLines([
      t('kirmizi', 10, 'brak'), t('kirmizi', 50, 'm65'),
    ], tuleja)
    expect(out).toHaveLength(2)
    expect(out[0].kgPerUnit).toBe('50')
  })

  it('bez podanych nazw tulei sortuje jak dawniej — po samych kg', () => {
    const out = sortOrderLines([t('kirmizi', 20, 'm65'), t('kirmizi', 80, 'm80')])
    expect(out.map(x => x.kgPerUnit)).toEqual(['80', '20'])
  })
})
