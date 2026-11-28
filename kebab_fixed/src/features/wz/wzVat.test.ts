/** VAT na WZ — stawka krajowa 5 %, zagranica 0 %, wybór per pozycja. */
import { describe, it, expect } from 'vitest'
import {
  maVat, nipKrajowy, podsumowanieVat, stawkaVatDlaNabywcy, VAT_KRAJOWY,
} from './wzVat'

describe('nipKrajowy', () => {
  it('same cyfry to kontrahent krajowy', () => {
    expect(nipKrajowy('8943033750')).toBe(true)
    expect(nipKrajowy('513-020-15-09')).toBe(true)
  })

  it('prefiks kraju oznacza zagranicę', () => {
    // Tak wyglądają NIP-y w kartotece: CZ12345678, DE232653399, FR77988827754.
    expect(nipKrajowy('CZ12345678')).toBe(false)
    expect(nipKrajowy('DE232653399')).toBe(false)
    expect(nipKrajowy('FR77988827754')).toBe(false)
  })

  it('prefiks PL to nadal kraj', () => {
    expect(nipKrajowy('PL8943033750')).toBe(true)
  })

  it('brak NIP-u traktujemy jako sprzedaż krajową', () => {
    expect(nipKrajowy('')).toBe(true)
    expect(nipKrajowy(null)).toBe(true)
  })
})

describe('stawkaVatDlaNabywcy', () => {
  it('kraj dostaje 5 %', () => {
    expect(stawkaVatDlaNabywcy('8943033750')).toBe(VAT_KRAJOWY)
  })

  it('zagranica dostaje 0 % (WDT / eksport)', () => {
    expect(stawkaVatDlaNabywcy('DE232653399')).toBe(0)
  })

  // 27.11.2026: VAT UE nieaktywny w VIES → faktura z VAT (stawka krajowa).
  it('zagranica z nieaktywnym VAT UE dostaje stawkę krajową', () => {
    expect(stawkaVatDlaNabywcy('ATU12345675', 'nieaktywny')).toBe(VAT_KRAJOWY)
  })
  it('aktywny, błąd sprawdzenia i brak statusu nie zmieniają 0 %', () => {
    expect(stawkaVatDlaNabywcy('ATU12345675', 'aktywny')).toBe(0)
    expect(stawkaVatDlaNabywcy('ATU12345675', 'blad')).toBe(0)
    expect(stawkaVatDlaNabywcy('ATU12345675', '')).toBe(0)
  })
  it('kraj zostaje 5 % niezależnie od statusu', () => {
    expect(stawkaVatDlaNabywcy('1112223334', 'nieaktywny')).toBe(VAT_KRAJOWY)
  })
})

describe('podsumowanieVat', () => {
  it('liczy netto, VAT i brutto w jednej stawce', () => {
    const p = podsumowanieVat([{ value: 100, vat_rate: 5 }, { value: 200, vat_rate: 5 }])
    expect(p.netto).toBe(300)
    expect(p.vat).toBe(15)
    expect(p.brutto).toBe(315)
  })

  it('rozbija na stawki, jak stopka faktury', () => {
    const p = podsumowanieVat([
      { value: 100, vat_rate: 5 },
      { value: 100, vat_rate: 23 },
    ])
    expect(p.wiersze.map(w => w.stawka)).toEqual([5, 23])
    expect(p.wiersze.map(w => w.vat)).toEqual([5, 23])
    expect(p.brutto).toBe(228)
  })

  it('VAT liczy od SUMY w stawce, nie pozycja po pozycji', () => {
    // 3 × 0,10 zł przy 23 %: od sumy 0,30 → 0,07. Pozycjami wyszłoby 3 × 0,02
    // = 0,06 i WZ rozjechałaby się z fakturą wystawioną od sumy.
    const p = podsumowanieVat([
      { value: 0.1, vat_rate: 23 }, { value: 0.1, vat_rate: 23 }, { value: 0.1, vat_rate: 23 },
    ])
    expect(p.vat).toBe(0.07)
  })

  it('VAT w groszach połówką w górę — jak księga rozliczeń (Decimal ROUND_HALF_UP)', () => {
    // Liczone na float-ach 20,10 × 5 % = 1,005 dawało 1,00 — a backend
    // (rozliczenia_ksiega.brutto_wz) liczy 1,01: wydruk WZ i saldo klienta
    // różniły się o grosz.
    expect(podsumowanieVat([{ value: 1200.1, vat_rate: 5 }]).vat).toBe(60.01)
    expect(podsumowanieVat([{ value: 20.1, vat_rate: 5 }]).vat).toBe(1.01)
    expect(podsumowanieVat([{ value: 2.9, vat_rate: 5 }]).vat).toBe(0.15)
    expect(podsumowanieVat([{ value: 2.5, vat_rate: 23 }]).vat).toBe(0.58)
    expect(podsumowanieVat([{ value: 11.3, vat_rate: 5 }])).toMatchObject({ netto: 11.3, vat: 0.57, brutto: 11.87 })
    expect(podsumowanieVat([{ value: 5.7, vat_rate: 8 }]).vat).toBe(0.46)
  })

  it('netto do groszy połówką w górę mimo szumu float (1,005 → 1,01)', () => {
    const p = podsumowanieVat([{ value: 1.005, vat_rate: 0 }])
    expect(p.netto).toBe(1.01)
    expect(p.brutto).toBe(1.01)
  })

  it('pozycje bez stawki liczą się jako 0 %', () => {
    const p = podsumowanieVat([{ value: 500 }])
    expect(p.netto).toBe(500)
    expect(p.vat).toBe(0)
    expect(p.brutto).toBe(500)
  })

  it('pusty dokument nie kłamie kwotami', () => {
    const p = podsumowanieVat([])
    expect(p).toMatchObject({ netto: 0, vat: 0, brutto: 0 })
    expect(p.wiersze).toEqual([])
  })
})

describe('maVat', () => {
  it('dokument z samymi zerami nie pokazuje sekcji VAT', () => {
    expect(maVat([{ value: 100, vat_rate: 0 }, { value: 50 }])).toBe(false)
  })

  it('jedna pozycja ze stawką wystarczy', () => {
    expect(maVat([{ value: 100, vat_rate: 0 }, { value: 50, vat_rate: 5 }])).toBe(true)
  })
})
