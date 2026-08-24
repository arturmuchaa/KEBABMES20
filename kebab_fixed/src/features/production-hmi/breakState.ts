/**
 * Przerwy zmiany produkcyjnej.
 *
 * Produkcja ma około trzech przerw dziennie. Bez ich odliczenia tempo liczone
 * od pierwszego zapisu jest zaniżone o czas, którego nikt nie przepracował.
 *
 * Przerwa BLOKUJE dodawanie sztuk — to nie jest efekt uboczny, tylko cała
 * pointa: zapomniana przerwa zatrzymuje robotę, zamiast po cichu zawyżać
 * tempo. Operator poprawia ją natychmiast, bo inaczej nie zapisze pracy.
 */

export interface Pause {
  from: string
  /** `null` = przerwa trwa. */
  to: string | null
}

export interface BreakState {
  pauses: Pause[]
}

export const BRAK_PRZERW: BreakState = { pauses: [] }

const ms = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

export function onBreak(state: BreakState): boolean {
  return (state?.pauses ?? []).some(p => p.to === null)
}

/** Czy wolno zapisać sztuki. W trakcie przerwy — nie. */
export function canSave(state: BreakState): boolean {
  return !onBreak(state)
}

/** Start przerwy. Wciśnięcie w trakcie przerwy nie otwiera drugiej. */
export function breakStarted(state: BreakState, now: string): BreakState {
  if (onBreak(state)) return state
  return { pauses: [...(state?.pauses ?? []), { from: now, to: null }] }
}

/** Koniec przerwy. Bez otwartej przerwy nie robi nic — kliknięcie dwa razy
 *  nie może dopisać drugiego odcinka do sumy. */
export function breakEnded(state: BreakState, now: string): BreakState {
  if (!onBreak(state)) return state
  return { pauses: (state.pauses ?? []).map(p => (p.to === null ? { ...p, to: now } : p)) }
}

/** Suma przerw; trwająca liczona do `now`. */
export function pausedMs(state: BreakState, now: string): number {
  return (state?.pauses ?? []).reduce((sum, p) => {
    const koniec = p.to === null ? ms(now) : ms(p.to)
    return sum + Math.max(0, koniec - ms(p.from))
  }, 0)
}

/** Czas PRACY: zegarowy minus część przerw mieszcząca się w oknie zmiany. */
export function workedMs(from: string, now: string, state: BreakState): number {
  const start = ms(from), end = ms(now)
  if (end <= start) return 0
  const przerwy = (state?.pauses ?? []).reduce((sum, p) => {
    // Liczy się tylko część przerwy wspólna z oknem zmiany — przerwa sprzed
    // startu (albo z poprzedniego dnia) nie może zjadać dzisiejszej pracy.
    const a = Math.max(start, ms(p.from))
    const b = Math.min(end, p.to === null ? end : ms(p.to))
    return sum + Math.max(0, b - a)
  }, 0)
  return Math.max(0, end - start - przerwy)
}
