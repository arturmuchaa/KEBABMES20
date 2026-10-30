/**
 * WZ z zamówienia — czysta logika (bez Reacta).
 *
 * Ta sama droga co stary MES (WzNewPage ?order=): pozycje podaje serwer
 * (`wzApi.fromOrderPicks` — wiersze magazynu wg FEFO, nazwa jak na dokumencie),
 * dokument zapisuje `wzApi.createManual` z `orderId` — rozchód po stock_id,
 * stany i ruchy magazynowe robi serwer. VAT: `stawkaVatDlaNabywcy`,
 * ostrzeżenie o cudzej rezerwacji: `rezerwacjeObcegoKlienta`.
 */
import { stawkaVatDlaNabywcy, podsumowanieVat } from '@/features/wz/wzVat'
import { rezerwacjeObcegoKlienta, type Rezerwacja } from '@/features/wz/wzRezerwacje'
import { zlozNazweWyrobu } from '@/features/wz/nazwaWyrobu'

export interface WierszWz {
  stockId: string
  name: string
  batchNo?: string
  qtyStr: string
  available: number
  kgPerUnit?: number
  priceStr: string
  vatRate: number
  clientOrderNo?: string | null
  clientName?: string | null
  /** Wyrób bez gramatury („KEBAB UDO BEYAZ HALAL”) — klucz ceny „według wyrobu”. */
  grupa?: string
}
export interface FormWz {
  buyer: { name: string; address: string; nip: string }
  rows: WierszWz[]
  valued: boolean
  currency: 'PLN' | 'EUR'
  eurRateStr: string
  place: string
  issuedDate: string
  releaseDate: string
  notes: string
  palletsH1Str: string
  palletsOtherStr: string
  palletsOtherKind: string
  containersStr: string
}

type Picks = Awaited<ReturnType<typeof import('@/lib/api').wzApi.fromOrderPicks>>

const liczba = (s: string) => { const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }
export const ilosc = (r: WierszWz) => liczba(r.qtyStr)
export const cena = (r: WierszWz) => liczba(r.priceStr)
export const masa = (r: WierszWz) => r.kgPerUnit ? Math.round(ilosc(r) * r.kgPerUnit * 1000) / 1000 : 0
/**
 * Wartość pozycji — wyrób gotowy wyceniany ZA KILOGRAM (szt × kg/szt × cena),
 * tak jak liczy serwer (`wz_service`: value = total_kg × price) i stary MES
 * (`rowMath.rowValue`). Pozycja bez gramatury — za sztukę.
 */
export const wartosc = (r: WierszWz) => Math.round((masa(r) > 0 ? masa(r) : ilosc(r)) * cena(r) * 100) / 100

/** Jedna cena dla wszystkich pozycji dokumentu — żeby nie wpisywać jej w każdym wierszu. */
export const cenaDlaWszystkich = (f: FormWz, priceStr: string): FormWz => ({ ...f, rows: f.rows.map(r => ({ ...r, priceStr })) })

/** Wspólna cena pozycji ('' gdy pozycje mają różne albo puste ceny). */
export const wspolnaCena = (f: FormWz): string => wspolna(f.rows)
const wspolna = (rows: WierszWz[]): string => {
  const ceny = [...new Set(rows.map(r => cena(r)))]
  return rows.length > 0 && ceny.length === 1 && ceny[0] > 0 ? rows[0].priceStr : ''
}

/** Klucz ceny „według wyrobu”: rodzaj + receptura, bez gramatury (cena idzie za kg). */
export const kluczCeny = (r: WierszWz) => r.grupa || r.name.replace(/\s+\d+(?:[.,]\d+)?\s*kg$/i, '').trim()

export interface GrupaCen { key: string; pozycji: number; szt: number; kg: number; priceStr: string }
/** Wyroby na dokumencie (kolejność pierwszego wystąpienia) z ich wspólną ceną. */
export function grupyCen(f: FormWz): GrupaCen[] {
  const m = new Map<string, WierszWz[]>()
  f.rows.forEach(r => m.set(kluczCeny(r), [...(m.get(kluczCeny(r)) ?? []), r]))
  return [...m.entries()].map(([key, rows]) => ({
    key, pozycji: rows.length, priceStr: wspolna(rows),
    szt: rows.reduce((a, r) => a + ilosc(r), 0),
    kg: Math.round(rows.reduce((a, r) => a + masa(r) * 1000, 0)) / 1000,
  }))
}
export const cenaDlaGrupy = (f: FormWz, key: string, priceStr: string): FormWz =>
  ({ ...f, rows: f.rows.map(r => (kluczCeny(r) === key ? { ...r, priceStr } : r)) })

export const vatDlaWszystkich = (f: FormWz, vatRate: number): FormWz => ({ ...f, rows: f.rows.map(r => ({ ...r, vatRate })) })
/** Wspólna stawka VAT (null gdy pozycje mają różne). */
export const wspolnyVat = (f: FormWz): number | null => { const v = [...new Set(f.rows.map(r => r.vatRate))]; return v.length === 1 ? v[0] : null }
export const bezCeny = (f: FormWz) => f.rows.filter(r => !(cena(r) > 0)).length

/** Formularz z odpowiedzi `/wz/from-order/{id}/picks`. Brakuje = zamówiono − wstawione. */
export function zPicks(d: Picks, dzis: string): { form: FormWz; orderNo: string; brakuje: number; clientId: string } {
  const vat = stawkaVatDlaNabywcy(d.buyer.nip)
  const rows: WierszWz[] = d.picks.map(p => ({
    stockId: p.stock_id,
    // Nazwę składa backend (ta sama, którą wystawi dokument); fallback dla starszego backendu.
    name: p.name || (zlozNazweWyrobu(p.product_type_name, p.recipe_name) + (p.kg_per_unit > 0 ? ` ${String(p.kg_per_unit).replace('.', ',')}kg` : '')),
    batchNo: p.batch_no ?? undefined,
    qtyStr: String(p.qty),
    available: p.qty_available,
    kgPerUnit: p.kg_per_unit || undefined,
    priceStr: '',
    vatRate: vat,
    grupa: p.product_type_name && p.recipe_name ? zlozNazweWyrobu(p.product_type_name, p.recipe_name) : undefined,
  }))
  const wstawione = d.picks.reduce((a, p) => a + p.qty, 0)
  return {
    orderNo: d.order_no, clientId: d.client_id, brakuje: Math.max(0, d.ordered - wstawione),
    form: {
      buyer: { name: d.buyer.name || '', address: d.buyer.address || '', nip: d.buyer.nip || '' },
      rows, valued: false, currency: 'PLN', eurRateStr: '', place: '', issuedDate: dzis, releaseDate: dzis, notes: '',
      palletsH1Str: '', palletsOtherStr: '', palletsOtherKind: 'net_e1', containersStr: '',
    },
  }
}

/** Wiersz `/wz/stock/finished-goods` (nazwa pozycji wg kartoteki odbiorcy, gdy podano `client_id`). */
export interface FgStock {
  id: string; batch_no?: string | null; qty_available: number; kg_per_unit: number; name?: string
  product_type_name?: string; recipe_name?: string; client_name?: string | null; client_order_no?: string | null
}
export interface Wybor { id: string; qty: number }
export interface KlientWz { id: string; name: string; displayName?: string; address?: string; city?: string; nip?: string }

const nazwaFg = (g: FgStock) => g.name || (zlozNazweWyrobu(g.product_type_name ?? '', g.recipe_name ?? '') + (g.kg_per_unit > 0 ? ` ${String(g.kg_per_unit).replace('.', ',')}kg` : ''))

/** Odbiorca z kartoteki — ten sam kształt, który backend składa dla WZ z zamówienia. */
export const nabywcaZKlienta = (c: KlientWz): FormWz['buyer'] =>
  ({ name: c.name || c.displayName || '', address: `${c.address ?? ''} ${c.city ?? ''}`.trim(), nip: c.nip ?? '' })

/**
 * WZ z zaznaczonych wierszy magazynu (bez zamówienia) — jak stary MES
 * („Wystaw WZ” w Magazynie wyrobu, `?fg=id:szt`). Kolejność pozycji = kolejność
 * zaznaczenia; stempel zamówienia zostaje na wierszu, żeby ostrzec przed wydaniem
 * cudzej rezerwacji.
 */
export function zMagazynu(fg: FgStock[], wybor: Wybor[], dzis: string): FormWz {
  const po = new Map(fg.map(g => [g.id, g]))
  const rows: WierszWz[] = wybor.flatMap(w => {
    const g = po.get(w.id)
    if (!g) return []
    return [{
      stockId: g.id, name: nazwaFg(g), batchNo: g.batch_no ?? undefined,
      qtyStr: String(Math.max(1, Math.min(w.qty, Number(g.qty_available) || 0))), available: Number(g.qty_available) || 0,
      kgPerUnit: g.kg_per_unit || undefined, priceStr: '', vatRate: stawkaVatDlaNabywcy(''),
      clientOrderNo: g.client_order_no ?? null, clientName: g.client_name ?? null,
      grupa: g.product_type_name && g.recipe_name ? zlozNazweWyrobu(g.product_type_name, g.recipe_name) : undefined,
    }]
  })
  return {
    buyer: { name: '', address: '', nip: '' }, rows, valued: false, currency: 'PLN', eurRateStr: '', place: '',
    issuedDate: dzis, releaseDate: dzis, notes: '', palletsH1Str: '', palletsOtherStr: '', palletsOtherKind: 'net_e1', containersStr: '',
  }
}

/**
 * Zmiana odbiorcy: nowy nabywca i stawka VAT z jego NIP-u — ale tylko w wierszach,
 * które miały stawkę domyślną poprzedniego nabywcy (poprawione ręcznie zostają).
 */
export function zNabywca(f: FormWz, buyer: FormWz['buyer']): FormWz {
  const stara = stawkaVatDlaNabywcy(f.buyer.nip), nowa = stawkaVatDlaNabywcy(buyer.nip)
  return { ...f, buyer, rows: f.rows.map(r => (r.vatRate === stara ? { ...r, vatRate: nowa } : r)) }
}

/** Nazwy pozycji wg kartoteki odbiorcy (magazyn przeczytany z `client_id`). */
export const zNazwami = (f: FormWz, fg: FgStock[]): FormWz => {
  const po = new Map(fg.map(g => [g.id, g]))
  return { ...f, rows: f.rows.map(r => { const g = po.get(r.stockId); return g ? { ...r, name: nazwaFg(g) } : r }) }
}

/** Odbiorca podpowiadany z zaznaczenia: wszystkie wiersze z jednym klientem i ten klient jest w kartotece. */
export function klientZWyboru(fg: FgStock[], wybor: Wybor[], klienci: KlientWz[]): KlientWz | undefined {
  const nazwy = [...new Set(wybor.map(w => fg.find(g => g.id === w.id)?.client_name).filter((n): n is string => !!n))]
  if (nazwy.length !== 1 || wybor.some(w => !fg.find(g => g.id === w.id)?.client_name)) return undefined
  const kand = klienci.filter(c => c.name === nazwy[0] || c.displayName === nazwy[0])
  return kand.length === 1 ? kand[0] : undefined
}

/** Komunikaty jak w starym formularzu WZ; '' = można wystawić. */
export function walidacja(f: FormWz): string {
  if (!f.buyer.name.trim()) return 'Wpisz nazwę odbiorcy.'
  if (!f.rows.length) return 'Dokument nie ma pozycji — nic nie leży na magazynie.'
  if (f.rows.some(r => !(ilosc(r) > 0) || !Number.isInteger(ilosc(r)))) return 'Ilość każdej pozycji musi być liczbą całkowitą większą od zera.'
  const za = f.rows.filter(r => ilosc(r) > r.available)
  if (za.length) return `Ilość przekracza stan magazynowy: ${za.map(r => `${r.name} (${r.batchNo ?? '—'}) — na stanie ${r.available}`).join(', ')}`
  if (f.valued && f.rows.some(r => !(cena(r) > 0))) return 'Dokument wartościowy: każda pozycja potrzebuje ceny.'
  if (f.valued && f.currency === 'EUR' && !(liczba(f.eurRateStr) > 0)) return 'Brak kursu EUR — pobierz z NBP albo wpisz ręcznie.'
  return ''
}

/**
 * O co zapytać przed zapisem: towar zarezerwowany pod zamówienia innego klienta.
 * `nazwyOdbiorcy` — pozostałe nazwy TEGO odbiorcy z kartoteki (handlowa i pełna):
 * stempel na wyrobie bywa jedną albo drugą („DEM`S” / „ROYAL BEOS e.U (DEM`S GOURMET)”),
 * a wydanie właścicielowi to realizacja, nie odebranie towaru.
 */
export const cudzeRezerwacje = (f: FormWz, nazwyOdbiorcy: string[] = []): Rezerwacja[] => {
  const swoje = nazwyOdbiorcy.map(n => n.trim().toLowerCase()).filter(Boolean)
  return rezerwacjeObcegoKlienta(f.rows.map(r => ({ stockType: 'fg', qtyStr: r.qtyStr, clientOrderNo: r.clientOrderNo, clientName: r.clientName })), f.buyer.name)
    .filter(r => !swoje.includes(r.clientName.trim().toLowerCase()))
}

export function sumy(f: FormWz) {
  const szt = f.rows.reduce((a, r) => a + ilosc(r), 0)
  const kg = Math.round(f.rows.reduce((a, r) => a + masa(r) * 1000, 0)) / 1000
  const vat = f.valued ? podsumowanieVat(f.rows.map(r => ({ value: wartosc(r), vat_rate: r.vatRate }))) : null
  return { szt, kg, vat }
}

/** Ciało `wzApi.createManual` — pola jak w starym formularzu (palety na dokumencie, pojemniki: '' = auto). */
export function doDto(f: FormWz, orderId?: string) {
  const intOrUndef = (s: string) => s.trim() === '' ? undefined : Math.max(0, Math.floor(liczba(s)))
  return {
    buyer: { name: f.buyer.name.trim(), address: f.buyer.address.trim(), nip: f.buyer.nip.trim() },
    orderId,
    items: f.rows.map(r => ({
      stockType: 'fg' as const, stockId: r.stockId, name: r.name, unit: 'szt', qty: ilosc(r),
      price: f.valued ? cena(r) : 0, batchNo: r.batchNo, kgPerUnit: r.kgPerUnit,
      vatRate: f.valued ? r.vatRate : undefined,
    })),
    valued: f.valued,
    currency: f.currency,
    eurRate: f.valued && f.currency === 'EUR' && liczba(f.eurRateStr) > 0 ? liczba(f.eurRateStr) : null,
    payrollDeduction: null,
    place: f.place.trim() || undefined,
    issuedDate: f.issuedDate || undefined,
    releaseDate: f.releaseDate || undefined,
    notes: f.notes.trim() || undefined,
    palletsH1: intOrUndef(f.palletsH1Str),
    palletsOther: intOrUndef(f.palletsOtherStr),
    palletsOtherKind: f.palletsOtherStr.trim() ? f.palletsOtherKind : undefined,
    // '' → null = suma z pozycji (auto); '0' → świadome zero.
    containersTotal: f.containersStr.trim() === '' ? null : Math.max(0, Math.floor(liczba(f.containersStr))),
  }
}
