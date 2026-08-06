/**
 * deliveryView — czysta logika widoku „Przyjęcie surowca".
 *
 * Strona odpowiada na dwa różne pytania: „co jeszcze leży w chłodni"
 * (sekcja W obiegu) i „co przyjęliśmy w lipcu" (Historia dostaw). Podział,
 * sortowanie i filtry siedzą tutaj — komponenty tylko renderują.
 *
 * Zero importów z React/UI: to ma się dać przetestować w vitest (środowisko
 * node, bez DOM) i w razie potrzeby użyć w druku albo eksporcie.
 */
import { deriveDeliveryStatus, type DeliveryStatus } from '@/lib/utils/fefo'

/** Minimalny kształt wiersza dostawy. Strukturalnie spełnia go RawBatch —
 *  celowo nie importujemy typu encji, żeby ten moduł dało się użyć także na
 *  danych z innego źródła (np. surowy wynik API). */
export interface DeliveryLike {
  internalBatchNo?:  string
  internalBatchSeq?: number
  supplierName?:     string
  supplierBatchNo?:  string
  receivedDate?:     string
  slaughterDate?:    string
  expiryDate?:       string
  kgReceived:        number | string
  kgAvailable:       number | string
  status?:           string
}

export type DeliverySortCol =
  | 'internalBatchNo' | 'supplierName' | 'receivedDate'
  | 'slaughterDate'   | 'expiryDate'   | 'kgReceived' | 'kgAvailable'

export type SortDir = 'asc' | 'desc'

/** Okres historii w dniach; 0 = bez ograniczenia. */
export type HistoryPeriod = 30 | 90 | 0

/**
 * splitDeliveries — rozdziela dostawy na żywe i zamknięte.
 *
 * W obiegu = został surowiec I dostawa nie jest anulowana. Anulowana z resztą
 * kg to anomalia do wyjaśnienia w kartotece, nie pozycja operacyjna — idzie
 * do historii, gdzie widać ją ze znacznikiem ANULOWANA.
 */
export function splitDeliveries<T extends DeliveryLike>(rows: T[]): { live: T[]; history: T[] } {
  const live: T[] = []
  const history: T[] = []
  for (const r of rows) {
    const status = deriveDeliveryStatus(r)
    if (status === 'awaiting' || status === 'in_progress') live.push(r)
    else history.push(r)
  }
  return { live, history }
}

/** Numer partii jako liczba do porównań (ANUL-… → sekwencja). */
function batchSortKey(b: DeliveryLike): number {
  const fromNo = Number(String(b.internalBatchNo ?? '').replace(/\D/g, ''))
  if (Number.isFinite(fromNo) && fromNo > 0) return fromNo
  return Number(b.internalBatchSeq ?? 0)
}

/** Puste daty na koniec listy niezależnie od kierunku — brak daty to brak
 *  informacji, a nie „najstarsza dostawa świata". */
function cmpDate(a: string | undefined, b: string | undefined, sign: number): number {
  if (!a && !b) return 0
  // Mnożymy przez sign, bo wywołujący i tak odwróci wynik przy 'desc' —
  // pusta data ma wylądować na końcu w OBU kierunkach.
  if (!a) return sign
  if (!b) return -sign
  return a.localeCompare(b)
}

/**
 * sortDeliveries — sortowanie kolumnowe. Nie mutuje wejścia.
 *
 * Przy równej wartości rozstrzyga numer partii w tym samym kierunku: dwie
 * dostawy z tego samego dnia mają się pokazać w kolejności przyjmowania.
 */
export function sortDeliveries<T extends DeliveryLike>(
  rows: T[], col: DeliverySortCol, dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (col) {
      case 'internalBatchNo': cmp = batchSortKey(a) - batchSortKey(b); break
      case 'supplierName':    cmp = (a.supplierName ?? '').localeCompare(b.supplierName ?? '', 'pl'); break
      case 'receivedDate':    cmp = cmpDate(a.receivedDate,  b.receivedDate,  sign); break
      case 'slaughterDate':   cmp = cmpDate(a.slaughterDate, b.slaughterDate, sign); break
      case 'expiryDate':      cmp = cmpDate(a.expiryDate,    b.expiryDate,    sign); break
      case 'kgReceived':      cmp = Number(a.kgReceived)  - Number(b.kgReceived);  break
      case 'kgAvailable':     cmp = Number(a.kgAvailable) - Number(b.kgAvailable); break
    }
    if (cmp !== 0) return sign * cmp
    return sign * (batchSortKey(a) - batchSortKey(b))
  })
}

/** Data sprzed `days` dni w formacie ISO 'YYYY-MM-DD'. */
function isoDaysAgo(todayIsoDate: string, days: number): string {
  const t = new Date(`${todayIsoDate}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() - days)
  return t.toISOString().slice(0, 10)
}

/**
 * filterHistory — szukajka + okres + anulowane.
 *
 * Dostawa bez daty przyjęcia NIGDY nie wypada przez filtr okresu — brak daty
 * (stare rekordy) nie może chować dokumentu przed audytem.
 */
export function filterHistory<T extends DeliveryLike>(
  rows: T[],
  opts: { query?: string; period?: HistoryPeriod; showCancelled?: boolean; today?: string },
): T[] {
  const { query = '', period = 30, showCancelled = false } = opts
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const from  = period > 0 ? isoDaysAgo(today, period) : null
  const q     = query.trim().toLowerCase()

  return rows.filter(r => {
    if (!showCancelled && r.status === 'cancelled') return false
    if (from && r.receivedDate && r.receivedDate.slice(0, 10) < from) return false
    if (!q) return true
    return (
      String(r.internalBatchNo ?? '').toLowerCase().includes(q) ||
      String(r.supplierName    ?? '').toLowerCase().includes(q) ||
      String(r.supplierBatchNo ?? '').toLowerCase().includes(q)
    )
  })
}

/**
 * deliveryStatusBadgeKey — klucz do STATUS_META w components/ui/badge.tsx.
 *
 * Ten sam status znaczy co innego dla ćwiartki (idzie na rozbiór) i dla
 * fileta czy mięsa z/s (leży na magazynie i idzie prosto do masowania).
 */
export function deliveryStatusBadgeKey(status: DeliveryStatus, requiresDeboning: boolean): string {
  if (status === 'cancelled') return 'delivery_cancelled'
  return `delivery_${status}_${requiresDeboning ? 'deboning' : 'stock'}`
}

/** Podsumowanie nagłówka sekcji „W obiegu". */
export function liveSummary<T extends DeliveryLike>(rows: T[]): { count: number; kg: number } {
  return {
    count: rows.length,
    kg:    rows.reduce((s, r) => s + Number(r.kgAvailable), 0),
  }
}

/** Liczebnik: 1 dostawa · 2 dostawy · 5 dostaw · 22 dostawy · 101 dostaw. */
export function pluralDostawy(n: number): string {
  if (n === 1) return 'dostawa'
  const last    = n % 10
  const lastTwo = n % 100
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'dostawy'
  return 'dostaw'
}
