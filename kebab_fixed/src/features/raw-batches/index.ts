/**
 * raw-batches — public API modułu.
 * Tylko to jest eksportowane na zewnątrz.
 */
export { RawBatchesPage }   from './pages/RawBatchesPage'
export { useRawBatches, computeDisplayStatus, checkEditLock } from './hooks/useRawBatches'
export type {
  RawBatch, CreateRawBatchDto, EditRawBatchDto, CancelRawBatchDto,
  RawBatchHistoryEntry, RawBatchSnapshot, SystemLog,
  ValidationResult, EditLockResult,
  SupplierOption, NextBatchNumberResponse,
} from './types'
