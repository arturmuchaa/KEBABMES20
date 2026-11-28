import { describe, it, expect } from 'vitest'
import {
  filtruj, zrodloDlaNumeru, porownanie, zastosuj, pustyFormularz, pobraneZGus, pobraneZVies, bledy, zKlienta, doDtoKlienta,
  doDtoDostawcy, jezykZKraju, krajDlaFormularza, czyUe, type Formularz,
} from './model'

describe('zrodloDlaNumeru', () => {
  it('NIP polski → GUS, VAT z prefiksem → VIES, za krótki → nic', () => {
    expect(zrodloDlaNumeru('1112223334')).toBe('gus')
    expect(zrodloDlaNumeru('111-222-33-34')).toBe('gus')
    expect(zrodloDlaNumeru('PL1112223334')).toBe('gus')
    expect(zrodloDlaNumeru('ATU12345675')).toBe('vies')
    expect(zrodloDlaNumeru('de 450 785 239')).toBe('vies')
    expect(zrodloDlaNumeru('12')).toBe(null)
    expect(zrodloDlaNumeru('')).toBe(null)
  })
})

describe('filtruj', () => {
  const lista = [
    { id: '1', name: 'BULLI KEBAB, s. r. o.', displayName: 'BULLI', nip: 'SK1020304050', city: 'Košice' },
    { id: '2', name: 'FUDI SPÓŁKA Z O.O.', displayName: 'FUDI', nip: '1112223334', city: 'ZAŁĘŻE' },
  ]
  it('bez polskich znaków i wielkości liter, po nazwie, NIP-ie i mieście', () => {
    expect(filtruj(lista, 'kosice').map(x => x.id)).toEqual(['1'])
    expect(filtruj(lista, 'zaleze').map(x => x.id)).toEqual(['2'])
    expect(filtruj(lista, '11122').map(x => x.id)).toEqual(['2'])
    expect(filtruj(lista, 'bulli').map(x => x.id)).toEqual(['1'])
    expect(filtruj(lista, '  ').length).toBe(2)
  })
})

describe('porownanie i zastosuj', () => {
  const pobrane = { name: 'FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', nip: '1112223334', regon: '123', address: 'Zalesie 41F', postalCode: '62-300', city: 'Zalesie', country: 'PL' }
  it('nowy kontrahent: wszystkie pobrane pola zaznaczone', () => {
    const w = porownanie(pustyFormularz(), pobrane, true)
    expect(w.every(x => x.przejmij)).toBe(true)
    expect(w.map(x => x.pole)).toEqual(['name', 'nip', 'regon', 'address', 'postalCode', 'city', 'country'])
  })
  it('pobranie do istniejącej karty nie zaznacza wypełnionych pól', () => {
    const obecne = { ...pustyFormularz(), name: 'FUDI SP. Z O.O.', nip: '1112223334', address: 'ZALESIE 41F', postalCode: '', city: 'ZALESIE', country: 'PL' }
    const w = porownanie(obecne, pobrane, false)
    const m = Object.fromEntries(w.map(x => [x.pole, x.przejmij]))
    expect(m).toEqual({ name: false, regon: true, address: false, postalCode: true, city: false })
  })
  it('zastosuj przejmuje tylko zaznaczone', () => {
    const f = pustyFormularz()
    const w = porownanie(f, pobrane, true).map(x => (x.pole === 'city' ? { ...x, przejmij: false } : x))
    const out = zastosuj(f, w)
    expect(out.name).toBe(pobrane.name)
    expect(out.city).toBe('')
    expect(out.postalCode).toBe('62-300')
  })
})

describe('pobrane dane → formularz', () => {
  it('GUS/MF: rozbity adres z serwera', () => {
    expect(pobraneZGus({ nip: '2223334445', nazwa: 'GRASO', regon: '1', ulica: 'Jana Kilińskiego 17', kod_pocztowy: '40-001', miasto: 'Katowice', kraj: 'PL', adres: 'X' }))
      .toEqual({ name: 'GRASO', nip: '2223334445', regon: '1', address: 'Jana Kilińskiego 17', postalCode: '40-001', city: 'Katowice', country: 'PL' })
  })
  it('VIES: numer z prefiksem kraju, adres z serwera', () => {
    expect(pobraneZVies({ vatNumber: 'ATU12345675', countryCode: 'AT', traderName: 'Emin Handels GmbH', traderAddress: 'x', valid: true, ulica: 'Hauptplatz 7', kodPocztowy: '4490', miasto: 'St.Florian-Markt', kraj: 'AT' }))
      .toEqual({ name: 'Emin Handels GmbH', nip: 'ATU12345675', address: 'Hauptplatz 7', postalCode: '4490', city: 'St.Florian-Markt', country: 'AT' })
  })
})

describe('formularz', () => {
  it('nazwa wymagana, e-mail sprawdzany', () => {
    expect(bledy(pustyFormularz(), 'odbiorcy').name).toBeTruthy()
    expect(bledy({ ...pustyFormularz(), name: 'X', email: 'zly' }, 'odbiorcy').email).toBeTruthy()
    expect(bledy({ ...pustyFormularz(), name: 'X', email: 'biuro@firma.pl' }, 'odbiorcy')).toEqual({})
  })
  it('kraj: z pola, inaczej z prefiksu VAT', () => {
    expect(krajDlaFormularza({ ...pustyFormularz(), nip: 'SK1020304050' } as Formularz)).toBe('SK')
    expect(krajDlaFormularza({ ...pustyFormularz(), nip: 'SK1020304050', country: 'CZ' } as Formularz)).toBe('CZ')
    expect(krajDlaFormularza({ ...pustyFormularz(), nip: '1112223334' } as Formularz)).toBe('PL')
  })
  it('język z kraju jak w starym MES', () => {
    expect(jezykZKraju('AT')).toBe('de')
    expect(jezykZKraju('CZ')).toBe('cs')
    expect(jezykZKraju('PL')).toBe('pl')
    expect(jezykZKraju('ES')).toBe('en')
  })
  it('UE: tylko kraje UE poza Polską', () => {
    expect(czyUe('AT')).toBe(true)
    expect(czyUe('PL')).toBe(false)
    expect(czyUe('CH')).toBe(false)
  })
  it('DTO klienta i dostawcy niosą kraj i pola kartoteki', () => {
    const f = zKlienta({ id: 'c1', code: 'K1', name: 'Emin', nip: 'ATU12345675', country: 'AT', active: true, createdAt: '', hdiRecipeNames: [{ recipeId: 'r1', name: 'BEYAZ' }] })
    expect(doDtoKlienta(f)).toMatchObject({ name: 'Emin', nip: 'ATU12345675', country: 'AT', hdiRecipeNames: [{ recipeId: 'r1', name: 'BEYAZ' }] })
    expect(doDtoDostawcy({ ...pustyFormularz(), name: 'KOKO', vetNumber: '12345678', supplyScope: 'mięso' })).toMatchObject({ name: 'KOKO', vetNumber: '12345678', supplyScope: 'mięso', country: 'PL' })
  })
})
