/**
 * Rozrachunki — czysta logika (bez Reacta): mapery odpowiedzi `/api/rozliczenia`,
 * stany w słowach, sortowanie, filtry i parsowanie kwot wpisanych po polsku.
 *
 * Salda liczy serwer (`rozliczenia_service`) — tu tylko pokazujemy. Znak jak
 * w Excelu biura: minus = klient winien, plus = nadpłata. Księgi WZ i FV
 * zawsze osobno.
 */
import { kwota } from '@/features/rozliczenia/druk'

export type Ksiega = 'wz' | 'fv'
export type Forma = 'gotowka' | 'przelew'
export type StanKontrahenta = 'po_terminie' | 'w_terminie' | 'nadplata' | 'rozliczony'

export interface Kontrahent {
  id: string
  nazwa: string
  nip: string
  waluta: string
  saldoWz: number
  saldoFv: number
  saldo: number
  /** Kwota po terminie (dodatnia). */
  poTerminie: number
  najstarszaDni: number
  /** Dni do najbliższego terminu wśród niezapłaconych w terminie; null, gdy brak. */
  najblizszyTerminDni: number | null
  stan: StanKontrahenta
  /** Wpis w dzienniku z przypomnieniem na dziś lub wcześniej, nieodhaczony. */
  przypomnienie: boolean
}

export interface SumaWaluty { naleznosci: number; poTerminie: number; gotowkaWz: number; nadplaty: number }

export interface WzBezKontrahenta { id: string; numer: string; data: string; kwota: number; waluta: string; nabywca: string }

export interface ListaRozliczen {
  start: string
  podsumowanie: Record<string, SumaWaluty>
  kontrahenci: Kontrahent[]
  bezKontrahenta: WzBezKontrahenta[]
  /** Liczba dokumentów, wpłat i otwarć w innej walucie niż kontrahent (poza saldami). */
  innaWaluta: number
}

/** Stan dokumentu z serwera (`stan_dokumentu`, dla dokumentów poza księgą — `usuniety`, `czeka_na_ceny`, …). */
export interface Stan { kod: string; dni: number; czesciowo: boolean }

export interface Dok {
  id: string
  numer: string
  data: string
  kwota: number
  zaplacono: number
  zostalo: number
  termin: string | null
  forma: string
  uwagi: string
  zrodlo: string
  otwarcie: boolean
  stan: Stan
  zamkniety: string | null
  brakVat: boolean
}

export interface Wplata {
  id: string
  ksiega: Ksiega
  forma: string
  kwota: number
  data: string
  uwagi: string
  utworzyl: string
  dokumentId: string | null
  przydzialy: Array<{ numer: string; kwota: number }>
  /** Część wpłaty, która nie pokryła żadnego dokumentu (nadpłata). */
  reszta: number
}

export interface Otwarcie { kwota: number; zalegleOd: string | null; uwagi: string }

export interface WpisDziennika { id: string; tresc: string; przypomnij: string | null; odhaczono: string | null; kto: string; kiedy: string }

export interface Karta {
  klient: {
    id: string; nazwa: string; nip: string; waluta: string
    terminWz: number; terminFv: number; formaWz: string; formaFv: string
    notatka: string
    /** Waluta, na którą wskazuje NIP, gdy różna od ustawionej. */
    walutaPodpowiedz: string | null
  }
  start: string
  saldo: {
    wz: number; fv: number; lacznie: number
    poTerminieWz: number; poTerminieFv: number
    najstarszaDniWz: number; najstarszaDniFv: number
  }
  otwarcia: Record<Ksiega, Otwarcie | null>
  dokumenty: Record<Ksiega, Dok[]>
  wplaty: Wplata[]
  czekaNaCeny: Array<{ id: string; numer: string; data: string }>
  innaWaluta: Array<{ id: string; numer: string; data: string; kwota: number; waluta: string; rodzaj: string }>
  dziennik: WpisDziennika[]
}

// ─── Mapery ────────────────────────────────────────────────────────────

type Surowy = Record<string, unknown>
const obj = (v: unknown): Surowy => (v && typeof v === 'object' && !Array.isArray(v) ? v as Surowy : {})
const tab = (v: unknown): Surowy[] => (Array.isArray(v) ? v.map(obj) : [])
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const s = (v: unknown) => (v == null ? '' : String(v))
const sNull = (v: unknown) => (v == null || v === '' ? null : String(v))

function mapujSume(r: Surowy): SumaWaluty {
  return { naleznosci: n(r.naleznosci), poTerminie: n(r.po_terminie), gotowkaWz: n(r.gotowka_wz), nadplaty: n(r.nadplaty) }
}

function mapujKontrahenta(r: Surowy): Kontrahent {
  return {
    id: s(r.id), nazwa: s(r.nazwa), nip: s(r.nip), waluta: s(r.waluta),
    saldoWz: n(r.saldo_wz), saldoFv: n(r.saldo_fv), saldo: n(r.saldo),
    poTerminie: n(r.po_terminie), najstarszaDni: n(r.najstarsza_dni),
    najblizszyTerminDni: r.najblizszy_termin_dni == null ? null : n(r.najblizszy_termin_dni),
    stan: (s(r.stan) || 'rozliczony') as StanKontrahenta,
    przypomnienie: !!r.przypomnienie,
  }
}

export function mapujListe(raw: unknown): ListaRozliczen {
  const r = obj(raw)
  return {
    start: s(r.start),
    podsumowanie: Object.fromEntries(Object.entries(obj(r.podsumowanie)).map(([w, v]) => [w, mapujSume(obj(v))])),
    kontrahenci: tab(r.kontrahenci).map(mapujKontrahenta),
    bezKontrahenta: tab(r.bez_kontrahenta).map(d => ({
      id: s(d.id), numer: s(d.numer), data: s(d.data), kwota: n(d.kwota), waluta: s(d.waluta), nabywca: s(d.nabywca),
    })),
    innaWaluta: n(r.inna_waluta),
  }
}

const mapujStan = (r: Surowy): Stan => ({ kod: s(r.kod), dni: n(r.dni), czesciowo: !!r.czesciowo })

function mapujDok(r: Surowy): Dok {
  return {
    id: s(r.id), numer: s(r.numer), data: s(r.data),
    kwota: n(r.kwota), zaplacono: n(r.zaplacono), zostalo: n(r.zostalo),
    termin: sNull(r.termin), forma: s(r.forma), uwagi: s(r.uwagi), zrodlo: s(r.zrodlo),
    otwarcie: !!r.otwarcie, stan: mapujStan(obj(r.stan)), zamkniety: sNull(r.zamkniety), brakVat: !!r.brak_vat,
  }
}

function mapujOtwarcie(v: unknown): Otwarcie | null {
  if (!v || typeof v !== 'object') return null
  const r = obj(v)
  return { kwota: n(r.kwota), zalegleOd: sNull(r.zalegle_od), uwagi: s(r.uwagi) }
}

export function mapujKarte(raw: unknown): Karta {
  const r = obj(raw), k = obj(r.klient), sa = obj(r.saldo), ot = obj(r.otwarcia), dk = obj(r.dokumenty)
  return {
    klient: {
      id: s(k.id), nazwa: s(k.nazwa), nip: s(k.nip), waluta: s(k.waluta),
      terminWz: n(k.termin_wz), terminFv: n(k.termin_fv), formaWz: s(k.forma_wz), formaFv: s(k.forma_fv),
      notatka: s(k.notatka), walutaPodpowiedz: sNull(k.waluta_podpowiedz),
    },
    start: s(r.start),
    saldo: {
      wz: n(sa.wz), fv: n(sa.fv), lacznie: n(sa.lacznie),
      poTerminieWz: n(sa.po_terminie_wz), poTerminieFv: n(sa.po_terminie_fv),
      najstarszaDniWz: n(sa.najstarsza_dni_wz), najstarszaDniFv: n(sa.najstarsza_dni_fv),
    },
    otwarcia: { wz: mapujOtwarcie(ot.wz), fv: mapujOtwarcie(ot.fv) },
    dokumenty: { wz: tab(dk.wz).map(mapujDok), fv: tab(dk.fv).map(mapujDok) },
    wplaty: tab(r.wplaty).map(w => ({
      id: s(w.id), ksiega: (s(w.ksiega) || 'fv') as Ksiega, forma: s(w.forma), kwota: n(w.kwota), data: s(w.data),
      uwagi: s(w.uwagi), utworzyl: s(w.utworzyl), dokumentId: sNull(w.dokument_id),
      przydzialy: tab(w.przydzialy).map(p => ({ numer: s(p.numer), kwota: n(p.kwota) })),
      reszta: n(w.reszta),
    })),
    czekaNaCeny: tab(r.czeka_na_ceny).map(c => ({ id: s(c.id), numer: s(c.numer), data: s(c.data) })),
    innaWaluta: tab(r.inna_waluta).map(i => ({
      id: s(i.id), numer: s(i.numer), data: s(i.data), kwota: n(i.kwota), waluta: s(i.waluta), rodzaj: s(i.rodzaj),
    })),
    dziennik: tab(r.dziennik).map(d => ({
      id: s(d.id), tresc: s(d.tresc), przypomnij: sNull(d.przypomnij), odhaczono: sNull(d.odhaczono), kto: s(d.kto), kiedy: s(d.kiedy),
    })),
  }
}

/** Szczegóły dokumentu (`GET /api/rozliczenia/dokumenty/:id`): stan, wpłaty, które go pokryły, historia zmian. */
export interface SzczegolyDokumentu extends Dok {
  pokrycie: Array<{ data: string; forma: string; kwota: number; uwagi: string }>
  historia: Array<{ akcja: string; opis: string; powod: string; kto: string; kiedy: string }>
}

export function mapujSzczegoly(raw: unknown): SzczegolyDokumentu {
  const r = obj(raw)
  return {
    ...mapujDok(r),
    pokrycie: tab(r.pokrycie).map(p => ({ data: s(p.data), forma: s(p.forma), kwota: n(p.kwota), uwagi: s(p.uwagi) })),
    historia: tab(r.historia).map(h => ({ akcja: s(h.akcja), opis: s(h.opis), powod: s(h.powod), kto: s(h.kto), kiedy: s(h.kiedy) })),
  }
}

// ─── Stany w słowach ───────────────────────────────────────────────────

export type Ton = 'late' | 'soon' | 'ok' | 'zero'

/** Klasa znacznika powłoki (`.tag`) dla tonu: po terminie — czerwień, termin blisko — ostrzeżenie. */
export const KLASA_TONU: Record<Ton, string> = { late: 'crit', soon: 'warn', ok: 'ok', zero: 'neutral' }

/** Liczba dni słowem: `1 dzień`, `7 dni`. */
export const dni = (x: number) => (x === 1 ? '1 dzień' : `${x} dni`)
/** Tyle dni do terminu i mniej — termin „blisko” (ostrzeżenie zamiast spokojnego „w terminie”). */
const BLISKO = 3

export function pigulka(k: Kontrahent): { tekst: string; ton: Ton } {
  switch (k.stan) {
    case 'po_terminie': return { tekst: `${dni(k.najstarszaDni)} po terminie`, ton: 'late' }
    case 'w_terminie': {
      const d = k.najblizszyTerminDni
      if (d === 0) return { tekst: 'termin dziś', ton: 'soon' }
      if (d === 1) return { tekst: 'termin jutro', ton: 'soon' }
      if (d != null && d <= BLISKO) return { tekst: `termin za ${d} dni`, ton: 'soon' }
      return { tekst: 'w terminie', ton: 'ok' }
    }
    case 'nadplata': return { tekst: 'nadpłata', ton: 'ok' }
    default: return { tekst: 'rozliczony', ton: 'zero' }
  }
}

/** Dokumenty poza rozliczeniem (szczegóły dokumentu z serwera). */
const POZA_KSIEGA: Record<string, { tekst: string; ton: Ton }> = {
  czeka_na_ceny: { tekst: 'czeka na ceny', ton: 'soon' },
  inna_waluta: { tekst: 'inna waluta', ton: 'soon' },
  bez_kontrahenta: { tekst: 'bez kontrahenta', ton: 'soon' },
  usuniety: { tekst: 'usunięty', ton: 'zero' },
  anulowany: { tekst: 'anulowany', ton: 'zero' },
  korekta: { tekst: 'korekta', ton: 'zero' },
}

export function etykietaStanu(st: Stan): { tekst: string; ton: Ton } {
  let w: { tekst: string; ton: Ton }
  switch (st.kod) {
    case 'zaplacony':
      w = { tekst: st.dni <= 0 ? 'zapłacona od razu' : `zapłacona po ${st.dni} ${st.dni === 1 ? 'dniu' : 'dniach'}`, ton: 'zero' }
      break
    case 'po_terminie': w = { tekst: `${dni(st.dni)} po terminie`, ton: 'late' }; break
    case 'termin_dzis': w = { tekst: 'termin dziś', ton: 'soon' }; break
    case 'termin_jutro': w = { tekst: 'termin jutro', ton: 'soon' }; break
    case 'w_terminie': w = { tekst: `za ${dni(st.dni)}`, ton: st.dni <= BLISKO ? 'soon' : 'ok' }; break
    default: w = POZA_KSIEGA[st.kod] ?? { tekst: st.kod.replace(/_/g, ' '), ton: 'zero' }
  }
  return st.czesciowo ? { ...w, tekst: `${w.tekst} · częściowo` } : w
}

// ─── Kwoty ─────────────────────────────────────────────────────────────

const grosze = (x: number) => Math.round((Number(x) || 0) * 100)

/** Znak salda w groszach: −1 dług, 0 rozliczone, 1 nadpłata (bez szumu ułamków). */
export const znakSalda = (x: number) => Math.sign(grosze(x))

/** Saldo z walutą: `−38 447,70 €` (minus typograficzny), `+350,00 zł` (nadpłata), `0,00 zł`. */
export function kwotaSalda(x: number, waluta: string): string {
  return `${znakSalda(x) > 0 ? '+' : ''}${kwota(x, waluta)}`
}

/**
 * Kwota wpisana przez biuro: `15 000,50`, `15000.5`, `15 000,50` (spacja twarda),
 * `15.000,50`, `−500`, `1 234,56 €`. Nie liczba → NaN (formularz pokaże błąd).
 */
export function liczba(tekst: string): number {
  let t = String(tekst ?? '').replace(/\s/g, '').replace(/(zł|pln|eur|€)$/i, '').replace(/^[−–]/, '-')
  // Oba separatory: ostatni jest dziesiętny, pierwszy — tysiące (`15.000,50`, `15,000.50`).
  if (t.includes(',') && t.includes('.')) {
    const dzies = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.'
    t = t.split(dzies === ',' ? '.' : ',').join('')
  }
  t = t.replace(',', '.')
  return /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : NaN
}

// ─── Lista: sortowanie, filtry, sumy ───────────────────────────────────

export type Kolumna = 'nazwa' | 'waluta' | 'saldoWz' | 'saldoFv' | 'saldo' | 'poTerminie' | 'najstarszaDni'
export type Kierunek = 'asc' | 'desc'
export type Filtr = 'wszyscy' | 'poTerminie' | 'nadplaty' | 'przypomnienia' | 'PLN' | 'EUR'

export const KOLUMNY: Kolumna[] = ['nazwa', 'waluta', 'saldoWz', 'saldoFv', 'saldo', 'poTerminie', 'najstarszaDni']
export const FILTRY: Filtr[] = ['wszyscy', 'poTerminie', 'nadplaty', 'przypomnienia', 'PLN', 'EUR']

/** Kierunek pierwszego kliknięcia: kwoty po terminie i dni — najwięcej na górze, salda — największy dłużnik (najbardziej ujemne). */
export const PIERWSZY_KIERUNEK: Record<Kolumna, Kierunek> = {
  nazwa: 'asc', waluta: 'asc', saldoWz: 'asc', saldoFv: 'asc', saldo: 'asc', poTerminie: 'desc', najstarszaDni: 'desc',
}

const porownajNazwy = (a: Kontrahent, b: Kontrahent) => a.nazwa.localeCompare(b.nazwa, 'pl')

export function sortuj(lista: Kontrahent[], kol: Kolumna, kier: Kierunek): Kontrahent[] {
  const m = kier === 'asc' ? 1 : -1
  return [...lista].sort((a, b) => {
    const r = kol === 'nazwa' ? porownajNazwy(a, b)
      : kol === 'waluta' ? a.waluta.localeCompare(b.waluta)
        : (a[kol] as number) - (b[kol] as number)
    return r * m || porownajNazwy(a, b)
  })
}

const bezZnakow = (t: string) => t.toLowerCase().replace(/[\s\-.]/g, '')

export function filtruj(lista: Kontrahent[], f: Filtr, szukaj: string): Kontrahent[] {
  const q = szukaj.trim().toLowerCase(), qNip = bezZnakow(q)
  return lista.filter(k => {
    if (f === 'poTerminie' && k.stan !== 'po_terminie') return false
    if (f === 'nadplaty' && znakSalda(k.saldoWz) <= 0 && znakSalda(k.saldoFv) <= 0) return false
    if (f === 'przypomnienia' && !k.przypomnienie) return false
    if ((f === 'PLN' || f === 'EUR') && k.waluta !== f) return false
    if (!q) return true
    return k.nazwa.toLowerCase().includes(q) || (!!qNip && bezZnakow(k.nip).includes(qNip))
  })
}

/** Waluty do kafelków sum — waluta z samymi zerami nie dostaje kafelka. */
export function walutyPodsumowania(l: ListaRozliczen): string[] {
  return Object.entries(l.podsumowanie)
    .filter(([, v]) => [v.naleznosci, v.poTerminie, v.gotowkaWz, v.nadplaty].some(x => grosze(x) !== 0))
    .map(([w]) => w)
}

/** Kontrahent dla WZ bez kontrahenta: nabywca z WZ równy nazwie albo nazwie skróconej klienta. */
export function podpowiedzKlienta(nabywca: string, klienci: Array<{ id: string; name: string; displayName?: string }>): string {
  const q = nabywca.trim().toUpperCase()
  if (!q) return ''
  return klienci.find(c => c.name.trim().toUpperCase() === q || (c.displayName ?? '').trim().toUpperCase() === q)?.id ?? ''
}

// ─── Karta klienta: okres, wpłaty, dziennik ────────────────────────────

/** Dzisiejsza data lokalna jako `RRRR-MM-DD` (nie UTC — o północy biuro ma już nowy dzień). */
export function dzisIso(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type Okres = 'wszystko' | 'miesiac' | 'kwartal' | 'rok' | 'zakres'
export const OKRESY: Okres[] = ['wszystko', 'miesiac', 'kwartal', 'rok', 'zakres']
export type Zakres = { od: string; do: string } | null

const iso = (r: number, m: number, d: number) => `${r}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const ostatniDzien = (r: number, m: number) => new Date(Date.UTC(r, m, 0)).getUTCDate()

/** Zakres dat okresu (granice włącznie); `null` — bez filtra. „Od–do” z pustym końcem — bez końca. */
export function zakresOkresu(okres: Okres, dzis: string, od = '', do_ = ''): Zakres {
  const [r, m] = dzis.split('-').map(Number)
  switch (okres) {
    case 'miesiac': return { od: iso(r, m, 1), do: iso(r, m, ostatniDzien(r, m)) }
    case 'kwartal': {
      const p = Math.floor((m - 1) / 3) * 3 + 1
      return { od: iso(r, p, 1), do: iso(r, p + 2, ostatniDzien(r, p + 2)) }
    }
    case 'rok': return { od: iso(r, 1, 1), do: iso(r, 12, 31) }
    case 'zakres': return od || do_ ? { od, do: do_ } : null
    default: return null
  }
}

export const wOkresie = (data: string, z: Zakres) => !z || ((!z.od || data >= z.od) && (!z.do || data <= z.do))

/** Symbol waluty do nagłówka kolumny: `€`, `zł`, inna — kod. */
export const symbolWaluty = (w: string) => kwota(0, w).split(' ').pop() ?? w

/** Kwota bez symbolu waluty (`7 280,00`) — do opisów w wierszu, gdzie waluta jest w kolumnie obok. */
export const kwotaBezWaluty = (x: number) => kwota(x, 'PLN').replace(/ zł$/, '')

/** Na co poszła wpłata: `FV 528/2026 7 280,00; FV 541/2026 7 720,00`, reszta — `nadpłata 250,00`. */
export function rozliczyla(w: Wplata): string {
  const czesci = w.przydzialy.map(p => `${p.numer} ${kwotaBezWaluty(p.kwota)}`)
  if (znakSalda(w.reszta) > 0) czesci.push(`nadpłata ${kwotaBezWaluty(w.reszta)}`)
  return czesci.join('; ')
}

export const FORMA_SLOWEM: Record<string, string> = { gotowka: 'gotówka', przelew: 'przelew' }

/** Formy płatności do przełącznika w oknach. */
export const FORMY = [['gotowka', 'Gotówka'], ['przelew', 'Przelew']] as const

/** Forma z ustawień klienta, a gdy pusta lub nieznana — domyślna księgi (WZ gotówka, faktury przelew). */
export const formaDomyslna = (f: string, ks: Ksiega): Forma => (f === 'gotowka' || f === 'przelew' ? f : ks === 'wz' ? 'gotowka' : 'przelew')

/** Zaokrąglenie do groszy/centów jak `ROUND_HALF_UP` na serwerze (1,005 → 1,01; −1,005 → −1,01). */
export function doGroszy(x: number): number {
  const r = Math.sign(x) * Math.round(Number(Math.abs(x * 100).toPrecision(12))) / 100
  return r || 0
}

/** Domyślna płatność słowem: `gotówka przy odbiorze`, `przelew, 7 dni`. */
export function opisPlatnosci(forma: string, termin: number): string {
  const f = FORMA_SLOWEM[forma] ?? forma
  if (termin > 0) return `${f}, ${dni(termin)}`
  return forma === 'gotowka' ? `${f} przy odbiorze` : `${f} od razu`
}

export type WpisZPrzypomnieniem = WpisDziennika & { zalegle: boolean }

/** Dziennik: nieodhaczone przypomnienia na górze (najwcześniejsze pierwsze), dalej reszta w kolejności serwera. */
export function uporzadkujDziennik(wpisy: WpisDziennika[], dzis: string): WpisZPrzypomnieniem[] {
  const czeka = (w: WpisDziennika) => !!w.przypomnij && !w.odhaczono
  const gora = wpisy.filter(czeka).sort((a, b) => a.przypomnij!.localeCompare(b.przypomnij!))
  return [...gora, ...wpisy.filter(w => !czeka(w))].map(w => ({ ...w, zalegle: czeka(w) && w.przypomnij! <= dzis }))
}

// ─── Okna karty: podgląd wpłaty, daty ──────────────────────────────────

/** Jeden dokument, który pokryje wpłata (`_podglad` w rozliczenia_service). */
export interface Przydzial { dokumentId: string; numer: string; kwota: number; zostaloPrzed: number; zostaloPo: number; zamyka: boolean }
export interface PodgladWplaty { przydzialy: Przydzial[]; nadwyzka: number }

export function mapujPodglad(raw: unknown): PodgladWplaty {
  const r = obj(raw)
  return {
    przydzialy: tab(r.przydzialy).map(p => ({
      dokumentId: s(p.dokument_id), numer: s(p.numer), kwota: n(p.kwota),
      zostaloPrzed: n(p.zostalo_przed), zostaloPo: n(p.zostalo_po), zamyka: !!p.zamyka,
    })),
    nadwyzka: n(r.nadwyzka),
  }
}

const wyliczenie = (x: string[]) => (x.length > 1 ? `${x.slice(0, -1).join(', ')} i ${x[x.length - 1]}` : x[0] ?? '')

/** Co zrobiła wpłata, do powiadomienia: `rozliczyła FV 528/2026 i część FV 541/2026 — nadpłata +250,00 € zostaje na saldzie`. */
export function opisRozliczenia(p: PodgladWplaty, waluta: string): string {
  const nadwyzka = znakSalda(p.nadwyzka) > 0 ? kwotaSalda(p.nadwyzka, waluta) : ''
  if (!p.przydzialy.length) return nadwyzka ? `nic nie było do zapłaty — ${nadwyzka} zostaje jako nadpłata` : ''
  const co = `rozliczyła ${wyliczenie(p.przydzialy.map(x => (x.zamyka ? x.numer : `część ${x.numer}`)))}`
  return nadwyzka ? `${co} — nadpłata ${nadwyzka} zostaje na saldzie` : co
}

/** `RRRR-MM-DD` + N dni (bez stref czasowych); pusta data — pusta. */
export function dodajDni(dataIso: string, dniDo: number): string {
  if (!dataIso) return ''
  const [r, m, d] = dataIso.split('-').map(Number)
  const x = new Date(Date.UTC(r, m - 1, d + dniDo))
  return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate())
}

/** Cały poprzedni miesiąc względem dnia `dzis` (historia rozliczeń do druku). */
export function poprzedniMiesiac(dzis: string): { od: string; do: string } {
  const [r, m] = dzis.split('-').map(Number)
  const pr = m === 1 ? r - 1 : r, pm = m === 1 ? 12 : m - 1
  return { od: iso(pr, pm, 1), do: iso(pr, pm, ostatniDzien(pr, pm)) }
}
