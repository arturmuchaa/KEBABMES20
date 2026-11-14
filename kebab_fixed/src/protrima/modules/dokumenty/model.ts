/**
 * Moduł „Dokumenty” — czyste funkcje: wiersz z API → `Dok`, filtr, sort, dostępność działań.
 * Dokumentów jest kilkaset (prod 14.11.2026: 447 WZ, 188 HDI, 187 CMR), więc wszystko
 * liczymy na kliencie — filtr i sort odpowiadają od razu.
 */
export type Rodzaj = 'wz' | 'cmr' | 'hdi'
type Wiersz = Record<string, unknown>

export interface Dok {
  rodzaj: Rodzaj
  id: string
  numer: string
  /** ISO `YYYY-MM-DD` albo '' (stare dokumenty bez daty). */
  data: string
  klient: string
  orderId?: string
  orderNo?: string
  stan: 'aktywny' | 'anulowany'
  etykietaStanu: string
  seria?: 'WZ' | 'WM'
  wartosc?: number | null
  waluta?: string
  rodzajHdi?: string
  przewoznik?: string
  zrodlo: Wiersz
}

const s = (v: unknown) => (v == null ? '' : String(v))
const iso = (v: unknown) => { const t = s(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '' }
const anulowany = (r: Wiersz) => s(r.status).toLowerCase().startsWith('anul')
const RODZAJ: Record<string, string> = { calosc: 'całość', fv: 'do faktury', usluga: 'usługa' }

export function zWz(r: Wiersz): Dok {
  const an = anulowany(r)
  const etykieta = an ? 'anulowany' : r.loading_status === 'rozjazd' ? 'rozjazd' : r.loaded_at ? 'załadowany' : 'wystawiony'
  return {
    rodzaj: 'wz', id: s(r.id), numer: s(r.number), data: iso(r.release_date) || iso(r.issued_date), klient: s(r.buyer_name),
    orderId: r.order_id ? s(r.order_id) : undefined, orderNo: r.order_no ? s(r.order_no) : undefined,
    stan: an ? 'anulowany' : 'aktywny', etykietaStanu: etykieta, seria: s(r.doc_series) === 'WM' ? 'WM' : 'WZ',
    wartosc: r.valued ? Number(r.total_value ?? 0) : null, waluta: s(r.currency) || 'PLN', zrodlo: r,
  }
}
export function zCmr(r: Wiersz): Dok {
  const an = anulowany(r)
  return {
    rodzaj: 'cmr', id: s(r.id), numer: s(r.number), data: iso(r.issue_date) || iso(r.created_at), klient: s(r.client_name),
    orderId: r.order_id ? s(r.order_id) : undefined, orderNo: r.order_no ? s(r.order_no) : undefined,
    stan: an ? 'anulowany' : 'aktywny', etykietaStanu: an ? 'anulowany' : 'wystawiony',
    przewoznik: r.carrier_name ? s(r.carrier_name) : undefined, rodzajHdi: r.scope ? RODZAJ[s(r.scope)] ?? s(r.scope) : undefined, zrodlo: r,
  }
}
export function zHdi(r: Wiersz): Dok {
  const an = anulowany(r)
  return {
    rodzaj: 'hdi', id: s(r.id), numer: s(r.number), data: iso(r.issue_date) || iso(r.created_at), klient: s(r.client_name),
    orderId: r.order_id ? s(r.order_id) : undefined, orderNo: r.order_no ? s(r.order_no) : undefined,
    stan: an ? 'anulowany' : 'aktywny', etykietaStanu: an ? 'anulowany' : r.incomplete ? 'niekompletny' : 'wystawiony',
    rodzajHdi: RODZAJ[s(r.scope) || 'calosc'] ?? s(r.scope), zrodlo: r,
  }
}

export type Okres = 'dzis' | '7dni' | 'miesiac' | 'poprzedni' | 'wszystko' | 'zakres'
export interface Filtr {
  szukaj: string
  okres: Okres
  od?: string
  do?: string
  klient: string
  stan: 'aktywne' | 'anulowane' | 'wszystkie'
  seria: 'wszystkie' | 'WZ' | 'WM'
}
export const FILTR_DOMYSLNY: Filtr = { szukaj: '', okres: 'miesiac', klient: '', stan: 'aktywne', seria: 'wszystkie' }

export const normKlient = (k: string) => k.toLowerCase().replace(/\s+/g, ' ').trim()
const dodajDni = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

/** Zakres dat [od, do] dla okresu; null = bez ograniczenia. */
export function zakresOkresu(f: Filtr, dzis: string): [string, string] | null {
  const m = dzis.slice(0, 7)
  switch (f.okres) {
    case 'dzis': return [dzis, dzis]
    case '7dni': return [dodajDni(dzis, -6), dzis]
    case 'miesiac': return [`${m}-01`, `${m}-31`]
    case 'poprzedni': { const p = dodajDni(`${m}-01`, -1).slice(0, 7); return [`${p}-01`, `${p}-31`] }
    case 'zakres': return [f.od || '0000-01-01', f.do || '9999-12-31']
    default: return null
  }
}

export function filtruj(dok: Dok[], f: Filtr, dzis: string): Dok[] {
  const zakres = zakresOkresu(f, dzis)
  const q = f.szukaj.trim().toLowerCase()
  const kl = normKlient(f.klient)
  return dok.filter(d => {
    if (f.stan === 'aktywne' && d.stan !== 'aktywny') return false
    if (f.stan === 'anulowane' && d.stan !== 'anulowany') return false
    if (zakres && (!d.data || d.data < zakres[0] || d.data > zakres[1])) return false
    if (d.rodzaj === 'wz' && f.seria !== 'wszystkie' && d.seria !== f.seria) return false
    if (kl && normKlient(d.klient) !== kl) return false
    if (q && !`${d.numer} ${d.klient} ${d.orderNo ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

export type Kolumna = 'numer' | 'data' | 'klient' | 'zamowienie' | 'wartosc' | 'stan'
/** Klucz numeru „WZ/7/11/26” → rok, miesiąc, kolejny (porządek wystawiania). */
const kluczNumeru = (n: string) => {
  const m = n.match(/(\d+)\/(\d{1,2})\/(\d{2,4})\s*$/)
  if (!m) return [0, 0, 0, n] as const
  const rok = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
  return [rok, Number(m[2]), Number(m[1]), n] as const
}
export function sortuj(dok: Dok[], kol: Kolumna, kier: 'asc' | 'desc'): Dok[] {
  const z = kier === 'asc' ? 1 : -1
  const cmp = (a: Dok, b: Dok): number => {
    switch (kol) {
      case 'numer': { const x = kluczNumeru(a.numer), y = kluczNumeru(b.numer); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return ((x[i] as number) - (y[i] as number)) * z; return a.numer.localeCompare(b.numer, 'pl') * z }
      case 'data': if (!a.data || !b.data) return a.data ? -1 : b.data ? 1 : 0; return a.data.localeCompare(b.data) * z || cmpNum(a, b)
      case 'klient': return a.klient.localeCompare(b.klient, 'pl') * z
      case 'zamowienie': return (a.orderNo ?? '').localeCompare(b.orderNo ?? '', 'pl', { numeric: true }) * z
      case 'wartosc': return ((a.wartosc ?? -1) - (b.wartosc ?? -1)) * z
      case 'stan': return a.etykietaStanu.localeCompare(b.etykietaStanu, 'pl') * z
    }
  }
  const cmpNum = (a: Dok, b: Dok) => { const x = kluczNumeru(a.numer), y = kluczNumeru(b.numer); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]) }
  return [...dok].sort(cmp)
}

export type Dzialanie = 'ceny' | 'dopisz' | 'anuluj' | 'rozjazd' | 'edytujCmr' | 'anulujHdi'
export type Dostepnosc = { ok: boolean; powod?: string }
const nie = (powod: string): Dostepnosc => ({ ok: false, powod })
const tak: Dostepnosc = { ok: true }

/** Co wolno zrobić z dokumentem — te same reguły, których pilnuje serwer, żeby
 *  przycisk był wyłączony z podpowiedzią zamiast kończyć się błędem po kliknięciu. */
export function dzialania(d: Dok): Record<Dzialanie, Dostepnosc> {
  const brak = nie('nie dotyczy tego dokumentu')
  const r = d.zrodlo
  const an = d.stan === 'anulowany'
  const w: Record<Dzialanie, Dostepnosc> = { ceny: brak, dopisz: brak, anuluj: brak, rozjazd: brak, edytujCmr: brak, anulujHdi: brak }
  if (d.rodzaj === 'wz') {
    w.ceny = an ? nie('dokument jest anulowany') : tak
    w.dopisz = an ? nie('dokument jest anulowany') : tak
    w.anuluj = an ? nie('dokument jest już anulowany')
      : r.split_scope ? nie('dokument podziału wysyłki — anuluj komplet z zamówienia (zakładka Dokumenty)')
      : r.source_type === 'order' && (r.loaded_at || r.loading_status) ? nie('po załadunku towar jest na aucie — anulowanie oddałoby na stan coś, czego nie ma')
      : (r.source_type === 'order' || r.source_type === 'manual') ? tak
      : nie('ten rodzaj WZ anuluje się w miejscu, z którego powstał')
    w.rozjazd = r.loading_status === 'rozjazd' && r.source_id ? tak : nie('dokument zgadza się z załadunkiem')
  } else if (d.rodzaj === 'cmr') {
    w.edytujCmr = an ? nie('dokument jest anulowany') : tak
  } else {
    w.anulujHdi = an ? nie('dokument jest już anulowany') : tak
  }
  return w
}
