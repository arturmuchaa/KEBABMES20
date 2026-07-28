/**
 * workerScorecard.ts — ranking pracowników rozbioru dla raportu zarządczego.
 *
 * Ocena liczy się od ŚREDNIEJ ZAKŁADU — prosto i tak, jak każdy to rozumie
 * bez tłumaczenia. Korekta o partię (uzysk względem średniej WŁASNYCH partii)
 * dalej się liczy, ale nie zaśmieca tabeli: wchodzi do raportu tylko wtedy,
 * gdy realnie zmienia obraz, czyli gdy ktoś systematycznie dostawał surowiec
 * gorszy albo lepszy od reszty. Na lipcu 2026 obie miary różniły się o
 * 0,00–0,17 p.p., więc druga kolumna byłaby wyłącznie kosztem zrozumiałości.
 *
 * Mała próba jest OZNACZONA i nie zajmuje czoła ani końca listy: ktoś z
 * jednym dniem i 525 kg (DAWID, lipiec 2026) postawiony obok kogoś z 17 t
 * to nie ranking, tylko szum — a na jego podstawie zapadłaby decyzja.
 *
 * Świadomie NIE MA tu ocen A–E ani gwiazdek. Różnica 65,2% vs 66,7% to
 * kilkaset złotych i temat na rozmowę o technice cięcia, nie stopień na
 * świadectwie — a raz nadana ocena zostaje z człowiekiem na dłużej niż
 * miesiąc, którego dotyczy.
 */

/** Próg wiarygodności próby [kg ćwiartki] — poniżej niego liczby są szumem. */
export const SMALL_SAMPLE_KG = 2000

/** Od jakiej różnicy między „vs zakład" a „vs własne partie" warto o niej
 *  mówić [p.p.]. Poniżej progu to szum arytmetyczny, nie krzywda. */
export const BATCH_BIAS_PP = 0.2

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
  /** 2 = para rozbierająca na jedno nazwisko (kg/h już znormalizowane). */
  crewSize: number
  yieldVsBatchPp: number | null
  /** Najsłabszy i najlepszy dzień pracownika — powtarzalność po ludzku. */
  yieldMinDay: number | null
  yieldMaxDay: number | null
  yieldRangePp: number | null
}

export interface ScorecardRow extends ScorecardWorker {
  /** Odchylenie od średniej ZAKŁADU [p.p.] — miara pokazywana w raporcie. */
  deltaPp: number
  /** Skutek finansowy tego odchylenia; null bez kosztu mięsa. */
  deltaPln: number | null
  /** O ile korekta o jakość partii zmieniłaby ocenę [p.p., ze znakiem].
   *  Istotne dopiero od BATCH_BIAS_PP — wtedy raport dopisuje wyjaśnienie. */
  batchBiasPp: number | null
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
  const best = rows.filter(r => !r.smallSample)[0]
  if (!best || best.deltaPp <= 0) return null
  return { pp: best.deltaPp, pln: (best.deltaPp / 100) * totalKgQuarter * meatCostPerKg,
    workerName: best.workerName }
}

/** Pracownicy, u których korekta o jakość partii zmieniłaby ocenę na tyle,
 *  że raport ma o tym napisać (zamiast trzymać stale drugą kolumnę). */
export function batchBiasNotes(rows: ScorecardRow[]): ScorecardRow[] {
  return rows.filter(r => !r.smallSample && r.batchBiasPp != null
    && Math.abs(r.batchBiasPp) >= BATCH_BIAS_PP)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function workerScorecard(
  workers: ScorecardWorker[], meatCostPerKg: number | null, plantAvgYield: number,
): ScorecardRow[] {
  const totalKg = workers.reduce((a, w) => a + w.kgQuarter, 0) || 1
  const rows: ScorecardRow[] = workers.map(w => {
    const pp = round2(w.avgYield - plantAvgYield)
    const bias = w.yieldVsBatchPp == null ? null : round2(w.yieldVsBatchPp - pp)
    return {
      ...w,
      deltaPp: pp,
      deltaPln: meatCostPerKg == null ? null : (pp / 100) * w.kgQuarter * meatCostPerKg,
      batchBiasPp: bias,
      volumeSharePct: (w.kgQuarter / totalKg) * 100,
      smallSample: w.kgQuarter < SMALL_SAMPLE_KG,
    }
  })
  const key = (r: ScorecardRow) => (r.deltaPln ?? r.deltaPp)
  // Małe próby na koniec listy — nie oceniamy ich, tylko pokazujemy dla
  // kompletu (płaca i tak liczy się z kilogramów, nie z tego rankingu).
  return rows.sort((a, b) =>
    a.smallSample !== b.smallSample ? (a.smallSample ? 1 : -1) : key(b) - key(a))
}
