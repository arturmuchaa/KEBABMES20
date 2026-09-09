import { describe, expect, it } from 'vitest'
import { buildCartonLabelLines, type CartonLabelItem } from './cartonLabelLines'

/** Pozycja kartki: sztuki × waga, receptura i tuleja. */
const p = (
  qty: number, kgPerUnit: number,
  recipeName = 'BEYAZ AFIYET', packagingName = 'METAL 60CM',
): CartonLabelItem => ({ qty, kgPerUnit, recipeName, packagingName })

describe('buildCartonLabelLines — receptura na kartce', () => {
  it('dopisuje recepture do pozycji', () => {
    expect(buildCartonLabelLines([p(18, 40)])).toEqual(['18 X 40KG (BEYAZ AFIYET)'])
  })

  it('dwie receptury na palecie to dwie osobne linie', () => {
    // Wprost z opisu wlasciciela: YALCIN 10x80 (BEYAZ AFIYET), pod spodem
    // 5x40 (KIRMIZI).
    expect(buildCartonLabelLines([
      p(10, 80, 'BEYAZ AFIYET'),
      p(5, 40, 'KIRMIZI'),
    ])).toEqual([
      '10 X 80KG (BEYAZ AFIYET)',
      '5 X 40KG (KIRMIZI)',
    ])
  })

  it('ta sama receptura i waga sumuje sztuki w jedna linie', () => {
    expect(buildCartonLabelLines([p(6, 40), p(12, 40)]))
      .toEqual(['18 X 40KG (BEYAZ AFIYET)'])
  })

  it('ta sama receptura w dwoch wagach to dwie linie', () => {
    expect(buildCartonLabelLines([p(10, 40), p(5, 20)])).toEqual([
      '10 X 40KG (BEYAZ AFIYET)',
      '5 X 20KG (BEYAZ AFIYET)',
    ])
  })

  it('ta sama waga w dwoch recepturach NIE scala sie w jedna linie', () => {
    // Przed ta zmiana kartka grupowala po samych kilogramach i obie pozycje
    // wychodzily jako '15 X 40KG' — bez sladu, ze to dwa rozne wyroby.
    expect(buildCartonLabelLines([
      p(10, 40, 'BEYAZ AFIYET'),
      p(5, 40, 'KIRMIZI'),
    ])).toEqual([
      '10 X 40KG (BEYAZ AFIYET)',
      '5 X 40KG (KIRMIZI)',
    ])
  })

  it('sortuje wagami malejaco', () => {
    expect(buildCartonLabelLines([p(1, 20), p(2, 80), p(3, 40)])).toEqual([
      '2 X 80KG (BEYAZ AFIYET)',
      '3 X 40KG (BEYAZ AFIYET)',
      '1 X 20KG (BEYAZ AFIYET)',
    ])
  })

  it('waga ulamkowa z jednym miejscem po przecinku', () => {
    expect(buildCartonLabelLines([p(4, 8.5)])).toEqual(['4 X 8,5KG (BEYAZ AFIYET)'])
  })
})

describe('buildCartonLabelLines — tuleja niestandardowa', () => {
  it('tuleja 80 cm dopisuje sie przy recepturze', () => {
    expect(buildCartonLabelLines([p(10, 80, 'BEYAZ AFIYET', 'METAL 80CM')]))
      .toEqual(['10 X 80KG (BEYAZ AFIYET · 80CM)'])
  })

  it('tuleja 75 cm tez jest niestandardowa', () => {
    expect(buildCartonLabelLines([p(3, 50, 'KIRMIZI', 'METAL 75CM')]))
      .toEqual(['3 X 50KG (KIRMIZI · 75CM)'])
  })

  it('standard 45-65 cm bez dopisku', () => {
    expect(buildCartonLabelLines([
      p(1, 10, 'KIRMIZI', 'METAL 45CM'),
      p(2, 20, 'KIRMIZI', 'KARTON 65CM'),
    ])).toEqual([
      '2 X 20KG (KIRMIZI)',
      '1 X 10KG (KIRMIZI)',
    ])
  })

  it('ta sama receptura i waga w dwoch tulejach to dwie linie', () => {
    // YALCIN wozi KIRMIZI 30 kg naraz w METAL 65CM i METAL 80CM — na kartce
    // musi byc widac, ktora paleta jest ktora.
    expect(buildCartonLabelLines([
      p(4, 30, 'KIRMIZI', 'METAL 65CM'),
      p(2, 30, 'KIRMIZI', 'METAL 80CM'),
    ])).toEqual([
      '4 X 30KG (KIRMIZI)',
      '2 X 30KG (KIRMIZI · 80CM)',
    ])
  })

  it('brak rozmiaru w nazwie tulei nie dopisuje nic', () => {
    // Folia i karton klapowy nie maja rozmiaru — dopisek '(· null)' byłby
    // smieciem na kartce.
    expect(buildCartonLabelLines([p(5, 25, 'KIRMIZI', 'Folia stretch')]))
      .toEqual(['5 X 25KG (KIRMIZI)'])
  })
})

describe('buildCartonLabelLines — brzegi', () => {
  it('pozycja bez receptury pokazuje sama wage', () => {
    expect(buildCartonLabelLines([p(7, 30, '')])).toEqual(['7 X 30KG'])
  })

  it('pusta paleta daje pusta liste', () => {
    expect(buildCartonLabelLines([])).toEqual([])
  })

  it('pomija pozycje bez wagi — nie da sie ich opisac', () => {
    expect(buildCartonLabelLines([p(5, 0), p(2, 40)]))
      .toEqual(['2 X 40KG (BEYAZ AFIYET)'])
  })

  it('nie rusza tablicy wejsciowej', () => {
    const wej = [p(1, 20), p(2, 80)]
    buildCartonLabelLines(wej)
    expect(wej.map(x => x.kgPerUnit)).toEqual([20, 80])
  })
})
