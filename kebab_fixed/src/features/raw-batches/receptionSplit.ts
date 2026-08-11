/**
 * receptionSplit — podział JEDNEJ dostawy na numery porządkowe.
 *
 * Dostawa przyjeżdża jako komplet pozycji HDI dostawcy (jego numery partii
 * + kilogramy). Zakład rozbija ją na własne numery porządkowe, przy czym
 * jedna partia dostawcy trafia w CAŁOŚCI do jednego numeru — dzielenie jej
 * urywa identyfikowalność w połowie.
 *
 *     PRZYJĘCIE 12/08/2026 — 10 000 kg
 *     ├── numer porządkowy #1 — A001…A005 — 6 000 kg
 *     └── numer porządkowy #2 — A006…A008 — 4 000 kg
 *
 * Zero importów z React/UI — moduł ma się dać przetestować w vitest i użyć
 * w wydruku rejestru przyjęć.
 */

/** Pozycja z HDI dostawcy, z przypisanym numerem porządkowym. */
export interface HdiLine {
  supplierBatchNo: string
  kgReceived:      number
  /** Surowy tekst z pola wagi („1 800,00") — pole jest tekstowe, żeby
   *  przyjąć format z HDI; `kgReceived` to jego wynik po `parseKg`. */
  kgRaw?:          string
  slaughterDate:   string
  expiryDate:      string
  /** Indeks numeru porządkowego (0 = pierwszy). */
  group:           number
}

export interface ReceptionGroup {
  index:       number
  kg:          number
  lines:       HdiLine[]
  supplierNos: string[]
  /** Najwcześniejsza data uboju / ważności w grupie — FEFO liczy od najkrótszej. */
  slaughterDate: string
  expiryDate:    string
  /** Numer porządkowy, który grupa dostanie przy zapisie („472").
   *  Podpowiedź z sekwencji — patrz `ordinalLabels`. */
  batchNo?:      string
  /** Ręcznie policzone pojemniki tej grupy; null = wylicz z kalibru.
   *  Nie wynika z pozycji HDI — dokłada je operator, który przeliczył stos
   *  (5.08.2026 partia 459: 199 pojemników na palecie vs 193 z wagi). */
  containersCount?: number | null
}

/**
 * parseKg — waga przepisana z HDI, w formacie, w jakim tam stoi.
 *
 * HDI dostawcy drukuje „1 800,00" i „2 160,00" — ze spacją tysięcy i
 * przecinkiem dziesiętnym. `<input type="number">` odrzuca jedno i drugie,
 * więc pole jest tekstowe, a liczbę wyciągamy tutaj. Kropka też przechodzi:
 * operator z klawiatury numerycznej wpisze „1800.5".
 */
export function parseKg(raw: string): number {
  const s = String(raw ?? '')
    .replace(/[\s  ]/g, '')   // spacje tysięcy, także twarde
    .replace(',', '.')
  if (!s || !/^\d*\.?\d*$/.test(s)) return 0
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * nextSupplierBatchNo — numery partii na HDI idą po kolei (112819, 112820…),
 * więc kolejny wiersz podpowiada następny numer. Przy przerwie w numeracji
 * (112824 → 112827) operator poprawia jedno pole zamiast wpisywać wszystko.
 * Numer nieliczbowy albo pusty nie generuje podpowiedzi.
 */
export function nextSupplierBatchNo(prev: string): string {
  const s = (prev ?? '').trim()
  if (!/^\d+$/.test(s)) return ''
  // Bez BigInt/Number: numery bywają długie, a wiodące zera muszą zostać.
  const inc = (String(BigInt(s) + 1n)).padStart(s.length, '0')
  return inc
}

/** Najwcześniejsza niepusta data (ISO). */
function earliest(values: string[]): string {
  const ds = values.filter(Boolean).map(v => v.slice(0, 10)).sort()
  return ds[0] ?? ''
}

/**
 * groupLines — pozycje HDI pogrupowane w numery porządkowe.
 *
 * Zwraca ZAWSZE `groupCount` grup, także puste: operator widzi wtedy, że
 * założył numer porządkowy i nic do niego nie przypisał (to błąd, ale ma go
 * zobaczyć jako pustą grupę, a nie przez zniknięcie wiersza).
 */
export function groupLines(lines: HdiLine[], groupCount: number): ReceptionGroup[] {
  const n = Math.max(1, groupCount)
  return Array.from({ length: n }, (_, index) => {
    const own = lines.filter(l => l.group === index)
    return {
      index,
      kg:            own.reduce((s, l) => s + (Number(l.kgReceived) || 0), 0),
      lines:         own,
      supplierNos:   own.map(l => l.supplierBatchNo.trim()).filter(Boolean),
      slaughterDate: earliest(own.map(l => l.slaughterDate)),
      expiryDate:    earliest(own.map(l => l.expiryDate)),
    }
  })
}

/** Suma całej dostawy — musi się zgadzać z dokumentem przewozowym. */
export function receptionTotalKg(lines: HdiLine[]): number {
  return lines.reduce((s, l) => s + (Number(l.kgReceived) || 0), 0)
}

export interface ReceptionIssues {
  /** Blokują zapis. */
  errors:   string[]
  /** Widoczne, ale nie blokują — dostawa musi wejść do systemu. */
  warnings: string[]
}

/**
 * receptionIssues — kontrole modelu dostawy.
 *
 * Blokujemy tylko to, co czyni dokument bezsensownym (numer porządkowy bez
 * kilogramów). Podzielona partia dostawcy to ostrzeżenie: zdarza się, że
 * dostawca sam przywozi resztę wcześniejszej partii, a odmowa rejestracji
 * o szóstej rano jest gorsza niż widoczna adnotacja.
 */
export function receptionIssues(
  lines: HdiLine[], groupCount: number, labels: string[] = [],
): ReceptionIssues {
  const groups = groupLines(lines, groupCount)
  const errors: string[] = []
  const warnings: string[] = []
  // Komunikat ma mówić numerem, który operator widzi na kaflu („472"),
  // a nie pozycją listy — inaczej trzeba je w głowie przeliczać.
  const name = (i: number) => labels[i] ?? `#${i + 1}`

  groups.forEach(g => {
    if (g.kg <= 0) errors.push(`Numer porządkowy ${name(g.index)} nie ma żadnych kilogramów`)
  })

  lines.forEach(l => {
    if ((Number(l.kgReceived) || 0) <= 0 && l.supplierBatchNo.trim())
      errors.push(`Partia dostawcy ${l.supplierBatchNo.trim()} nie ma wagi`)
  })

  const seen = new Map<string, number>()
  lines.forEach(l => {
    const no = l.supplierBatchNo.trim()
    if (!no) return
    const first = seen.get(no)
    if (first !== undefined && first !== l.group) {
      warnings.push(
        `Partia dostawcy ${no} rozdzielona między numer porządkowy ${name(first)} i ${name(l.group)}`)
    } else if (first === undefined) {
      seen.set(no, l.group)
    }
  })

  if (lines.some(l => !l.supplierBatchNo.trim() && (Number(l.kgReceived) || 0) > 0))
    warnings.push('Pozycja bez numeru partii dostawcy — nie będzie czego pokazać przy reklamacji')

  return { errors, warnings }
}

/** Czy dostawę da się zapisać. */
export function canSubmitReception(
  lines: HdiLine[], groupCount: number, labels: string[] = [],
): boolean {
  return receptionIssues(lines, groupCount, labels).errors.length === 0 &&
    receptionTotalKg(lines) > 0
}

/**
 * withContainers — dopisuje grupom LICZBĘ POJEMNIKÓW, którą widzi operator.
 *
 * Domyślnie wynika z kalibru (kg ÷ pojemnik, w górę — niepełny pojemnik to
 * nadal jeden fizyczny pojemnik); ręczne przeliczenie stosu ma pierwszeństwo.
 *
 * Musi być JEDNO źródło tej liczby: kontrola „ilość pojemników z HDI" brała
 * kiedyś pod uwagę wyłącznie nadpisania i przy nietkniętym formularzu
 * pokazywała rozjazd o całą dostawę (−600), choć na ekranie stało 349 + 251.
 */
export function withContainers(
  groups: ReceptionGroup[],
  containerKg: number | null,
  overrides: Record<number, number | null> = {},
  perKg: (kg: number, cal: number | null) => number | null =
    (kg, cal) => (cal && cal > 0 ? Math.ceil(kg / cal) : null),
): ReceptionGroup[] {
  return groups.map(g => ({
    ...g,
    containersCount: overrides[g.index] ?? perKg(g.kg, containerKg),
  }))
}

/**
 * ordinalLabels — numery porządkowe, które grupy DOSTANĄ przy zapisie.
 *
 * Operator dzieli dostawę myśląc numerami hali („to jedzie na 472"), nie
 * pozycjami listy, więc pokazujemy 472, 473… zamiast #1, #2. Numery są
 * PODPOWIEDZIĄ — nadaje je backend atomowo przy zapisie, więc gdy w tej samej
 * chwili ktoś zarejestruje dostawę z drugiego stanowiska, faktyczne mogą
 * wyjść wyższe. Dlatego formularz nigdy ich nie wysyła: sekwencja zostaje
 * jedynym źródłem prawdy.
 *
 * Seria usługowa („48U") ma własną numerację i literę trzeba zachować.
 * Bez czytelnej podpowiedzi wracamy do „#1", zamiast zmyślać numer.
 */
export function ordinalLabels(suggested: string, count: number): string[] {
  const m = /^(\d+)(U?)$/i.exec((suggested || '').trim())
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    m ? `${Number(m[1]) + i}${m[2].toUpperCase()}` : `#${i + 1}`)
}

/** Sumy zadeklarowane na HDI — do porównania z tym, co faktycznie wpisano. */
export interface HdiTotals {
  /** „Masa netto" ze stopki HDI. 0 = nie podano. */
  kg:         number
  /** „Ilość pojemników" ze stopki HDI. 0 = nie podano. */
  containers: number
}

export interface HdiCheck {
  /** Różnica wpisane − HDI (0 gdy zgodne lub gdy HDI nie podano). */
  kgDiff:         number
  containersDiff: number
  ok:             boolean
}

/**
 * checkAgainstHdi — kontrola „czy przepisałem cały dokument".
 *
 * Stopka HDI podaje masę netto i liczbę pojemników całej dostawy. Porównanie
 * z sumą wpisanych pozycji łapie najczęstszy błąd: pominiętą albo dwa razy
 * wpisaną linię. Pole niewypełnione (0) nie zgłasza rozjazdu — nie każdy
 * dokument je ma.
 */
export function checkAgainstHdi(
  lines: HdiLine[], groups: ReceptionGroup[], hdi: HdiTotals,
): HdiCheck {
  const kgDiff = hdi.kg > 0
    ? Math.round((receptionTotalKg(lines) - hdi.kg) * 1000) / 1000 : 0
  const entered = groups.reduce((s, g) => s + (g.containersCount ?? 0), 0)
  const containersDiff = hdi.containers > 0 ? entered - hdi.containers : 0
  return { kgDiff, containersDiff, ok: kgDiff === 0 && containersDiff === 0 }
}

/**
 * renumberAfterRemove — po skasowaniu numeru porządkowego indeksy muszą się
 * zejść bez dziur, inaczej grupa #3 zostałaby z pozycjami wskazującymi na
 * nieistniejącą #2.
 */
export function renumberAfterRemove(lines: HdiLine[], removed: number): HdiLine[] {
  return lines.map(l => ({
    ...l,
    group: l.group === removed ? Math.max(0, removed - 1)
      : l.group > removed ? l.group - 1
        : l.group,
  }))
}
