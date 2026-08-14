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
import { batchDisplayNo } from './batchDisplayNo'

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

/** Żywy stan lotu mięsa (meat_stock) — dla surowca przyjmowanego BEZ rozbioru. */
export interface MeatLotInfo {
  /** Ile jeszcze leży wolne (kg_available lotu; rezerwacje NIE są tu odjęte). */
  kgAvailable: number
  /** Ile zajęte pod plan masowania. */
  kgReserved:  number
  /** Ile lot miał na starcie. */
  kgInitial:   number
}

/** Loty mięsa kluczowane numerem partii przyjęcia. Brak klucza = nic nie zostało. */
export type MeatStockMap = Record<string, MeatLotInfo>

export interface ResolveOpts {
  /** Ćwiartka = true (stan żyje w raw_batches); filet i mięso z/s = false. */
  requiresDeboning: boolean
  meatStock?:       MeatStockMap
}

export interface ResolvedDelivery {
  status:     DeliveryStatus
  /** Ile z tej dostawy jeszcze fizycznie leży. */
  kgLeft:     number
  /** Zajęte pod plan masowania (tylko magazyn mięsa). */
  kgReserved: number
  /** Dostawa nietknięta — warunek konieczny EDYCJI. */
  untouched:  boolean
  /** Można anulować przyjęcie (nic z niego nie poszło dalej).
   *
   *  Osobne od `untouched`, bo filet i mięso z/s są „tknięte" od chwili
   *  przyjęcia — mają lot w magazynie mięsa — i nigdy nie dawały się anulować,
   *  nawet świeże (prod 2026-08-14: dostawa wpisana pod złym rodzajem, brak
   *  jakiegokolwiek wyjścia z poziomu aplikacji). Do anulowania wystarczy, że
   *  lot jest w całości wolny; edycja zostaje zablokowana, bo `update_batch`
   *  nie rusza lotu i rozjechałaby kilogramy. */
  cancellable: boolean
}

/**
 * resolveDelivery — gdzie naprawdę leży stan tej dostawy.
 *
 * Ćwiartka: stan żyje w raw_batches.kg_available i maleje przy rozbiorze.
 *
 * Surowiec BEZ rozbioru (filet, mięso z/s z dostawy zewnętrznej): backend
 * zeruje kg_available JUŻ PRZY PRZYJĘCIU i przerzuca całość do meat_stock pod
 * tym samym numerem partii (raw_batches_service.create_batch). Czytanie
 * kg_available z dostawy pokazywałoby więc świeży filet jako „zużyty" —
 * prawdziwy stan trzeba wziąć z lotu mięsa.
 *
 * Dostawa bez rozbioru nigdy nie jest „nietknięta" w rozumieniu backendu:
 * _batch_used_reason_cx odrzuca edycję każdej partii mającej wiersz w
 * meat_stock, a taki powstaje od razu przy przyjęciu.
 */
export function resolveDelivery(b: DeliveryLike, opts: ResolveOpts): ResolvedDelivery {
  const received = Number(b.kgReceived)

  if (b.status === 'cancelled') {
    return {
      status: 'cancelled', kgLeft: Number(b.kgAvailable),
      kgReserved: 0, untouched: false, cancellable: false,
    }
  }

  if (opts.requiresDeboning) {
    const kgLeft = Number(b.kgAvailable)
    const untouched = kgLeft >= received
    return {
      status:     deriveDeliveryStatus(b),
      kgLeft,
      kgReserved: 0,
      untouched,
      cancellable: untouched,
    }
  }

  const lot     = opts.meatStock?.[batchDisplayNo(b)]
  const kgLeft  = lot?.kgAvailable ?? 0
  const initial = lot?.kgInitial ?? received

  return {
    status:     kgLeft <= 0 ? 'processed' : kgLeft < initial ? 'in_progress' : 'awaiting',
    kgLeft,
    kgReserved: lot?.kgReserved ?? 0,
    untouched:  false,
    // Lot w całości wolny = z dostawy nic nie poszło w produkcję ani na WZ.
    // Brak lotu (kgLeft 0) to dostawa już zużyta — nie ma czego anulować.
    cancellable: lot != null && kgLeft >= initial && (lot.kgReserved ?? 0) <= 0,
  }
}

/**
 * splitDeliveries — rozdziela dostawy na żywe i zamknięte.
 *
 * W obiegu = został surowiec I dostawa nie jest anulowana. Anulowana z resztą
 * kg to anomalia do wyjaśnienia w kartotece, nie pozycja operacyjna — idzie
 * do historii, gdzie widać ją ze znacznikiem ANULOWANA.
 */
export function splitDeliveries<T extends DeliveryLike>(
  rows: T[], opts: ResolveOpts,
): { live: T[]; history: T[] } {
  const live: T[] = []
  const history: T[] = []
  for (const r of rows) {
    const { status } = resolveDelivery(r, opts)
    if (status === 'awaiting' || status === 'in_progress') live.push(r)
    else history.push(r)
  }
  return { live, history }
}

/**
 * Numer partii jako liczba do porównań.
 *
 * MUSI iść przez batchDisplayNo: anulowana dostawa ma w internal_batch_no
 * techniczne „ANUL-<id>", a wyskrobanie z tego cyfr dawało klucz rzędu
 * 37 bilionów, który wygrywał każde sortowanie i każdy tie-break.
 */
function batchSortKey(b: DeliveryLike): number {
  const digits = batchDisplayNo(b).replace(/\D/g, '')
  return digits ? Number(digits) : 0
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
  rows: T[], col: DeliverySortCol, dir: SortDir, opts?: ResolveOpts,
): T[] {
  const sign = dir === 'asc' ? 1 : -1
  // „Zostało kg" musi sortować po TYM, co widać w kolumnie — dla surowca bez
  // rozbioru kg_available dostawy jest zawsze zerem, więc bez opts kliknięcie
  // nagłówka nie robiłoby nic.
  const kgLeft = (b: DeliveryLike) =>
    opts ? resolveDelivery(b, opts).kgLeft : Number(b.kgAvailable)
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (col) {
      case 'internalBatchNo': cmp = batchSortKey(a) - batchSortKey(b); break
      case 'supplierName':    cmp = (a.supplierName ?? '').localeCompare(b.supplierName ?? '', 'pl'); break
      case 'receivedDate':    cmp = cmpDate(a.receivedDate,  b.receivedDate,  sign); break
      case 'slaughterDate':   cmp = cmpDate(a.slaughterDate, b.slaughterDate, sign); break
      case 'expiryDate':      cmp = cmpDate(a.expiryDate,    b.expiryDate,    sign); break
      case 'kgReceived':      cmp = Number(a.kgReceived)  - Number(b.kgReceived);  break
      case 'kgAvailable':     cmp = kgLeft(a) - kgLeft(b); break
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
    // Szukamy po numerze POKAZANYM w tabeli — anulowana dostawa ma w bazie
    // „ANUL-<id>", a operator wpisuje numer, który widzi (np. 432).
    return (
      batchDisplayNo(r).toLowerCase().includes(q) ||
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
export function deliveryStatusBadgeKey(
  status: DeliveryStatus, requiresDeboning: boolean,
): DeliveryBadgeKey {
  if (status === 'cancelled') return 'delivery_cancelled'
  return `delivery_${status}_${requiresDeboning ? 'deboning' : 'stock'}`
}

/** Klucze, które MUSZĄ istnieć w STATUS_META (components/ui/badge.tsx).
 *  Literalna unia zamiast string — rozjazd nazw wyłapie kompilator, a nie
 *  operator patrzący na szary znacznik z surowym kluczem. */
export type DeliveryBadgeKey =
  | 'delivery_cancelled'
  | `delivery_${Exclude<DeliveryStatus, 'cancelled'>}_${'deboning' | 'stock'}`

/** Podsumowanie nagłówka sekcji „W obiegu" — kilogramy z REALNEGO stanu. */
export function liveSummary<T extends DeliveryLike>(
  rows: T[], opts: ResolveOpts,
): { count: number; kg: number } {
  return {
    count: rows.length,
    kg:    rows.reduce((s, r) => s + resolveDelivery(r, opts).kgLeft, 0),
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
