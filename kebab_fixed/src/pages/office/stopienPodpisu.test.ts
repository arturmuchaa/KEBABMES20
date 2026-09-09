import { describe, expect, it } from 'vitest'
import { stopienPodpisu } from './ReceptionRegisterPrintPage'

/**
 * Opis pod podpisem na karcie 1.1.1 — imię, nazwisko, data i godzina.
 *
 * Właściciel (2026-09-09): „pod podpisem informacja aby mieściła się w jednej
 * linijce imię nazwisko data i czas, aby nie przeskakiwało na dół nawet przy
 * dłuższym nazwisku".
 *
 * Wcześniej karta celowo ZAWIJAŁA długie nazwisko — dwie linijki uznano za
 * mniejsze zło niż ucięcie. Teraz jedna linia jest warunkiem, więc ustąpić
 * musi stopień pisma.
 */
const opis = (nazwisko: string) => `${nazwisko}  09.09.2026 09:30`

describe('stopienPodpisu', () => {
  it('krótki podpis dostaje pełny stopień pisma', () => {
    expect(stopienPodpisu(opis('JAN NOWAK'))).toBe(3.9)
  })

  it('długie nazwisko schodzi niżej, żeby zostać w jednej linii', () => {
    const krotkie = stopienPodpisu(opis('JAN NOWAK'))
    const dlugie = stopienPodpisu(opis('KATARZYNA KSIĘŻYC-WIŚNIEWSKA'))
    expect(dlugie).toBeLessThan(krotkie)
  })

  it('nigdy nie schodzi poniżej progu czytelności', () => {
    const absurd = stopienPodpisu(opis('A'.repeat(200)))
    expect(absurd).toBe(2.4)
  })

  it('nigdy nie przekracza stopnia bazowego', () => {
    expect(stopienPodpisu('X')).toBe(3.9)
    expect(stopienPodpisu('')).toBe(3.9)
  })

  it('szersza kratka pozwala na większe pismo', () => {
    const tekst = opis('KATARZYNA KSIĘŻYC-WIŚNIEWSKA')
    expect(stopienPodpisu(tekst, 30)).toBeGreaterThan(stopienPodpisu(tekst, 21))
  })
})

describe('stopienPodpisu — czy tekst NAPRAWDĘ się mieści', () => {
  /** Szerokość tekstu w mm przy danym stopniu pisma (Arial ≈ 0,5 em/znak). */
  const szerokoscMm = (tekst: string, pt: number) => tekst.length * 0.5 * pt * 0.3528

  // Nazwiska, które wchodzą z PEŁNĄ datą — sam dobór stopnia wystarcza.
  // Dłuższe (Brzęczyszczykiewicz) wymagają już skrócenia daty i pilnuje
  // ich `opisPodpisu` niżej: ta funkcja tylko dobiera stopień w widełkach
  // i przy minimum czytelności świadomie się poddaje.
  const NAZWISKA = [
    'JAN NOWAK',
    'ARTUR MUCHA',
    'KATARZYNA KSIĘŻYC',
  ]

  it.each(NAZWISKA)('„%s" mieści się w kratce 21 mm', (nazwisko) => {
    const tekst = opis(nazwisko)
    const pt = stopienPodpisu(tekst)
    // 1,2 mm zapasu na marginesy kratki — tyle samo, co w funkcji.
    expect(szerokoscMm(tekst, pt)).toBeLessThanOrEqual(21 - 1.2 + 0.01)
  })

  it('przy bardzo długim nazwisku zatrzymuje się na minimum czytelności', () => {
    // Nie udaje, że zmieściła — jedną linię gwarantuje dopiero opisPodpisu.
    expect(stopienPodpisu(opis('PRZEMYSŁAW BRZĘCZYSZCZYKIEWICZ'))).toBe(2.4)
  })

  it('typowy podpis nie robi się bez potrzeby drobny', () => {
    // Kontrola przeciwna: gdyby funkcja zawsze oddawała minimum, testy wyżej
    // też by przeszły, a karta byłaby nieczytelna.
    expect(stopienPodpisu(opis('ARTUR MUCHA'))).toBeGreaterThanOrEqual(2.9)
  })
})


// ── Degradacja: gdy nawet minimalne pismo nie starcza ─────────────────
import { opisPodpisu } from './ReceptionRegisterPrintPage'

/** Szerokość tekstu w mm przy danym stopniu pisma. */
const mm = (tekst: string, pt: number) => tekst.length * 0.5 * pt * 0.3528

describe('opisPodpisu — jedna linia bez wyjątków', () => {
  it('typowy podpis zostaje z pełną datą', () => {
    const { tekst } = opisPodpisu('ARTUR MUCHA', '09.09.2026 09:30')
    expect(tekst).toBe('ARTUR MUCHA  09.09.2026 09:30')
  })

  it('bardzo długie nazwisko traci ROK, nie linię', () => {
    const { tekst } = opisPodpisu('PRZEMYSŁAW BRZĘCZYSZCZYKIEWICZ', '09.09.2026 09:30')
    expect(tekst).toBe('PRZEMYSŁAW BRZĘCZYSZCZYKIEWICZ  09.09 09:30')
  })

  it.each([
    'JAN NOWAK',
    'ARTUR MUCHA',
    'KATARZYNA KSIĘŻYC',
    'MAŁGORZATA WIŚNIEWSKA-KOWALCZYK',
    'PRZEMYSŁAW BRZĘCZYSZCZYKIEWICZ',
  ])('„%s" NAPRAWDĘ mieści się w kratce', (nazwisko) => {
    const { tekst, pt } = opisPodpisu(nazwisko, '09.09.2026 09:30')
    expect(mm(tekst, pt)).toBeLessThanOrEqual(21 - 1.2 + 0.01)
  })

  it('sam podpis bez nazwiska i daty nie tworzy pustego napisu', () => {
    expect(opisPodpisu(undefined, undefined).tekst).toBe('')
  })

  it('nazwisko bez daty też działa', () => {
    expect(opisPodpisu('ARTUR MUCHA', undefined).tekst).toBe('ARTUR MUCHA')
  })
})
