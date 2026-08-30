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
    // Tak wyglądają NIP-y w kartotece: CZ03678580, DE232653399, FR77988827754.
    expect(nipKrajowy('CZ03678580')).toBe(false)
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
