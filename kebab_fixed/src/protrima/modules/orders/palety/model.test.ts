import { describe, it, expect } from 'vitest'
import { bezPalety, bledyPalety, edytowalna, pozostalo, rozpisz, sztukNaPalete, wykryjSztuki, zDodanymi, zZmieniona, type PozycjaLite } from './model'
import type { OrderPallet } from '@/lib/api'

const L: PozycjaLite[] = [
  { id: 'a', lp: 1, recipe: 'KIRMIZI', recipeId: 'k', kgPerUnit: 40, qty: 20 },
  { id: 'b', lp: 2, recipe: 'KIRMIZI', recipeId: 'k', kgPerUnit: 30, qty: 30 },
  { id: 'c', lp: 3, recipe: 'BEYAZ', recipeId: 'b', kgPerUnit: 25, qty: 10 },
]
const P: OrderPallet[] = [
  { id: 'p1', palletNo: 1, cartonNo: '000634', notes: 'n1', status: 'packed', items: [{ orderLineId: 'a', qty: 20 }] },
  { id: 'p3', palletNo: 3, cartonNo: '000645', notes: '', status: 'created', items: [{ orderLineId: 'b', qty: 10 }] },
]

describe('palety — zapis po tożsamości', () => {
  it('pozostało do rozpisania, z pominięciem edytowanej palety', () => {
    expect(pozostalo(L, P)).toEqual({ a: 0, b: 20, c: 10 })
    expect(pozostalo(L, P, 'p3')).toEqual({ a: 0, b: 30, c: 10 })
  })
  it('nowe palety: numer 0 (nada serwer), istniejące z id i numerem bez zmian', () => {
    const s = zDodanymi(P, [{ items: [{ lineId: 'c', qty: 10 }, { lineId: 'b', qty: 0 }] }])
    expect(s.map(p => [p.id, p.palletNo])).toEqual([['p1', 1], ['p3', 3], [undefined, 0]])
    expect(s[2].items).toEqual([{ orderLineId: 'c', qty: 10 }])
    expect(s[0].notes).toBe('n1')
  })
  it('zmiana zawartości nie rusza numeru; usunięcie nie przenumerowuje pozostałych', () => {
    const z = zZmieniona(P, 'p3', [{ lineId: 'b', qty: 12 }])
    expect(z.map(p => [p.id, p.palletNo])).toEqual([['p1', 1], ['p3', 3]])
    expect(z[1].items).toEqual([{ orderLineId: 'b', qty: 12 }])
    expect(bezPalety(P, 'p1').map(p => [p.id, p.palletNo])).toEqual([['p3', 3]])
    expect(() => zZmieniona(P, 'zniknela', [])).toThrow(/odśwież/)
  })
  it('paleta spakowana jest nietykalna; limity ilości', () => {
    expect(edytowalna(P[0])).toBe(false)
    expect(edytowalna(P[1])).toBe(true)
    expect(bledyPalety([{ lineId: 'b', qty: 21 }, { lineId: 'c', qty: 2.5 }], pozostalo(L, P))).toEqual({ b: 'Zostało do rozpisania 20 szt.', c: 'Wpisz liczbę całkowitą sztuk większą od zera.' })
  })
})

describe('rozpis automatyczny — jak pakuje biuro', () => {
  const poz = (id: string, lp: number, rec: string, kgU: number, qty: number, tul = 'METAL 65CM'): PozycjaLite => ({ id, lp, recipe: rec, recipeId: rec, kgPerUnit: kgU, qty, product: 'UDO', packaging: tul })
  const opis = (plan: ReturnType<typeof rozpisz>) => plan.map(p => p.items.map(i => `${i.lineId}${i.qty}`).join('+'))
  it('pełne palety wg standardu sztuk: 60×12, 40×20, 15×60, 10×80', () => {
    const L2 = [poz('a', 1, 'K', 60, 24), poz('b', 2, 'K', 40, 40), poz('c', 3, 'K', 15, 60), poz('d', 4, 'K', 10, 80)]
    expect(opis(rozpisz(L2, { a: 24, b: 40, c: 60, d: 80 }))).toEqual(['a12', 'a12', 'b20', 'b20', 'c60', 'd80'])
  })
  it('resztki tej samej receptury i rodzaju razem (różne tuleje) — jak YALCIN P1: 20×30 + 15×20 = 900 kg', () => {
    const plan = rozpisz([poz('a', 1, 'AFIYET', 30, 20, 'METAL 65CM'), poz('b', 2, 'AFIYET', 20, 15, 'METAL 60CM')], { a: 20, b: 15 })
    expect(opis(plan)).toEqual(['a20+b15'])
    expect(plan[0]).toMatchObject({ kg: 900, mieszana: false })
  })
  it('różne receptury mieszane dopiero na końcu i tylko w limicie 950 kg', () => {
    const L3 = [poz('a', 1, 'K', 40, 25), poz('b', 2, 'B', 20, 10)]   // reszta: 5×40 = 200, 10×20 = 200
    expect(opis(rozpisz(L3, { a: 25, b: 10 }))).toEqual(['a20', 'a5+b10'])
    expect(rozpisz(L3, { a: 25, b: 10 })[1].mieszana).toBe(true)
    expect(opis(rozpisz(L3, { a: 25, b: 10 }, { mieszane: false }))).toEqual(['a20', 'a5', 'b10'])
  })
  it('25 kg: standard 35, w oknie można wybrać 30', () => {
    const L4 = [poz('a', 1, 'K', 25, 60)]
    expect(opis(rozpisz(L4, { a: 60 }))).toEqual(['a35', 'a25'])
    expect(opis(rozpisz(L4, { a: 60 }, { nadpisz: { '25': 30 } }))).toEqual(['a30', 'a30'])
  })
  it('nietypowa waga: ok. 900 kg na paletę; wszystko rozpisane, nic ponad limit z resztek', () => {
    expect(sztukNaPalete(70)).toBe(10)
    expect(sztukNaPalete(35)).toBe(25)
    expect(sztukNaPalete(35, { '35': 20 })).toBe(20)
    expect(sztukNaPalete(45)).toBe(20)
    const L5 = [poz('a', 1, 'K', 45, 60), poz('b', 2, 'B', 7, 100)]
    const plan = rozpisz(L5, { a: 60, b: 100 })
    const suma = (id: string) => plan.flatMap(p => p.items).filter(i => i.lineId === id).reduce((x, i) => x + i.qty, 0)
    expect([suma('a'), suma('b')]).toEqual([60, 100])
  })
})

describe('wykrywanie wariantu 25 kg / 35 kg', () => {
  const poz = (id: string, kgU: number, qty: number): PozycjaLite => ({ id, lp: 1, recipe: 'K', recipeId: 'K', kgPerUnit: kgU, qty })
  it('z palet już rozpisanych w zamówieniu', () => {
    expect(wykryjSztuki([poz('a', 35, 100)], [{ items: [{ lineId: 'a', qty: 20 }] }])).toEqual({ '35': 20 })
    expect(wykryjSztuki([poz('a', 25, 70)], [{ items: [{ lineId: 'a', qty: 30 }] }, { items: [{ lineId: 'a', qty: 35 }] }, { items: [{ lineId: 'a', qty: 30 }] }])).toEqual({ '25': 30 })
  })
  it('bez palet — wariant dzielący ilość bez reszty, inaczej standard', () => {
    expect(wykryjSztuki([poz('a', 35, 60)], [])).toEqual({ '35': 20 })     // 60 = 3×20, nie dzieli się przez 25
    expect(wykryjSztuki([poz('a', 35, 75)], [])).toEqual({ '35': 25 })
    expect(wykryjSztuki([poz('a', 25, 90)], [])).toEqual({ '25': 30 })
    expect(wykryjSztuki([poz('a', 35, 100)], [])).toEqual({ '35': 25 })    // dzielą oba → standard
    expect(wykryjSztuki([poz('a', 25, 47)], [])).toEqual({ '25': 35 })     // żaden → standard
    expect(wykryjSztuki([poz('a', 40, 47)], [])).toEqual({})
  })
})
