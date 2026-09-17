import { describe, it, expect } from 'vitest'
import { spiceVerdict, scaleIngredients, waterOf } from './spiceCheck'

describe('spiceVerdict', () => {
  it('trafienie w tolerancji 0,05 kg przechodzi', () => {
    expect(spiceVerdict(3.5, 3.5)).toBe('ok')
    expect(spiceVerdict(3.5, 3.54)).toBe('ok')
    expect(spiceVerdict(3.5, 3.46)).toBe('ok')
  })

  it('za mało i za dużo są rozpoznane osobno', () => {
    expect(spiceVerdict(3.5, 3.2)).toBe('low')
    expect(spiceVerdict(3.5, 3.7)).toBe('over')
  })

  it('granica tolerancji należy do trafienia', () => {
    expect(spiceVerdict(3.5, 3.55)).toBe('ok')
    expect(spiceVerdict(3.5, 3.45)).toBe('ok')
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
