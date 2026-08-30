/**
 * Przełącznik rodzaju surowca na stronie „Przyjęcie surowca" i zakładka
 * „Wszystko", która go zbiera w jedną listę.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_MATERIALS, RED_MEAT, receptionTabs, batchesForTab, materialLookup,
  redMeatTypes, type MaterialTypeLike,
} from './receptionTabs'

const TYPES: MaterialTypeLike[] = [
  { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true,  receivable: true },
  { id: 'mat-filet',    name: 'Filet z kurczaka',    requiresDeboning: false, receivable: true },
  { id: 'mat-mieso-zs', name: 'Mięso z/s',           requiresDeboning: false, receivable: true },
  // Uboczne z rozbioru nie są przyjmowane od dostawcy — nie ma dla nich zakładki,
  // ale nazwa musi być znana, bo stare dostawy potrafią się do nich odwoływać.
  { id: 'mat-grzbiety', name: 'Grzbiety',            requiresDeboning: false, receivable: false },
]

/** Słownik po dołożeniu wołowiny — pięć rodzajów pod jedną zakładką. */
const Z_WOLOWINA: MaterialTypeLike[] = [
  ...TYPES,
  { id: 'mat-wolowina-8020', name: 'Wołowina 80/20',    requiresDeboning: false, receivable: true, category: 'czerwone' },
  { id: 'mat-loj-otokowy',   name: 'Łój wołowy otokowy', requiresDeboning: false, receivable: true, category: 'czerwone' },
]

describe('receptionTabs', () => {
  it('„Wszystko" stoi jako pierwsza zakładka', () => {
    expect(receptionTabs(TYPES)[0]).toMatchObject({ id: ALL_MATERIALS, name: 'Wszystko' })
  })

  it('dalej idą tylko rodzaje, które faktycznie się przyjmuje', () => {
    expect(receptionTabs(TYPES).slice(1).map(t => t.id))
      .toEqual(['mat-cwiartka', 'mat-filet', 'mat-mieso-zs'])
  })

  it('bez wołowiny w słowniku zakładka „Mięso czerwone" się nie pokazuje', () => {
    expect(receptionTabs(TYPES).map(t => t.id)).not.toContain(RED_MEAT)
  })

  it('wołowina schodzi do JEDNEJ zakładki, nie do pięciu', () => {
    const ids = receptionTabs(Z_WOLOWINA).map(t => t.id)
    expect(ids).toEqual([ALL_MATERIALS, 'mat-cwiartka', 'mat-filet', 'mat-mieso-zs', RED_MEAT])
  })

  it('wołowina stoi ZA drobiem — drób to 95% dostaw', () => {
    const ids = receptionTabs(Z_WOLOWINA).map(t => t.id)
    expect(ids.indexOf(RED_MEAT)).toBe(ids.length - 1)
  })

  it('zbiorcza wołowina nie idzie na rozbiór', () => {
    const tab = receptionTabs(Z_WOLOWINA).find(t => t.id === RED_MEAT)
    expect(tab?.requiresDeboning).toBe(false)
  })
})

describe('redMeatTypes', () => {
  it('wybiera rodzaje do wyboru w formularzu przyjęcia', () => {
    expect(redMeatTypes(Z_WOLOWINA).map(m => m.id))
      .toEqual(['mat-wolowina-8020', 'mat-loj-otokowy'])
  })

  it('nie proponuje rodzaju, którego nie wolno przyjąć', () => {
    const zNieprzyjmowalnym = [
      ...Z_WOLOWINA,
      { id: 'mat-scinki-wol', name: 'Ścinki wołowe', receivable: false, category: 'czerwone' },
    ]
    expect(redMeatTypes(zNieprzyjmowalnym).map(m => m.id)).not.toContain('mat-scinki-wol')
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

  it('zakładka wołowiny zbiera wszystkie jej rodzaje naraz', () => {
    const zWolowina = [
      ...dostawy,
      { id: 'd', materialTypeId: 'mat-wolowina-8020' },
      { id: 'e', materialTypeId: 'mat-loj-otokowy' },
    ]
    expect(batchesForTab(zWolowina, RED_MEAT, Z_WOLOWINA).map(b => b.id)).toEqual(['d', 'e'])
  })

  it('bez słownika zakładka wołowiny nic nie pokazuje zamiast zgadywać', () => {
    // Słownik jeszcze się wczytuje — lepiej pusta tabela niż lista drobiu
    // pod nagłówkiem „Mięso czerwone".
    expect(batchesForTab(dostawy, RED_MEAT)).toEqual([])
  })

  it('stara dostawa bez rodzaju NIE wpada do wołowiny', () => {
    expect(batchesForTab(dostawy, RED_MEAT, Z_WOLOWINA).map(b => b.id)).not.toContain('c')
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
