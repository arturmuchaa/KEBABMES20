/**
 * deboning/utils/index.ts
 *
 * Czyste funkcje logiki sesji produkcyjnej.
 * ZERO zależności od UI / React / DOM.
 * Gotowe do przeniesienia 1:1 na backend (Node/Python).
 *
 * Zasada: każda funkcja = deterministyczny wynik dla tych samych wejść.
 */
export * from './partialWeighing'

import type {
  ProductionSession, SessionStatus,
  TimeWindowStatus, WriteCheckResult, WriteBlockReason,
} from '../types'

// ─── Stałe czasowe ────────────────────────────────────────────────────────────
export const WORK_START_HOUR = 4    // 04:00 — otwarcie okna
export const WORK_END_HOUR   = 18   // 18:00 — zamknięcie okna + auto-approve

// ─── 1. DATA PRODUKCYJNA ──────────────────────────────────────────────────────
/**
 * getProductionDate — oblicza datę produkcyjną.
 *
 * Jeśli jest przed 04:00 → produkcja trwa jeszcze z poprzedniego dnia.
 * Jeśli >= 04:00 → dzisiejszy dzień produkcyjny.
 *
 * @param now  opcjonalny Date (domyślnie new Date()) — ułatwia testy
 * @returns ISO date string 'YYYY-MM-DD'
 */
export function getProductionDate(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < WORK_START_HOUR) {
    // Przed 04:00 → poprzedni dzień
    const prev = new Date(now)
    prev.setDate(prev.getDate() - 1)
    return prev.toISOString().slice(0, 10)
  }
  return now.toISOString().slice(0, 10)
}

// ─── 2. OKNO CZASOWE ─────────────────────────────────────────────────────────
/**
 * getTimeWindowStatus — stan okna czasowego w danym momencie.
 *
 * Backend CRON wywołuje:
 *   - o 04:00 → odblokowanie (można startować sesję)
 *   - o 18:00 → auto-approve wszystkich otwartych/zamkniętych sesji
 *
 * @param now opcjonalny Date
 * @param session opcjonalna aktywna sesja (null = brak)
 */
export function getTimeWindowStatus(
  session: ProductionSession | null,
  now: Date = new Date(),
): TimeWindowStatus {
  const h = now.getHours()
  const m = now.getMinutes()
  const totalMins = h * 60 + m

  const openMins  = WORK_START_HOUR * 60   // 240
  const closeMins = WORK_END_HOUR   * 60   // 1080

  const isWithinWindow = totalMins >= openMins && totalMins < closeMins

  // canWrite = okno otwarte + sesja istnieje + status === 'open'
  const canWrite = isWithinWindow && session?.status === 'open'

  const minutesToClose = isWithinWindow
    ? closeMins - totalMins
    : null

  const minutesToOpen = !isWithinWindow
    ? totalMins < openMins
      ? openMins - totalMins
      : (24 * 60 - totalMins) + openMins   // do 04:00 następnego dnia
    : null

  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')

  return {
    isWithinWindow,
    canWrite,
    minutesToOpen,
    minutesToClose,
    productionDate:  getProductionDate(now),
    currentTimeHHMM: `${hh}:${mm}`,
  }
}

// ─── 3. SPRAWDZENIE ZAPISU ────────────────────────────────────────────────────
/**
 * checkWriteAccess — czy można zapisać wpis rozbioru?
 *
 * Hierarchia sprawdzeń:
 *   1. Okno czasowe — 04:00–18:00
 *   2. Sesja istnieje
 *   3. Sesja jest 'open'
 *
 * HACCP (expired batch) sprawdzany osobno w api/index.ts.
 */
export function checkWriteAccess(
  session: ProductionSession | null,
  now: Date = new Date(),
): WriteCheckResult {
  const tw = getTimeWindowStatus(session, now)

  // Okno 04–18 to OSTRZEŻENIE, nie twarda blokada.
  // Blokada twarda tylko gdy brak sesji lub sesja zamknięta/zatwierdzona.
  // (Na produkcji backend może dodać twardą blokadę po stronie serwera)

  if (!session) {
    return { blocked: true, reason: 'no_session', message: 'Brak aktywnej sesji. Rozpocznij dzień produkcyjny.' }
  }

  if (session.status === 'closed') {
    return { blocked: true, reason: 'session_closed', message: 'Sesja zamknięta. Nie można dodawać wpisów.' }
  }

  if (session.status === 'approved') {
    return { blocked: true, reason: 'session_approved', message: 'Sesja zatwierdzona. Dane są zablokowane.' }
  }

  return { blocked: false }
}

// ─── 4. AUTO-APPROVE (CRON 18:00) ────────────────────────────────────────────
/**
 * shouldAutoApprove — czy sesja powinna być auto-zatwierdzona?
 *
 * Wywołaj o 18:00 (CRON) dla każdej sesji z danego dnia produkcyjnego.
 * Backend: UPDATE sessions SET status='approved', approved_by='SYSTEM' WHERE...
 */
export function shouldAutoApprove(session: ProductionSession, now: Date = new Date()): boolean {
  const h = now.getHours()
  if (h < WORK_END_HOUR) return false
  return session.status === 'open' || session.status === 'closed'
}

// ─── 5. PODSUMOWANIE SESJI ───────────────────────────────────────────────────
/**
 * calcSessionSummary — agreguje wpisy sesji do podsumowania HACCP.
 * Czysta funkcja — te same dane → ten sam wynik.
 */
export function calcSessionSummary(entries: ReadonlyArray<{
  kgTaken: number; kgMeat: number; kgBones: number; kgBacks: number;
  workerId: string; rawBatchId: string; yieldPct: number;
  status?: 'pending' | 'complete';
}>) {
  // Pobrania (pending, kgMeat=0) nie wchodzą do podsumowania HACCP — inaczej
  // zaniżyłyby wydajność i zawyżyły liczbę wpisów/partii.
  const done = entries.filter(e => e.status !== 'pending')
  const totalKgTaken = done.reduce((s, e) => s + e.kgTaken, 0)
  const totalKgMeat  = done.reduce((s, e) => s + e.kgMeat,  0)
  const totalKgBones = done.reduce((s, e) => s + e.kgBones, 0)
  const totalKgBacks = done.reduce((s, e) => s + e.kgBacks, 0)
  const totalKgUppz  = Math.max(0, totalKgTaken - totalKgMeat - totalKgBones - totalKgBacks)
  const avgYieldPct  = totalKgTaken > 0 ? (totalKgMeat / totalKgTaken) * 100 : 0
  const workerIds    = new Set(done.map(e => e.workerId))
  const batchIds     = new Set(done.map(e => e.rawBatchId))

  return {
    totalKgTaken, totalKgMeat, totalKgBones, totalKgBacks, totalKgUppz,
    avgYieldPct,
    entryCount:  done.length,
    workerCount: workerIds.size,
    batchCount:  batchIds.size,
  }
}

/**
 * splitEntriesByStatus — rozdziela wpisy na pending (pobrane, czeka na mięso)
 * i complete. Brak status = complete (stare dane / zapis 'od razu').
 */
export function splitEntriesByStatus<T extends { status?: 'pending' | 'complete' }>(
  entries: ReadonlyArray<T>,
): { pending: T[]; complete: T[] } {
  const pending: T[] = []
  const complete: T[] = []
  for (const e of entries) {
    if (e.status === 'pending') pending.push(e)
    else complete.push(e)
  }
  return { pending, complete }
}

/**
 * entryTime — czas ZWAŻENIA wpisu: dla dwufazowego pobrania completedAt
 * (domknięcie mięsem), dla wpisu „od razu" createdAt. Feed „Ostatnie wpisy"
 * musi żyć po tym czasie — sortowanie po createdAt (czas POBRANIA) wybijało
 * wpisy na górę wg tego, kto później pobrał, nie kto później zważył
 * (bug prod 2026-07-09, „Adrian wskakuje na górę").
 */
export function entryTime(e: { createdAt?: string; completedAt?: string | null }): string {
  return String(e.completedAt || e.createdAt || '')
}

/**
 * sortEntriesByCreatedAt — normalizuje kolejność wpisów rosnąco po czasie
 * zważenia (entryTime). Backend zwraca DESC, ale cały kod HMI (slice(-8),
 * slice(-3)) zakłada ASC jak w mocku — bez normalizacji feed „Ostatnie wpisy"
 * pokazywał najstarsze wpisy dnia (bug prod 2026-07-08, partie 404/405).
 */
export function sortEntriesByCreatedAt<T extends { createdAt?: string; completedAt?: string | null }>(
  entries: ReadonlyArray<T>,
): T[] {
  return [...entries].sort((a, b) => entryTime(a).localeCompare(entryTime(b)))
}

// ─── 6. WALIDACJA WPISU ROZBIORU ─────────────────────────────────────────────
/**
 * validateDeboningEntry — walidacja wpisu przed zapisem.
 * Zwraca string (błąd) lub null (OK).
 */
export function validateDeboningEntry(
  kgTaken: number,
  kgMeat: number,
  kgAvailable: number,
): string | null {
  if (kgTaken <= 0)           return 'Ilość pobranej ćwiartki musi być > 0'
  if (kgMeat <= 0)            return 'Ilość mięsa musi być > 0'
  if (kgMeat > kgTaken)       return 'Mięso nie może być większe niż pobrana ilość'
  // BUGFIX: kgAvailable to aktualny stan z bazy po poprzednich wpisach tej sesji
  // Backend dodatkowo waliduje ten sam warunek — double-check
  if (kgTaken > kgAvailable + 0.01)
    return `⛔ Nie można pobrać ${kgTaken} kg — w partii dostępne tylko ${kgAvailable.toFixed(2)} kg`
  const yieldPct = (kgMeat / kgTaken) * 100
  if (yieldPct > 95)          return `Wydajność ${yieldPct.toFixed(1)}% jest nierealna — sprawdź dane`
  if (yieldPct < 30)          return `Wydajność ${yieldPct.toFixed(1)}% jest bardzo niska — sprawdź dane`
  return null
}

// ─── 7. FORMAT POMOCNICZY ─────────────────────────────────────────────────────
/** Formatuje minuty jako "X godz. Y min" */
export function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} godz.` : `${h} godz. ${m} min`
}
