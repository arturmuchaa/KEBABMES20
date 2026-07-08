/**
 * deboning/types/index.ts
 * Typy domenowe modułu rozbioru. Prywatne dla features/deboning/.
 */

// ─── 1. SESJA PRODUKCYJNA ─────────────────────────────────────────────────────
export type SessionStatus = 'open' | 'closed' | 'approved'
export type ProcessType   = 'deboning' | 'mixing' | 'production'

export interface ProductionSession {
  readonly id:          string
  readonly sessionDate: string        // ISO date — data PRODUKCYJNA (nie kalendarzowa)
  readonly processType: ProcessType
  readonly status:      SessionStatus
  readonly startedAt:   string        // ISO datetime
  readonly endedAt?:    string
  readonly approvedBy?: string        // userId lub 'SYSTEM'
  readonly approvedAt?: string
  readonly notes?:      string
  readonly createdAt:   string
}

export interface StartSessionDto {
  processType: ProcessType
  notes?:      string
}

export interface CloseSessionDto  { notes?: string }
export interface ApproveSessionDto { approvedBy: string; notes?: string }

// ─── 2. WPIS ROZBIORU ─────────────────────────────────────────────────────────
export interface DeboningEntry {
  readonly id:          string
  readonly sessionId:   string
  readonly sessionDate: string
  readonly rawBatchId:  string
  readonly rawBatchNo:  string
  readonly workerId:    string
  readonly workerName:  string
  readonly kgTaken:     number
  readonly kgMeat:      number
  readonly kgBones:     number
  readonly kgBacks:     number
  readonly kgRemainder: number
  readonly yieldPct:    number
  readonly sessionNo:   string        // "ROZ/dd/mm/rr" (np. ROZ/06/06/26)
  readonly tempInput?:  number
  readonly tempRoom?:   number
  readonly notes?:      string
  readonly meatLotNo?:  string        // → MeatStock traceability
  // Ważenie automatyczne RS232 — audyt (null dla wpisów ręcznych/starych)
  readonly kgGross?:    number | null
  readonly tareCartKg?: number | null
  readonly tareE2Kg?:   number | null
  readonly e2Count?:    number | null
  readonly weighMode?:  'auto' | 'manual' | null
  readonly status?:     'pending' | 'complete'
  readonly createdAt:   string
}

export interface CreateDeboningEntryDto {
  sessionId:  string
  rawBatchId: string
  workerId:   string
  kgTaken:    number
  kgMeat:     number
  tempInput?: number
  tempRoom?:  number
  notes?:     string
  kgGross?:    number
  tareCartKg?: number
  tareE2Kg?:   number
  e2Count?:    number
  weighMode?:  'auto' | 'manual'
}

export interface CreateDeboningTakeDto {
  sessionId:  string
  rawBatchId: string
  workerId:   string
  kgTaken:    number
}

export interface CompleteDeboningTakeDto {
  kgMeat:     number
  kgGross?:    number
  tareCartKg?: number
  tareE2Kg?:   number
  e2Count?:    number
  weighMode?:  'auto' | 'manual'
}

export interface UpdateDeboningEntryDto {
  kgTaken?:   number
  kgMeat?:    number
  kgBones?:   number
  kgBacks?:   number
  tempInput?: number
  tempRoom?:  number
  notes?:     string
}

// ─── 3. PODSUMOWANIE SESJI ────────────────────────────────────────────────────
export interface SessionSummary {
  readonly sessionId:    string
  readonly sessionDate:  string
  readonly status:       SessionStatus
  readonly totalKgTaken: number
  readonly totalKgMeat:  number
  readonly totalKgBones: number
  readonly totalKgBacks: number
  readonly totalKgUppz:  number   // UPPZ kat.3
  readonly avgYieldPct:  number
  readonly entryCount:   number
  readonly workerCount:  number
  readonly batchCount:   number
}

// ─── 4. OKNO CZASOWE ──────────────────────────────────────────────────────────
export interface TimeWindowStatus {
  readonly isWithinWindow:  boolean
  readonly canWrite:        boolean        // window AND session.status==='open'
  readonly minutesToOpen:   number | null
  readonly minutesToClose:  number | null
  readonly productionDate:  string
  readonly currentTimeHHMM: string
}

// ─── 5. TRACEABILITY ──────────────────────────────────────────────────────────
export interface DeboningTraceability {
  readonly entryId:         string
  readonly sessionId:       string
  readonly sessionDate:     string
  readonly rawBatchId:      string
  readonly rawBatchNo:      string
  readonly supplierId:      string
  readonly supplierName?:   string
  readonly supplierBatchNo: string
  readonly slaughterDate:   string
  readonly expiryDate:      string
  readonly meatLotNo?:      string
  readonly workerId:        string
  readonly workerName:      string
  readonly kgTaken:         number
  readonly kgMeat:          number
  readonly yieldPct:        number
  readonly processedAt:     string
}

// ─── 6. BLOKADA ZAPISU ────────────────────────────────────────────────────────
export type WriteBlockReason =
  | 'no_session'
  | 'session_closed'
  | 'session_approved'
  | 'outside_time_window'
  | 'haccp_expired_batch'

export interface WriteBlock   { blocked: true;  reason: WriteBlockReason; message: string }
export interface WriteAllowed { blocked: false }
export type WriteCheckResult = WriteBlock | WriteAllowed
