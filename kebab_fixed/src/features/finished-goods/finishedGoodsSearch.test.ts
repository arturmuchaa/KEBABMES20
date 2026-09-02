import { describe, expect, it } from 'vitest'
import { dopasujTowar, normalizuj, tokeny } from './finishedGoodsSearch'

/** Wiersz magazynu w kształcie, jaki widzi ekran. */
const g = (over: Partial<any> = {}): any => ({
  productTypeName: 'KEBAB UDO', recipeName: 'KIRMIZI',
  packagingName: 'METAL 65CM', clientName: 'YALCIN SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  kgPerUnit: 30, qty: 142, totalKg: 4260,
  batches: [{ batchNo: '010926 518', clientOrderNo: 'YALCIN/Z/1/09/26' }],
  ...over,
})

/** Skrócona nazwa, jaką ekran POKAZUJE zamiast pełnej. */
const skrot = (pelna: string) => (pelna.startsWith('YALCIN') ? 'YALCIN' : pelna)

describe('normalizuj', () => {
  it('składa polskie znaki i wielkość liter', () => {
    expect(normalizuj('ŚCINKI Łóź')).toBe('scinki loz')
  })
  it('zamienia przecinek dziesiętny na kropkę', () => {
    expect(normalizuj('2,5')).toBe('2.5')
  })
})

describe('tokeny', () => {
  it('dzieli zapytanie na słowa', () => {
    expect(tokeny(' kirmizi   30 ')).toEqual(['kirmizi', '30'])
  })
  it('puste zapytanie nie daje tokenów', () => {
    expect(tokeny('   ')).toEqual([])
  })
})

describe('dopasujTowar — sedno naprawy', () => {
  it('DWA SŁOWA zawężają zamiast dawać zero wyników', () => {
    // Dziś filtr robi includes na całej frazie naraz, więc „kirmizi 30"
    // nie trafia w nic — żadne pojedyncze pole nie zawiera obu słów.
    expect(dopasujTowar(g(), 'kirmizi 30', skrot)).toBe(true)
    expect(dopasujTowar(g(), 'kirmizi 25', skrot)).toBe(false)
  })

  it('znajduje po NAZWIE SKRÓCONEJ, czyli tej z ekranu', () => {
    // Ekran pokazuje „YALCIN", filtr szukał w pełnej nazwie z KRS.
    expect(dopasujTowar(g(), 'yalcin', skrot)).toBe(true)
  })

  it('znajduje po pełnej nazwie klienta', () => {
    expect(dopasujTowar(g(), 'ograniczoną', skrot)).toBe(true)
  })

  it('składa polskie znaki — „ograniczona" znajdzie „OGRANICZONĄ"', () => {
    expect(dopasujTowar(g(), 'ograniczona', skrot)).toBe(true)
  })

  it('znajduje po rodzaju i po recepturze', () => {
    expect(dopasujTowar(g(), 'udo', skrot)).toBe(true)
    expect(dopasujTowar(g(), 'kirmizi', skrot)).toBe(true)
  })

  it('znajduje po tulei — samą liczbą i z jednostką', () => {
    expect(dopasujTowar(g(), '65', skrot)).toBe(true)
    expect(dopasujTowar(g(), '65cm', skrot)).toBe(true)
    expect(dopasujTowar(g(), 'metal', skrot)).toBe(true)
  })

  it('znajduje po gramaturze, także z „kg" i z przecinkiem', () => {
    expect(dopasujTowar(g(), '30', skrot)).toBe(true)
    expect(dopasujTowar(g(), '30kg', skrot)).toBe(true)
    expect(dopasujTowar(g({ kgPerUnit: 2.5 }), '2,5', skrot)).toBe(true)
    expect(dopasujTowar(g({ kgPerUnit: 2.5 }), '2.5', skrot)).toBe(true)
  })

  it('gramatura dopasowuje się DOKŁADNIE, nie fragmentem', () => {
    // „3" nie może znaleźć towaru 30 kg — inaczej filtr jest bezużyteczny.
    expect(dopasujTowar(g({ kgPerUnit: 30, packagingName: '', recipeName: '' }), '3', skrot))
      .toBe(false)
  })

  it('znajduje po numerze partii', () => {
    expect(dopasujTowar(g(), '518', skrot)).toBe(true)
    expect(dopasujTowar(g(), '010926', skrot)).toBe(true)
  })

  it('znajduje po numerze zamówienia', () => {
    expect(dopasujTowar(g(), 'Z/1/09/26', skrot)).toBe(true)
  })

  it('puste zapytanie przepuszcza wszystko', () => {
    expect(dopasujTowar(g(), '', skrot)).toBe(true)
    expect(dopasujTowar(g(), '   ', skrot)).toBe(true)
  })

  it('słowo spoza wiersza odrzuca go', () => {
    expect(dopasujTowar(g(), 'polat', skrot)).toBe(false)
  })

  it('trzy słowa też działają', () => {
    expect(dopasujTowar(g(), 'yalcin kirmizi 30', skrot)).toBe(true)
    expect(dopasujTowar(g(), 'yalcin kirmizi 99', skrot)).toBe(false)
  })

  it('działa bez podanej mapy skrótów', () => {
    expect(dopasujTowar(g(), 'kirmizi')).toBe(true)
  })
})
