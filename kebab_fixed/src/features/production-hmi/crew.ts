/**
 * Kto pracuje na linii, a kto tylko obsługuje panel.
 *
 * Kiosk brał dotąd listę z DZIAŁÓW (`/auth/operators?department=produkcja`),
 * czyli z tego, kto ma dostęp do panelu. Efekt: na ekranie stał sam kierownik,
 * bo tylko on ma PIN — a sztuki liczy się ludziom z linii. Dostęp do panelu
 * i wykonywanie pracy to dwie różne rzeczy, więc listę bierzemy z ROLI
 * pracownika, dokładnie jak rozbiór (`WORKER_DEBONING`).
 */
export interface WorkerRow {
  id: string
  name: string
  role?: string
  active?: boolean
  /** Foliowczyk — zaznaczany w kartotece pracownika.
   *  `/workers` oddaje surowe wiersze z bazy, więc pole przychodzi jako
   *  `is_wrapper`; przyjmujemy obie postaci. */
  isWrapper?: boolean
  is_wrapper?: boolean
}

const foliowczyk = (w: WorkerRow): boolean => !!(w.isWrapper ?? w.is_wrapper)

const czynny = (w: WorkerRow): boolean => !!w && w.active !== false && !!w.id && !!w.name

const poNazwisku = (a: WorkerRow, b: WorkerRow) => String(a.name).localeCompare(String(b.name), 'pl')

export interface CrewLabel {
  /** Pierwsze słowo — tak hala woła ludzi. */
  first: string
  /** Reszta nazwiska — podpis kafla, odróżnia dwóch „ANARÓW". */
  rest: string
  /** Na przycisk zapisu: imię, a przy powtórce imię + inicjał nazwiska. */
  short: string
}

/**
 * Podpisy kafli i przycisku zapisu. Dwie osoby o tym samym imieniu dostają
 * na przycisku inicjał nazwiska („ANAR K." / „ANAR M."), bo „Dodaj 3 szt. ·
 * ANAR" przy dwóch Anarach to zaproszenie do pomyłki w wypłacie. Gdy i inicjał
 * się powtarza (ANAR KAZIMOV / ANAR KERIMOV), idzie pełne nazwisko.
 */
export function crewLabels(workers: readonly { id: string; name: string }[]): Map<string, CrewLabel> {
  const czesci = workers.map(w => {
    const slowa = String(w.name ?? '').trim().split(/\s+/).filter(Boolean)
    return { id: w.id, first: slowa[0] ?? '—', rest: slowa.slice(1).join(' ') }
  })
  const klucz = (s: string) => s.toLocaleLowerCase('pl')
  const policz = (klucze: string[]) => {
    const m = new Map<string, number>()
    for (const k of klucze) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }
  const imion = policz(czesci.map(c => klucz(c.first)))
  const inicjalow = policz(czesci.map(c => `${klucz(c.first)} ${klucz(c.rest.slice(0, 1))}`))
  return new Map(czesci.map(c => {
    const dubel = (imion.get(klucz(c.first)) ?? 0) > 1
    const dubelInicjalu = (inicjalow.get(`${klucz(c.first)} ${klucz(c.rest.slice(0, 1))}`) ?? 0) > 1
    const short = !dubel || !c.rest ? c.first
      : dubelInicjalu ? `${c.first} ${c.rest}`
      : `${c.first} ${c.rest[0]}.`
    return [c.id, { first: c.first, rest: c.rest, short }]
  }))
}

/** Ludzie z linii produkcyjnej — im przypisuje się sztuki. */
export function productionCrew(lista: WorkerRow[] | null | undefined): WorkerRow[] {
  return (Array.isArray(lista) ? lista : [])
    .filter(w => czynny(w) && w.role === 'WORKER_PRODUCTION')
    .sort(poNazwisku)
}

/**
 * Foliowczycy — im wpisuje się zafoliowane kilogramy.
 *
 * Gdy biuro nikogo jeszcze nie zaznaczyło, pokazujemy całą produkcję zamiast
 * pustego okna: pusta lista wygląda jak awaria i kończy się zapisem na kartce.
 */
export function wrappingCrew(lista: WorkerRow[] | null | undefined): WorkerRow[] {
  const wszyscy = (Array.isArray(lista) ? lista : []).filter(czynny)
  const zaznaczeni = wszyscy.filter(foliowczyk)
  return (zaznaczeni.length ? zaznaczeni : wszyscy.filter(w => w.role === 'WORKER_PRODUCTION'))
    .sort(poNazwisku)
}
