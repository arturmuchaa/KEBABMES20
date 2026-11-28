import { describe, it, expect } from 'vitest'
import { adresZGus, adresZVies } from './adresZRejestru'

describe('adres z rejestru (stary MES, 27.11.2026)', () => {
  it('VIES: gotowe pola z serwera 1:1', () => {
    expect(adresZVies({ vatNumber: 'DE111222333', countryCode: 'DE', traderName: 'Anka', traderAddress: 'Hauptstr. 21\n50667 Köln', valid: true,
      ulica: 'Hauptstr. 21', kodPocztowy: '50667', miasto: 'Köln', kraj: 'DE' }))
      .toEqual({ address: 'Hauptstr. 21', postalCode: '50667', city: 'Köln', country: 'DE' })
  })
  it('VIES ze starszego serwera (bez pól) — rozbicie po stronie przeglądarki jak dotąd', () => {
    expect(adresZVies({ vatNumber: 'DE1', countryCode: 'DE', traderName: 'X', traderAddress: 'Hauptstr. 21\n50667 Köln', valid: true }))
      .toEqual({ address: 'Hauptstr. 21', postalCode: '50667', city: 'Köln', country: 'DE' })
  })
  it('GUS: ulica już z numerem; stary kształt z numer_budynku dalej działa', () => {
    expect(adresZGus({ nip: '1', nazwa: 'X', ulica: 'Jana Kilińskiego 17', kod_pocztowy: '40-001', miasto: 'Katowice', kraj: 'PL' }))
      .toEqual({ address: 'Jana Kilińskiego 17', postalCode: '40-001', city: 'Katowice', country: 'PL' })
    expect(adresZGus({ nip: '1', nazwa: 'X', ulica: 'DŁUGA', numer_budynku: '12', numer_lokalu: '3', kod_pocztowy: '00-950', miasto: 'KRAKÓW' }))
      .toEqual({ address: 'DŁUGA 12/3', postalCode: '00-950', city: 'KRAKÓW', country: 'PL' })
  })
})
