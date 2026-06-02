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
  supplierId:       string
  supplierBatchNo:  string
  slaughterDate:    string
  receivedDate:     string
  expiryDate:       string
  kgReceived:       number
  pricePerKg:       number
  invoiceNo?:       string
  supplierBatches?: SupplierBatchItem[]
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
