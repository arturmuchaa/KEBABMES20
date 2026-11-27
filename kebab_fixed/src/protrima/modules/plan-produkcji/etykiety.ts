/**
 * Etykieta kebaba z Planu produkcji — ZPL na rolkę 80 × 100 mm, tę samą co
 * zawieszki przyjęcia (właściciel 27.11.2026), drukowana w biurze wieczorem
 * przez `src/protrima/drukarka`: QR sztuki (`U|…`, skan na hali), numer kebaba
 * `ddmmrr <partia>` (spec §3) jako największy napis, receptura, rodzaj,
 * tuleja, waga, data planu, klient i numer sztuki w pozycji.
 *
 * Etykiet mięsa (palet) biuro NIE drukuje — robi to HMI masowni po zważeniu
 * (`features/masownia/mixingLabelZpl.ts`), a końcówka zostaje ze starą.
 *
 * Stały, prosty wzór — pełny edytor etykiet to osobny projekt.
 */
import { LABEL_DPI, fmtLabelDate, fmtLabelKg, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { ZEBRA_PROFILES } from '@/lib/zebraProfiles'
import type { UnitForLabel } from '@/lib/api'

const W_MM = ZEBRA_PROFILES['80x100'].width
const H_MM = ZEBRA_PROFILES['80x100'].height
const M = 3
const POLE = W_MM - 2 * M

export interface SztukaDoDruku extends UnitForLabel {
  /** Ile sztuk ma pozycja — do „nr/razem”. */
  razem: number
}

/** Numer kebaba na etykiecie: `ddmmrr <partia>` z daty planu. */
export function numerKebaba(dataPlanu: string, partia: string): string {
  const s = (dataPlanu ?? '').slice(0, 10)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}${s.slice(5, 7)}${s.slice(2, 4)}` : ''
  return [d, partia].filter(Boolean).join(' ')
}

/** Znaki sterujące ZPL z danych (^ ~) rozbiłyby komendy — wycinamy je. */
const esc = (v: string) => (v ?? '').replace(/[\^~]/g, ' ')

function text(x: number, y: number, font: number, value: string, dpi: number): string {
  const h = mmToDots(font, dpi)
  return `^FO${mmToDots(x, dpi)},${mmToDots(y, dpi)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

function textRight(x: number, y: number, w: number, font: number, value: string, dpi: number): string {
  const h = mmToDots(font, dpi)
  return `^FO${mmToDots(x, dpi)},${mmToDots(y, dpi)}^A0N,${h},${h}^FB${mmToDots(w, dpi)},1,0,R^FD${esc(value)}^FS`
}

function kreska(y: number, dpi: number): string {
  const t = Math.max(1, mmToDots(0.6, dpi))
  return `^FO${mmToDots(M, dpi)},${mmToDots(y, dpi)}^GB${mmToDots(POLE, dpi)},${t},${t}^FS`
}

function qr(x: number, y: number, dane: string, dpi: number, mag = 8): string {
  const m = Math.max(3, Math.round((mag * dpi) / 203))
  return `^FO${mmToDots(x, dpi)},${mmToDots(y, dpi)}^BQN,2,${m}^FDQA,${dane}^FS`
}

function ramka(body: string[], dpi: number): string {
  return [
    '^XA',
    '^CI28',                        // UTF-8 — polskie znaki
    `^PW${mmToDots(W_MM, dpi)}`,
    `^LL${mmToDots(H_MM, dpi)}`,
    '^LH0,0',
    '^LT0',                         // kasuje przesunięcie góry zapisane w drukarce
    '^MNY',                         // etykiety wykrawane
    '^MTD',
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}

export function etykietaSztukiZpl(s: SztukaDoDruku, dpi = LABEL_DPI): string {
  const numer = numerKebaba(s.producedDate, s.batchNo) || '—'
  // Kebab mix ma partię „355/356” — dłuższy numer musi zmieścić się w 74 mm.
  const fNumer = numer.length > 11 ? 8 : 10
  const body = [
    text(M, 3, 3, 'PARTIA', dpi),
    text(M, 7, fNumer, numer, dpi),
    kreska(19.5, dpi),
    text(M, 22, 3, 'RECEPTURA', dpi),
    text(M, 25.5, 7, s.recipeName || '—', dpi),
    text(M, 34, 4.5, [s.productTypeName, s.packagingName].filter(Boolean).join('  ·  '), dpi),
    kreska(41, dpi),
    text(M, 43.5, 3, 'WAGA', dpi),
    text(M, 47, 12, `${fmtLabelKg(s.weightKg)} kg`, dpi),
    text(M, 62, 3, 'DATA PRODUKCJI', dpi),
    text(M, 65.5, 6, fmtLabelDate(s.producedDate), dpi),
    qr(W_MM - M - 24, 44, s.qrCode, dpi, 7),
    kreska(75, dpi),
    text(M, 77.5, 3, 'KLIENT', dpi),
    text(M, 81, 6.5, s.clientName || '—', dpi),
    textRight(M, 77.5, POLE, 3, 'SZTUKA', dpi),
    textRight(M, 81, POLE, 6.5, `${s.qrSeq}/${s.razem}`, dpi),
  ]
  return ramka(body, dpi)
}
