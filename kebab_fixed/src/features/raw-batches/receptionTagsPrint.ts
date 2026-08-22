/**
 * Co dokładnie leci na drukarkę przy druku zawieszek.
 *
 * Wydzielone ze strony, żeby dało się to sprawdzić testem: dwie regresje pod
 * rząd (22.08.2026) wzięły się nie z układu etykiety, tylko z tego, CO strona
 * dokleja do wydruku. Reguły są dwie i obie mają swój test:
 *
 *  1. Seria idzie JEDNYM zadaniem — nie zadanie na zawieszkę.
 *  2. Wydruk NIE niesie nastaw trwałych drukarki (`~TA`, `~JC`). Punkt
 *     odrywania zapisuje się w drukarce i ma tam zostać; wysyłany przed każdą
 *     serią kasował go wartością z ekranu — przy domyślnym zerze każdy wydruk
 *     robił cichaczem `~TA000` i biuro nie było w stanie ustawić cięcia,
 *     bo następny druk cofał poprawkę.
 */
import { receptionTagsStreamZpl, type ReceptionTagInput } from './receptionTagZpl'
import type { TagPrinterCalibration } from './tagPrinterCalibration'

/**
 * Zadania do wysłania na drukarkę dla całej serii zawieszek.
 * Pusta seria = brak zadań: pusty format tylko wypluwa czystą etykietę.
 */
export function receptionTagsPrintJobs(
  tags: readonly ReceptionTagInput[],
  calibration: TagPrinterCalibration,
): string[] {
  if (tags.length === 0) return []
  return [
    receptionTagsStreamZpl(tags, {
      offsetXMm: calibration.offsetXMm,
      offsetYMm: calibration.offsetYMm,
      labelLengthMm: calibration.labelLengthMm,
    }),
  ]
}
