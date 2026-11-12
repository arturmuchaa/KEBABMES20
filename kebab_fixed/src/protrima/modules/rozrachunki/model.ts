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
/** `sprawdz_walute` — nic w sumach, ale są pozycje w innej walucie niż kontrahent (np. klient zagraniczny z domyślnym PLN). */
export type StanKontrahenta = 'po_terminie' | 'w_terminie' | 'nadplata' | 'sprawdz_walute' | 'rozliczony'

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
  /** Dokumenty, wpłaty i otwarcia w innej walucie niż kontrahent (poza saldem). */
  innaWaluta: number
  /** Obrót za wybrany okres (brutto, waluta kontrahenta; bez salda otwarcia). */
  obrot: number
  /** Sprzedane kg za wybrany okres (z FV bez kwoty, bez salda otwarcia). */
  kg: number
  /** Faktury z papierów kursu czekające na kwotę (bez względu na okres). */
  fvBezKwoty: number
}

export interface SumaWaluty { naleznosci: number; poTerminie: number; gotowkaWz: number; nadplaty: number; obrot: number; kg: number }

/** Klient wyłączony z rozrachunków (nie ma go na liście ani w sumach) — do przywrócenia chipem „Wyłączeni”. */
export interface Wylaczony { id: string; nazwa: string; nip: string; waluta: string }

export interface WzBezKontrahenta { id: string; numer: string; data: string; kwota: number; waluta: string; nabywca: string }

export interface ListaRozliczen {
  start: string
  podsumowanie: Record<string, SumaWaluty>
  kontrahenci: Kontrahent[]
  bezKontrahenta: WzBezKontrahenta[]
  /** Liczba dokumentów, wpłat i otwarć w innej walucie niż kontrahent (poza saldami). */
  innaWaluta: number
  wylaczeni: Wylaczony[]
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
  /** Faktura korygująca — kwota ujemna, sama zmniejsza inne dokumenty księgi. */
  korekta: boolean
  /** Korekta: dokumenty, które zmniejszyła (numer i kwota). */
  rozliczyla: Array<{ numer: string; kwota: number }>
  /** Kilogramy dokumentu (WZ z MES, FV z kursu, FV ręczna z kg); null — brak danych. */
  kg: number | null
  /** WZ „nie licz do rozrachunków” (D2) — poza saldem, z powodem. */
  nieLicz: boolean
  nieLiczPowod: string
  /** FV z papierów kursu bez kwoty (D4) — czeka, aż biuro wpisze kwotę z Subiekta. */
  bezKwoty: boolean
  /**
   * Zaległy dokument sprzed startu (D13): `zrodlo='otwarcie'`, ale osobny dokument z numerem.
   * Zbiorcze saldo otwarcia ma to samo źródło — odróżnia je flaga `otwarcie`.
   */
  zalegly: boolean
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
    /** Wyłączony z rozrachunków (D1) — nie ma go na liście, saldo nie drukuje się na WZ. */
    wylaczony: boolean
  }
  start: string
  /** Obrót za wybrany okres (brutto, waluta klienta, bez salda otwarcia i zaległych sprzed startu). */
  obrot: number
  /** Sprzedane kg za okres (z FV bez kwoty, bez salda otwarcia). */
  kg: number
  /** FV z papierów kursu czekające na kwotę (bez względu na okres). */
  fvBezKwoty: number
  /** Biuro wprowadziło saldo otwarcia (choćby 0) — dopiero wtedy saldo drukuje się na WZ i w papierach kursu. */
  rozliczeniaOtwarte: boolean
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
  return {
    naleznosci: n(r.naleznosci), poTerminie: n(r.po_terminie), gotowkaWz: n(r.gotowka_wz), nadplaty: n(r.nadplaty),
    obrot: n(r.obrot), kg: n(r.kg),
  }
}

function mapujKontrahenta(r: Surowy): Kontrahent {
  return {
    id: s(r.id), nazwa: s(r.nazwa), nip: s(r.nip), waluta: s(r.waluta),
    saldoWz: n(r.saldo_wz), saldoFv: n(r.saldo_fv), saldo: n(r.saldo),
    poTerminie: n(r.po_terminie), najstarszaDni: n(r.najstarsza_dni),
    najblizszyTerminDni: r.najblizszy_termin_dni == null ? null : n(r.najblizszy_termin_dni),
    stan: (s(r.stan) || 'rozliczony') as StanKontrahenta,
    przypomnienie: !!r.przypomnienie,
    innaWaluta: n(r.inna_waluta),
    obrot: n(r.obrot), kg: n(r.kg), fvBezKwoty: n(r.fv_bez_kwoty),
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
    wylaczeni: tab(r.wylaczeni).map(w => ({ id: s(w.id), nazwa: s(w.nazwa), nip: s(w.nip), waluta: s(w.waluta) })),
  }
}

const mapujStan = (r: Surowy): Stan => ({ kod: s(r.kod), dni: n(r.dni), czesciowo: !!r.czesciowo })

function mapujDok(r: Surowy): Dok {
  return {
    id: s(r.id), numer: s(r.numer), data: s(r.data),
    kwota: n(r.kwota), zaplacono: n(r.zaplacono), zostalo: n(r.zostalo),
    termin: sNull(r.termin), forma: s(r.forma), uwagi: s(r.uwagi), zrodlo: s(r.zrodlo),
    otwarcie: !!r.otwarcie, stan: mapujStan(obj(r.stan)), zamkniety: sNull(r.zamkniety), brakVat: !!r.brak_vat,
    korekta: !!r.korekta, rozliczyla: tab(r.rozliczyla).map(p => ({ numer: s(p.numer), kwota: n(p.kwota) })),
    kg: r.kg == null || r.kg === '' ? null : n(r.kg),
    nieLicz: !!r.nie_licz, nieLiczPowod: s(r.nie_licz_powod),
    bezKwoty: r.kwota === null || s(obj(r.stan).kod) === 'czeka_na_kwote',
    zalegly: s(r.zrodlo) === 'otwarcie' && !r.otwarcie,
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
      notatka: s(k.notatka), walutaPodpowiedz: sNull(k.waluta_podpowiedz), wylaczony: !!k.wylaczony,
    },
    start: s(r.start),
    obrot: n(r.obrot), kg: n(r.kg), fvBezKwoty: n(r.fv_bez_kwoty),
    rozliczeniaOtwarte: !!r.rozliczenia_otwarte,
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
export interface Pokrycie {
  data: string; forma: string
  /** Ile z wpłaty (korekty, nadpłaty z otwarcia) poszło na ten dokument. */
  kwota: number
  /** Cała kwota wpłaty — inna niż `kwota`, gdy wpłata pokryła kilka dokumentów. */
  kwotaWplaty: number
  uwagi: string; kto: string
  rodzaj: 'wplata' | 'korekta' | 'otwarcie' | string
}

export interface SzczegolyDokumentu extends Dok {
  /** Księga dokumentu (do „+ Wpłata do tego dokumentu”). */
  ksiega: Ksiega
  pokrycie: Pokrycie[]
  historia: Array<{ akcja: string; opis: string; powod: string; kto: string; kiedy: string }>
}

export function mapujSzczegoly(raw: unknown): SzczegolyDokumentu {
  const r = obj(raw)
  return {
    ...mapujDok(r),
    ksiega: s(r.ksiega) === 'wz' ? 'wz' : 'fv',
    pokrycie: tab(r.pokrycie).map(p => ({
      data: s(p.data), forma: s(p.forma), kwota: n(p.kwota), kwotaWplaty: p.kwota_wplaty == null ? n(p.kwota) : n(p.kwota_wplaty),
      uwagi: s(p.uwagi), kto: s(p.kto), rodzaj: s(p.rodzaj) || 'wplata',
    })),
    historia: tab(r.historia).map(h => ({ akcja: s(h.akcja), opis: s(h.opis), powod: s(h.powod), kto: s(h.kto), kiedy: s(h.kiedy) })),
  }
}

/** Wpis historii zmian klienta (`GET /api/rozliczenia/klient/:id/historia-zmian`). */
export interface WpisHistorii {
  id: string; kiedy: string; kto: string; obiekt: string; akcja: string
  /** Czego dotyczy: numer dokumentu, „Wpłata 300,00 PLN z 10.11.2026”, „Saldo otwarcia WZ”, „Ustawienia klienta”. */
  czego: string
  opis: string; powod: string
  /** Usunięta wpłata/faktura albo anulowana WZ. */
  usuniete: boolean
}
export interface HistoriaZmian { wpisy: WpisHistorii[]; wiecej: boolean }

export function mapujHistorieZmian(raw: unknown): HistoriaZmian {
  const r = obj(raw)
  return {
    wpisy: tab(r.wpisy).map(w => ({
      id: s(w.id), kiedy: s(w.kiedy), kto: s(w.kto), obiekt: s(w.obiekt), akcja: s(w.akcja), czego: s(w.czego),
      opis: s(w.opis), powod: s(w.powod), usuniete: !!w.usuniete,
    })),
    wiecej: !!r.wiecej,
  }
}

// ─── Stany w słowach ───────────────────────────────────────────────────

export type Ton = 'late' | 'soon' | 'ok' | 'zero'

/** Klasa znacznika powłoki (`.tag`) dla tonu: po terminie — czerwień, termin blisko — ostrzeżenie. */
export const KLASA_TONU: Record<Ton, string> = { late: 'crit', soon: 'warn', ok: 'ok', zero: 'neutral' }

/** `1 pozycja`, `2 pozycje`, `5 pozycji` (polska odmiana liczebnika). */
export function pozycje(x: number): string {
  const d = x % 10, s = x % 100
  const slowo = x === 1 ? 'pozycja' : d >= 2 && d <= 4 && (s < 12 || s > 14) ? 'pozycje' : 'pozycji'
  return `${x} ${slowo}`
}

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
    case 'sprawdz_walute': return { tekst: 'sprawdź walutę', ton: 'soon' }
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
  nie_licz: { tekst: 'nie liczona', ton: 'zero' },
  czeka_na_kwote: { tekst: 'czeka na kwotę', ton: 'soon' },
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

export type Kolumna = 'nazwa' | 'waluta' | 'saldoWz' | 'saldoFv' | 'saldo' | 'poTerminie' | 'najstarszaDni' | 'obrot' | 'kg'
export type Kierunek = 'asc' | 'desc'
export type Filtr = 'wszyscy' | 'poTerminie' | 'nadplaty' | 'przypomnienia' | 'PLN' | 'EUR'

export const KOLUMNY: Kolumna[] = ['nazwa', 'waluta', 'saldoWz', 'saldoFv', 'saldo', 'poTerminie', 'najstarszaDni', 'obrot', 'kg']
export const FILTRY: Filtr[] = ['wszyscy', 'poTerminie', 'nadplaty', 'przypomnienia', 'PLN', 'EUR']

/** Kierunek pierwszego kliknięcia: kwoty po terminie, dni, obrót i kg — najwięcej na górze, salda — największy dłużnik (najbardziej ujemne). */
export const PIERWSZY_KIERUNEK: Record<Kolumna, Kierunek> = {
  nazwa: 'asc', waluta: 'asc', saldoWz: 'asc', saldoFv: 'asc', saldo: 'asc', poTerminie: 'desc', najstarszaDni: 'desc', obrot: 'desc', kg: 'desc',
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

/** Waluty do kafelków sum — waluta z samymi zerami (także obrót i kg za okres) nie dostaje kafelka. */
export function walutyPodsumowania(l: ListaRozliczen): string[] {
  return Object.entries(l.podsumowanie)
    .filter(([, v]) => [v.naleznosci, v.poTerminie, v.gotowkaWz, v.nadplaty, v.obrot].some(x => grosze(x) !== 0) || Math.round(v.kg * 1000) !== 0)
    .map(([w]) => w)
}

/** Kontrahenci z kartoteki do dodania („+ Kontrahent”): bez tych, którzy już są na liście, i bez wyłączonych (wracają chipem). */
export function kandydaciDoDodania<C extends { id: string; active?: boolean }>(klienci: C[], naLiscie: Array<{ id: string }>, wylaczeni: Array<{ id: string }>): C[] {
  const zajete = new Set([...naLiscie, ...wylaczeni].map(k => String(k.id)))
  return klienci.filter(c => c.active !== false && !zajete.has(String(c.id)))
}

// ─── Okres obrotu i kilogramów (lista i karta) ─────────────────────────

/** Okres obrotu i kg — `odPoczatku` = od daty startu rozliczeń. */
export type OkresObrotu = 'miesiac' | 'poprzedni' | 'rok' | 'odPoczatku' | 'zakres'
export const OKRESY_OBROTU: OkresObrotu[] = ['miesiac', 'poprzedni', 'rok', 'odPoczatku', 'zakres']
export const ETYKIETA_OKRESU_OBROTU: Record<OkresObrotu, string> = {
  miesiac: 'Ten miesiąc', poprzedni: 'Poprzedni miesiąc', rok: 'Ten rok', odPoczatku: 'Od początku', zakres: 'Od–do',
}
/** Wybór okresu: gotowy okres albo własne daty (`od`/`do` tylko dla `zakres`). */
export interface WyborOkresuObrotu { okres: OkresObrotu; od: string; do: string }

/**
 * Daty do API (`lista(od, do)`, `karta(..., okresOd, okresDo)`); pusta — domyślna serwera
 * (`od` = data startu, `do` = bez końca). Okres w całości przed startem serwer liczy jako zero.
 */
export function zakresObrotu(w: WyborOkresuObrotu, dzis: string): { od: string; do: string } {
  const [r, m] = dzis.split('-').map(Number)
  switch (w.okres) {
    case 'miesiac': return { od: iso(r, m, 1), do: iso(r, m, ostatniDzien(r, m)) }
    case 'poprzedni': return poprzedniMiesiac(dzis)
    case 'rok': return { od: iso(r, 1, 1), do: iso(r, 12, 31) }
    case 'zakres': return { od: w.od, do: w.do }
    default: return { od: '', do: '' }
  }
}

/** Błąd własnego zakresu po polsku; null — można liczyć. */
export function bladZakresu(w: WyborOkresuObrotu): string | null {
  if (w.okres !== 'zakres') return null
  if (!w.od || !w.do) return 'Wpisz obie daty'
  return w.do < w.od ? 'Data „do” jest wcześniejsza niż „od”' : null
}

/**
 * Opis okresu, który wybrał użytkownik (nie ten z odpowiedzi serwera — okres sprzed startu
 * serwer zwraca obcięty): `01.11–30.11.2026`, `od 12.11.2026`, `20.12.2025–10.01.2026`.
 */
export function opisOkresu(w: WyborOkresuObrotu, dzis: string, start: string): string {
  const z = zakresObrotu(w, dzis)
  if (!z.od && !z.do) return start ? `od ${dataKrotka(start, true)}` : 'od początku'
  if (z.od && z.do) {
    const tenSamRok = z.od.slice(0, 4) === z.do.slice(0, 4)
    return `${dataKrotka(z.od, !tenSamRok)}–${dataKrotka(z.do, true)}`
  }
  return z.od ? `od ${dataKrotka(z.od, true)}` : `do ${dataKrotka(z.do, true)}`
}
const dataKrotka = (d: string, zRokiem: boolean) => {
  const [r, m, dz] = d.split('-')
  return zRokiem ? `${dz}.${m}.${r}` : `${dz}.${m}`
}

const FORMAT_KG = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 1, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions)

/** Kilogramy: `1 234,5 kg`, `0 kg` (zwykła spacja tysięcy, minus typograficzny dla korekty). */
export function kilogramy(x: number): string {
  const v = Math.round((Number(x) || 0) * 10) / 10
  const t = FORMAT_KG.format(Math.abs(v)).replace(/[\u00a0\u202f]/g, ' ')
  return `${v < 0 ? '−' : ''}${t} kg`
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

const iso = (r: number, m: number, d: number) => `${r}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const ostatniDzien = (r: number, m: number) => new Date(Date.UTC(r, m, 0)).getUTCDate()

/** Symbol waluty do nagłówka kolumny: `€`, `zł`, inna — kod. */
export const symbolWaluty = (w: string) => kwota(0, w).split(' ').pop() ?? w

/** Kwota bez symbolu waluty (`7 280,00`) — do opisów w wierszu, gdzie waluta jest w kolumnie obok. */
export const kwotaBezWaluty = (x: number) => kwota(x, 'PLN').replace(/ zł$/, '')

/**
 * Numer z serią księgi (`528` → `FV 528`), gdy jej brak. Goły numer obok kwoty
 * (`512 17 325,00`) czyta się jak jedna liczba — spacja to też separator tysięcy.
 * „Saldo otwarcia” to nie dokument z serią — zostaje bez zmian.
 */
export function numerZSeria(numer: string, ksiega: Ksiega): string {
  const seria = ksiega === 'wz' ? 'WZ' : 'FV'
  const n = numer.trim()
  if (!n || n.toUpperCase().startsWith(seria) || n.startsWith('Saldo otwarcia')) return n
  return `${seria} ${n}`
}

/** Pozycje „Rozliczyła” osobno: `FV 528/2026: 7 280,00 €`, reszta — `nadpłata: 250,00 €`. */
export function czesciRozliczenia(w: Wplata, waluta: string): string[] {
  const czesci = w.przydzialy.map(p => `${numerZSeria(p.numer, w.ksiega)}: ${kwota(p.kwota, waluta)}`)
  if (znakSalda(w.reszta) > 0) czesci.push(`nadpłata: ${kwota(w.reszta, waluta)}`)
  return czesci
}

/** Na co poszła wpłata: `FV 528/2026: 7 280,00 €; FV 541/2026: 7 720,00 €`. */
export const rozliczyla = (w: Wplata, waluta: string): string => czesciRozliczenia(w, waluta).join('; ')

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
export function opisRozliczenia(p: PodgladWplaty, waluta: string, ksiega?: Ksiega): string {
  const nadwyzka = znakSalda(p.nadwyzka) > 0 ? kwotaSalda(p.nadwyzka, waluta) : ''
  if (!p.przydzialy.length) return nadwyzka ? `nic nie było do zapłaty — ${nadwyzka} zostaje jako nadpłata` : ''
  const nr = (x: Przydzial) => (ksiega ? numerZSeria(x.numer, ksiega) : x.numer)
  const co = `rozliczyła ${wyliczenie(p.przydzialy.map(x => (x.zamyka ? nr(x) : `część ${nr(x)}`)))}`
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

// ─── Saldo otwarcia: zaległe dokumenty sprzed startu (D13) ─────────────

/** Wiersz tabeli „Zaległe dokumenty” w oknie salda otwarcia (tekst z pól, zanim pójdzie do API). */
export interface WierszZaleglego {
  klucz: string
  ksiega: Ksiega
  numer: string
  data: string
  termin: string
  /** Termin wpisany ręcznie — przestaje iść za datą. */
  terminReczny: boolean
  kwota: string
  uwagi: string
}
export type BledyZaleglego = Partial<Record<'numer' | 'data' | 'termin' | 'kwota', string>>

/** Pusty wiersz — nic nie wpisano (data i termin same nie wystarczą); przy zapisie pomijany. */
export const pustyZalegly = (w: WierszZaleglego) => !w.numer.trim() && !w.kwota.trim() && !w.uwagi.trim()

export const normNumeru = (t: string) => t.trim().replace(/\s+/g, ' ').toUpperCase()

/**
 * Błędy wiersza po polsku (przy polach). `zajete` — numery już zajęte w księdze
 * (na karcie i we wcześniejszych wierszach tej paczki), znormalizowane `normNumeru`.
 */
export function bledyZaleglego(w: WierszZaleglego, start: string, zajete: Set<string>): BledyZaleglego {
  const b: BledyZaleglego = {}
  if (!w.numer.trim()) b.numer = 'Wpisz numer dokumentu'
  else if (zajete.has(normNumeru(w.numer))) b.numer = `Numer ${w.numer.trim()} jest już w księdze ${w.ksiega === 'wz' ? 'WZ' : 'faktur'}`
  if (!w.data) b.data = 'Wpisz datę wystawienia'
  else if (start && w.data >= start) b.data = `Data musi być przed startem rozliczeń (${start.split('-').reverse().join('.')})`
  if (w.termin && w.data && w.termin < w.data) b.termin = 'Termin przed datą wystawienia'
  const k = w.kwota.trim() ? liczba(w.kwota) : NaN
  if (!w.kwota.trim()) b.kwota = 'Wpisz kwotę do zapłaty'
  else if (!Number.isFinite(k) || doGroszy(k) <= 0) b.kwota = 'Kwota większa od zera'
  return b
}

/** `1 dokument`, `2 dokumenty`, `5 dokumentów`. */
export function ileDokumentow(x: number): string {
  const d = x % 10, s = x % 100
  return `${x} ${x === 1 ? 'dokument' : d >= 2 && d <= 4 && (s < 12 || s > 14) ? 'dokumenty' : 'dokumentów'}`
}
