/**
 * Nazwa wyrobu na WZ.
 *
 * WZ/74/08/26 dla VATANA drukowała „KEBAB YAPRAK YAPRAK 20kg": rodzaj
 * nazywa się KEBAB YAPRAK, receptura YAPRAK. Receptury nie wolno jednak
 * pomijać zawsze — „KIRMIZI 25kg" to i KEBAB MIX 95/5, i KEBAB UDO 100%.
 */
import { describe, it, expect } from 'vitest'
import {
  bezPowtorzonychSlow, recepturaJestPowtorzeniem, zlozNazweWyrobu,
} from './nazwaWyrobu'

describe('recepturaJestPowtorzeniem', () => {
  it('receptura zawarta w nazwie rodzaju nic nie wnosi', () => {
    expect(recepturaJestPowtorzeniem('KEBAB YAPRAK', 'YAPRAK')).toBe(true)
  })

  it('receptura odróżniająca produkty ZOSTAJE', () => {
    expect(recepturaJestPowtorzeniem('KEBAB MIX 95/5', 'KIRMIZI')).toBe(false)
    expect(recepturaJestPowtorzeniem('KEBAB UDO 100%', 'BEYAZ AFIYET')).toBe(false)
  })

  it('pusta receptura nie ma czego wnosić', () => {
    expect(recepturaJestPowtorzeniem('KEBAB YAPRAK', '')).toBe(true)
    expect(recepturaJestPowtorzeniem('KEBAB YAPRAK', null)).toBe(true)
  })

  it('wielkość liter nie ma znaczenia', () => {
    expect(recepturaJestPowtorzeniem('Kebab Yaprak', 'yaprak')).toBe(true)
  })
})

describe('zlozNazweWyrobu', () => {
  it('nie powtarza receptury zawartej w rodzaju', () => {
    expect(zlozNazweWyrobu('KEBAB YAPRAK', 'YAPRAK')).toBe('KEBAB YAPRAK')
  })

  it('trzyma rodzaj PRZED recepturą', () => {
    expect(zlozNazweWyrobu('KEBAB MIX 95/5', 'KIRMIZI')).toBe('KEBAB MIX 95/5 KIRMIZI')
  })

  it('sam rodzaj wystarczy', () => {
    expect(zlozNazweWyrobu('KEBAB UDO 100%', '')).toBe('KEBAB UDO 100%')
  })

  it('bez rodzaju zostaje receptura, a nie pusty napis', () => {
    expect(zlozNazweWyrobu('', 'KIRMIZI')).toBe('KIRMIZI')
    expect(zlozNazweWyrobu('', '')).toBe('Wyrób')
  })
})

describe('bezPowtorzonychSlow', () => {
  it('zwija powtórzenie w nazwie zapisanej wcześniej', () => {
    expect(bezPowtorzonychSlow('KEBAB YAPRAK YAPRAK 20kg')).toBe('KEBAB YAPRAK 20kg')
  })

  it('nie rusza nazwy bez powtórzenia', () => {
    expect(bezPowtorzonychSlow('KEBAB MIX 95/5 KIRMIZI 25kg'))
      .toBe('KEBAB MIX 95/5 KIRMIZI 25kg')
  })

  it('zwija tylko SĄSIEDZTWO', () => {
    // To samo słowo wracające dalej w nazwie nie jest pomyłką sklejania.
    expect(bezPowtorzonychSlow('MIX KIRMIZI MIX')).toBe('MIX KIRMIZI MIX')
  })

  it('pusta nazwa nie wywraca funkcji', () => {
    expect(bezPowtorzonychSlow('')).toBe('')
    expect(bezPowtorzonychSlow(undefined)).toBe('')
  })
})
