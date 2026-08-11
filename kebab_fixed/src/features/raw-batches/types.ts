/**
 * raw-batches/types.ts
 *
 * Jedyne źródło typów domenowych modułu.
 * Importują stąd: hooks, api, components (tylko wewnątrz features/raw-batches/).
 * Na zewnątrz eksportuje tylko to co jest w index.ts.
 */

import type { Paginated } from '@/types'
import type { RawBatchDerivedStatus } from '@/lib/utils/fefo'

export type { RawBatchDerivedStatus }
export type RawBatchStatus = RawBatchDerivedStatus | 'cancelled'

// ─── ENCJA RawBatch ───────────────────────────────────────────────────────────
//
// Status ZAWSZE obliczamy z danych domenowych (deriveRawBatchStatus).
// Backend może cache'ować status — frontend zawsze rekonstruuje z expiryDate+kgAvailable.
// Wyjątek: 'cancelled' — nie da się wywnioskować z innych pól, musi być w danych.

export interface RawBatch {
  readonly id:               string
  readonly internalBatchNo:  string   // np. "344" — nadawany przez backend, read-only
  readonly internalBatchSeq: number   // integer — FEFO tie-breaker

  readonly supplierId:      string
  readonly supplierName?:   string
  readonly supplierDisplayName?: string
  readonly supplierBatchNo: string
  readonly supplierBatches?: SupplierBatchItem[]

  // Daty — ISO date 'YYYY-MM-DD'
  readonly slaughterDate: string
  readonly receivedDate:  string
  readonly expiryDate:    string      // klucz FEFO

  // Kilogramy
  readonly kgReceived:     number
  readonly kgAvailable:    number
  readonly kgUsed:         number
  readonly utilizationPct: number

  readonly pricePerKg: number
  readonly invoiceNo?: string

  // Rodzaj surowca (ćwiartka / filet z kurczaka / mięso z indyka…)
  readonly materialTypeId?: string
  readonly materialName?:   string

  // Dokument dostawy: jedna dostawa (jeden numer przyjęcia) rozbija się na
  // kilka numerów porządkowych, które są właśnie tymi partiami.
  readonly receptionId?: string
  readonly receptionNo?: string

  // Status — opcjonalny cache backendu + 'cancelled' który nie da się derive'ować
  readonly status?: RawBatchStatus

  // Flagi operacyjne
  readonly isInUse?: boolean   // true gdy trwa sesja rozbioru — blokuje edycję/cancel

  // Audyt edycji — przygotowane pod pełny audit trail
  readonly editReason?:  string
  readonly editedAt?:    string   // ISO datetime
  readonly editedBy?:    string   // userId

  readonly createdAt: string
  readonly updatedAt?: string
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface SupplierBatchItem {
  supplierBatchNo: string
  kgReceived:      number
  slaughterDate:   string
  expiryDate:      string
}

export interface CreateRawBatchDto {
  internalBatchNo?: string   // user może wpisać własny np. "344"; backend zsynchronizuje batch_seq
  materialTypeId?:  string   // rodzaj surowca (domyślnie ćwiartka)
  supplierId:       string
  supplierBatchNo:  string
  slaughterDate:    string
  receivedDate:     string
  expiryDate:       string
  kgReceived:       number
  pricePerKg:       number
  invoiceNo?:       string
  supplierBatches?: SupplierBatchItem[]
  // Nośniki zwrotne — zasilają saldo pojemników dostawcy.
  containerKg?:     number | null   // null = niekalibrowany
  containersCount?: number | null   // ręczna liczba; wygrywa z wyliczeniem z kalibru
  palletsH1?:       number
  palletsOther?:    number
  /** Rodzaj z listy „inne opakowania / palety" (siatka E1, europaleta…). */
  palletsOtherKind?: string
  /** Przyjęcie NA USŁUGĘ (mięso z/s klienta) — osobna seria numerów 48U. */
  isService?:       boolean
}

// ─── Przyjęcie = dokument całej dostawy ──────────────────────────────────────
//
// Jedna dostawa → jeden numer przyjęcia („12/08/2026") → kilka numerów
// porządkowych (grup). Partie dostawcy wiszą pod grupą, do której trafiły.

/** Jeden numer porządkowy w obrębie dostawy. */
export interface ReceptionGroupDto {
  /** Pusty = backend nada kolejny z sekwencji. */
  internalBatchNo?: string
  kgReceived:       number
  slaughterDate?:   string
  expiryDate?:      string
  supplierBatches:  SupplierBatchItem[]
  containerKg?:     number | null
  containersCount?: number | null
  palletsH1?:       number
  palletsOther?:    number
  palletsOtherKind?: string
}

export interface CreateReceptionDto {
  /** Pusty = backend nada kolejny numer w miesiącu. */
  receptionNo?:     string
  receivedDate:     string
  supplierId:       string
  materialTypeId?:  string
  /** WZ / faktura / inny dokument przywozowy — kolumna (e) karty 1.1.1. */
  documentNo?:      string
  /** Własny numer HDI dostawcy („33656"), niezależny od numeru WZ. */
  hdiNo?:           string
  /** Sumy ze stopki HDI — służą tylko kontroli przepisania dokumentu. */
  docKg?:           number | null
  docContainers?:   number | null
  pricePerKg:       number
  notes?:           string
  isService?:       boolean
  groups:           ReceptionGroupDto[]
}

/** Dane wspólne dla całej dostawy — wszystko, co nie zależy od podziału. */
export interface ReceptionHeader {
  receptionNo:      string
  receivedDate:     string
  supplierId:       string
  materialTypeId:   string
  documentNo:       string
  hdiNo:            string
  docKg:            number
  docContainers:    number
  pricePerKg:       number
  containerKg:      number | null
  palletsH1:        number
  palletsOther:     number
  palletsOtherKind: string
  isService:        boolean
  notes:            string
}

export interface ReceptionBatch extends RawBatch {
  readonly supplierBatches: SupplierBatchItem[]
}

export interface Reception {
  readonly id:           string
  readonly receptionNo:  string
  readonly receivedDate: string
  readonly supplierId:   string
  readonly supplierName: string
  readonly documentNo:   string
  readonly hdiNo:        string
  readonly notes:        string
  readonly kgTotal:      number
  readonly batches:      ReceptionBatch[]
}

export interface EditRawBatchDto {
  kgReceived?:  number
  pricePerKg?:  number
  invoiceNo?:   string
  expiryDate?:  string
  // Audyt — wymagany przy każdej edycji
  editReason:   string
  editedBy?:    string
}

export interface CancelRawBatchDto {
  reason:      string
  cancelledBy?: string
}

// ─── Historia zmian (audit trail) ────────────────────────────────────────────

export type ChangeType = 'create' | 'edit' | 'cancel'

export interface RawBatchHistoryEntry {
  readonly id:             string
  readonly rawBatchId:     string
  readonly changedAt:      string        // ISO datetime
  readonly changedBy?:     string        // userId (opcjonalny — brak auth w v1)
  readonly changeType:     ChangeType
  readonly beforeSnapshot: RawBatchSnapshot | null  // null przy create
  readonly afterSnapshot:  RawBatchSnapshot | null  // null przy cancel
  readonly reason?:        string
}

// Snapshot — immutable zapis stanu partii w momencie zmiany
// Używany w traceability (deboning, mixing, production)
export interface RawBatchSnapshot {
  readonly internalBatchNo:  string
  readonly supplierId:       string
  readonly supplierName?:    string
  readonly supplierBatchNo:  string
  readonly slaughterDate:    string
  readonly receivedDate:     string
  readonly expiryDate:       string
  readonly kgReceived:       number
  readonly kgAvailable:      number
  readonly pricePerKg:       number
}

// ─── Logi operacyjne ──────────────────────────────────────────────────────────

export type SystemLogAction = 'CREATE_BATCH' | 'EDIT_BATCH' | 'CANCEL_BATCH'

export interface SystemLog {
  readonly id:        string
  readonly userId?:   string
  readonly action:    SystemLogAction
  readonly entity:    'raw_batch'
  readonly entityId:  string
  readonly metadata:  Record<string, unknown>
  readonly createdAt: string
}

// ─── Walidacja — rozdzielona na ERROR i WARNING ───────────────────────────────

export interface ValidationError {
  type:    'error'
  message: string
}

export interface ValidationWarning {
  type:    'warning'
  message: string
}

export type ValidationResult =
  | { ok: true;  warnings: ValidationWarning[] }
  | { ok: false; error: ValidationError; warnings: ValidationWarning[] }

// ─── Blokada edycji ───────────────────────────────────────────────────────────

export type EditLockReason = 'used' | 'cancelled' | 'in_use' | 'expired_haccp'

export interface EditLock {
  locked: true
  reason: EditLockReason
  message: string
}

export interface EditUnlocked {
  locked: false
}

export type EditLockResult = EditLock | EditUnlocked

// ─── API response types ───────────────────────────────────────────────────────

export interface NextBatchNumberResponse {
  readonly suggestedBatchNo: string
  readonly suggestedSeq:     number
  readonly note:             string
}

export interface SupplierOption {
  value: string
  label: string
}

export type RawBatchPage = Paginated<RawBatch>

export interface RawBatchListParams {
  status?: RawBatchStatus | 'active_only' | ''
  limit?:  number
  page?:   number
}
