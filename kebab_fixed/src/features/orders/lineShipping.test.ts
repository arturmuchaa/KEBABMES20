import { describe, it, expect } from 'vitest'
import { naMagazynie, wydane, pokryte, zostaloDoZrobienia, wydaneWCalosci } from './lineShipping'

describe('stan pozycji zamówienia', () => {
  it('nic nie zrobione', () => {
    expect(pokryte({ qty: 60 })).toBe(0)
    expect(zostaloDoZrobienia({ qty: 60 })).toBe(60)
  })

  it('leży na magazynie', () => {
    const l = { qty: 60, qtyStock: 20, qtyDelivered: 0 }
    expect(naMagazynie(l)).toBe(20)
    expect(zostaloDoZrobienia(l)).toBe(40)
    expect(wydaneWCalosci(l)).toBe(false)
  })

  it('towar sprzedany komuś innemu nie pokrywa pozycji', () => {
    // Zniknął z magazynu, na zamówieniu nie ma po nim śladu.
    const l = { qty: 60, qtyStock: 0, qtyDelivered: 0 }
    expect(pokryte(l)).toBe(0)
    expect(zostaloDoZrobienia(l)).toBe(60)
  })

  it('wydane temu klientowi liczy się jako zrobione — nie robimy tego drugi raz', () => {
    const l = { qty: 60, qtyStock: 0, qtyDelivered: 60 }
    expect(pokryte(l)).toBe(60)
    expect(zostaloDoZrobienia(l)).toBe(0)
    expect(wydaneWCalosci(l)).toBe(true)
  })

  it('połowa wydana, połowa leży', () => {
    const l = { qty: 60, qtyStock: 30, qtyDelivered: 30 }
    expect(pokryte(l)).toBe(60)
    expect(wydaneWCalosci(l)).toBe(false)
    expect(wydane(l)).toBe(30)
  })

  it('stare dane bez rozbicia liczą się po qtyDone', () => {
    expect(pokryte({ qty: 60, qtyDone: 40 })).toBe(40)
  })

  it('pozycja bez sztuk nie udaje wydanej', () => {
    expect(wydaneWCalosci({ qty: 0, qtyDelivered: 0 })).toBe(false)
  })
})
