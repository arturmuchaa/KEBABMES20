/**
 * Przełącznik rodzaju surowca na stronie „Przyjęcie surowca" i zakładka
 * „Wszystko", która go zbiera w jedną listę.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_MATERIALS, receptionTabs, batchesForTab, materialLookup,
  type MaterialTypeLike,
} from './receptionTabs'

const TYPES: MaterialTypeLike[] = [
  { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true,  receivable: true },
  { id: 'mat-filet',    name: 'Filet z kurczaka',    requiresDeboning: false, receivable: true },
  { id: 'mat-mieso-zs', name: 'Mięso z/s',           requiresDeboning: false, receivable: true },
  // Uboczne z rozbioru nie są przyjmowane od dostawcy — nie ma dla nich zakładki,
  // ale nazwa musi być znana, bo stare dostawy potrafią się do nich odwoływać.
  { id: 'mat-grzbiety', name: 'Grzbiety',            requiresDeboning: false, receivable: false },
]

describe('receptionTabs', () => {
  it('„Wszystko" stoi jako pierwsza zakładka', () => {
    expect(receptionTabs(TYPES)[0]).toMatchObject({ id: ALL_MATERIALS, name: 'Wszystko' })
  })

  it('dalej idą tylko rodzaje, które faktycznie się przyjmuje', () => {
    expect(receptionTabs(TYPES).slice(1).map(t => t.id))
      .toEqual(['mat-cwiartka', 'mat-filet', 'mat-mieso-zs'])
  })
})

describe('batchesForTab', () => {
  const dostawy = [
    { id: 'a', materialTypeId: 'mat-cwiartka' },
    { id: 'b', materialTypeId: 'mat-filet' },
    // Dostawa sprzed wprowadzenia rodzajów — to ćwiartka.
    { id: 'c' },
  ]

  it('zakładka rodzaju pokazuje tylko swój surowiec', () => {
    expect(batchesForTab(dostawy, 'mat-filet').map(b => b.id)).toEqual(['b'])
  })

  it('stara dostawa bez rodzaju liczy się jako ćwiartka', () => {
    expect(batchesForTab(dostawy, 'mat-cwiartka').map(b => b.id)).toEqual(['a', 'c'])
  })

  it('„Wszystko" nie gubi żadnej dostawy — po to jest', () => {
    expect(batchesForTab(dostawy, ALL_MATERIALS).map(b => b.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('materialLookup', () => {
  const { label, requiresDeboning } = materialLookup(TYPES)

  it('podaje nazwę rodzaju do kolumny „Rodzaj"', () => {
    expect(label({ materialTypeId: 'mat-filet' })).toBe('Filet z kurczaka')
  })

  it('nazywa starą dostawę bez rodzaju ćwiartką', () => {
    expect(label({})).toBe('Ćwiartka z kurczaka')
  })

  it('zna też rodzaje, których się już nie przyjmuje', () => {
    expect(label({ materialTypeId: 'mat-grzbiety' })).toBe('Grzbiety')
  })

  it('nieznanego rodzaju nie udaje — pokazuje jego identyfikator', () => {
    expect(label({ materialTypeId: 'mat-cos-nowego' })).toBe('mat-cos-nowego')
  })

  it('ćwiartka idzie na rozbiór, filet i mięso z/s prosto na magazyn', () => {
    expect(requiresDeboning({ materialTypeId: 'mat-cwiartka' })).toBe(true)
    expect(requiresDeboning({ materialTypeId: 'mat-filet' })).toBe(false)
    expect(requiresDeboning({ materialTypeId: 'mat-mieso-zs' })).toBe(false)
  })

  it('nieznany rodzaj traktuje jak ćwiartkę — stan czyta z dostawy', () => {
    expect(requiresDeboning({ materialTypeId: 'mat-cos-nowego' })).toBe(true)
    expect(requiresDeboning({})).toBe(true)
  })
})
