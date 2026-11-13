/**
 * Wydruki rozliczeń — typy odpowiedzi `/api/rozliczenia` (zestawienie,
 * historia) i formaty kwot/dat wspólne dla WZ, kartek do druku i PROTRIMA.
 *
 * Liczby przychodzą policzone z backendu (`rozliczenia_service`), więc
 * wydruk i panel pokazują dokładnie to samo — tu tylko formatujemy.
 */

export interface KlientWydruku {
  nazwa: string; nip: string; adres: string
  /** Drugi język dokumentu (kartoteka klienta albo prefiks NIP); brak = z NIP. */
  jezyk?: string | null
}

/** Pozycja niezapłacona w zestawieniu na dzień. */
export interface PozycjaZestawienia {
  numer: string
  data: string
  termin: string
  kwota: number
  zaplacono: number
  pozostalo: number
  dni_po_terminie: number
  /** Pozycja powstała z drukowanej właśnie WZ. */
  ten_dokument: boolean
}

export interface KsiegaZestawienia { pozycje: PozycjaZestawienia[]; razem: number }

/** Rachunek do wpłat w walucie kontrahenta (ustawienia Rozrachunków); brak = nie podano. */
export interface KontoWydruku { numer: string; bank: string; swift: string; waluta: string }

export interface Zestawienie {
  klient: KlientWydruku
  waluta: string
  na_dzien: string
  policzono: string
  wz: KsiegaZestawienia
  fv: KsiegaZestawienia
  razem: number
  po_terminie: number
  nadplata_wz: number
  nadplata_fv: number
  konto?: KontoWydruku | null
}

/** Wiersz wyciągu. Saldo otwarcia przychodzi jako `dokument` z opisem
 *  „Saldo otwarcia” — kwota stoi w `obciazenie` (dług) albo `wplata` (nadpłata). */
export interface WierszHistorii {
  data: string
  rodzaj: 'dokument' | 'wplata' | 'korekta'
  opis: string
  obciazenie: number
  wplata: number
  saldo: number
  /** Dni po terminie na koniec okresu (dokument z niezapłaconą resztą); 0 dla wpłat. */
  dni_po_terminie: number
}

export interface KsiegaHistorii { saldo_poczatek: number; wiersze: WierszHistorii[]; saldo_koniec: number }

export interface HistoriaOkresu {
  klient: KlientWydruku
  waluta: string
  od: string
  do: string
  wz: KsiegaHistorii
  fv: KsiegaHistorii
  saldo_poczatek: number
  saldo_koniec: number
  konto?: KontoWydruku | null
}

const SYMBOL: Record<string, string> = { PLN: 'zł', EUR: '€' }

// `useGrouping: 'always'` — pl-PL domyślnie nie grupuje czterocyfrowych
// („1234,50”), a na wydruku kwoty w kolumnie mają wyglądać jednakowo.
const FORMAT = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions)

/** `1 234,56 €` / `−38 447,70 zł` — zwykła spacja tysięcy, minus U+2212. */
export function kwota(n: number, waluta: string): string {
  const grosze = Math.round(Math.abs(Number(n) || 0) * 100)
  const liczba = FORMAT.format(grosze / 100).replace(/[  ]/g, ' ')
  const znak = grosze > 0 && n < 0 ? '−' : ''
  const kod = (waluta || 'PLN').toUpperCase()
  return `${znak}${liczba} ${SYMBOL[kod] ?? kod}`
}

/** `2026-11-09` → `09.11.2026`; pusta → ''. */
export function dataPl(iso: string | null | undefined): string {
  if (!iso) return ''
  const [r, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && r ? `${d}.${m}.${r}` : String(iso)
}

const CZAS_PL = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Chwila wydruku do stopki kartki: `12.11.2026, 13:05` — zawsze czas
 *  polski. PDF renderuje headless Chrome na serwerze w UTC, więc lokalne
 *  getHours() przeglądarki dawałoby godzinę (a koło północy dzień) wstecz. */
export function chwilaWydruku(d: Date = new Date()): string {
  const c = Object.fromEntries(CZAS_PL.formatToParts(d).map(p => [p.type, p.value]))
  return `${c.day}.${c.month}.${c.year}, ${c.hour}:${c.minute}`
}
