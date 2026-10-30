/**
 * Papiery kursu — czysta logika (bez Reacta), te same zasady co stary MES
 * (`ZaladunekDrukPage`): kurs = jedno auto po załadunku; biuro dla każdego
 * odbiorcy decyduje, ile idzie na fakturę (całość albo podział), podaje numer
 * faktury tego odbiorcy (pole 5 CMR) i czy drukuje HDI także do faktury.
 * Wystawienie robi serwer jedną operacją (`zaladunkiApi.wystaw`).
 */
import { cmrApi, hdiApi, wzApi } from '@/lib/api'

export interface DokKursu { id: string; number: string; doc_series?: string; split_scope?: string | null; scope?: string | null }
export interface PozycjaKursu {
  order_id: string
  order_no: string | null
  client_name: string | null
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

/** Decyzja biura dla jednego odbiorcy. */
export interface Decyzja { tryb: 'calosc' | 'podzial'; kgFv: string; fakturaNr: string; hdiFv: boolean }
/** HDI do faktury domyślnie WŁĄCZONE — biuro drukuje zawsze dwa HDI (29.09.2026). */
export const PUSTA_DECYZJA: Decyzja = { tryb: 'calosc', kgFv: '', fakturaNr: '', hdiFv: true }

export interface Transport { carrier_id: string; plate: string; invoice_no: string; instructions: string }

const liczba = (s: string) => { const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }

export const doWystawienia = (k: Kurs | null) => (k?.pozycje ?? []).filter(p => p.wz_status === 'do_wystawienia')

/** Kilogramy na fakturę z decyzji (całość = to, co wyjechało). */
export const kgNaFakture = (p: PozycjaKursu, d: Decyzja) => (d.tryb === 'calosc' ? p.kg_zaladowane : liczba(d.kgFv))

/**
 * Ciało `zaladunkiApi.wystaw` dla odbiorców czekających na biuro — albo komunikat,
 * dlaczego jeszcze nie można. Podział musi mieć kg > 0 i nie więcej niż wyjechało.
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
    if (!(kg > 0)) return { blad: `${kto}: podaj kilogramy na fakturę.` }
    if (d.tryb === 'podzial' && kg > p.kg_zaladowane + 1e-6) return { blad: `${kto}: na fakturę nie może iść więcej niż wyjechało (${p.kg_zaladowane} kg).` }
    orders.push({ order_id: p.order_id, cel_kg: Math.round(kg * 1000) / 1000, invoice_no: d.fakturaNr.trim(), hdi_fv: d.hdiFv })
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
