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

/**
 * Druga oś rejestru (22.09.2026): dokument dla KONTRAHENTA kontra wydanie
 * WEWNĘTRZNE ze stanu magazynu.
 *
 * Jedna strona z dwiema zakładkami, nie dwa ekrany: jedno zamówienie rodzi
 * OBA dokumenty (WM na całość + WZ klienta na część niefakturowaną), a biuro
 * szuka po kliencie i dacie, nie po rodzaju dokumentu — wybór ekranu wymagałby
 * wiedzy, której szukający zwykle nie ma.
 */
export type RodzajWydania = 'zewnetrzne' | 'magazynowe'

interface WzRow {
  number?: string
  buyer_name?: string
  buyer_nip?: string
  status?: string
  /** Seria dokumentu: 'WM' wewnętrzny, 'WZ' (albo brak) dla kontrahenta. */
  doc_series?: string
  /** Zamówienie, z którego powstał dokument — źródło palet i ich skanów. */
  source_id?: string
  sourceId?: string
  source_type?: string
}

const anulowany = (d: WzRow) => (d.status || '') === 'anulowany'

/**
 * Czy dla tego dokumentu da się pokazać ślad skanowania palet.
 *
 * Warunek jest JEDEN: dokument pochodzi z zamówienia, bo skany wiszą na
 * paletach zamówienia (`order_pallets` → `pallet_scans`). Seria nie ma tu
 * nic do rzeczy — WZ/83 dla klienta ma 27 skanów na 13 paletach dokładnie
 * tak samo jak WM.
 *
 * Związanie śladu z zakładką „Magazynowe" było błędem projektowym
 * (22.09.2026): rejestr otwiera się na „Zewnętrzne", więc szukający nie
 * widział NICZEGO — właściciel zgłosił to dwa razy, zanim się wydało.
 */
export function sladDostepny(d: WzRow): boolean {
  return Boolean(d.source_id || d.sourceId)
}

/** Dokument BEZ serii to WZ sprzed podziału wysyłki (przed 09.2026) — z
 *  definicji zewnętrzny. Potraktowanie go jako magazynowego schowałoby biuru
 *  całą historię sprzed tej daty. */
export function rodzajDokumentu(d: WzRow): RodzajWydania {
  return (d.doc_series || 'WZ') === 'WM' ? 'magazynowe' : 'zewnetrzne'
}

export function wzRodzajCounts<T extends WzRow>(
  docs: T[], tab: WzTab,
): { zewnetrzne: number; magazynowe: number } {
  const wZakladce = (docs ?? []).filter(d => (tab === 'cancelled') === anulowany(d))
  const magazynowe = wZakladce.filter(d => rodzajDokumentu(d) === 'magazynowe').length
  return { zewnetrzne: wZakladce.length - magazynowe, magazynowe }
}

export function wzTabCounts<T extends WzRow>(docs: T[]): { active: number; cancelled: number } {
  const all = docs ?? []
  const cancelled = all.filter(anulowany).length
  return { active: all.length - cancelled, cancelled }
}

export function filterWz<T extends WzRow>(
  docs: T[], query: string, tab: WzTab, rodzaj?: RodzajWydania,
): T[] {
  const q = (query || '').trim().toLowerCase()
  // Zakładka najpierw, szukanie potem: wpisanie odbiorcy z anulowanego
  // dokumentu nie może wciągać go z powrotem między aktywne.
  //
  // `rodzaj` pominięty = obie osie razem (zgodność wstecz dla wołających,
  // którzy o drugiej osi nie wiedzą).
  const wZakladce = (docs ?? [])
    .filter(d => (tab === 'cancelled') === anulowany(d))
    .filter(d => !rodzaj || rodzajDokumentu(d) === rodzaj)
  if (!q) return wZakladce
  return wZakladce.filter(d =>
    [d.number, d.buyer_name, d.buyer_nip].some(v => (v || '').toLowerCase().includes(q)))
}
