import { describe, expect, it } from 'vitest'
import { buildCartonLabelContent, type CartonLabelItem } from './cartonLabelLines'

/** Pozycja kartki: sztuki × waga, receptura i tuleja. */
const p = (
  qty: number, kgPerUnit: number,
  recipeName = 'KIRMIZI', packagingName = 'METAL 60CM',
): CartonLabelItem => ({ qty, kgPerUnit, recipeName, packagingName })

describe('kartka — JEDNA receptura na całej palecie', () => {
  it('receptura stoi osobną linią pod klientem, nie przy pozycji', () => {
    // Właściciel (2026-09-09): „chciałem, aby jak jedna pozycja: klient,
    // pod spodem receptura, pod spodem kg".
    expect(buildCartonLabelContent([p(15, 50)])).toEqual({
      recipeHeader: 'KIRMIZI',
      lines: ['15 X 50KG'],
    })
  })

  it('dwie pozycje tej samej receptury też mają ją w nagłówku', () => {
    // „Jak dwie te same pozycje, to też klient, receptura i dwie pozycje."
    expect(buildCartonLabelContent([p(20, 40), p(10, 20)])).toEqual({
      recipeHeader: 'KIRMIZI',
      lines: ['20 X 40KG', '10 X 20KG'],
    })
  })

  it('sortuje pozycje wagami malejąco', () => {
    expect(buildCartonLabelContent([p(1, 20), p(2, 80), p(3, 40)]).lines)
      .toEqual(['2 X 80KG', '3 X 40KG', '1 X 20KG'])
  })

  it('ta sama receptura i waga sumuje sztuki w jedną linię', () => {
    expect(buildCartonLabelContent([p(6, 40), p(12, 40)]).lines)
      .toEqual(['18 X 40KG'])
  })

  it('waga ułamkowa z jednym miejscem po przecinku', () => {
    expect(buildCartonLabelContent([p(4, 8.5)]).lines).toEqual(['4 X 8,5KG'])
  })
})

describe('kartka — DWIE różne receptury w kartonie', () => {
  it('receptura schodzi do pozycji, za kilogramy i BEZ nawiasów', () => {
    // „Dopiero wtedy, gdy jest kilka pozycji: klient, pod spodem
    // 20x40kg beyaz afiyet i bez nawiasu, i pod spodem 10 x 20kg kirmizi."
    expect(buildCartonLabelContent([
      p(20, 40, 'BEYAZ AFIYET'),
      p(10, 20, 'KIRMIZI'),
    ])).toEqual({
      recipeHeader: null,
      lines: ['20 X 40KG BEYAZ AFIYET', '10 X 20KG KIRMIZI'],
    })
  })

  it('ta sama waga w dwóch recepturach to dwie osobne linie', () => {
    expect(buildCartonLabelContent([
      p(10, 40, 'BEYAZ AFIYET'),
      p(5, 40, 'KIRMIZI'),
    ]).lines).toEqual(['10 X 40KG BEYAZ AFIYET', '5 X 40KG KIRMIZI'])
  })

  it('trzy receptury — każda przy swojej pozycji', () => {
    expect(buildCartonLabelContent([
      p(10, 80, 'BEYAZ AFIYET'),
      p(5, 40, 'KIRMIZI'),
      p(8, 30, 'YAPRAK'),
    ])).toEqual({
      recipeHeader: null,
      lines: ['10 X 80KG BEYAZ AFIYET', '5 X 40KG KIRMIZI', '8 X 30KG YAPRAK'],
    })
  })
})

describe('kartka — tuleja niestandardowa', () => {
  it('idzie PRZED recepturą, gdy receptury stoją przy pozycjach', () => {
    expect(buildCartonLabelContent([
      p(20, 40, 'BEYAZ AFIYET', 'METAL 60CM'),
      p(10, 20, 'KIRMIZI', 'METAL 80CM'),
    ]).lines).toEqual(['20 X 40KG BEYAZ AFIYET', '10 X 20KG 80CM KIRMIZI'])
  })

  it('przy wspólnej recepturze zostaje przy swojej pozycji', () => {
    expect(buildCartonLabelContent([
      p(20, 40, 'KIRMIZI', 'METAL 60CM'),
      p(10, 20, 'KIRMIZI', 'METAL 80CM'),
    ])).toEqual({
      recipeHeader: 'KIRMIZI',
      lines: ['20 X 40KG', '10 X 20KG 80CM'],
    })
  })

  it('jedna pozycja w tulei 80 cm — receptura dalej w nagłówku', () => {
    expect(buildCartonLabelContent([p(15, 50, 'KIRMIZI', 'METAL 80CM')])).toEqual({
      recipeHeader: 'KIRMIZI',
      lines: ['15 X 50KG 80CM'],
    })
  })

  it('75 cm też jest niestandardowa', () => {
    expect(buildCartonLabelContent([p(3, 50, 'KIRMIZI', 'METAL 75CM')]).lines)
      .toEqual(['3 X 50KG 75CM'])
  })

  it('standard 45-65 cm bez dopisku', () => {
    expect(buildCartonLabelContent([
      p(1, 10, 'KIRMIZI', 'METAL 45CM'),
      p(2, 20, 'KIRMIZI', 'KARTON 65CM'),
    ]).lines).toEqual(['2 X 20KG', '1 X 10KG'])
  })

  it('ta sama receptura i waga w dwóch tulejach to dwie linie', () => {
    // YALCIN wozi KIRMIZI 30 kg naraz w METAL 65CM i METAL 80CM.
    expect(buildCartonLabelContent([
      p(4, 30, 'KIRMIZI', 'METAL 65CM'),
      p(2, 30, 'KIRMIZI', 'METAL 80CM'),
    ]).lines).toEqual(['4 X 30KG', '2 X 30KG 80CM'])
  })

  it('brak rozmiaru w nazwie tulei nie dopisuje nic', () => {
    expect(buildCartonLabelContent([p(5, 25, 'KIRMIZI', 'Folia stretch')]).lines)
      .toEqual(['5 X 25KG'])
  })
})

describe('kartka — brzegi', () => {
  it('pozycja bez receptury nie robi pustego nagłówka', () => {
    expect(buildCartonLabelContent([p(7, 30, '')])).toEqual({
      recipeHeader: null,
      lines: ['7 X 30KG'],
    })
  })

  it('jedna pozycja z recepturą, druga bez — receptura zostaje przy pozycji', () => {
    expect(buildCartonLabelContent([
      p(10, 40, 'KIRMIZI'),
      p(5, 20, ''),
    ])).toEqual({
      recipeHeader: null,
      lines: ['10 X 40KG KIRMIZI', '5 X 20KG'],
    })
  })

  it('pusta paleta daje pustą treść', () => {
    expect(buildCartonLabelContent([])).toEqual({ recipeHeader: null, lines: [] })
  })

  it('pomija pozycje bez wagi — nie da się ich opisać', () => {
    expect(buildCartonLabelContent([p(5, 0), p(2, 40)]).lines)
      .toEqual(['2 X 40KG'])
  })

  it('nie rusza tablicy wejściowej', () => {
    const wej = [p(1, 20), p(2, 80)]
    buildCartonLabelContent(wej)
    expect(wej.map(x => x.kgPerUnit)).toEqual([20, 80])
  })
})
