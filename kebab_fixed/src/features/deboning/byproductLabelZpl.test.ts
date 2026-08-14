import { describe, it, expect } from 'vitest'
import {
  byproductLabelZpl, fmtLabelDate, fmtLabelKg, mmToDots,
  LABEL_DPI, LABEL_W_MM, LABEL_H_MM,
} from './byproductLabelZpl'

const BASE = {
  kind: 'backs' as const,
  batchNo: '471',
  netKg: 245.5,
  productionDate: '2026-08-14',
  expiryDate: '2026-08-20',
}

describe('fmtLabelDate — ISO → dd.mm.rrrr', () => {
  it('formatuje datę dzienną', () => {
    expect(fmtLabelDate('2026-08-14')).toBe('14.08.2026')
  })

  it('tnie znacznik czasu do daty', () => {
    expect(fmtLabelDate('2026-08-14T07:31:00+02:00')).toBe('14.08.2026')
  })

  it('brak/śmieć → pusto (etykieta nie kłamie datą)', () => {
    expect(fmtLabelDate('')).toBe('')
    expect(fmtLabelDate('14.08.2026')).toBe('')
    expect(fmtLabelDate(undefined)).toBe('')
  })
})

describe('fmtLabelKg — kilogramy po polsku', () => {
  it('przecinek dziesiętny, jedno miejsce', () => {
    expect(fmtLabelKg(245.54)).toBe('245,5')
  })

  it('okrągłe kilogramy bez ogona', () => {
    expect(fmtLabelKg(246)).toBe('246')
  })
})

describe('byproductLabelZpl — etykieta palety ubocznych 50×80', () => {
  it('taśma ma 50 mm szerokości i 80 mm wysokości — nie odwrotnie', () => {
    // Pierwsze wydanie miało 80×50 i drukarka ucinała lewą stronę wierszy.
    expect(LABEL_W_MM).toBe(50)
    expect(LABEL_H_MM).toBe(80)
  })

  it('otwiera i zamyka etykietę, ustawia UTF-8 i rozmiar taśmy', () => {
    const zpl = byproductLabelZpl(BASE)
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^CI28')
    expect(zpl).toContain(`^PW${mmToDots(LABEL_W_MM)}`)
    expect(zpl).toContain(`^LL${mmToDots(LABEL_H_MM)}`)
  })

  it('drukuje wszystkie pięć pól: frakcja, nr porządkowy, waga, daty', () => {
    const zpl = byproductLabelZpl(BASE)
    expect(zpl).toContain('GRZBIETY')
    expect(zpl).toContain('471')
    expect(zpl).toContain('245,5 kg')
    expect(zpl).toContain('14.08.2026')
    expect(zpl).toContain('20.08.2026')
  })

  it('kości mają swój nagłówek', () => {
    expect(byproductLabelZpl({ ...BASE, kind: 'bones' })).toContain('KOŚCI')
  })

  it('nazwa towaru niesie gatunek — „GRZBIETY z kurczaka", w dwóch wierszach', () => {
    // Jeden wiersz „GRZBIETY Z KURCZAKA" ma ~80 mm i nie zmieściłby się na
    // 44 mm pola zadruku — stąd podział na frakcję i gatunek pod spodem.
    const zpl = byproductLabelZpl(BASE)
    expect(zpl).toContain('GRZBIETY')
    expect(zpl).toContain('z kurczaka')
    expect(zpl).not.toContain('GRZBIETY z kurczaka')
  })

  it('brak daty ważności na ćwiartce → pusta wartość, nie „Invalid Date"', () => {
    const zpl = byproductLabelZpl({ ...BASE, expiryDate: '' })
    expect(zpl).toContain('Data ważności')
    expect(zpl).not.toContain('Invalid')
    expect(zpl).not.toContain('NaN')
  })

  it('znaki sterujące ZPL w danych nie rozbijają etykiety', () => {
    const zpl = byproductLabelZpl({ ...BASE, batchNo: '4^71~A' })
    // ^ i ~ z DANYCH znikają; komendy ZPL (^FO/^FD) zostają.
    expect(zpl).toContain('4 71 A')
    expect(zpl).toContain('^FO')
  })

  it('liczba kopii > 1 dokłada ^PQ przed zamknięciem', () => {
    const zpl = byproductLabelZpl(BASE, { copies: 3 })
    expect(zpl).toContain('^PQ3')
    expect(zpl.indexOf('^PQ3')).toBeLessThan(zpl.lastIndexOf('^XZ'))
  })

  it('jedna kopia nie potrzebuje ^PQ', () => {
    expect(byproductLabelZpl(BASE)).not.toContain('^PQ')
  })

  it('inne dpi przelicza współrzędne (drukarka 300 dpi)', () => {
    const zpl = byproductLabelZpl(BASE, { dpi: 300 })
    expect(zpl).toContain(`^PW${mmToDots(LABEL_W_MM, 300)}`)
    expect(zpl).not.toContain(`^PW${mmToDots(LABEL_W_MM, LABEL_DPI)}`)
  })

  it('wszystkie pola mieszczą się w polu zadruku', () => {
    const zpl = byproductLabelZpl(BASE)
    const maxX = mmToDots(LABEL_W_MM)
    const maxY = mmToDots(LABEL_H_MM)
    const coords = [...zpl.matchAll(/\^FO(\d+),(\d+)/g)]
    expect(coords.length).toBeGreaterThan(4)
    for (const [, x, y] of coords) {
      expect(Number(x)).toBeLessThan(maxX)
      expect(Number(y)).toBeLessThan(maxY)
    }
  })

  it('żaden wiersz tekstu nie wychodzi poza szerokość taśmy', () => {
    // Ten test pilnuje pluskwy z 14.08.2026: napisy szersze niż taśma drukarka
    // ucina bez ostrzeżenia, a operator dostaje „ŚCI" zamiast „KOŚCI".
    // Font 0 (CG Triumvirate) ma znaki mniej więcej 0,6 wysokości szerokie —
    // z zapasem, bo cyfry i wielkie litery są węższe.
    const maxX = mmToDots(LABEL_W_MM)
    const zpl = byproductLabelZpl({ ...BASE, kind: 'bones', batchNo: '4718', netKg: 1245.5 })
    const pola = [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)]
    expect(pola.length).toBeGreaterThan(5)
    for (const [, x, , h, tekst] of pola) {
      const szerokosc = tekst.length * Number(h) * 0.6
      expect(Number(x) + szerokosc).toBeLessThanOrEqual(maxX)
    }
  })
})

describe('mmToDots — milimetry → punkty drukarki', () => {
  it('203 dpi: 80 mm ≈ 639 pkt', () => {
    expect(mmToDots(80)).toBe(639)
  })

  it('300 dpi: 80 mm ≈ 945 pkt', () => {
    expect(mmToDots(80, 300)).toBe(945)
  })
})
