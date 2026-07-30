import { describe, it, expect } from 'vitest'
import {
  ASSET_LABELS, ASSET_SHORT, ASSET_TYPES, CALIBER_OPTIONS, OTHER_CARRIER_KINDS,
  caliberKg, containersForKg,
} from './containers'

describe('containersForKg', () => {
  it('dzieli bez reszty', () => {
    expect(containersForKg(300, 15)).toBe(20)
  })

  it('zaokrągla W GÓRĘ — niepełny pojemnik to nadal jeden pojemnik', () => {
    // Regresja: modal przyjęcia liczył floor i gubił jeden pojemnik na
    // każdej niepełnej dostawie.
    expect(containersForKg(305, 15)).toBe(21)
    expect(containersForKg(6005, 15)).toBe(401)
  })

  it('obsługuje kaliber 20 kg', () => {
    expect(containersForKg(300, 20)).toBe(15)
    expect(containersForKg(310, 20)).toBe(16)
  })

  it('niekalibrowany nie da się wyliczyć', () => {
    expect(containersForKg(1000, null)).toBeNull()
  })

  it('zero i wartości ujemne to zero pojemników', () => {
    expect(containersForKg(0, 15)).toBe(0)
    expect(containersForKg(-5, 15)).toBe(0)
  })
})

describe('caliberKg', () => {
  it('mapuje wartość selecta na kilogramy', () => {
    expect(caliberKg('15')).toBe(15)
    expect(caliberKg('20')).toBe(20)
    expect(caliberKg('none')).toBeNull()
  })
})

describe('słowniki', () => {
  it('ma trzy kalibry w stałej kolejności', () => {
    expect(CALIBER_OPTIONS.map(o => o.value)).toEqual(['15', '20', 'none'])
  })

  it('etykiety nośników zgodne z drukiem', () => {
    expect(ASSET_LABELS.e2).toBe('Ilość pojemników EURO2')
    expect(ASSET_LABELS.pallet_h1).toBe('Ilość palet H1')
    expect(ASSET_LABELS.net_e1).toBe('Ilość siatek E1')
    expect(ASSET_LABELS.pallet_other).toBe('Ilość palet innych')
  })

  it('lista innych opakowań w kolejności podanej przez zakład', () => {
    expect(OTHER_CARRIER_KINDS.map(k => k.value))
      .toEqual(['net_e1', 'pallet_plastic', 'pallet_euro', 'pallet_wood'])
    expect(OTHER_CARRIER_KINDS[0].label).toBe('Siatka E1')
  })

  it('każdy typ ma obie etykiety', () => {
    for (const a of ASSET_TYPES) {
      expect(ASSET_LABELS[a]).toBeTruthy()
      expect(ASSET_SHORT[a]).toBeTruthy()
    }
  })
})
