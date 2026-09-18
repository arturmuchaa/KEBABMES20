import { describe, it, expect } from 'vitest'
import { spiceVerdict, scaleIngredients, waterOf, kgNaWyjsciu } from './spiceCheck'

describe('spiceVerdict', () => {
  it('trafienie w tolerancji 100 g przechodzi', () => {
    // Działka wagi przypraw to 100 g — próg węższy byłby nieosiągalny.
    expect(spiceVerdict(3.5, 3.5)).toBe('ok')
    expect(spiceVerdict(3.5, 3.6)).toBe('ok')
    expect(spiceVerdict(3.5, 3.4)).toBe('ok')
  })

  it('za mało i za dużo są rozpoznane osobno', () => {
    expect(spiceVerdict(3.5, 3.2)).toBe('low')
    expect(spiceVerdict(3.5, 3.8)).toBe('over')
  })

  it('granica tolerancji należy do trafienia', () => {
    expect(spiceVerdict(3.5, 3.6)).toBe('ok')
    expect(spiceVerdict(3.5, 3.4)).toBe('ok')
  })

  it('poza dzialka juz nie przechodzi', () => {
    expect(spiceVerdict(3.5, 3.65)).toBe('over')
    expect(spiceVerdict(3.5, 3.35)).toBe('low')
  })
})

describe('scaleIngredients', () => {
  const receptura = [
    { ingredientName: 'BERG SERHAT', qtyPer100kg: 1.75, unit: 'kg' },
    { ingredientName: 'TRANSGLUTAMINAZA', qtyPer100kg: 0.1, unit: 'kg' },
    { ingredientName: 'Woda', qtyPer100kg: 18, unit: 'L' },
  ]

  it('przelicza recepturę ze 100 kg na wsad', () => {
    const out = scaleIngredients(receptura, 200)
    expect(out.map(i => [i.name, i.qty])).toEqual([['BERG SERHAT', 3.5], ['TRANSGLUTAMINAZA', 0.2]])
  })

  it('woda NIE idzie do pojemnika — dozuje ją dozownik przy maszynie', () => {
    expect(scaleIngredients(receptura, 200).some(i => i.unit === 'L')).toBe(false)
  })

  it('numeruje pozycje od zera, w kolejności receptury', () => {
    expect(scaleIngredients(receptura, 200).map(i => i.seq)).toEqual([0, 1])
  })

  it('zachowuje kolejność z receptury (seq steruje wsypywaniem)', () => {
    const odwrotna = [receptura[1], receptura[0]]
    expect(scaleIngredients(odwrotna, 100).map(i => i.name)).toEqual(['TRANSGLUTAMINAZA', 'BERG SERHAT'])
  })
})

describe('waterOf', () => {
  it('wyciąga litry wody na wskazany wsad', () => {
    const receptura = [
      { ingredientName: 'BERG SERHAT', qtyPer100kg: 1.75, unit: 'kg' },
      { ingredientName: 'Woda', qtyPer100kg: 18, unit: 'L' },
    ]
    expect(waterOf(receptura, 600)).toBe(108)
  })

  it('receptura bez wody daje zero', () => {
    expect(waterOf([{ ingredientName: 'JOGURT NATURALNY', qtyPer100kg: 5, unit: 'kg' }], 600)).toBe(0)
  })
})


/**
 * Ile mięsa wyjdzie z masownicy — operator widzi to PRZED startem, a ta sama
 * liczba czeka na niego przy odbiorze (właściciel 18.09.2026: „chciałbym, aby
 * operator widział, ile wyjdzie mięsa według receptury z mieszania").
 */
describe('kgNaWyjsciu', () => {
  const receptura = [
    { ingredientName: 'Przyprawa', qtyPer100kg: 6, unit: 'kg' },
    { ingredientName: 'Woda', qtyPer100kg: 18, unit: 'L' },
  ]

  it('dolicza przyprawy I wodę — to wszystko wchodzi do masownicy', () => {
    expect(kgNaWyjsciu(600, receptura)).toBe(744)
  })

  it('bez receptury zwraca samo mięso, zamiast zmyślać przyrost', () => {
    expect(kgNaWyjsciu(600, [])).toBe(600)
  })

  it('zaokrągla do dziesiątej części kilograma', () => {
    expect(kgNaWyjsciu(507, receptura)).toBe(628.7)
  })
})
