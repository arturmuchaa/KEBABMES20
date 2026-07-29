/**
 * reportPeriod.ts — okresy raportu rozbioru i to, co się w nich drukuje.
 *
 * Raport ma jeden szablon, ale dwie role. Miesiąc, kwartał i rok to materiał
 * dla zarządu: podsumowanie, odchylenia w złotówkach, trend, premie. Jeden
 * dzień to dokument OPERACYJNY dla biura i hali — tam premie i trendy nie
 * mają czego szukać, bo z jednej zmiany nie wyciąga się wniosków kadrowych.
 * Stąd `scopeSections`: zakres decyduje o zawartości, nie osobne szablony,
 * które i tak rozjechałyby się po pierwszej zmianie w jednym z nich.
 *
 * Okres rozpoznajemy po DOKŁADNYCH granicach (poniedziałek–niedziela, 1. dzień
 * miesiąca – ostatni itd.). Zakres wpisany ręcznie zostaje „custom", nawet gdy
 * ma 30 dni — inaczej raport obiecywałby porównania miesiąc do miesiąca dla
 * przypadkowego wycinka kalendarza.
 *
 * Wszystko liczy się na kalendarzu LOKALNYM (Date z komponentami), bo doba
 * produkcyjna jest polska — ta sama zasada co w statystykach rozbioru.
 */

export type PeriodKind = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type ReportScope = PeriodKind | 'custom'

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec',
  'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
const ROMAN = ['I', 'II', 'III', 'IV']

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Poniedziałek tygodnia, w którym leży `d` (tydzień polski, nie amerykański). */
function monday(d: Date): Date {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7   // pon=0 … nd=6
  x.setDate(x.getDate() - dow)
  return x
}

export function periodRange(kind: PeriodKind, refIso: string): { from: string; to: string } {
  const d = parse(refIso)
  switch (kind) {
    case 'day':
      return { from: ymd(d), to: ymd(d) }
    case 'week': {
      const a = monday(d)
      const b = new Date(a)
      b.setDate(b.getDate() + 6)
      return { from: ymd(a), to: ymd(b) }
    }
    case 'month':
      return {
        from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)),
        to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      }
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3)
      return {
        from: ymd(new Date(d.getFullYear(), q * 3, 1)),
        to: ymd(new Date(d.getFullYear(), q * 3 + 3, 0)),
      }
    }
    case 'year':
      return {
        from: ymd(new Date(d.getFullYear(), 0, 1)),
        to: ymd(new Date(d.getFullYear(), 12, 0)),
      }
  }
}

/** Przewiń okres o `step` jednostek (strzałki ◀ ▶ nad raportem).
 *
 *  Miesiące/kwartały/lata przewijamy z 1. dnia miesiąca — inaczej cofnięcie
 *  z 31 marca daje 3 marca (luty ma 28 dni) i okres przeskakuje. */
export function shiftPeriod(kind: PeriodKind, refIso: string, step: number): string {
  const d = parse(refIso)
  switch (kind) {
    case 'day':
      d.setDate(d.getDate() + step)
      return ymd(d)
    case 'week':
      d.setDate(d.getDate() + step * 7)
      return ymd(d)
    case 'month':
      return ymd(new Date(d.getFullYear(), d.getMonth() + step, 1))
    case 'quarter':
      return ymd(new Date(d.getFullYear(), d.getMonth() + step * 3, 1))
    case 'year':
      return ymd(new Date(d.getFullYear() + step, d.getMonth(), 1))
  }
}

/** Jakim okresem jest zakres — po DOKŁADNYCH granicach kalendarzowych. */
export function detectScope(from: string, to: string): ReportScope {
  if (!from || !to) return 'custom'
  if (from === to) return 'day'
  for (const kind of ['week', 'month', 'quarter', 'year'] as PeriodKind[]) {
    const r = periodRange(kind, from)
    if (r.from === from && r.to === to) return kind
  }
  return 'custom'
}

export function scopeTitle(scope: ReportScope): string {
  switch (scope) {
    case 'day': return 'RAPORT DZIENNY ROZBIORU'
    case 'week': return 'RAPORT TYGODNIOWY ROZBIORU'
    case 'month': return 'RAPORT MIESIĘCZNY ROZBIORU'
    case 'quarter': return 'RAPORT KWARTALNY ROZBIORU'
    case 'year': return 'RAPORT ROCZNY ROZBIORU'
    default: return 'RAPORT ROZBIORU'
  }
}

const fmtD = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

export function periodLabel(scope: ReportScope, from: string, to: string): string {
  const d = parse(from)
  switch (scope) {
    case 'month': return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    case 'quarter': return `${ROMAN[Math.floor(d.getMonth() / 3)]} kwartał ${d.getFullYear()}`
    case 'year': return `rok ${d.getFullYear()}`
    case 'day': return fmtD(from)
    // Tydzień nazywa się datami — ale z podpisem, żeby nagłówek nie wyglądał
    // jak przypadkowy zakres wpisany ręcznie.
    case 'week': return `tydzień ${fmtD(from)} – ${fmtD(to)}`
    default: return `${fmtD(from)} – ${fmtD(to)}`
  }
}

export interface ScopeSections {
  /** Podsumowanie dla zarządu (cztery pozycje). */
  brief: boolean
  massBalance: boolean
  cost: boolean
  /** „Ile jest wart uzysk" — scenariusze w złotówkach. */
  yieldValue: boolean
  /** „Gdzie uciekają pieniądze" — odchylenia partii. */
  deviations: boolean
  trend: boolean
  gaps: boolean
  batches: boolean
  workers: boolean
  /** Rozdział o premii — sensowny dopiero od pełnego miesiąca. */
  bonus: boolean
  /** Wykres dnia po dniu — przy jednym dniu nie ma czego rysować. */
  dailyChart: boolean
}

export function scopeSections(scope: ReportScope): ScopeSections {
  // Jeden dzień = dokument operacyjny: co weszło, co wyszło, kto ile zrobił.
  // Wnioski kadrowe i finansowe z jednej zmiany byłyby nadinterpretacją.
  if (scope === 'day') {
    return {
      brief: false, massBalance: true, cost: true, yieldValue: false,
      deviations: false, trend: false, gaps: false,
      batches: true, workers: true, bonus: false, dailyChart: false,
    }
  }
  // Premia rozlicza się w cyklu płacowym — tydzień i zakres własny jej nie mają.
  const bonus = scope === 'month' || scope === 'quarter' || scope === 'year'
  return {
    brief: true, massBalance: true, cost: true, yieldValue: true,
    deviations: true, trend: true, gaps: true,
    batches: true, workers: true, bonus, dailyChart: true,
  }
}

export interface ScopeWords {
  /** Przysłówek do kwot liczonych za okres: „miesięcznie", „tygodniowo". */
  adverb: string
  /** Rzeczownik w mianowniku: „miesiąc", „tydzień". */
  noun: string
  /** „kolejny miesiąc", „kolejny tydzień" — do celów na następny okres. */
  next: string
}

/** Słowa okresu do tekstów raportu. Bez tego kwota policzona z tygodnia
 *  wychodziła w druku jako „X zł miesięcznie" — czyli cztery razy za dużo. */
export function scopeWords(scope: ReportScope): ScopeWords {
  switch (scope) {
    case 'day': return { adverb: 'w tym dniu', noun: 'dzień', next: 'kolejny dzień' }
    case 'week': return { adverb: 'tygodniowo', noun: 'tydzień', next: 'kolejny tydzień' }
    case 'month': return { adverb: 'miesięcznie', noun: 'miesiąc', next: 'kolejny miesiąc' }
    case 'quarter': return { adverb: 'kwartalnie', noun: 'kwartał', next: 'kolejny kwartał' }
    case 'year': return { adverb: 'rocznie', noun: 'rok', next: 'kolejny rok' }
    default: return { adverb: 'w tym okresie', noun: 'okres', next: 'kolejny okres' }
  }
}
