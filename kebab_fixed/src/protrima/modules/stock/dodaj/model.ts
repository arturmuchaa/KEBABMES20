/**
 * „Dodaj wyrób gotowy” — logika okna bez Reacta.
 *
 * Biuro wpisuje dzień produkcji naraz. Trzy rzeczy, które w starym MES nie
 * działały: zwijanie klientów, dwa zamówienia jednego klienta w jednej liście
 * i jedna partia na całe okno. Tu pozycja koszyka ma WIELE wierszy partii —
 * każdy wiersz to osobny wpis wyrobu w jednym żądaniu `createBulk`.
 *
 * Powiązanie z zamówieniem: numer zamówienia + receptura + waga sztuki — dlatego
 * przy pozycjach z zamówień te pola biorą się z POZYCJI, nie z ręki.
 */
import { isClosed, lineMissing, type Line, type Order } from '../../../data/model'
import { ddmmrr, liczba, normalizeManualBatchNo } from '@/features/finished-goods/manualGoods'

export interface PartiaWiersz { key: string; nr: string; qty: string }

export interface PozycjaKoszyka {
  /** lineId albo `r-<n>` dla ręcznych. */
  key: string
  zrodlo: 'zamowienie' | 'reczna'
  /** '' dla ręcznych. */
  orderNo: string
  clientId: string
  /** Nazwa wysyłana na serwer (zamówienie / kartoteka). */
  clientName: string
  /** Nazwa na ekranie (handlowa). */
  clientLabel: string
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  kgPerUnit: number
  /** Ile zostało do zrobienia (ręczne: wpisane sztuki). */
  cel: number
  partie: PartiaWiersz[]
}

export interface GalazZamowienia { orderId: string; orderNo: string; delivery?: Date; kgLeft: number; lines: Line[] }
export interface GalazKlienta { clientId: string; clientName: string; kgLeft: number; zamowienia: GalazZamowienia[] }

export interface FinishedGoodBulkItem {
  qty: number
  kgPerUnit: number
  producedDate: string
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  clientId: string
  clientName: string
  clientOrderNo: string
  batchNo: string
  seasonedBatchNos: string[]
  consumeSeasoned: boolean
}

const zaokr = (n: number) => Math.round(n * 100) / 100

let licznik = 0
/** Klucz wiersza niezależny od indeksu — usunięcie wiersza nie przestawia fokusu ani błędów. */
export const nowyKlucz = (prefix = 'p') => `${prefix}-${Date.now().toString(36)}-${(++licznik).toString(36)}`

export function drzewoZamowien(orders: Order[], q = ''): GalazKlienta[] {
  const fraza = q.trim().toLowerCase()
  const pasuje = (...teksty: string[]) => !fraza || teksty.some(t => t.toLowerCase().includes(fraza))
  const klienci = new Map<string, GalazKlienta>()
  for (const o of orders) {
    if (isClosed(o) || o.status === 'draft') continue
    const klientPasuje = pasuje(o.client.name)
    const lines = o.lines.filter(l => !l.usluga && (klientPasuje || pasuje(o.no, l.recipe, l.product)))
    if (!lines.length) continue
    const kgLeft = zaokr(lines.reduce((a, l) => a + lineMissing(l) * l.kgPerUnit, 0))
    let k = klienci.get(o.client.id)
    if (!k) { k = { clientId: o.client.id, clientName: o.client.name, kgLeft: 0, zamowienia: [] }; klienci.set(o.client.id, k) }
    k.zamowienia.push({ orderId: o.id, orderNo: o.no, delivery: o.delivery, kgLeft, lines })
    k.kgLeft = zaokr(k.kgLeft + kgLeft)
  }
  const czas = (d?: Date) => (d ? d.getTime() : Number.POSITIVE_INFINITY)
  for (const k of klienci.values()) k.zamowienia.sort((a, b) => czas(a.delivery) - czas(b.delivery) || a.orderNo.localeCompare(b.orderNo, 'pl'))
  return [...klienci.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, 'pl'))
}

export function pozycjaZLinii(o: Order, l: Line): PozycjaKoszyka {
  const cel = lineMissing(l) || l.qty
  return {
    key: l.id, zrodlo: 'zamowienie', orderNo: o.no,
    clientId: o.client.id, clientName: o.client.name, clientLabel: o.client.name,
    recipeId: l.recipeId, recipeName: l.recipe,
    productTypeId: l.productTypeId ?? '', productTypeName: l.product,
    packagingId: l.packagingId ?? '', packagingName: l.packaging,
    kgPerUnit: l.kgPerUnit, cel,
    partie: [{ key: nowyKlucz(), nr: '', qty: String(cel) }],
  }
}

export const sumaPartii = (p: PozycjaKoszyka): number => p.partie.reduce((a, w) => a + Math.round(liczba(w.qty)), 0)

export function dodajPartie(p: PozycjaKoszyka): PozycjaKoszyka {
  const reszta = p.cel - sumaPartii(p)
  return { ...p, partie: [...p.partie, { key: nowyKlucz(), nr: '', qty: reszta > 0 ? String(reszta) : '' }] }
}

export function statusPozycji(p: PozycjaKoszyka): 'ok' | 'mniej' | 'wiecej' {
  const s = sumaPartii(p)
  return s === p.cel ? 'ok' : s < p.cel ? 'mniej' : 'wiecej'
}

export interface Rozpoznana { naWyrobie: string; masownia: boolean; nrMasowni?: string }

const Z_DATA = /^\d{6}\s+/

export function rozpoznajPartie(nr: string, data: string, wsadyMasowni: string[]): Rozpoznana {
  const wpis = String(nr ?? '').trim()
  if (!wpis) return { naWyrobie: '—', masownia: false }
  const goly = wpis.replace(Z_DATA, '')
  const wsad = wsadyMasowni.find(w => String(w).trim().toLowerCase() === goly.toLowerCase())
  if (wsad != null) {
    const d = ddmmrr(data)
    const n = String(wsad).trim()
    return { naWyrobie: d ? `${d} ${n}` : n, masownia: true, nrMasowni: n }
  }
  return { naWyrobie: normalizeManualBatchNo(wpis, data), masownia: false }
}

export function bledyKoszyka(k: PozycjaKoszyka[], data: string): Record<string, string> {
  const b: Record<string, string> = {}
  if (!k.length) b.koszyk = 'Zaznacz pozycje z zamówień albo dodaj wyrób ręcznie'
  if (!data) b.data = 'Podaj datę produkcji — z niej powstaje numer partii'
  for (const p of k) {
    for (const w of p.partie) {
      if (!w.nr.trim()) b[`${p.key}:${w.key}:nr`] = 'Wpisz numer partii'
      if (Math.round(liczba(w.qty)) <= 0) b[`${p.key}:${w.key}:qty`] = 'Podaj sztuki'
    }
  }
  return b
}

export function payloadKoszyka(k: PozycjaKoszyka[], data: string, wsadyMasowni: string[]): FinishedGoodBulkItem[] {
  return k.flatMap(p => p.partie.map(w => {
    const r = rozpoznajPartie(w.nr, data, wsadyMasowni)
    return {
      qty: Math.round(liczba(w.qty)), kgPerUnit: p.kgPerUnit, producedDate: data,
      recipeId: p.recipeId, recipeName: p.recipeName,
      productTypeId: p.productTypeId, productTypeName: p.productTypeName,
      packagingId: p.packagingId, packagingName: p.packagingName,
      clientId: p.clientId, clientName: p.clientName, clientOrderNo: p.orderNo,
      batchNo: r.masownia ? '' : r.naWyrobie,
      seasonedBatchNos: r.masownia && r.nrMasowni ? [r.nrMasowni] : [],
      consumeSeasoned: r.masownia,
    }
  }))
}

export function sumyKoszyka(k: PozycjaKoszyka[]): { partie: number; sztuki: number; kg: number } {
  let partie = 0, sztuki = 0, kg = 0
  for (const p of k) for (const w of p.partie) {
    const q = Math.round(liczba(w.qty))
    partie++; sztuki += q; kg += q * p.kgPerUnit
  }
  return { partie, sztuki, kg: zaokr(kg) }
}
