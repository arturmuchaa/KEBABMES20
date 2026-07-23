/**
 * fefo.ts — FEFO (First Expired, First Out) utilities
 *
 * Współdzielone przez: raw-batches, deboning, meat-stock, production.
 * CZYSTA LOGIKA — zero zależności od UI, frameworku, Tailwind.
 *
 * Zasada: ten plik może być importowany w Node.js testach bez żadnego setupu.
 */

// ─── 1. SORTOWANIE ────────────────────────────────────────────────────────────

/**
 * Minimalny interfejs wymagany do sortowania FEFO.
 *
 * Pola:
 *   expiryDate       — ISO date string 'YYYY-MM-DD', klucz główny
 *   internalBatchSeq — liczba całkowita nadana przez backend, tie-breaker #2
 *   createdAt        — ISO datetime string, tie-breaker #3 (ostateczny fallback)
 *
 * Dlaczego createdAt jako fallback:
 *   Dwie partie mogą mieć ten sam expiryDate i ten sam seq (błąd danych lub migracja).
 *   createdAt gwarantuje deterministyczny wynik — ta sama tablica zawsze daje ten sam sort.
 *   Bez fallbacku sort byłby niestabilny (zależny od kolejności w pamięci silnika JS).
 */
export interface FefoSortable {
  expiryDate:       string   // ISO 'YYYY-MM-DD'
  internalBatchSeq: number   // integer, nadany przez backend
  createdAt:        string   // ISO datetime, ostateczny tie-breaker
}

/**
 * sortFefo — deterministyczny sort FEFO.
 *
 * Klucze (wszystkie ASC):
 *   1. expiryDate       — najwcześniej wygasająca = pierwsza do rozbioru (HACCP)
 *   2. internalBatchSeq — przy tej samej dacie: starsza sekwencja pierwsza
 *   3. createdAt        — ostateczny fallback: wcześniej utworzona partia pierwsza
 *
 * Nie mutuje oryginalnej tablicy (zwraca kopię przez [...items]).
 */
export function sortFefo<T extends FefoSortable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    // Klucz 1: expiryDate
    if (a.expiryDate < b.expiryDate) return -1
    if (a.expiryDate > b.expiryDate) return  1

    // Klucz 2: internalBatchSeq
    if (a.internalBatchSeq !== b.internalBatchSeq) {
      return a.internalBatchSeq - b.internalBatchSeq
    }

    // Klucz 3: createdAt (ostateczny fallback — gwarantuje determinizm)
    if (a.createdAt < b.createdAt) return -1
    if (a.createdAt > b.createdAt) return  1
    return 0
  })
}

/**
 * Minimalny wariant dla lotów/partii BEZ internalBatchSeq (meat_stock,
 * seasoned_meat): expiryDate ASC, potem numer partii NATURALNIE
 * ("428" < "1024" — localeCompare numeric), na końcu id dla determinizmu.
 * Najstarsza partia zawsze pierwsza — bez tego równe daty ważności dają
 * "pomieszaną" kolejność zależną od silnika JS.
 */
export interface FefoLotLike {
  expiryDate?: string   // ISO 'YYYY-MM-DD'
  no?:         string   // lot_no / batch_no
  id?:         string
}

export function fefoLotCompare(a: FefoLotLike, b: FefoLotLike): number {
  const ae = a.expiryDate ?? ''
  const be = b.expiryDate ?? ''
  if (ae < be) return -1
  if (ae > be) return 1
  const byNo = String(a.no ?? '').localeCompare(String(b.no ?? ''), 'pl', { numeric: true })
  if (byNo !== 0) return byNo
  return String(a.id ?? '').localeCompare(String(b.id ?? ''))
}

// ─── 2. HACCP EXPIRY STATUS ───────────────────────────────────────────────────

/**
 * Progi HACCP (dni do wygaśnięcia).
 * Zmiany polityki zakładu = edycja tylko tych stałych.
 *
 *   EXPIRED  : daysLeft < 0          — przeterminowana, zablokowana
 *   CRITICAL : 0 ≤ daysLeft ≤ 1     — wygasa dziś lub jutro
 *   WARNING  : 2 ≤ daysLeft ≤ 3     — wygasa wkrótce
 *   OK       : daysLeft > 3          — bezpieczna
 */
const THRESHOLD_CRITICAL = 1  // dni (włącznie)
const THRESHOLD_WARNING  = 3  // dni (włącznie)

export type ExpiryLevel = 'OK' | 'WARNING' | 'CRITICAL' | 'EXPIRED'

/**
 * ExpiryStatus — wynik oceny daty ważności.
 *
 * Celowo NIE zawiera:
 *   - label (tekst UI → komponent decyduje o tłumaczeniu)
 *   - klas CSS / Tailwind (warstwa prezentacji → komponent)
 *
 * Zawiera tylko dane domenowe — ta sama logika działa w CLI, PDF, e-mailu.
 */
export interface ExpiryStatus {
  /** Poziom ważności HACCP */
  readonly level:    ExpiryLevel
  /** Dni do wygaśnięcia. Ujemne = przeterminowana (np. -3 = 3 dni temu) */
  readonly daysLeft: number
  /** Czy partia jest zablokowana do użycia w produkcji */
  readonly blocked:  boolean
}

/**
 * getExpiryStatus — oblicza status HACCP dla daty ważności.
 *
 * @param expiryDateIso — ISO date string 'YYYY-MM-DD'
 * @returns ExpiryStatus — czyste dane, bez UI
 *
 * Porównuje z dzisiejszą datą (północ, strefa lokalna urządzenia).
 * Na serwerze (SSR/Node) strefa lokalna = strefa serwera — uwzględnij przy deploy.
 */
export function getExpiryStatus(expiryDateIso: string): ExpiryStatus {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const exp = new Date(expiryDateIso)
  exp.setHours(0, 0, 0, 0)

  const daysLeft = Math.floor((exp.getTime() - today.getTime()) / 86_400_000)

  if (daysLeft < 0)                   return { level: 'EXPIRED',  daysLeft, blocked: true  }
  if (daysLeft <= THRESHOLD_CRITICAL) return { level: 'CRITICAL', daysLeft, blocked: false }
  if (daysLeft <= THRESHOLD_WARNING)  return { level: 'WARNING',  daysLeft, blocked: false }
  return                                     { level: 'OK',       daysLeft, blocked: false }
}

// ─── 3. USABILITY ─────────────────────────────────────────────────────────────

/**
 * Powód niedostępności partii w produkcji.
 *
 *   expired    — data ważności przekroczona (bezwzględna blokada HACCP)
 *   quarantine — partia w kwarantannie (decyzja operatora)
 *   depleted   — brak kg do rozbioru
 *   low_expiry — wygasa wkrótce (ostrzeżenie, nie blokada — zakład decyduje)
 */
export type UnusableReason = 'expired' | 'quarantine' | 'depleted' | 'low_expiry'

export interface UsabilityResult {
  usable:  boolean
  reason?: UnusableReason   // undefined gdy usable === true
}

/**
 * checkUsability — czy partia nadaje się do użycia w produkcji?
 *
 * Przyjmuje ExpiryStatus (wynik getExpiryStatus) oraz opcjonalne flagi
 * dla stanów których nie można wywnioskować z samej daty:
 *   - inQuarantine: partia zablokowana przez operatora
 *   - kgAvailable:  dostępne kilogramy (0 = wyczerpana)
 *
 * Hierarchia sprawdzeń (najpoważniejszy błąd wygrywa):
 *   1. expired     — HACCP, bezwzględna blokada
 *   2. quarantine  — decyzja operatora
 *   3. depleted    — brak kg
 *   4. low_expiry  — ostrzeżenie (usable: true, ale z powodem)
 *
 * UWAGA: low_expiry zwraca usable: true — to ostrzeżenie, nie blokada.
 * Zakład może zdecydować inaczej. Sprawdzaj reason w UI.
 */
export function checkUsability(
  expiryStatus: ExpiryStatus,
  opts: { inQuarantine?: boolean; kgAvailable?: number } = {},
): UsabilityResult {
  if (expiryStatus.blocked)                          return { usable: false, reason: 'expired'    }
  if (opts.inQuarantine === true)                    return { usable: false, reason: 'quarantine' }
  if (opts.kgAvailable !== undefined &&
      opts.kgAvailable <= 0)                         return { usable: false, reason: 'depleted'   }
  if (expiryStatus.level === 'WARNING' ||
      expiryStatus.level === 'CRITICAL')             return { usable: true,  reason: 'low_expiry' }
  return                                                    { usable: true }
}

// ─── HELPER FOR PRODUCTION CHECK ──────────────────────────────────────────────

/**
 * isUsableForProduction — quick check if batch can be used in production.
 * Returns true if batch has kg available and is not expired.
 */
export function isUsableForProduction(
  expiryDateIso: string,
  kgAvailable: number,
  inQuarantine = false,
): boolean {
  const expiry = getExpiryStatus(expiryDateIso)
  const result = checkUsability(expiry, { kgAvailable, inQuarantine })
  return result.usable
}

// ─── 4. DERIVED STATUS ────────────────────────────────────────────────────────

/**
 * RawBatchDerivedStatus — status partii obliczony wyłącznie z danych domenowych.
 *
 * ZASADA: status NIE jest przechowywany osobno — wynika deterministycznie z:
 *   - expiryDate (data ważności)
 *   - kgAvailable (pozostałe kg)
 *
 * Backend może zwracać status jako pole dla wydajności (cache),
 * ale frontend zawsze może go zrekonstruować z tych dwóch pól.
 * Eliminuje to możliwość rozjechania się status vs rzeczywistości.
 */
export type RawBatchDerivedStatus = 'active' | 'low_expiry' | 'expired' | 'used'

/**
 * deriveRawBatchStatus — oblicza status partii z danych domenowych.
 *
 * Hierarchia:
 *   1. used        — kgAvailable ≤ 0 (niezależnie od daty)
 *   2. expired     — data ważności przekroczona
 *   3. low_expiry  — wygasa ≤ THRESHOLD_WARNING dni
 *   4. active      — wszystko OK
 *
 * Użycie:
 *   const status = deriveRawBatchStatus(batch.expiryDate, batch.kgAvailable)
 *   // Zawsze spójne z rzeczywistością — nie można "zapomnieć zaktualizować"
 */
export function deriveRawBatchStatus(
  expiryDateIso: string,
  kgAvailable:   number,
): RawBatchDerivedStatus {
  if (kgAvailable <= 0) return 'used'

  const expiry = getExpiryStatus(expiryDateIso)
  if (expiry.level === 'EXPIRED')                              return 'expired'
  if (expiry.level === 'CRITICAL' || expiry.level === 'WARNING') return 'low_expiry'
  return 'active'
}

// ─── 5. HACCP GUARDS — reusable, backend-ready ───────────────────────────────
//
// Te funkcje są projektowane tak, żeby można je było 1:1 przenieść na backend
// (Node.js / Python). Nie mają żadnych zależności od frameworka frontendowego.

/**
 * isExpired — czy data ważności już minęła?
 *
 * Twarda blokada HACCP. Używaj wszędzie gdzie akceptujesz surowiec:
 *   - tworzenie partii
 *   - edycja partii
 *   - użycie w rozbiorze
 *   - użycie w produkcji
 *
 * @param expiryDateIso ISO date 'YYYY-MM-DD'
 */
export function isExpired(expiryDateIso: string): boolean {
  return getExpiryStatus(expiryDateIso).level === 'EXPIRED'
}

/**
 * isHighPriority — czy partia powinna być użyta natychmiast?
 * WARNING level — informacyjne, nie blokuje.
 *
 * @param expiryDateIso ISO date 'YYYY-MM-DD'
 * @param thresholdDays dni do wygaśnięcia uznawane za HIGH PRIORITY (default: 2)
 */
export function isHighPriority(expiryDateIso: string, thresholdDays = 2): boolean {
  const { daysLeft } = getExpiryStatus(expiryDateIso)
  return daysLeft >= 0 && daysLeft <= thresholdDays
}

/**
 * isActiveForProduction — czy partia jest aktywna operacyjnie?
 * Łączy: nie expired + ma kg + nie wyczerpana.
 * Gotowe pod backend query: WHERE expiry_date > today AND kg_available > 0
 */
export function isActiveForProduction(
  expiryDateIso: string,
  kgAvailable: number,
): boolean {
  if (kgAvailable <= 0) return false
  return !isExpired(expiryDateIso)
}

/**
 * buildFefoQuery — parametry zapytania FEFO do backendu.
 *
 * Zwraca obiekt gotowy do przekazania jako query params do API.
 * Backend powinien zaimplementować identyczne sortowanie po stronie DB:
 *   ORDER BY expiry_date ASC, internal_batch_seq ASC, created_at ASC
 *   WHERE status NOT IN ('used', 'cancelled', 'expired')
 *   LIMIT 25
 *
 * Gdy backend obsłuży to zapytanie — usuń sortFefo() z hooków,
 * zostaw tylko jako helper dla offline/mock.
 */
export function buildFefoQuery(limit = 25): {
  sort:   'expiry_date_asc'
  status: 'active_only'
  limit:  number
} {
  return { sort: 'expiry_date_asc', status: 'active_only', limit }
}
