/**
 * Listy kart HACCP do pobrania (historie kart).
 *
 * Karty HACCP to PUSTE formularze papierowe — MES ich nie przechowuje, tylko
 * numeruje. „Historia" jest więc listą kart, które w danym okresie powinny
 * istnieć: biuro wybiera dzień i pobiera gotową, ponumerowaną kartę.
 *
 * Numery liczą TE SAME funkcje, co strony wydruku — inaczej lista i karta
 * mogłyby pokazywać różne numery tego samego dokumentu.
 */
import { cardPeriod } from './temperatureLogCard'

export interface HaccpCardRow {
  /** Dzień identyfikujący kartę (ISO) — trafia do URL wydruku i do PDF. */
  day: string
  /** Numer karty. */
  no: string
  /** Okres karty w formie czytelnej dla człowieka. */
  when: string
  /** Dopisek pod okresem (np. dzień tygodnia). */
  note?: string
  /** Karta obejmująca dzisiejszy dzień. */
  current?: boolean
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Dzień roboczy zakładu: pon–sob. W niedziele zakład nie pracuje, więc nie ma
 * czego dopuszczać do pracy — karta na niedzielę byłaby pustym drukiem
 * rozbijającym ciąg kart. Sobota ZOSTAJE: rozbiór w soboty idzie normalnie,
 * a każdy dzień produkcyjny musi mieć swoją kartę dopuszczenia.
 */
export const isWorkday = (d: Date) => d.getDay() !== 0

/**
 * Numer karty arkusza kontroli sanitarnej — `<nr>/MM/RR`.
 *
 * Numer jest PORZĄDKOWY w miesiącu: liczy KARTY, nie dni kalendarza. Wcześniej
 * brano wprost dzień miesiąca, więc każda niedziela robiła dziurę — sobota
 * 1.08 → 1/08, poniedziałek 3.08 → 3/08 (zgłoszenie 2026-08-05). Inspekcja
 * czyta karty jako kolejne dokumenty, więc muszą iść 1, 2, 3…
 *
 * Ta sama zasada co w numerze karty raportu rozbioru (`lib/haccpReportNo`), z
 * jedną różnicą: tam dni produkcyjne biorą się z danych, tu z kalendarza —
 * arkusz jest pustym drukiem i nie ma o co pytać backendu.
 *
 * Reset z nowym miesiącem.
 */
export const sanitaryCardNo = (d: Date) => {
  let nth = 0
  for (let day = 1; day <= d.getDate(); day++) {
    if (isWorkday(new Date(d.getFullYear(), d.getMonth(), day))) nth++
  }
  // Niedziela nie ma własnej karty (nie trafia na listę), ale ktoś może wejść
  // na wydruk z ręcznie wpisaną datą — dostaje wtedy numer kolejny po ostatnim
  // dniu roboczym, tak jak dzień spoza listy w haccpReportNo.
  if (!isWorkday(d)) nth += 1
  return `${nth}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
}

/** Kolejne dni ROBOCZE wstecz od `today` — po jednej karcie arkusza na dzień. */
export function sanitaryCards(count: number, today = new Date()): HaccpCardRow[] {
  const start = midnight(today)
  const rows: HaccpCardRow[] = []
  // Pętla po kolejnych dniach wstecz, bo dni robocze nie są równo rozłożone —
  // ograniczenie z góry to czysty bezpiecznik, nie logika (na 7 dni kalendarza
  // przypada 6 roboczych, więc pętla zawsze dobija do `count`).
  for (let back = 0; rows.length < count && back < count * 2 + 14; back++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() - back)
    if (!isWorkday(d)) continue
    rows.push({
      day: iso(d),
      no: sanitaryCardNo(d),
      when: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      note: d.toLocaleDateString('pl-PL', { weekday: 'short' }),
      // „bieżąca" tylko wtedy, gdy DZIŚ jest dniem roboczym — w niedzielę
      // żadna karta nie jest bieżąca (sobotnia jest już zamknięta).
      current: back === 0,
    })
  }
  return rows
}

/**
 * Numer karty rejestru przyjęcia (1.1.1 i 1.1.1/2) — `MM/RRRR`.
 *
 * Rejestr idzie MIESIĄCAMI, nie dniami ani tygodniami: jeden wiersz to jedna
 * dostawa, a tych bywa kilka na tydzień — karta dzienna byłaby w większości
 * pusta. Gdy miesiąc nie mieści się na jednej kartce, biuro dodrukowuje kolejną
 * i wpisuje ręcznie „Strona" (na karcie jest na to pole) — dlatego numer karty
 * NIE zawiera numeru strony.
 */
export const receptionCardNo = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

/** Kolejne miesiące wstecz od `today` — po jednej karcie rejestru na miesiąc. */
export function receptionCards(count: number, today = new Date()): HaccpCardRow[] {
  return Array.from({ length: count }, (_, i) => {
    const first = new Date(today.getFullYear(), today.getMonth() - i, 1)
    return {
      day: iso(first),
      no: receptionCardNo(first),
      when: first.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }),
      note: 'miesiąc',
      current: i === 0,
    }
  })
}

/** Kolejne tygodnie wstecz od `today` — po jednej karcie temperatur na tydzień. */
export function temperatureCards(count: number, today = new Date()): HaccpCardRow[] {
  const start = midnight(today)
  return Array.from({ length: count }, (_, i) => {
    const seed = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i * 7)
    const { no, days } = cardPeriod(seed)
    const first = days[0]
    const last = days[days.length - 1]
    return {
      day: iso(first),
      no,
      when: `${dm(first)} – ${dm(last)}.${last.getFullYear()}`,
      note: 'pon–ndz',
      current: i === 0,
    }
  })
}
