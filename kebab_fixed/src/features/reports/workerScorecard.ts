/**
 * workerScorecard.ts — ranking pracowników rozbioru dla raportu zarządczego.
 *
 * Dwie decyzje, które trzymają ten ranking uczciwym:
 *
 * 1. Ocena idzie z uzysku SKORYGOWANEGO O PARTIĘ (`yieldVsBatchPp`), nie z
 *    surowego %. Kto dostał gorszą ćwiartkę, wypadał w surowym rankingu źle
 *    niezależnie od swojej roboty — a partii nikt sobie nie wybiera.
 * 2. Mała próba jest OZNACZONA i nie zajmuje czoła ani końca listy. Ktoś z
 *    jednym dniem i 525 kg (DAWID, lipiec 2026) postawiony obok kogoś z 17 t
 *    to nie ranking, tylko szum — a na jego podstawie zapadłaby decyzja.
 *
 * Świadomie NIE MA tu ocen A–E ani gwiazdek. Różnica 65,2% vs 66,7% to
 * kilkaset złotych i temat na rozmowę o technice cięcia, nie stopień na
 * świadectwie — a raz nadana ocena zostaje z człowiekiem na dłużej niż
 * miesiąc, którego dotyczy.
 */

/** Próg wiarygodności próby [kg ćwiartki] — poniżej niego liczby są szumem. */
export const SMALL_SAMPLE_KG = 2000

export interface ScorecardWorker {
  workerId: string
  workerName: string
  quarters: number
  kgQuarter: number
  kgMeat: number
  avgYield: number
  kgPerHour: number
  days: number
  attendancePct: number
  yieldVsBatchPp: number | null
  yieldStdDev: number | null
}

export interface ScorecardRow extends ScorecardWorker {
  /** Skutek finansowy odchylenia od własnych partii; null bez kosztu mięsa. */
  deltaPln: number | null
  /** Udział w ćwiartce zakładu — kontekst dla kwoty. */
  volumeSharePct: number
  /** Za mało danych, żeby oceniać (patrz SMALL_SAMPLE_KG). */
  smallSample: boolean
}

/** Ile zakład zyskałby, gdyby wszyscy trzymali poziom najlepszego.
 *
 * Suma kolumny „Skutek" jest z definicji bliska zeru — to porównanie
 * pracowników MIĘDZY SOBĄ, nie dodatkowy zysk, i prezes musi to wiedzieć,
 * zanim zacznie liczyć na te kwoty. Realna stawka leży tutaj: różnica
 * między najlepszym a średnią, rozciągnięta na całą ćwiartkę zakładu.
 * Liczona tylko z prób wiarygodnych — jeden dobry dzień nie jest wzorcem.
 */
export function potentialPln(
  rows: ScorecardRow[], totalKgQuarter: number, meatCostPerKg: number | null,
): { pp: number; pln: number; workerName: string } | null {
  if (meatCostPerKg == null || !totalKgQuarter) return null
  const best = rows.filter(r => !r.smallSample && r.yieldVsBatchPp != null)[0]
  if (!best || (best.yieldVsBatchPp ?? 0) <= 0) return null
  const pp = best.yieldVsBatchPp as number
  return { pp, pln: (pp / 100) * totalKgQuarter * meatCostPerKg, workerName: best.workerName }
}

export function workerScorecard(
  workers: ScorecardWorker[], meatCostPerKg: number | null,
): ScorecardRow[] {
  const totalKg = workers.reduce((a, w) => a + w.kgQuarter, 0) || 1
  const rows: ScorecardRow[] = workers.map(w => {
    const pp = w.yieldVsBatchPp ?? 0
    return {
      ...w,
      deltaPln: meatCostPerKg == null ? null : (pp / 100) * w.kgQuarter * meatCostPerKg,
      volumeSharePct: (w.kgQuarter / totalKg) * 100,
      smallSample: w.kgQuarter < SMALL_SAMPLE_KG,
    }
  })
  const key = (r: ScorecardRow) => (r.deltaPln ?? r.yieldVsBatchPp ?? 0)
  // Małe próby na koniec listy — nie oceniamy ich, tylko pokazujemy dla
  // kompletu (płaca i tak liczy się z kilogramów, nie z tego rankingu).
  return rows.sort((a, b) =>
    a.smallSample !== b.smallSample ? (a.smallSample ? 1 : -1) : key(b) - key(a))
}
