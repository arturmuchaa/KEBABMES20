/**
 * executiveBrief.ts — cztery zdania na samej górze raportu: co poszło dobrze,
 * co wymaga uwagi, co jest największym ryzykiem, co jest do decyzji.
 *
 * Dwie rzeczy, które odróżniają to od ozdobnika:
 *
 * 1. KAŻDA pozycja niesie liczbę i wskazuje konkret (partię, człowieka, dzień).
 *    „Uzysk wymaga uwagi" bez kwoty to zdanie, po którym nikt nic nie zrobi.
 * 2. Wszystko jest REGUŁOWE i deterministyczne — te same dane dają ten sam
 *    tekst. Raport zarządczy, który co miesiąc formułuje wnioski inaczej dla
 *    tych samych liczb, jest niemożliwy do zweryfikowania.
 *
 * Świadomie BEZ kolorowych kropek 🟢🟡🔴: dokument idzie na czarno-białą
 * drukarkę biurową, gdzie wszystkie trzy drukują się jako identyczna szara
 * plamka. Rozróżnienie niesie podpis pozycji, nie kolor.
 */

export interface BriefBatch {
  batchNo: string
  yieldPct: number | null
  kgQuarter: number
  supplierName?: string
}

export interface BriefWorker {
  workerId: string
  workerName: string
  kgQuarter: number
  yieldVsBatchPp: number | null
  attendancePct: number
  yieldStdDev: number | null
  smallSample: boolean
  deltaPln: number | null
}

export interface BriefInput {
  avgYield: number
  meatCostPerKg: number | null
  kgQuarter: number
  /** Dodatni = ubytek, ujemny = nadwyżka nad deklarację dostawcy. */
  missingKg: number
  batches: BriefBatch[]
  workers: BriefWorker[]
  offDays: { date: string; avgYield: number; kgMeat: number }[]
  monthsInSystem: number
}

export type BriefKind = 'good' | 'watch' | 'risk' | 'decision'
export interface BriefItem { kind: BriefKind; label: string; text: string }

/** Rozrzut partii, powyżej którego warto o nim mówić [p.p.]. */
const SPREAD_WATCH_PP = 1.5

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pln = (v: number) => `${nf0.format(Math.abs(v))} zł`
const fmtD = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

export function executiveBrief(i: BriefInput): BriefItem[] {
  const cost = i.meatCostPerKg
  const scored = i.batches.filter(b => b.yieldPct != null && b.kgQuarter > 0)
    .map(b => ({
      ...b,
      yieldPct: b.yieldPct as number,
      deltaPln: cost == null ? 0 : ((b.yieldPct as number) - i.avgYield) / 100 * b.kgQuarter * cost,
    }))
    .sort((a, b) => a.deltaPln - b.deltaPln)
  const worstBatch = scored[0]
  const bestBatch = scored[scored.length - 1]
  const lossPln = scored.filter(b => b.deltaPln < 0).reduce((a, b) => a + b.deltaPln, 0)
  const spread = scored.length > 1
    ? Math.max(...scored.map(b => b.yieldPct)) - Math.min(...scored.map(b => b.yieldPct))
    : 0

  // Małe próby nie mogą zostać ani wzorcem, ani „największym ryzykiem" —
  // jeden dzień pracy to nie poziom, tylko pojedynczy pomiar.
  const solid = i.workers.filter(w => !w.smallSample && w.yieldVsBatchPp != null)
  const bestWorker = [...solid].sort((a, b) => (b.yieldVsBatchPp ?? 0) - (a.yieldVsBatchPp ?? 0))[0]
  const worstWorker = [...solid].sort((a, b) => (a.deltaPln ?? 0) - (b.deltaPln ?? 0))[0]
  const surplus = i.missingKg < 0
  const gapKg = Math.abs(i.missingKg)

  return [
    { kind: 'good', label: 'Poszło dobrze', text: good() },
    { kind: 'watch', label: 'Wymaga uwagi', text: watch() },
    { kind: 'risk', label: 'Największe ryzyko', text: risk() },
    { kind: 'decision', label: 'Do decyzji', text: decision() },
  ]

  function good(): string {
    const parts: string[] = []
    if (surplus) {
      parts.push(`bilans masy zamknął się nadwyżką ${nf0.format(gapKg)} kg ` +
        `(${nf1.format(gapKg / i.kgQuarter * 100)}%) nad deklaracją dostawcy`)
    }
    if (bestBatch && bestBatch.deltaPln > 0) {
      parts.push(`najlepsza partia ${bestBatch.batchNo} osiągnęła ` +
        `${nf1.format(bestBatch.yieldPct)}%${cost != null ? ` (+${pln(bestBatch.deltaPln)})` : ''}`)
    }
    if (bestWorker && (bestWorker.yieldVsBatchPp ?? 0) > 0) {
      parts.push(`${bestWorker.workerName} utrzymał ` +
        `+${nf2.format(bestWorker.yieldVsBatchPp as number)} p.p. ponad średnią swoich partii`)
    }
    return parts.length
      ? cap(parts.join('; ')) + '.'
      : `Średni uzysk okresu wyniósł ${nf1.format(i.avgYield)}%.`
  }

  function watch(): string {
    const parts: string[] = []
    if (!surplus && gapKg > 0) {
      parts.push(`ubytek masy ${nf0.format(gapKg)} kg ` +
        `(${nf1.format(gapKg / i.kgQuarter * 100)}%) — towar nieujęty w ważeniu`)
    }
    if (spread >= SPREAD_WATCH_PP && worstBatch && bestBatch) {
      parts.push(`rozrzut partii ${nf1.format(spread)} p.p. ` +
        `(${nf1.format(worstBatch.yieldPct)}–${nf1.format(bestBatch.yieldPct)}%)`)
    }
    if (i.offDays.length) {
      const d = [...i.offDays].sort((a, b) =>
        Math.abs(b.avgYield - i.avgYield) - Math.abs(a.avgYield - i.avgYield))[0]
      parts.push(`${i.offDays.length} ${i.offDays.length === 1 ? 'dzień odstający' : 'dni odstających'} ` +
        `od średniej, najmocniej ${fmtD(d.date)} (${nf1.format(d.avgYield)}%)`)
    }
    const unstable = [...solid].sort((a, b) => (b.yieldStdDev ?? 0) - (a.yieldStdDev ?? 0))[0]
    if (unstable && (unstable.yieldStdDev ?? 0) >= 1) {
      parts.push(`najmniej powtarzalny wynik: ${unstable.workerName} ` +
        `(± ${nf2.format(unstable.yieldStdDev as number)} p.p. między dniami)`)
    }
    return parts.length ? cap(parts.join('; ')) + '.'
      : 'Brak odchyleń przekraczających progi kontrolne w tym okresie.'
  }

  function risk(): string {
    if (worstBatch && worstBatch.deltaPln < 0 && cost != null) {
      // Bez ekstrapolacji w skali roku: przy jednym miesiącu danych roczna
      // kwota byłaby zmyślona, a to pierwsza liczba, którą prezes sprawdzi.
      const share = scored.filter(b => b.deltaPln < 0).length
      return `Partia ${worstBatch.batchNo} (${nf1.format(worstBatch.yieldPct)}%` +
        `${worstBatch.supplierName ? `, ${worstBatch.supplierName}` : ''}) kosztowała ` +
        `${pln(worstBatch.deltaPln)} względem średniej okresu; ${share} z ${scored.length} ` +
        `partii wypadło poniżej średniej, łącznie ${pln(lossPln)}.`
    }
    if (worstWorker && (worstWorker.deltaPln ?? 0) < 0) {
      return `${worstWorker.workerName}: ${pln(worstWorker.deltaPln as number)} poniżej średniej ` +
        `własnych partii przy ${nf0.format(worstWorker.attendancePct)}% obecności.`
    }
    if (i.monthsInSystem <= 1) {
      return 'Brak porównania z poprzednim okresem — to jeden miesiąc rozliczony ' +
        'w systemie, więc żadnego wyniku nie da się jeszcze nazwać trendem ani odchyleniem.'
    }
    return `Średni uzysk ${nf1.format(i.avgYield)}% — brak pozycji przekraczającej progi ryzyka.`
  }

  function decision(): string {
    const levers: { text: string; pln: number }[] = []
    if (cost != null && bestWorker && (bestWorker.yieldVsBatchPp ?? 0) > 0) {
      const v = (bestWorker.yieldVsBatchPp as number) / 100 * i.kgQuarter * cost
      levers.push({
        pln: v,
        text: `wyrównanie zespołu do poziomu ${bestWorker.workerName} ` +
          `(+${nf2.format(bestWorker.yieldVsBatchPp as number)} p.p.) daje ${pln(v)} miesięcznie`,
      })
    }
    if (cost != null && lossPln < 0) {
      levers.push({
        pln: Math.abs(lossPln),
        text: `podciągnięcie partii poniżej średniej do ${nf1.format(i.avgYield)}% ` +
          `daje ${pln(lossPln)} miesięcznie`,
      })
    }
    if (!levers.length) {
      return i.monthsInSystem <= 1
        ? 'Zamknąć kolejny miesiąc, żeby raport mógł pokazać trend — dziś każdy wynik ' +
          'jest punktem bez odniesienia.'
        : `Utrzymać obecny poziom ${nf1.format(i.avgYield)}%.`
    }
    levers.sort((a, b) => b.pln - a.pln)
    const cel = cost != null
      ? ` Cel na kolejny miesiąc: uzysk ${nf1.format(i.avgYield + 0.2)}% ` +
        `(+${pln(0.2 / 100 * i.kgQuarter * cost)}).`
      : ''
    return cap(levers.map(l => l.text).join('; ')) + '.' + cel
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
