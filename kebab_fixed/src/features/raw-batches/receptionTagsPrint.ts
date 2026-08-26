/**
 * Co dokładnie leci na drukarkę przy druku zawieszek.
 *
 * Wydzielone ze strony, żeby dało się to sprawdzić testem: wszystkie regresje
 * z 22.08.2026 wzięły się nie z układu etykiety, tylko z tego, CO strona
 * dokleja do wydruku. Reguły są trzy i każda ma swój test:
 *
 *  1. Zadanie na KAŻDĄ zawieszkę — tak działał druk, zanim zacząłem przy nim
 *     majstrować. Sklejenie serii w jeden strumień było moim pomysłem, nie
 *     prośbą hali, i zbiegło się w czasie z rozjechanym cięciem; wracamy do
 *     wersji, która działała.
 *  2. Każdy format niesie własne `^LL` i `^MNY` — bez nich GC420t bierze
 *     długość zapisaną u siebie i urywa wydruk w 3/4 etykiety.
 *  3. Wydruk NIE niesie nastaw trwałych drukarki (`~TA`, `~JC`). Punkt
 *     odrywania zapisuje się w drukarce i ma tam zostać; wysyłany przed każdą
 *     serią kasował go wartością z ekranu — przy domyślnym zerze każdy wydruk
 *     robił cichaczem `~TA000` i biuro nie było w stanie ustawić cięcia.
 */
import { receptionTagZpl, type ReceptionTagInput } from './receptionTagZpl'
import type { TagPrinterCalibration } from './tagPrinterCalibration'

/**
 * Zadania do wysłania na drukarkę dla całej serii zawieszek — po jednym na
 * zawieszkę. `^PQ` nie wchodzi w grę: każda ma inny numer palety i inną wagę.
 */
export function receptionTagsPrintJobs(
  tags: readonly ReceptionTagInput[],
  calibration: TagPrinterCalibration,
): string[] {
  return tags.map(tag => receptionTagZpl(tag, {
    offsetXMm: calibration.offsetXMm,
    offsetYMm: calibration.offsetYMm,
    labelLengthMm: calibration.labelLengthMm,
  }))
}

/**
 * Ile czekać między zawieszkami serii, żeby drukarka zdążyła dojechać do
 * punktu odrywania.
 *
 * BrowserPrint oddaje sterowanie w chwili PRZEKAZANIA danych, nie po
 * wydrukowaniu. Bez tej przerwy sześć zawieszek ląduje w buforze w kilkanaście
 * milisekund, a GC420t drukuje pełny bufor jednym ciągiem — dosuw do krawędzi
 * robi dopiero po ostatniej, więc wcześniejsze biuro odrywa w poprzek
 * (zgłoszenie 26.08.2026; przy pojedynczej zawieszce problemu nie ma).
 *
 * Liczymy z długości etykiety i prędkości druku, z zapasem na dosuw i cofnięcie
 * taśmy. Sufit 3 s pilnuje, żeby błędna nastawa nie zawiesiła druku na minuty.
 */
const PREDKOSC_MM_S = 100   // GC420t domyślnie ~4 cale/s
const DOSUW_MM = 25         // dojazd do krawędzi odrywania i powrót

export function tagPrintDelayMs(labelLengthMm: number): number {
  const dlugosc = Number.isFinite(labelLengthMm) && labelLengthMm > 0 ? labelLengthMm : 0
  const ms = ((dlugosc + DOSUW_MM) / PREDKOSC_MM_S) * 1000 * 1.25
  return Math.round(Math.min(3000, Math.max(600, ms)))
}
