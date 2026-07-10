/**
 * raw-batches/api/index.ts
 *
 * Warstwa API modułu. Jedyne miejsce side-effectów (fetch/mutacje).
 * Hooki importują TYLKO stąd.
 *
 * Kontrakt numeracji: backend nadaje internalBatchNo atomowo przy POST.
 * Frontend wyświetla suggestedBatchNo jako podpowiedź — nie jako fakt.
 *
 * Rozszerzenia v2:
 *   - edit()   → PATCH + zapis historii + log
 *   - cancel() → soft-delete + zapis historii + log
 *   - history() → lista zmian dla partii
 */
import type {
  RawBatch,
  CreateRawBatchDto,
  EditRawBatchDto,
  CancelRawBatchDto,
  RawBatchPage,
  NextBatchNumberResponse,
  RawBatchHistoryEntry,
} from '../types'

// ─── Kontrakt API ─────────────────────────────────────────────────────────────

export interface RawBatchesApi {
  /** Lista partii; domyślnie backend daje aktywne FEFO — historia przyjęć
   *  woła z { active_only: false } (wszystkie, także zużyte/anulowane). */
  list(opts?: { active_only?: boolean; limit?: number }): Promise<RawBatchPage>

  byId(id: string): Promise<RawBatch>

  /** Propozycja numeru — backend nada finalny przy POST */
  nextNumber(): Promise<NextBatchNumberResponse>

  /** Utwórz partię + zapisz historię CREATE + log */
  create(dto: CreateRawBatchDto): Promise<RawBatch>

  /** Edytuj partię + zapisz historię EDIT + log. Blokada jeśli used/cancelled/in_use */
  edit(id: string, dto: EditRawBatchDto): Promise<RawBatch>

  /** Anuluj partię (soft-delete) + zapisz historię CANCEL + log */
  cancel(id: string, dto: CancelRawBatchDto): Promise<RawBatch>

  /** Historia zmian dla partii */
  history(id: string): Promise<RawBatchHistoryEntry[]>

  /** Sprawdź duplikat: ten sam dostawca + nr partii dostawcy + data uboju */
  checkDuplicate(supplierId: string, supplierBatchNo: string, slaughterDate: string): Promise<boolean>
}

// ─── Adapter: legacy mockApi → nowy kontrakt ─────────────────────────────────

import {
  rawBatchesApi as legacyApi,
  rawBatchHistoryApi,
  systemLogsApi,
} from '@/lib/apiClient'

export const rawBatchesApi: RawBatchesApi = {
  list: (opts) => legacyApi.list(opts),
  byId: (id) => legacyApi.byId(id),

  nextNumber: () => legacyApi.nextNumber().then(n => ({
    suggestedBatchNo: (n as any).suggestedBatchNo ?? (n as any).nextBatchNo ?? '',
    suggestedSeq:     (n as any).suggestedSeq     ?? (n as any).nextSeq     ?? 0,
    note:             (n as any).note ?? 'Numer zostanie potwierdzony przy zapisie',
  })),

  create: (dto) => legacyApi.create(dto),

  // edit/cancel/history/checkDuplicate delegują do mockApi (nowe endpointy)
  edit:           (id, dto)   => (legacyApi as any).edit(id, dto),
  cancel:         (id, dto)   => (legacyApi as any).cancel(id, dto),
  history:        (id)        => rawBatchHistoryApi.forBatch(id),
  checkDuplicate: (s, sb, sl) => (legacyApi as any).checkDuplicate(s, sb, sl),
}
