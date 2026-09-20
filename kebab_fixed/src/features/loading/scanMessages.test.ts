/**
 * Komunikaty skanu — operator musi wiedzieć, co się stało, w jednym rzucie oka.
 *
 * Sedno: komunikat wynika z KODU backendu, nie z treści zdania. Gdyby front
 * rozpoznawał sytuację po tekście, zmiana słowa po stronie serwera cicho
 * psułaby obsługę błędu na hali.
 */
import { describe, it, expect } from 'vitest'

import { komunikatOdmowy, komunikatSkanu } from './scanMessages'

describe('komunikatSkanu', () => {
  it('sukces mówi wprost, że paleta weszła, i podaje którą', () => {
    const k = komunikatSkanu('SUCCESS', { palletNo: 7, orderNo: 'DEM-S/Z/1/09/26', kg: 412.4 })
    expect(k.ok).toBe(true)
    expect(k.naglowek).toBe('PALETA ZESKANOWANA')
    expect(k.szczegol).toContain('P7')
    expect(k.szczegol).toContain('DEM-S/Z/1/09/26')
    expect(k.szczegol).toContain('412 kg')
  })

  it('powtórzony skan NIE jest sukcesem — inaczej operator liczyłby go drugi raz', () => {
    const k = komunikatSkanu('ALREADY_SCANNED', { palletNo: 3 })
    expect(k.ok).toBe(false)
    expect(k.naglowek).toBe('PALETA JUŻ ZESKANOWANA')
  })

  it('obca paleta: używa zdania backendu, bo tylko on zna numer zamówienia', () => {
    const k = komunikatSkanu('WRONG_ORDER', {
      palletNo: 2,
      wiadomosc: 'Paleta P2 należy do zamówienia YAL/Z/9 (YALCIN) — nie ma go na tym samochodzie',
    })
    expect(k.ok).toBe(false)
    expect(k.naglowek).toBe('PALETA NIE NALEŻY DO TEGO ZAMÓWIENIA')
    expect(k.szczegol).toContain('YALCIN')
  })

  it('zamknięty załadunek kieruje do biura, bo dokument już poszedł', () => {
    const k = komunikatSkanu('ALREADY_COMPLETED')
    expect(k.ok).toBe(false)
    expect(k.naglowek).toBe('ZAMÓWIENIE JUŻ ZREALIZOWANE')
    expect(k.szczegol).toMatch(/biur/i)
  })

  it('paleta na innym aucie NIE udaje powtórzonego skanu', () => {
    const k = komunikatSkanu('ON_OTHER_VEHICLE', {
      palletNo: 5,
      wiadomosc: 'Paleta P5 stoi już na aucie SOLÓWKA KR 1 — zdejmij ją tam albo weź inną paletę',
    })
    expect(k.ok).toBe(false)
    expect(k.naglowek).toBe('PALETA JEST NA INNYM SAMOCHODZIE')
    expect(k.szczegol).toContain('SOLÓWKA')
    // Krytyczne: to NIE może wyglądać jak „już zeskanowana" na tym aucie.
    expect(k.naglowek).not.toBe('PALETA JUŻ ZESKANOWANA')
  })

  it('offline mówi WPROST, że skan nie został zapisany', () => {
    const k = komunikatSkanu('OFFLINE', { palletNo: 1 })
    expect(k.ok).toBe(false)
    expect(k.szczegol).toMatch(/NIE został zapisany/i)
  })

  it('nieznany kod nie wypycha operatorowi technicznego błędu', () => {
    const k = komunikatSkanu('ERROR', { wiadomosc: 'psycopg2.IntegrityError: duplicate key' })
    expect(k.ok).toBe(false)
    expect(k.szczegol).not.toContain('psycopg2')
    expect(k.naglowek).toBe('BŁĄD — SPRÓBUJ PONOWNIE')
  })
})

describe('komunikatOdmowy — operacje na liście auta', () => {
  it('pokazuje POWÓD z serwera, bo tylko on wie, co blokuje', () => {
    const e = new Error('Na aucie stoi 5 palet tego zamówienia — najpierw zdejmij je przyciskiem cofnięcia przy palecie')
    const k = komunikatOdmowy(e, false)
    expect(k.ok).toBe(false)
    expect(k.szczegol).toContain('5 palet')
  })

  it('techniczny błąd NIE trafia na ekran magazyniera', () => {
    const e = new Error('psycopg2.errors.ForeignKeyViolation: relation "x" ...')
    const k = komunikatOdmowy(e, false)
    expect(k.szczegol).not.toContain('psycopg2')
    expect(k.szczegol).toMatch(/Spróbuj ponownie/i)
  })

  it('brak sieci ma pierwszeństwo przed treścią błędu', () => {
    const k = komunikatOdmowy(new TypeError('Failed to fetch'), true)
    expect(k.naglowek).toMatch(/BRAK POŁĄCZENIA/)
  })
})
