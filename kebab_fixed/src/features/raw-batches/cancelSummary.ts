import { fmtKg, fmtDatePl } from '@/lib/utils'
import type { RawBatch } from './types'

/**
 * Tożsamość partii pokazywana w oknie anulowania.
 *
 * POWÓD ISTNIENIA: okno pytało tylko „czy na pewno usunąć partię 492?" — sam
 * numer. Na liście stały obok siebie 492, 493 i 494 od dwóch dostawców i
 * operator potwierdzał w ciemno. Prod 2026-08-19: anulowano SZUMERĘ 4700 kg
 * mięsa z/s zamiast dostawy KOKO wpisanej pod złym rodzajem surowca — pomyłkę
 * wykryto dopiero po tym, jak w magazynie zabrakło 4700 kg.
 *
 * Dostawcę pokazujemy nazwą, której biuro używa na co dzień
 * (`supplierDisplayName`, np. „SZUMERA"), bo pełna nazwa z KRS-u jest w tabeli
 * ucinana i dwie spółki wyglądają wtedy tak samo.
 */
export interface PodsumowanieAnulowania {
  readonly numer: string
  readonly dostawca: string
  readonly surowiec: string
  readonly kg: string
  readonly data: string
}

const PUSTE = '—'

export function podsumowanieAnulowania(batch: RawBatch): PodsumowanieAnulowania {
  const dostawca = (batch.supplierDisplayName || batch.supplierName || '').trim()
  const surowiec = (batch.materialName || '').trim()
  return {
    numer: batch.internalBatchNo || PUSTE,
    dostawca: dostawca || PUSTE,
    surowiec: surowiec || PUSTE,
    // Bez miejsc po przecinku — dostawy chodzą w pełnych kilogramach, a
    // „4700 kg" czyta się w pół sekundy, „4700,00 kg" już nie.
    kg: `${fmtKg(batch.kgReceived ?? 0, 0)} kg`,
    data: batch.receivedDate ? fmtDatePl(batch.receivedDate) : PUSTE,
  }
}
