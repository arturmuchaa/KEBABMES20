/**
 * Przewidywana godzina zakończenia produkcji.
 *
 * Kierownik podejmuje po tej liczbie decyzje (drugi kurs auta, nadgodziny),
 * więc albo jest uczciwa, albo nie ma jej wcale. Stąd `unknown` zamiast
 * zgadywania: przy pustej hali i na starcie zmiany, gdy jeden wpis jednej
 * osoby dałby godzinę 23:40 i zabił zaufanie do kafla na resztę dnia.
 *
 * Tempo bierzemy z trzech źródeł, w tej kolejności ważności:
 *   1. zmierzone DZIŚ (prawda o tej obsadzie i tym dniu),
 *   2. uczone per receptura (z zakończonych dni),
 *   3. ziarno 120 kg/h na osobę (wartość od właściciela, gdy nie ma nic).
 */

export interface Rates {
  seed: number
  global: number
  plannedBreakMinutes: number
  byRecipe: Record<string, number>
}

export interface ForecastLine {
  id: string
  qty: number
  qtyDone: number
  kgPerUnit: number
  recipeId: string
}

export interface ForecastInput {
  lines: readonly ForecastLine[]
  /** Ilu ludzi UKŁADA teraz — z żywych wpisów, nie z kartoteki działu. */
  crew: number
  rates: Rates
  todayKg: number
  todayPersonHours: number
  /** Minuty faktycznej pracy dzisiaj, bez przerw. */
  todayWorkedMin: number
  breakUsedMin: number
  now: string
}

export type Forecast =
  | { kind: 'ready' }
  | { kind: 'unknown'; reason: 'brak-zalogi' | 'za-wczesnie' }
  | {
      kind: 'eta'; at: string; hhmm: string
      remainingKg: number; hours: number; rateUsed: number; breakAddedMin: number
    }

/** Poniżej tylu minut PRACY dzień jest za młody na prognozę. Liczone w czasie
 *  zegarowym, nie w roboczogodzinach: przy dużej załodze roboczogodziny rosną
 *  szybko i próg puszczałby prognozę po kilku minutach. */
const MIN_PRACY_MIN = 20

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Waga tempa dzisiejszego — rośnie z przepracowanymi roboczogodzinami.
 *  Po 4 rbh dzisiejsze waży 4/5; wcześniej podpiera się uczonym. */
const wagaDzis = (rbh: number): number => rbh / (rbh + 1)

export function finishForecast(input: ForecastInput): Forecast {
  const { lines, crew, rates, todayKg, todayPersonHours, todayWorkedMin, breakUsedMin, now } = input

  const zostalo = (lines ?? []).map(l => ({
    kg: Math.max(0, (l.qty ?? 0) - (l.qtyDone ?? 0)) * (l.kgPerUnit ?? 0),
    recipeId: l.recipeId ?? '',
  })).filter(x => x.kg > 0)

  const remainingKg = zostalo.reduce((a, x) => a + x.kg, 0)
  if (remainingKg <= 0) return { kind: 'ready' }
  if (!crew || crew <= 0) return { kind: 'unknown', reason: 'brak-zalogi' }
  if ((todayWorkedMin ?? 0) < MIN_PRACY_MIN) return { kind: 'unknown', reason: 'za-wczesnie' }

  const tempoDzis = todayPersonHours > 0 ? todayKg / todayPersonHours : 0
  const w = tempoDzis > 0 ? wagaDzis(todayPersonHours) : 0

  const tempoDla = (recipeId: string): number => {
    const uczone = rates.byRecipe?.[recipeId] ?? rates.global ?? rates.seed
    const zmieszane = w * tempoDzis + (1 - w) * uczone
    return zmieszane > 0 ? zmieszane : (rates.seed || 1)
  }

  let hours = 0
  for (const x of zostalo) hours += x.kg / (tempoDla(x.recipeId) * crew)

  // Przerwa, która jeszcze dziś będzie. Wykorzystana ponad plan nie odejmuje
  // czasu od prognozy — hala nie odrobi obiadu przez skrócenie roboty.
  const breakAddedMin = Math.max(0, (rates.plannedBreakMinutes ?? 0) - (breakUsedMin ?? 0))

  const at = new Date(new Date(now).getTime() + (hours * 60 + breakAddedMin) * 60_000)
  // Tempo pokazywane w panelu to średnia ważona kilogramami — jedna liczba
  // dla operatora, nawet gdy pozycje mają różne receptury.
  const rateUsed = remainingKg / (hours * crew)

  return {
    kind: 'eta', at: at.toISOString(), hhmm: hhmm(at),
    remainingKg: Math.round(remainingKg * 100) / 100,
    hours: Math.round(hours * 1000) / 1000,
    rateUsed: Math.round(rateUsed * 100) / 100,
    breakAddedMin,
  }
}
