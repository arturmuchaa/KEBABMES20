/**
 * Pula „do spakowania" pogrupowana po dniu produkcji.
 *
 * Właściciel (21.09.2026): magazynier ma wiedzieć, co produkcja zrobiła
 * poprzedniego dnia i co zostało z dni wcześniejszych, „czego nie zdążyli
 * ściągnąć". Dziś i wczoraj to normalna robota; wszystko starsze to
 * ZALEGŁE — leży najdłużej, więc ma najkrótszy termin.
 */
import type { PulaPozycja } from '@/lib/api'

export interface DzienPuli {
  data: string
  /** „dziś" / „wczoraj" / „zaległe" / „bez daty" */
  etykieta: string
  zalegle: boolean
  sztuk: number
  pozycje: PulaPozycja[]
}

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function etykietaDnia(data: string, dzis: Date): { etykieta: string; zalegle: boolean } {
  if (!data) return { etykieta: 'bez daty', zalegle: true }
  const wczoraj = new Date(dzis.getFullYear(), dzis.getMonth(), dzis.getDate() - 1)
  if (data === iso(dzis)) return { etykieta: 'dziś', zalegle: false }
  if (data === iso(wczoraj)) return { etykieta: 'wczoraj', zalegle: false }
  return { etykieta: 'zaległe', zalegle: true }
}

/** Dni w kolejności backendu (najstarsze pierwsze). */
export function pulaPoDniach(pula: PulaPozycja[], dzis: Date): DzienPuli[] {
  const out: DzienPuli[] = []
  for (const p of pula) {
    let d = out.find(x => x.data === p.producedDate)
    if (!d) {
      d = { data: p.producedDate, ...etykietaDnia(p.producedDate, dzis), sztuk: 0, pozycje: [] }
      out.push(d)
    }
    d.sztuk += p.qty
    d.pozycje.push(p)
  }
  return out
}

/** „2026-09-18" → „18.09" */
export function krotkaData(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || '')
  return m ? `${m[3]}.${m[2]}` : '—'
}

/** 15 → „15", 12.5 → „12,5" */
export function kgTxt(kg: number): string {
  return String(Math.round(kg * 1000) / 1000).replace('.', ',')
}
