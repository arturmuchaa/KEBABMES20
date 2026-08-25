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
