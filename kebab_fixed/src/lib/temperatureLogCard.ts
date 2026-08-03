/**
 * Numeracja i zakres kart kontroli temperatury (TemperatureLogPrintPage).
 *
 * Odczyt jest RAZ DZIENNIE — instrukcja 5.1 PRPs mówi tylko „oceny dokonuje
 * się codziennie", a temperaturę odnotowuje się w ramach obchodu SSZiZ;
 * nigdzie nie ma drugiego pomiaru w ciągu dnia (ciągły zapis prowadzi
 * centralny system rejestracji).
 *
 * Karta obejmuje jeden tydzień kalendarzowy (pon–ndz), a numeracja startuje
 * od nowa co miesiąc: `NN/MM/RRRR`, gdzie NN to kolejny tydzień miesiąca
 * (tydzień 27.07–02.08.2026 = `01/08/2026`, bo kończy się już w sierpniu).
 * Numer wynika więc z daty — nie ma licznika w bazie, a dwie osoby drukujące
 * ten sam tydzień dostają tę samą kartę.
 */

/** Dni w karcie — tydzień pon–ndz. */
export const CARD_DAYS = 7

/**
 * Tydzień pon–ndz zawierający `seed` wraz z numerem karty.
 *
 * Tydzień należy do miesiąca swojej NIEDZIELI, czyli dnia, którym się kończy.
 * Dzięki temu 1–2 sierpnia 2026 (sob–ndz) trafiają na kartę 01/08/2026, a nie
 * na lipcową — miesiąc zaczyna się pierwszą kartą, na której w ogóle pojawia
 * się jego data. Każdy tydzień ma dokładnie jedną niedzielę, więc numeracja
 * nie ma ani dziur, ani duplikatów.
 */
export function cardPeriod(seed: Date): { no: string; days: Date[] } {
  const monday = new Date(seed.getFullYear(), seed.getMonth(), seed.getDate() - ((seed.getDay() + 6) % 7))
  const days = Array.from({ length: CARD_DAYS }, (_, i) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
  // niedziele miesiąca padają na dni 1-7, 8-14, … — numer wprost z daty
  const sunday = days[CARD_DAYS - 1]
  const nth = Math.floor((sunday.getDate() - 1) / 7) + 1
  const mm = String(sunday.getMonth() + 1).padStart(2, '0')
  return { no: `${String(nth).padStart(2, '0')}/${mm}/${sunday.getFullYear()}`, days }
}
