/**
 * receptionPreview — arkusz dostawy do CZYTANIA.
 *
 * POWÓD ISTNIENIA: żeby zobaczyć, co właściwie przyjechało pod danym numerem
 * przyjęcia, biuro musiało otworzyć EDYCJĘ dokumentu (biuro, 22.08.2026).
 * Otwarty formularz edycji to zaproszenie do przypadkowej zmiany w dokumencie,
 * który bywa już rozliczony — a czasem po prostu nie da się go otworzyć, bo
 * pozycja jest zamrożona. Podgląd niczego nie zapisuje i działa też na
 * dostawach z historii.
 *
 * Tu siedzi tylko rachunek arkusza; rysowanie jest w `ReceptionPreviewPage`.
 * Czysta funkcja bez DOM — testowana jednostkowo.
 */
import { containersForKg } from '@/lib/containers'

import type { Reception, ReceptionBatch } from './types'

export interface ReceptionPreviewRow {
  batch: ReceptionBatch
  cancelled: boolean
  /** Pojemniki tej pozycji; null = surowiec niekalibrowany. */
  containers: number | null
  /** Partie dostawcy złożone na ten numer porządkowy. */
  supplierLots: string[]
}

export interface ReceptionPreviewSummary {
  /** Kilogramy pozycji CZYNNYCH — anulowane nie jadą do sumy dokumentu. */
  kg: number
  kgCancelled: number
  /** Ile z przyjętych kilogramów już zeszło (rozbiór, wydania, masowanie). */
  kgUsed: number
  batches: number
  cancelledBatches: number
  supplierLots: number
  /** Pojemniki razem; null = choć jedna pozycja bez kalibru. */
  containers: number | null
  /** Najkrótszy termin w dokumencie — po nim idzie FEFO. */
  earliestExpiry: string
}

/** Numer porządkowy anulowany — zostaje w dokumencie, ale nie liczy się do sum. */
function isCancelled(b: ReceptionBatch): boolean {
  return b.status === 'cancelled'
}

export function previewRows(rec: Reception | null | undefined): ReceptionPreviewRow[] {
  return (rec?.batches ?? []).map(b => ({
    batch: b,
    cancelled: isCancelled(b),
    containers: b.containersCount ?? containersForKg(b.kgReceived, b.containerKg ?? null),
    supplierLots: Array.from(new Set(
      ((b.supplierBatches ?? []).length > 0
        ? b.supplierBatches.map(s => s.supplierBatchNo)
        : [b.supplierBatchNo]
      ).map(n => (n ?? '').trim()).filter(Boolean))),
  }))
}

export function receptionPreviewSummary(rec: Reception | null | undefined): ReceptionPreviewSummary {
  const wiersze = previewRows(rec)
  const czynne = wiersze.filter(w => !w.cancelled)

  // Pojemniki sumujemy TYLKO wtedy, gdy każda czynna pozycja umie je podać.
  // Suma z pominięciem niekalibrowanej pozycji wyglądałaby na pełną i biuro
  // zamówiłoby za mało zawieszek.
  const brakKalibru = czynne.some(w => w.containers === null)
  const containers = brakKalibru
    ? null
    : czynne.reduce((s, w) => s + (w.containers ?? 0), 0)

  const terminy = czynne.map(w => w.batch.expiryDate).filter(Boolean).sort()

  return {
    kg: czynne.reduce((s, w) => s + Number(w.batch.kgReceived || 0), 0),
    kgCancelled: wiersze.filter(w => w.cancelled)
      .reduce((s, w) => s + Number(w.batch.kgReceived || 0), 0),
    kgUsed: czynne.reduce((s, w) => s + Number(w.batch.kgUsed || 0), 0),
    batches: czynne.length,
    cancelledBatches: wiersze.length - czynne.length,
    supplierLots: new Set(czynne.flatMap(w => w.supplierLots)).size,
    containers,
    earliestExpiry: terminy[0] ?? '',
  }
}
