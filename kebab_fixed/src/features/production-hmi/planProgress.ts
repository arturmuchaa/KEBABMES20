/**
 * Sumy, procenty i stany pozycji planu produkcji.
 *
 * Postęp DNIA liczymy w kilogramach (plan rozlicza się w kg; procent ze sztuk
 * kłamałby, bo sztuka sztuce nierówna). Postęp POZYCJI liczymy w sztukach —
 * w jednym wierszu waga sztuki jest stała, więc obie miary dają to samo,
 * a sztuki są tym, co operator właśnie odlicza.
 */

export interface WorkerEntry {
  workerId: string
  workerName: string
  pieces: number
  addedAt: string
}

/** Tyle z pozycji planu, ile potrzeba do liczenia postępu. */
export interface ProgressLine {
  id: string
  qty: number
  kgPerUnit: number
  qtyDone: number
  workerEntries?: WorkerEntry[]
}

export interface PlanTotals {
  kgPlan: number
  kgDone: number
  /** Procent dnia — z KILOGRAMÓW, 0–100, zaokrąglony. */
  pct: number
  sztPlan: number
  sztDone: number
}

const pct = (zrobione: number, plan: number): number =>
  plan > 0 ? Math.min(100, Math.round((zrobione / plan) * 100)) : 0

export function planTotals(lines: readonly ProgressLine[]): PlanTotals {
  let kgPlan = 0, kgDone = 0, sztPlan = 0, sztDone = 0
  for (const l of lines ?? []) {
    const qty = Number(l?.qty ?? 0)
    const kg  = Number(l?.kgPerUnit ?? 0)
    // Nadwyżki nie liczymy do postępu dnia — hala potrafi zrobić 23 z 20,
    // ale plan nie urósł, więc dzień nie jest zrobiony w 115%.
    const done = Math.min(Number(l?.qtyDone ?? 0), qty)
    kgPlan  += qty * kg
    kgDone  += done * kg
    sztPlan += qty
    sztDone += Number(l?.qtyDone ?? 0)
  }
  return { kgPlan, kgDone, pct: pct(kgDone, kgPlan), sztPlan, sztDone }
}

export type LineState = 'PLANNED' | 'IN_PROGRESS' | 'DONE'

export function lineState(line: ProgressLine): LineState {
  const qty = Number(line?.qty ?? 0)
  const done = Number(line?.qtyDone ?? 0)
  if (done >= qty) return 'DONE'   // pozycja na 0 szt. jest gotowa od razu
  if (done > 0) return 'IN_PROGRESS'
  return 'PLANNED'
}

export function linePct(line: ProgressLine): number {
  const qty = Number(line?.qty ?? 0)
  if (qty <= 0) return 100
  return pct(Number(line?.qtyDone ?? 0), qty)
}

export interface WorkerTally { workerId: string; workerName: string; pieces: number }

/** Kto ile zrobił z tej pozycji — wpisy tej samej osoby sumowane, największy pierwszy. */
export function byWorker(line: ProgressLine): WorkerTally[] {
  const wg = new Map<string, WorkerTally>()
  for (const w of line?.workerEntries ?? []) {
    const id = String(w?.workerId ?? w?.workerName ?? '')
    if (!id) continue
    const było = wg.get(id)
    if (było) było.pieces += Number(w?.pieces ?? 0)
    else wg.set(id, { workerId: id, workerName: String(w?.workerName ?? ''), pieces: Number(w?.pieces ?? 0) })
  }
  return [...wg.values()].sort((a, b) => b.pieces - a.pieces)
}
