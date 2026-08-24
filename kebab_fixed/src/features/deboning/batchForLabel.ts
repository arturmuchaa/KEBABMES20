/**
 * batchForLabel — partia kompletna na tyle, żeby dało się z niej wydrukować
 * etykietę.
 *
 * Etykieta ubocznych przepisuje datę ważności Z ĆWIARTKI (nie liczy jej
 * z normy). Ekran hali w kilku miejscach podaje jednak partię SKLEJONĄ
 * z tego, co akurat ma pod ręką — kafel „do zważenia" buduje ją z dwóch pól,
 * `{ id, internalBatchNo }` — a wtedy daty po prostu nie ma i etykieta wychodzi
 * z pustym terminem (partia 502, 24.08.2026).
 *
 * Zamiast łatać każde wywołanie z osobna, uzupełniamy partię z pełnej listy.
 * Gdy jej tam nie ma (starsza niż limit listy, usunięta w biurze) — oddajemy
 * wejście bez zmian: brak wiedzy nie może zablokować ważenia.
 *
 * Czysta funkcja bez DOM.
 */
export function batchForLabel<T extends { id: string; expiryDate?: string }>(
  batch: T,
  wszystkie: readonly T[],
): T {
  if (batch.expiryDate) return batch
  return wszystkie.find(b => b.id === batch.id) ?? batch
}
