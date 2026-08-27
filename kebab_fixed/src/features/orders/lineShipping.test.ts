import { describe, it, expect } from 'vitest'
import { stanPozycji, naMagazynie, zostaloDoZrobienia, domkniete } from './lineShipping'

describe('stan pozycji zamówienia', () => {
  it('nic nie zrobione', () => {
    expect(stanPozycji({ qty: 60 })).toBe('brak')
  })

  it('zrobione i leży na magazynie', () => {
    expect(stanPozycji({ qty: 60, qtyDone: 60 })).toBe('gotowe')
    expect(naMagazynie({ qty: 60, qtyDone: 60 })).toBe(60)
  })

  it('wyjechało na WZ — pozycja domknięta, nie ma czego kompletować', () => {
    const l = { qty: 60, qtyDone: 60, qtyShipped: 60 }
    expect(stanPozycji(l)).toBe('wyslane')
    expect(naMagazynie(l)).toBe(0)
    expect(domkniete(l)).toBe(true)
  })

  it('połowa wyjechała, połowa leży', () => {
    const l = { qty: 60, qtyDone: 60, qtyShipped: 30 }
    expect(stanPozycji(l)).toBe('gotowe')
    expect(naMagazynie(l)).toBe(30)
    expect(domkniete(l)).toBe(false)
  })

  it('wysłane liczy się jako zrobione — nie robimy tego drugi raz', () => {
    expect(zostaloDoZrobienia({ qty: 60, qtyDone: 30, qtyShipped: 30 })).toBe(30)
  })

  it('pozycja bez sztuk nie udaje wysłanej', () => {
    expect(stanPozycji({ qty: 0, qtyDone: 0, qtyShipped: 0 })).toBe('brak')
  })
})
