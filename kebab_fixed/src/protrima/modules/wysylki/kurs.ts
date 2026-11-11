/**
 * Papiery kursu — czysta logika (bez Reacta), te same zasady co stary MES
 * (`ZaladunekDrukPage`): kurs = jedno auto po załadunku; biuro dla każdego
 * odbiorcy decyduje, ile idzie na fakturę, a ile na WZ (całość jednym albo drugim, albo podział), podaje numer
 * faktury tego odbiorcy (pole 5 CMR) i czy drukuje HDI także do faktury.
 * Wystawienie robi serwer jedną operacją (`zaladunkiApi.wystaw`).
 */
import { cmrApi, hdiApi, rozliczeniaPdf, wzApi } from '@/lib/api'

export interface DokKursu { id: string; number: string; doc_series?: string; split_scope?: string | null; scope?: string | null }
export interface PozycjaKursu {
  order_id: string
  order_no: string | null
  client_name: string | null
  /** Kontrahent zamówienia — bez niego nie ma zestawienia należności. */
  client_id?: string | null
  /** 'do_wystawienia' — czeka na biuro; 'wystawiony'; 'rozjazd' — dokument ≠ załadunek. */
  wz_status: string | null
  /** Co FAKTYCZNIE wyjechało tym kursem — z tego liczy się „całość”. */
  kg_zaladowane: number
  zaladowano: Array<{ stock_id: string; batch_no: string | null; szt: number }>
  wz: DokKursu[]
  hdi: DokKursu[]
  cmr: DokKursu[]
}
export interface Kurs { id: string; plate: string; finished_at: string | null; printed_at: string | null; pozycje: PozycjaKursu[] }

/**
 * Decyzja biura dla jednego odbiorcy: dwa POŁĄCZONE pola — kg na fakturę i kg na WZ.
 * Biuro wpisuje dowolne z nich, drugie liczy się z tego, co wyjechało (07.11.2026:
 * „wpiszę w polu WZ 3000 kg, to w FV robi się 6000 kg i odwrotnie”). Puste `kgFv`
 * = jeszcze nic nie wpisano → całość na fakturę.
 */
export interface Decyzja { kgFv: string; kgWz: string; fakturaNr: string; hdiFv: boolean }
/** HDI do faktury domyślnie WŁĄCZONE — biuro drukuje zawsze dwa HDI (29.09.2026). */
export const PUSTA_DECYZJA: Decyzja = { kgFv: '', kgWz: '', fakturaNr: '', hdiFv: true }

export interface Transport { carrier_id: string; plate: string; invoice_no: string; instructions: string }

const liczba = (s: string) => { const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }

export const doWystawienia = (k: Kurs | null) => (k?.pozycje ?? []).filter(p => p.wz_status === 'do_wystawienia')

/** Liczba do pola edycji: przecinek dziesiętny, bez spacji tysięcy, do 3 miejsc. */
export const doPola = (n: number) => String(Math.round(Math.max(0, n) * 1000) / 1000).replace('.', ',')

/** Kilogramy na fakturę z decyzji (nic nie wpisano = całość, czyli to, co wyjechało). */
export const kgNaFakture = (p: PozycjaKursu, d: Decyzja) => (d.kgFv.trim() === '' && d.kgWz.trim() === '' ? p.kg_zaladowane : liczba(d.kgFv))
export const kgNaWz = (p: PozycjaKursu, d: Decyzja) => Math.max(0, p.kg_zaladowane - kgNaFakture(p, d))

/** Wpis w jednym polu przelicza drugie z tego, co wyjechało. */
export function wpiszKg(p: PozycjaKursu, d: Decyzja, pole: 'fv' | 'wz', tekst: string): Decyzja {
  const pusty = tekst.trim() === ''
  const reszta = doPola(p.kg_zaladowane - liczba(tekst))
  return pole === 'fv'
    ? { ...d, kgFv: tekst, kgWz: pusty ? '' : reszta }
    : { ...d, kgWz: tekst, kgFv: pusty ? '' : reszta }
}
/** Szybkie wybory: całość na fakturę / całość na WZ. */
export const calosc = (p: PozycjaKursu, d: Decyzja, na: 'fv' | 'wz'): Decyzja =>
  na === 'fv' ? { ...d, kgFv: doPola(p.kg_zaladowane), kgWz: '0' } : { ...d, kgFv: '0', kgWz: doPola(p.kg_zaladowane) }
export type Uklad = 'fv' | 'wz' | 'podzial'
export const uklad = (p: PozycjaKursu, d: Decyzja): Uklad => {
  const fv = kgNaFakture(p, d)
  return fv >= p.kg_zaladowane - 1e-6 ? 'fv' : fv <= 1e-6 ? 'wz' : 'podzial'
}

/**
 * Ciało `zaladunkiApi.wystaw` dla odbiorców czekających na biuro — albo komunikat,
 * dlaczego jeszcze nie można. Na fakturę od 0 (całość na WZ) do tego, co wyjechało.
 */
export function zamowieniaDoWystawienia(k: Kurs | null, decyzje: Record<string, Decyzja>):
  { orders: Array<{ order_id: string; cel_kg: number; invoice_no: string; hdi_fv: boolean }> } | { blad: string } {
  const czekajace = doWystawienia(k)
  if (!czekajace.length) return { blad: 'W tym kursie nic nie czeka na wystawienie.' }
  const orders = []
  for (const p of czekajace) {
    const d = decyzje[p.order_id] ?? PUSTA_DECYZJA
    const kg = kgNaFakture(p, d)
    const kto = p.client_name || p.order_no || 'odbiorca'
    const fvTekst = d.kgFv.trim(), wzTekst = d.kgWz.trim()
    if ((fvTekst || wzTekst) && (!fvTekst || !Number.isFinite(parseFloat(fvTekst.replace(/\s/g, '').replace(',', '.')))))
      return { blad: `${kto}: wpisz kilogramy na fakturę albo na WZ.` }
    if (kg < -1e-6 || liczba(d.kgWz) < -1e-6) return { blad: `${kto}: kilogramy nie mogą być ujemne.` }
    if (kg > p.kg_zaladowane + 1e-6) return { blad: `${kto}: na fakturę nie może iść więcej niż wyjechało (${p.kg_zaladowane} kg).` }
    if (wzTekst && liczba(d.kgWz) > p.kg_zaladowane + 1e-6) return { blad: `${kto}: na WZ nie może iść więcej niż wyjechało (${p.kg_zaladowane} kg).` }
    // Całość na WZ: dokumentów do faktury nie ma, więc HDI do faktury też nie.
    const zero = kg <= 1e-6
    orders.push({ order_id: p.order_id, cel_kg: zero ? 0 : Math.round(kg * 1000) / 1000, invoice_no: zero ? '' : d.fakturaNr.trim(), hdi_fv: zero ? false : d.hdiFv })
  }
  return { orders }
}

export interface PapierKursu { key: string; etykieta: string; numer: string; url: string; plik: string }

/** Dokumenty jednego odbiorcy do pobrania (PDF z serwera, ten sam wzór co stary MES). */
export function papieryPozycji(p: PozycjaKursu): PapierKursu[] {
  const plik = (pre: string, nr: string) => `${pre}-${nr.replace(/[\\/]/g, '-')}.pdf`
  return [
    ...p.wz.map(d => ({ key: `wz-${d.id}`, etykieta: d.doc_series === 'WM' ? 'WM (wewnętrzny)' : 'WZ', numer: d.number, url: wzApi.pdfUrl(d.id), plik: plik(d.doc_series === 'WM' ? 'WM' : 'WZ', d.number) })),
    ...p.hdi.map(d => ({ key: `hdi-${d.id}`, etykieta: d.scope === 'fv' ? 'HDI do faktury' : 'HDI', numer: d.number, url: hdiApi.pdfUrl(d.id), plik: plik('HDI', d.number) })),
    ...p.cmr.map(d => ({ key: `cmr-${d.id}`, etykieta: d.scope === 'fv' ? 'CMR do faktury' : 'CMR na drogę', numer: d.number, url: cmrApi.pdfUrl(d.id), plik: plik('CMR', d.number) })),
  ]
}

export interface SaldoKursu extends PapierKursu {
  /** Wchodzi do „Pobierz wszystkie PDF” tylko, gdy odbiorca nie ma WZ klienta (saldo nie jest wtedy na WZ). */
  doWszystkich: boolean
}

/**
 * Zestawienie należności odbiorcy — papier „na dziś”. Odbiorca bez `client_id` nie ma go wcale.
 * Gdy wysyłka idzie bez WZ do klienta (wszystko na fakturę; WM jest wewnętrzny), saldo nie ma
 * gdzie się pojawić, więc dochodzi do wydruku; przy WZ klienta jest już pod nim.
 */
export function saldoPozycji(p: PozycjaKursu, dzis: string): SaldoKursu | null {
  if (!p.client_id) return null
  const brakWz = !p.wz.some(d => d.doc_series !== 'WM')
  const klient = (p.client_name || p.client_id).replace(/[\\/:*?"<>|\s]+/g, '_')
  return { key: `saldo-${p.client_id}`, etykieta: 'Zestawienie należności', numer: '', url: rozliczeniaPdf.zestawienie(p.client_id, dzis), plik: `SALDO_${klient}_${dzis}.pdf`, doWszystkich: brakWz }
}
