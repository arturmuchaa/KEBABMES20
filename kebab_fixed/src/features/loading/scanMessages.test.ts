/**
 * Komunikaty skanu — operator musi wiedzieć, co się stało, w jednym rzucie oka.
 *
 * Sedno: komunikat wynika z KODU backendu, nie z treści zdania. Gdyby front
 * rozpoznawał sytuację po tekście, zmiana słowa po stronie serwera cicho
 * psułaby obsługę błędu na hali.
 */
import { describe, it, expect } from 'vitest'

import { komunikatOdmowy, komunikatPozaKolejnoscia, komunikatSkanu } from './scanMessages'

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


describe('komunikatPozaKolejnoscia', () => {
  // Hala (21.09.2026): „POLAT → POTRM → NAZAR — czy blokuje NAZARA między
  // POLAT-em?". Nie blokuje: paleta wchodzi, ekran świeci na żółto.
  const POZA = {
    pozycja: 3,
    czeka: { orderNo: 'POLAT/Z/1/09/26', clientName: 'POLAT', pozycja: 1, loaded: 4, total: 9 },
  }

  it('mówi WPROST, że paleta jednak weszła', () => {
    const k = komunikatPozaKolejnoscia(POZA, { palletNo: 2 })
    expect(k.ok).toBe(true)
    expect(k.ton).toBe('uwaga')
    expect(k.naglowek).toContain('ZALICZONA')
  })

  it('nazywa, kto czeka i na ile palet', () => {
    const k = komunikatPozaKolejnoscia(POZA, { palletNo: 2 })
    expect(k.szczegol).toContain('POLAT')
    expect(k.szczegol).toContain('4 z 9')
    expect(k.szczegol).toContain('3.')
  })

  it('bez nazwy klienta bierze numer zamówienia', () => {
    const k = komunikatPozaKolejnoscia(
      { ...POZA, czeka: { ...POZA.czeka, clientName: '' } }, { palletNo: 2 })
    expect(k.szczegol).toContain('POLAT/Z/1/09/26')
  })
})

// ─── Incydent 24.09.2026: komunikat odmowy przy POTWIERDZENIU ───────────
//
// Auto załadowane, wszystko zeskanowane, „Potwierdź" → „Skan nie został
// przyjęty, zawołaj biuro". Backend mówił konkretnie, czego brakuje, ale
// ekran wtłaczał tę odmowę w słownik kodów SKANU i lądował w gałęzi
// domyślnej — jedyna użyteczna informacja ginęła.
describe('odmowa potwierdzenia załadunku', () => {
  const ZDANIE = 'YALCIN/Z/7/09/26: brakuje na stanie — '
    + 'KEBAB UDO 100% BEYAZ AFIYET 40 kg: 1 szt (rozpis 40, stan 39)'

  it('pokazuje zdanie backendu, a nie ogólnik', () => {
    const k = komunikatOdmowy(new Error(ZDANIE), false)
    expect(k.szczegol).toBe(ZDANIE)
    expect(k.szczegol).not.toMatch(/zawołaj biuro/i)
  })

  it('prawdziwy komunikat mieści się w limicie ekranu', () => {
    // Backend tnie listę braków do 220 znaków — gdyby przekroczył, ekran
    // zamieniłby go na ogólnik i wróciłby dokładnie zgłoszony problem.
    expect(ZDANIE.length).toBeLessThanOrEqual(220)
  })

  it('techniczny wyciek nadal nie idzie do magazyniera', () => {
    const k = komunikatOdmowy(new Error('psycopg2.errors.ForeignKeyViolation: ...'), false)
    expect(k.szczegol).toMatch(/Operacja nie przeszła/i)
  })

  it('brak sieci wygrywa z treścią błędu', () => {
    expect(komunikatOdmowy(new Error(ZDANIE), true).naglowek).toMatch(/BRAK POŁĄCZENIA/i)
  })
})
