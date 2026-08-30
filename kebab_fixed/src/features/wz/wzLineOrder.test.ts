/**
 * Kolejność pozycji na WZ — UDO, MIX, reszta; gramatura od największej.
 *
 * Punktem odniesienia jest WZ/76/08/26 dla TRUVY, na którym biuro pokazało
 * problem: 15 pozycji w kolejności dokładania do koszyka.
 */
import { describe, it, expect } from 'vitest'
import {
  nazwaBezGramatury, rangaRodzaju, sortujPozycjeWz,
} from './wzLineOrder'

const poz = (name: string, kg: number) => ({ name, kg_per_unit: kg })

describe('rangaRodzaju', () => {
  it('UDO idzie przed MIX, a MIX przed resztą', () => {
    expect(rangaRodzaju('KEBAB UDO 100% KIRMIZI 15kg'))
      .toBeLessThan(rangaRodzaju('KEBAB MIX 95/5 KIRMIZI 15kg'))
    expect(rangaRodzaju('KEBAB MIX 95/5 KIRMIZI 15kg'))
      .toBeLessThan(rangaRodzaju('KEBAB YAPRAK 20kg'))
  })

  it('dopasowuje SŁOWO, nie fragment', () => {
    // „MIXER" nie jest rodzajem MIX.
    expect(rangaRodzaju('KEBAB MIXER 20kg')).toBe(rangaRodzaju('KEBAB YAPRAK 20kg'))
  })

  it('pusta nazwa ląduje na końcu, a nie na początku', () => {
    expect(rangaRodzaju('')).toBeGreaterThan(rangaRodzaju('KEBAB UDO 100% 15kg'))
    expect(rangaRodzaju(undefined)).toBeGreaterThan(rangaRodzaju('KEBAB MIX 20kg'))
  })
})

describe('nazwaBezGramatury', () => {
  it('ucina końcową gramaturę', () => {
    expect(nazwaBezGramatury('KEBAB UDO 100% KIRMIZI 15kg')).toBe('KEBAB UDO 100% KIRMIZI')
    expect(nazwaBezGramatury('KEBAB MIX 95/5 KIRMIZI 12,5 kg')).toBe('KEBAB MIX 95/5 KIRMIZI')
  })

  it('nie rusza nazwy bez gramatury', () => {
    expect(nazwaBezGramatury('Kości z kurczaka')).toBe('KOŚCI Z KURCZAKA')
  })

  it('nie ucina liczby, która nie jest gramaturą', () => {
    expect(nazwaBezGramatury('KEBAB MIX 95/5')).toBe('KEBAB MIX 95/5')
  })
})

describe('sortujPozycjeWz', () => {
  it('układa dokument TRUVY tak, jak chce biuro', () => {
    const przed = [
      poz('KEBAB MIX 95/5 KIRMIZI 50kg', 50),
      poz('KEBAB UDO 100% KIRMIZI 15kg', 15),
      poz('KEBAB UDO 100% KIRMIZI 25kg', 25),
      poz('KEBAB MIX 95/5 KIRMIZI 25kg', 25),
      poz('KEBAB MIX 95/5 KIRMIZI 20kg', 20),
      poz('KEBAB UDO 100% KIRMIZI 20kg', 20),
      poz('KEBAB MIX 95/5 KIRMIZI 40kg', 40),
      poz('KEBAB MIX 95/5 KIRMIZI 30kg', 30),
      poz('KEBAB MIX 95/5 KIRMIZI 15kg', 15),
    ]
    expect(sortujPozycjeWz(przed).map(p => p.name)).toEqual([
      'KEBAB UDO 100% KIRMIZI 25kg',
      'KEBAB UDO 100% KIRMIZI 20kg',
      'KEBAB UDO 100% KIRMIZI 15kg',
      'KEBAB MIX 95/5 KIRMIZI 50kg',
      'KEBAB MIX 95/5 KIRMIZI 40kg',
      'KEBAB MIX 95/5 KIRMIZI 30kg',
      'KEBAB MIX 95/5 KIRMIZI 25kg',
      'KEBAB MIX 95/5 KIRMIZI 20kg',
      'KEBAB MIX 95/5 KIRMIZI 15kg',
    ])
  })

  it('reszta idzie po UDO i MIX', () => {
    const out = sortujPozycjeWz([
      poz('Kości z kurczaka', 0),
      poz('KEBAB MIX 95/5 20kg', 20),
      poz('KEBAB UDO 100% 20kg', 20),
    ])
    expect(out.map(p => p.name)).toEqual([
      'KEBAB UDO 100% 20kg', 'KEBAB MIX 95/5 20kg', 'Kości z kurczaka',
    ])
  })

  it('dwa różne MIX-y nie przeplatają się po gramaturze', () => {
    const out = sortujPozycjeWz([
      poz('KEBAB MIX 95/5 KIRMIZI 20kg', 20),
      poz('KEBAB MIX 70/30 KIRMIZI 30kg', 30),
      poz('KEBAB MIX 95/5 KIRMIZI 40kg', 40),
      poz('KEBAB MIX 70/30 KIRMIZI 10kg', 10),
    ])
    expect(out.map(p => p.name)).toEqual([
      'KEBAB MIX 70/30 KIRMIZI 30kg',
      'KEBAB MIX 70/30 KIRMIZI 10kg',
      'KEBAB MIX 95/5 KIRMIZI 40kg',
      'KEBAB MIX 95/5 KIRMIZI 20kg',
    ])
  })

  it('nie zmienia wejścia', () => {
    const przed = [poz('KEBAB MIX 20kg', 20), poz('KEBAB UDO 20kg', 20)]
    const kopia = [...przed]
    sortujPozycjeWz(przed)
    expect(przed).toEqual(kopia)
  })

  it('pozycje nie do odróżnienia zachowują kolejność wejściową', () => {
    const a = poz('KEBAB UDO 100% 20kg', 20)
    const b = poz('KEBAB UDO 100% 20kg', 20)
    const out = sortujPozycjeWz([a, b])
    expect(out[0]).toBe(a)
    expect(out[1]).toBe(b)
  })

  it('pusta lista nie wywraca sortowania', () => {
    expect(sortujPozycjeWz([])).toEqual([])
  })
})
