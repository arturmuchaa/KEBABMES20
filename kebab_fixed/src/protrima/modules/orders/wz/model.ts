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
export const wspolnaCena = (f: FormWz): string => {
  const ceny = [...new Set(f.rows.map(r => cena(r)))]
  return ceny.length === 1 && ceny[0] > 0 ? f.rows[0].priceStr : ''
}

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

/** Komunikaty jak w starym formularzu WZ; '' = można wystawić. */
export function walidacja(f: FormWz): string {
  if (!f.buyer.name.trim()) return 'Wpisz nazwę odbiorcy.'
  if (!f.rows.length) return 'Dokument nie ma pozycji — nic nie leży na magazynie dla tego zamówienia.'
  if (f.rows.some(r => !(ilosc(r) > 0) || !Number.isInteger(ilosc(r)))) return 'Ilość każdej pozycji musi być liczbą całkowitą większą od zera.'
  const za = f.rows.filter(r => ilosc(r) > r.available)
  if (za.length) return `Ilość przekracza stan magazynowy: ${za.map(r => `${r.name} (${r.batchNo ?? '—'}) — na stanie ${r.available}`).join(', ')}`
  if (f.valued && f.rows.some(r => !(cena(r) > 0))) return 'Dokument wartościowy: każda pozycja potrzebuje ceny.'
  if (f.valued && f.currency === 'EUR' && !(liczba(f.eurRateStr) > 0)) return 'Brak kursu EUR — pobierz z NBP albo wpisz ręcznie.'
  return ''
}

/** O co zapytać przed zapisem: towar zarezerwowany pod zamówienia innego klienta. */
export const cudzeRezerwacje = (f: FormWz): Rezerwacja[] =>
  rezerwacjeObcegoKlienta(f.rows.map(r => ({ stockType: 'fg', qtyStr: r.qtyStr, clientOrderNo: r.clientOrderNo, clientName: r.clientName })), f.buyer.name)

export function sumy(f: FormWz) {
  const szt = f.rows.reduce((a, r) => a + ilosc(r), 0)
  const kg = Math.round(f.rows.reduce((a, r) => a + masa(r) * 1000, 0)) / 1000
  const vat = f.valued ? podsumowanieVat(f.rows.map(r => ({ value: wartosc(r), vat_rate: r.vatRate }))) : null
  return { szt, kg, vat }
}

/** Ciało `wzApi.createManual` — pola jak w starym formularzu (palety na dokumencie, pojemniki: '' = auto). */
export function doDto(f: FormWz, orderId: string) {
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
