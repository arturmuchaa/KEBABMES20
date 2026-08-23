/**
 * Testy logiki terminala zamówień. Sedno modułu — dziedziczenie pozycji
 * i wędrówka kursora — nie ma prawa się zepsuć po cichu.
 */
import { describe, it, expect } from 'vitest'
import { emptyLine, type LineForm, type RecipeLite } from '../order-form/types'
import {
  num, lineKg, carryOver, inheritedSlots, initialSlot, nextSlot, prevSlot,
  applyIdentity, totals, identityComplete, draftComplete, sameProduct,
} from './model'

const line = (p: Partial<LineForm>): LineForm => ({ ...emptyLine(), ...p })

describe('num — przecinek dziesiętny', () => {
  it('czyta przecinek jak kropkę', () => expect(num('8,5')).toBe(8.5))
  it('czyta kropkę', () => expect(num('8.5')).toBe(8.5))
  it('puste i śmieci to zero', () => {
    expect(num('')).toBe(0)
    expect(num('abc')).toBe(0)
    expect(num(undefined)).toBe(0)
  })
})

describe('carryOver — dziedziczenie pozycji', () => {
  const last = line({ qty: '40', kgPerUnit: '8,5', productTypeId: 'pt1', recipeId: 'r1', packagingId: 'tul65' })

  it('przenosi rodzaj, recepturę i tuleję', () => {
    const next = carryOver(last)
    expect(next.productTypeId).toBe('pt1')
    expect(next.recipeId).toBe('r1')
    expect(next.packagingId).toBe('tul65')
  })

  it('czyści WYŁĄCZNIE ilość i wagę', () => {
    const next = carryOver(last)
    expect(next.qty).toBe('')
    expect(next.kgPerUnit).toBe('')
  })

  it('bez poprzedniej pozycji daje pusty draft', () => {
    expect(carryOver(null)).toEqual(emptyLine())
  })

  it('oznacza odziedziczone sloty', () => {
    const s = inheritedSlots(carryOver(last), last)
    expect([...s].sort()).toEqual(['packagingId', 'productTypeId', 'recipeId'])
  })

  it('bez tulei nie oznacza tulei jako odziedziczonej', () => {
    const bezTulei = line({ productTypeId: 'pt1', recipeId: 'r1' })
    expect(inheritedSlots(carryOver(bezTulei), bezTulei).has('packagingId')).toBe(false)
  })
})

describe('kursor', () => {
  it('pusty draft startuje na rodzaju', () => {
    expect(initialSlot(emptyLine())).toBe('productTypeId')
  })
  it('po wybraniu rodzaju startuje na recepturze', () => {
    expect(initialSlot(line({ productTypeId: 'pt1' }))).toBe('recipeId')
  })
  it('odziedziczony draft startuje OD RAZU na sztukach', () => {
    expect(initialSlot(line({ productTypeId: 'pt1', recipeId: 'r1' }))).toBe('qty')
  })
  it('idzie w przód i w tył, nie wypada poza zakres', () => {
    expect(nextSlot('productTypeId')).toBe('recipeId')
    expect(nextSlot('packagingId')).toBe('qty')
    expect(nextSlot('kgPerUnit')).toBe('kgPerUnit')
    expect(prevSlot('qty')).toBe('packagingId')
    expect(prevSlot('productTypeId')).toBe('productTypeId')
  })
})

describe('applyIdentity — zmiana rodzaju a receptura', () => {
  const recipes: RecipeLite[] = [
    { id: 'r1', name: 'Kebab A', productTypeId: 'pt1' },
    { id: 'rAny', name: 'Uniwersalna' },
  ]

  it('zmiana rodzaju kasuje recepturę z innego produktu', () => {
    const out = applyIdentity(line({ productTypeId: 'pt1', recipeId: 'r1' }), 'productTypeId', 'pt2', recipes)
    expect(out.recipeId).toBe('')
  })
  it('zostawia recepturę bez przypisanego rodzaju', () => {
    const out = applyIdentity(line({ productTypeId: 'pt1', recipeId: 'rAny' }), 'productTypeId', 'pt2', recipes)
    expect(out.recipeId).toBe('rAny')
  })
  it('zostawia recepturę pasującą do nowego rodzaju', () => {
    const out = applyIdentity(line({ productTypeId: 'pt9', recipeId: 'r1' }), 'productTypeId', 'pt1', recipes)
    expect(out.recipeId).toBe('r1')
  })
  it('inne sloty ustawia wprost', () => {
    expect(applyIdentity(emptyLine(), 'packagingId', 'tul65', recipes).packagingId).toBe('tul65')
  })
})

describe('kompletność i sumy', () => {
  it('tuleja nie jest wymagana', () => {
    expect(identityComplete(line({ productTypeId: 'pt1', recipeId: 'r1' }))).toBe(true)
  })
  it('draft wymaga dodatnich liczb', () => {
    expect(draftComplete(line({ productTypeId: 'pt1', recipeId: 'r1', qty: '0', kgPerUnit: '8' }))).toBe(false)
    expect(draftComplete(line({ productTypeId: 'pt1', recipeId: 'r1', qty: '40', kgPerUnit: '8,5' }))).toBe(true)
  })
  it('liczy kg pozycji z przecinkiem', () => {
    expect(lineKg(line({ qty: '40', kgPerUnit: '8,5' }))).toBe(340)
  })
  it('sumuje paragon', () => {
    const t = totals([
      line({ qty: '40', kgPerUnit: '8,5' }),
      line({ qty: '10', kgPerUnit: '12' }),
    ])
    expect(t).toEqual({ count: 2, units: 50, kg: 460 })
  })
  it('rozpoznaje ten sam produkt o tej samej wadze', () => {
    const a = line({ productTypeId: 'pt1', recipeId: 'r1', packagingId: '', kgPerUnit: '8,5', qty: '40' })
    const b = line({ productTypeId: 'pt1', recipeId: 'r1', packagingId: '', kgPerUnit: '8.5', qty: '10' })
    expect(sameProduct(a, b)).toBe(true)
  })
})
