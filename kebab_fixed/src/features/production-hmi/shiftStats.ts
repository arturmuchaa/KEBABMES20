/**
 * Statystyki zmiany produkcyjnej — wyniki pracowników i tempo.
 *
 * Tempo w KILOGRAMACH na godzinę. Sztuka sztuce nierówna: 40 kg i 10 kg to
 * inna praca, a tempo w sztukach karałoby za robienie dużych kebabów.
 *
 * Wyniki NIE wchodzą na ekran główny — mają nie mieszać się operatorowi
 * w robocie (ta sama zasada co na rozbiorze). Ekran „Statystyki zmiany"
 * ogląda się świadomie.
 */
import { workedMs, type BreakState } from './breakState'

export interface ShiftEntry {
  worker: string
  pieces: number
  kgPerPiece: number
  at: string
}

export interface ShiftWindow {
  /** Start liczenia — pierwszy zapis sztuki na zmianie. */
  from: string
  now: string
  pauses: BreakState
}

/** Rozbicie na wagi sztuk: „5 × 40 kg · 10 × 20 kg". */
export interface Split { kgPerPiece: number; pieces: number }

export interface WorkerStats {
  worker: string
  kg: number
  pieces: number
  kgPerHour: number
  split: Split[]
}

export interface ShiftTotals {
  kg: number
  pieces: number
  kgPerHour: number
  workers: number
  workedMs: number
}

export interface ShiftStats {
  perWorker: WorkerStats[]
  total: ShiftTotals
}

const tempo = (kg: number, pracaMs: number): number =>
  pracaMs > 0 ? Math.round(kg / (pracaMs / 3_600_000)) : 0

export function shiftStats(entries: readonly ShiftEntry[], okno: ShiftWindow): ShiftStats {
  const praca = workedMs(okno.from, okno.now, okno.pauses)

  const wg = new Map<string, { kg: number; pieces: number; wagi: Map<number, number> }>()
  for (const w of entries ?? []) {
    const kto = String(w?.worker ?? '')
    if (!kto) continue
    const szt = Number(w?.pieces ?? 0)
    const kgSzt = Number(w?.kgPerPiece ?? 0)
    const rek = wg.get(kto) ?? { kg: 0, pieces: 0, wagi: new Map<number, number>() }
    rek.kg += szt * kgSzt
    rek.pieces += szt
    rek.wagi.set(kgSzt, (rek.wagi.get(kgSzt) ?? 0) + szt)
    wg.set(kto, rek)
  }

  const perWorker: WorkerStats[] = [...wg.entries()]
    .map(([worker, r]) => ({
      worker,
      kg: r.kg,
      pieces: r.pieces,
      kgPerHour: tempo(r.kg, praca),
      split: [...r.wagi.entries()]
        .map(([kgPerPiece, pieces]) => ({ kgPerPiece, pieces }))
        .sort((a, b) => b.kgPerPiece - a.kgPerPiece),
    }))
    .sort((a, b) => b.kg - a.kg)

  const kg = perWorker.reduce((s, w) => s + w.kg, 0)
  const pieces = perWorker.reduce((s, w) => s + w.pieces, 0)

  return {
    perWorker,
    total: { kg, pieces, kgPerHour: tempo(kg, praca), workers: perWorker.length, workedMs: praca },
  }
}
