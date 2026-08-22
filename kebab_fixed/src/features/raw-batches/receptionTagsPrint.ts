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
