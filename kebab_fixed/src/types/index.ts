// ─── Entities ────────────────────────────────────────────────

// ─── Re-eksport z modułów feature ────────────────────────────
// Typy specyficzne dla modułu żyją w features/*/types.ts
// Tutaj są re-eksportowane dla wstecznej kompatybilności i wygody importu.

// raw-batches
export type { RawBatch, RawBatchStatus, CreateRawBatchDto, SupplierOption,
              NextBatchNumberResponse, RawBatchListParams } from '@/features/raw-batches/types'

// ExpiryStatus — używany globalnie (deboning, meat-stock, production)
export type ExpiryLevel = 'OK' | 'WARNING' | 'CRITICAL' | 'EXPIRED'
/** @deprecated Użyj ExpiryLevel z @/lib/utils/fefo — zawiera więcej informacji */
export type ExpiryStatus = ExpiryLevel
export type MeatStockStatus = 'AVAILABLE' | 'RESERVED' | 'IN_PRODUCTION' | 'DEPLETED' | 'QUARANTINE'

export interface Supplier {
  id: string; code: string; name: string; displayName?: string
  nip?: string; regon?: string
  vetNumber?: string
  address?: string; postalCode?: string; city?: string
  contactName?: string; phone?: string; email?: string; active: boolean
}

export interface User {
  id: string; login: string; name: string
  role: 'ADMIN' | 'OFFICE' | 'WORKER_DEBONING' | 'WORKER_PRODUCTION' | 'WORKER_GENERAL'; active: boolean
}

// RawBatch — patrz @/features/raw-batches/types

export interface DeboningSession {
  id: string; sessionNo: string; rawBatchId: string; rawBatchNo?: string
  workerId: string; workerName?: string; kgTaken: number; kgMeat: number
  kgBones: number; kgBacks: number; kgRemainder: number; yieldPct: number
  tempInput?: number; tempRoom?: number; notes?: string
  meatStockId?: string; meatLotNo?: string; createdAt: string
}

export interface MeatStock {
  id: string; lotNo: string; deboningSessionId: string; sessionNo?: string
  rawBatchId: string; rawBatchNo?: string; kgInitial: number
  // Pełny ledger materiałowy — suma zawsze = kgInitial
  kgAvailable:  number   // AVAILABLE — w magazynie, do dyspozycji
  kgReserved:   number   // RESERVED — zarezerwowane pod zlecenie masowania
  kgInProcess:  number   // IN_PROCESS — fizycznie w masownicy
  kgUsed:       number   // USED — zużyte (przekazane do mięsa przyprawionego)
  productionDate: string
  expiryDate: string; expiryStatus: ExpiryStatus
  storageLocation?: string; status: MeatStockStatus; createdAt: string
  productType?: 'meat' | 'backs' | 'bones'
  // Rodzaj surowca (ćwiartka po rozbiorze / filet / indyk…) — komponenty
  // kebaba w recepturze wybierają partie po rodzaju
  materialTypeId?: string
  materialName?:   string
  /** Dostawca partii źródłowej (display_name dostawcy, fallback pełna nazwa) */
  supplierName?:   string
  // Alokacje per maszyna (traceability IN_PROCESS)
  machineAllocations?: MeatMachineAllocation[]
}

// Alokacja partii do konkretnej masownicy
export interface MeatMachineAllocation {
  readonly allocationId: string
  readonly machineId:    number
  readonly mixingOrderId:string
  readonly mixingOrderNo:string
  readonly kgAllocated:  number
  readonly allocatedAt:  string
  readonly status:       'in_process' | 'done'
  readonly completedAt?: string
}

// Magazyn surowca - grzbiety i kości z zakończonych partii
export interface BatchByproducts {
  id: string
  rawBatchId: string
  rawBatchNo: string
  backsKg: number       // Grzbiety z kurczaka
  bonesKg: number       // Kości z kurczaka
  backsDetails: Array<{ sessionId: string; kg: number; date: string }>
  bonesDetails: Array<{ sessionId: string; kg: number; date: string }>
  createdAt: string
}

// ─── DTOs ────────────────────────────────────────────────────

// CreateRawBatchDto — patrz @/features/raw-batches/types

export interface CreateDeboningDto {
  rawBatchId: string; workerId: string; kgTaken: number; kgMeat: number
  tempInput?: number; tempRoom?: number; notes?: string
}

export interface CreateSupplierDto {
  code: string; name: string; displayName?: string
  nip?: string; regon?: string
  vetNumber?: string
  address?: string; postalCode?: string; city?: string
  contactName?: string; phone?: string; email?: string
}

// ─── API Response wrappers ───────────────────────────────────

export interface Paginated<T> { data: T[]; total: number; page: number; limit: number }
// NextBatchNumber → NextBatchNumberResponse w @/features/raw-batches/types

// ─── Tablet / MES domain (Faza 2 — structs ready) ───────────

export type MixingStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE'

export interface MixingOrder {
  id: string; recipeId: string; recipeName: string
  meatKg: number; plannedOutputKg: number
  status: MixingStatus; scheduledAt: string
}

export type ProductionStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE'

export interface ProductionItem {
  id: string; clientName: string; pieces: number; kgPerPiece: number
  recipeName: string; sleeve: string; status: ProductionStatus
  completedPieces: number
}
