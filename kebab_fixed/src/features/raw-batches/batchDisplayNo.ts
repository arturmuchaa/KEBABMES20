/** Znacznik nadawany przy usunięciu przyjęcia — zwalnia numer do puli
 *  (kolumna internal_batch_no ma UNIQUE, a numer musi dać się przyjąć
 *  ponownie). Pierwotny numer zostaje w internal_batch_seq. */
const CANCELLED_PREFIX = 'ANUL-'

/** Numer partii do pokazania w tabeli przyjęć: dla usuniętych dostaw
 *  pierwotny numer z sekwencji zamiast technicznego znacznika. */
export function batchDisplayNo(b: { internalBatchNo?: string; internalBatchSeq?: number }): string {
  const no = b.internalBatchNo ?? ''
  if (no && !no.startsWith(CANCELLED_PREFIX)) return no
  return b.internalBatchSeq ? String(b.internalBatchSeq) : '—'
}
