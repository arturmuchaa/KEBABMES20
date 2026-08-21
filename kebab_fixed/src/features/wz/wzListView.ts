/**
 * wzListView — podział rejestru WZ na zakładki i szukanie w obrębie zakładki.
 *
 * Rejestr WZ czyta się jak rejestr faktur w programie do fakturowania:
 * aktywne dokumenty osobno, anulowane osobno. Dotąd anulowane leżały w tej
 * samej liście (tylko wyszarzone) — przy 12 anulowanych na 34 dokumenty
 * w sierpniu lista przestawała być czytelna.
 *
 * Zero importów z Reacta — czysta funkcja do testów.
 */
export type WzTab = 'active' | 'cancelled'

interface WzRow {
  number?: string
  buyer_name?: string
  buyer_nip?: string
  status?: string
}

const anulowany = (d: WzRow) => (d.status || '') === 'anulowany'

export function wzTabCounts<T extends WzRow>(docs: T[]): { active: number; cancelled: number } {
  const all = docs ?? []
  const cancelled = all.filter(anulowany).length
  return { active: all.length - cancelled, cancelled }
}

export function filterWz<T extends WzRow>(docs: T[], query: string, tab: WzTab): T[] {
  const q = (query || '').trim().toLowerCase()
  // Zakładka najpierw, szukanie potem: wpisanie odbiorcy z anulowanego
  // dokumentu nie może wciągać go z powrotem między aktywne.
  const wZakladce = (docs ?? []).filter(d => (tab === 'cancelled') === anulowany(d))
  if (!q) return wZakladce
  return wZakladce.filter(d =>
    [d.number, d.buyer_name, d.buyer_nip].some(v => (v || '').toLowerCase().includes(q)))
}
