/**
 * executiveSummary.ts — strona 1 raportu rozbioru: to, co prezes ma zrozumieć
 * w 30 sekund.
 *
 * Cała logika siedzi tutaj (nie w JSX), bo raport zarządczy musi być
 * powtarzalny: te same dane = ten sam tekst i te same liczby, za miesiąc i za
 * rok. Stąd też podsumowanie słowne jest REGUŁOWE, nie generowane przez model —
 * zdanie, które co miesiąc brzmi inaczej dla tych samych liczb, jest nie do
 * zweryfikowania przez nikogo poza autorem.
 *
 * Zasada nadrzędna: raport pokazuje wyłącznie to, czego system może bronić.
 * Czego nie wiemy — mówimy wprost (patrz `reportGaps`), zamiast zaklejać
 * zerem albo zmyśloną zmianą. Dlatego brak poprzedniego miesiąca daje
 * „pierwszy miesiąc w systemie", a nie „+0,3 p.p. vs czerwiec".
 */

import { YIELD_NORM_PCT } from '@/features/deboning/utils'

export interface ExecSummary {
  kgQuarter: number
  kgMeat: number
  kgBacks: number
  kgBones: number
  /** Dodatni = ubytek (coś niezważone); ujemny = nadwyżka nad deklarację dostawcy. */
  missingKg: number
  avgYield: number
  kgPerHour: number
  quarters: number
  workers: number
  quarterCost: number | null
  laborCost: number | null
  byproductRevenue: number | null
  meatCostPerKg: number | null
}

export interface ExecBatch {
  batchNo: string
  yieldPct: number | null
  kgQuarter: number
  supplierName?: string
  quarterCost?: number | null
}

/** Tylko pola trendu, których używa strona 1 — reszta KpiMonth nieistotna. */
export interface TrendMonth {
  yearMonth: string
  avgYield: number | null
  meatCostPerKg: number | null
  deltaYieldPp: number | null
  deltaMeatCostPerKg: number | null
}

// ── Bilans masy ───────────────────────────────────────────────────────────
// Prezes musi zobaczyć, że nic nie znika: wejście = mięso + grzbiety + kości
// + różnica, domknięte do 100%.

export interface MassPart {
  label: string
  kg: number
  /** Udział w ćwiartce Z DOKUMENTU dostawcy — tak liczy się uzysk. */
  pct: number
  /** Szerokość segmentu słupka: udział w tym, co FAKTYCZNIE zważono. */
  barPct: number
  tone: 'meat' | 'backs' | 'bones' | 'gap'
}
export interface MassBalance {
  parts: MassPart[]
  /** Suma wyjścia jako % ćwiartki z dokumentu — przy nadwyżce > 100%. */
  outputPct: number
  outputKg: number
  gap: { label: string; kg: number; pct: number; surplus: boolean }
}

export function massBalance(s: ExecSummary): MassBalance {
  const q = s.kgQuarter || 1
  const surplus = s.missingKg < 0
  const gapKg = Math.abs(s.missingKg)
  const gap = {
    label: surplus ? 'Nadwyżka nad deklaracją dostawcy' : 'Ubytek (niezważone)',
    kg: gapKg, pct: (gapKg / q) * 100, surplus,
  }
  const parts: Omit<MassPart, 'barPct'>[] = [
    { label: 'Mięso', kg: s.kgMeat, pct: (s.kgMeat / q) * 100, tone: 'meat' },
    { label: 'Grzbiety', kg: s.kgBacks, pct: (s.kgBacks / q) * 100, tone: 'backs' },
    { label: 'Kości', kg: s.kgBones, pct: (s.kgBones / q) * 100, tone: 'bones' },
  ]
  // Ubytek domyka słupek do wagi z dokumentu. NADWYŻKA nie jest frakcją —
  // to towar ponad deklarację dostawcy, więc nie wchodzi do słupka, tylko
  // jest opisana obok. Bez tego rozdziału wiersz „100,0%" sąsiadował ze
  // składowymi sumującymi się do 101,0% i wyglądał jak błąd rachunkowy.
  if (!surplus && gapKg > 0) parts.push({ label: gap.label, kg: gapKg, pct: gap.pct, tone: 'gap' })

  const outputKg = s.kgMeat + s.kgBacks + s.kgBones
  const weighed = parts.reduce((a, p) => a + p.kg, 0) || 1
  return {
    parts: parts.map(p => ({ ...p, barPct: (p.kg / weighed) * 100 })),
    outputKg,
    outputPct: (outputKg / q) * 100,
    gap,
  }
}

// ── Wodospad kosztu 1 kg mięsa ────────────────────────────────────────────

export interface CostStep { label: string; sign: '+' | '−'; pln: number; perKgMeat: number }
export interface CostWaterfall { steps: CostStep[]; netPln: number; netPerKg: number }

export function costWaterfall(s: ExecSummary): CostWaterfall | null {
  if (s.quarterCost == null || !s.kgMeat) return null
  const labor = s.laborCost ?? 0
  const byprod = s.byproductRevenue ?? 0
  const netPln = s.quarterCost + labor - byprod
  const per = (v: number) => v / s.kgMeat
  return {
    steps: [
      { label: 'Zakup ćwiartki', sign: '+', pln: s.quarterCost, perKgMeat: per(s.quarterCost) },
      { label: 'Robocizna rozbioru', sign: '+', pln: labor, perKgMeat: per(labor) },
      { label: 'Sprzedaż ubocznych', sign: '−', pln: byprod, perKgMeat: per(byprod) },
    ],
    netPln,
    netPerKg: per(netPln),
  }
}

// ── Ile jest wart uzysk ───────────────────────────────────────────────────

export interface YieldValue {
  pointKg: number
  pointPln: number
  scenarios: { yieldPct: number; deltaKg: number; deltaPln: number }[]
}

/** Przekłada punkty procentowe uzysku na pieniądze BEZ cen sprzedaży (tych
 *  w MES nie ma — sprzedaż idzie poza systemem). Dlatego miarą jest koszt
 *  wytworzenia 1 kg mięsa: każdy kilogram, który nie wyszedł z ćwiartki,
 *  trzeba było wytworzyć drugi raz. */
export function yieldValue(s: ExecSummary, scenarioPcts = [65, 66, 66.5]): YieldValue | null {
  if (s.meatCostPerKg == null || !s.kgQuarter) return null
  const pointKg = s.kgQuarter * 0.001
  return {
    pointKg,
    pointPln: pointKg * s.meatCostPerKg,
    scenarios: scenarioPcts.map(p => {
      const deltaKg = ((p - s.avgYield) / 100) * s.kgQuarter
      return { yieldPct: p, deltaKg, deltaPln: deltaKg * s.meatCostPerKg! }
    }),
  }
}

// ── Gdzie uciekają pieniądze ──────────────────────────────────────────────

export interface BatchDeviation {
  batchNo: string
  supplierName: string
  yieldPct: number
  kgQuarter: number
  deltaPp: number
  deltaPln: number
}
export interface BatchDeviations {
  all: BatchDeviation[]
  worst: BatchDeviation[]
  best: BatchDeviation[]
  /** Suma odchyleń ujemnych — ile kosztowały partie poniżej średniej. */
  lossPln: number
}

export function batchDeviations(
  batches: ExecBatch[], avgYield: number, meatCostPerKg: number | null, top = 5,
): BatchDeviations | null {
  if (meatCostPerKg == null) return null
  const all = batches
    .filter(b => b.yieldPct != null && b.kgQuarter > 0)
    .map(b => {
      const deltaPp = (b.yieldPct as number) - avgYield
      return {
        batchNo: b.batchNo,
        supplierName: b.supplierName ?? '',
        yieldPct: b.yieldPct as number,
        kgQuarter: b.kgQuarter,
        deltaPp,
        deltaPln: (deltaPp / 100) * b.kgQuarter * meatCostPerKg,
      }
    })
    .sort((a, b) => a.deltaPln - b.deltaPln)
  return {
    all,
    worst: all.slice(0, top),
    best: all.slice(-top).reverse(),
    lossPln: all.filter(b => b.deltaPln < 0).reduce((a, b) => a + b.deltaPln, 0),
  }
}

// ── Podsumowanie słowne ───────────────────────────────────────────────────

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const t = (kg: number) => nf1.format(kg / 1000)

export function execNarrative(
  s: ExecSummary, batches: ExecBatch[], months: TrendMonth[],
  // Kwota policzona z tygodnia nie może być opisana jako miesięczna —
  // przysłówek podaje wywołujący (`scopeWords`), domyślnie miesiąc.
  periodAdverb = 'miesięcznie',
): string[] {
  const out: string[] = []
  out.push(
    `Rozebrano ${t(s.kgQuarter)} t ćwiartki w ${s.quarters} pobraniach; ` +
    `uzyskano ${t(s.kgMeat)} t mięsa, ${t(s.kgBacks)} t grzbietów i ${t(s.kgBones)} t kości.`)

  const cur = months[months.length - 1]
  if (cur?.deltaYieldPp != null) {
    const d = cur.deltaYieldPp
    const dir = d > 0 ? 'wyżej' : d < 0 ? 'niżej' : 'tyle samo'
    out.push(
      `Średni uzysk wyniósł ${nf1.format(s.avgYield)}% — o ${nf1.format(Math.abs(d))} p.p. ` +
      `${dir} niż w poprzednim miesiącu.`)
  } else {
    out.push(
      `Średni uzysk wyniósł ${nf1.format(s.avgYield)}%. Brak danych porównawczych: ` +
      `w systemie jest dopiero jeden zamknięty miesiąc.`)
  }

  if (s.meatCostPerKg != null) {
    const v = yieldValue(s)
    out.push(
      `Koszt wytworzenia 1 kg mięsa to ${nf2.format(s.meatCostPerKg)} zł` +
      (v ? ` — każde 0,1 p.p. uzysku jest warte ${nf0.format(v.pointPln)} zł ${periodAdverb}.` : '.'))
  }

  const dev = batchDeviations(batches, s.avgYield, s.meatCostPerKg)
  if (dev && dev.worst.length && dev.worst[0].deltaPln < 0) {
    const w = dev.worst[0]
    const b = dev.best[0]
    out.push(
      `Najsłabsza partia ${w.batchNo} (${nf1.format(w.yieldPct)}%) kosztowała ` +
      `${nf0.format(Math.abs(w.deltaPln))} zł względem średniej, najlepsza ${b.batchNo} ` +
      `(${nf1.format(b.yieldPct)}%) dała ${nf0.format(b.deltaPln)} zł ponad nią; ` +
      `łącznie partie poniżej średniej to ${nf0.format(Math.abs(dev.lossPln))} zł.`)
  }

  const bal = massBalance(s)
  out.push(
    bal.gap.surplus
      ? `Bilans masy zamknął się nadwyżką ${nf0.format(bal.gap.kg)} kg ` +
        `(${nf1.format(bal.gap.pct)}%) — surowca było więcej, niż deklarował dostawca.`
      : `Bilans masy wykazał ${nf0.format(bal.gap.kg)} kg ubytku ` +
        `(${nf1.format(bal.gap.pct)}%) — towar nieujęty w ważeniu.`)
  return out
}

/** Podsumowanie raportu DZIENNEGO — operacyjne, bez warstwy zarządczej.
 *
 *  Jedna zmiana nie daje trendu ani wniosków kadrowych, więc odniesieniem
 *  jest norma uzysku, a nie poprzedni okres. Żadnego słowa „miesiąc": kwoty
 *  miesięczne w dokumencie z jednego dnia byłyby po prostu nieprawdziwe. */
export function execNarrativeDay(s: ExecSummary, batchCount: number): string[] {
  const out: string[] = []
  out.push(
    // „z 1 partii" i „z 3 partii" — dopełniacz jest ten sam, bez odmiany.
    `Rozebrano ${t(s.kgQuarter)} t ćwiartki w ${s.quarters} pobraniach ` +
    `z ${batchCount} partii surowca; uzyskano ${t(s.kgMeat)} t mięsa, ` +
    `${t(s.kgBacks)} t grzbietów i ${t(s.kgBones)} t kości.`)

  const { lo, hi } = YIELD_NORM_PCT
  const vsNorm = s.avgYield < lo ? 'poniżej normy' : s.avgYield > hi ? 'powyżej normy' : 'w normie'
  out.push(
    `Średni uzysk wyniósł ${nf1.format(s.avgYield)}% — ${vsNorm} ` +
    `(${nf1.format(lo)}–${nf1.format(hi)}%). Tempo: ${nf0.format(s.kgPerHour)} kg/h ` +
    `na osobę przy ${s.workers} stanowiskach.`)

  if (s.meatCostPerKg != null) {
    out.push(`Koszt wytworzenia 1 kg mięsa w tym dniu to ${nf2.format(s.meatCostPerKg)} zł/kg.`)
  }

  const bal = massBalance(s)
  out.push(
    bal.gap.surplus
      ? `Bilans masy zamknął się nadwyżką ${nf0.format(bal.gap.kg)} kg ` +
        `(${nf1.format(bal.gap.pct)}%) — surowca było więcej, niż deklarował dostawca.`
      : `Bilans masy wykazał ${nf0.format(bal.gap.kg)} kg ubytku ` +
        `(${nf1.format(bal.gap.pct)}%) — towar nieujęty w ważeniu.`)
  return out
}

// ── Czego raport nie obejmuje ─────────────────────────────────────────────

/** Jawna lista dziur. Raport, który przyznaje się do braków, jest
 *  wiarygodniejszy niż taki, który je zakleja — a prezes i tak je znajdzie. */
export function reportGaps(
  s: ExecSummary, batches: ExecBatch[], months: { yearMonth: string }[],
): string[] {
  const gaps: string[] = []
  if (months.length <= 1) {
    gaps.push(
      'Brak trendu: w systemie jest jeden miesiąc rozliczonego rozbioru. ' +
      'Porównania miesiąc do miesiąca pojawią się po zamknięciu kolejnych okresów.')
  }
  const noPrice = batches.filter(b => b.quarterCost === null).map(b => b.batchNo)
  if (noPrice.length) {
    gaps.push(
      `Poza rachunkiem kosztów: ${noPrice.length} ${noPrice.length === 1 ? 'partia' : 'partie'} ` +
      `bez ceny zakupu (${noPrice.slice(0, 6).join(', ')}${noPrice.length > 6 ? '…' : ''}).`)
  }
  gaps.push(
    'Raport nie zawiera marży ani zysku: MES prowadzi stronę kosztową ' +
    '(zakup, robocizna, uboczne), natomiast sprzedaż wyrobu rozliczana jest poza systemem.')
  if (s.byproductRevenue == null) {
    gaps.push('Brak przychodu ze sprzedaży ubocznych — koszt 1 kg mięsa jest zawyżony.')
  }
  return gaps
}
