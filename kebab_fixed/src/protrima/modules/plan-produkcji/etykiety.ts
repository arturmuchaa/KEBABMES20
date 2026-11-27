/**
 * Etykiety z Planu produkcji — ZPL na rolkę 100 × 150 mm (decyzja właściciela
 * 27.11.2026), drukowane w biurze wieczorem przez `src/protrima/drukarka`.
 *
 *  - etykieta SZTUKI: QR sztuki (`U|…`, skan na hali), numer kebaba
 *    `ddmmrr <partia>` (spec §3) jako największy napis, receptura, rodzaj,
 *    tuleja, waga, data planu, klient i numer sztuki w pozycji;
 *  - etykieta PALETY / KOŃCÓWKI: QR palety (`SP|…`, skan przy wywozie), numer
 *    palety, partia, receptura, kg z wagi i dzień masowania.
 *
 * Stały, prosty wzór — pełny edytor etykiet to osobny projekt.
 */
import { LABEL_DPI, fmtLabelDate, fmtLabelKg, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { ZEBRA_PROFILES } from '@/lib/zebraProfiles'
import type { SeasonedPallet, UnitForLabel } from '@/lib/api'

const W_MM = ZEBRA_PROFILES['100x150'].width
const H_MM = ZEBRA_PROFILES['100x150'].height
const M = 4
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

/** Dzień w Polsce z ISO serwera (UTC) — „26.11.2026”. */
function dzienPl(iso?: string | null): string {
  const t = Date.parse(iso ?? '')
  if (Number.isNaN(t)) return ''
  return fmtLabelDate(new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' }))
}

export function etykietaSztukiZpl(s: SztukaDoDruku, dpi = LABEL_DPI): string {
  const body = [
    text(M, 4, 3.6, 'PARTIA', dpi),
    text(M, 8.5, 13, numerKebaba(s.producedDate, s.batchNo) || '—', dpi),
    textRight(M, 4, POLE, 3.6, 'SZTUKA', dpi),
    textRight(M, 8.5, POLE, 8, `${s.qrSeq}/${s.razem}`, dpi),
    kreska(24, dpi),
    text(M, 27, 3.6, 'RECEPTURA', dpi),
    text(M, 31.5, 8, s.recipeName || '—', dpi),
    text(M, 42, 5.5, [s.productTypeName, s.packagingName].filter(Boolean).join('  ·  '), dpi),
    kreska(50, dpi),
    text(M, 53, 3.6, 'WAGA', dpi),
    text(M, 57.5, 14, `${fmtLabelKg(s.weightKg)} kg`, dpi),
    text(M, 76, 3.6, 'DATA PRODUKCJI', dpi),
    text(M, 80.5, 7, fmtLabelDate(s.producedDate), dpi),
    qr(W_MM - M - 40, 52, s.qrCode, dpi),
    kreska(96, dpi),
    text(M, 99, 3.6, 'KLIENT', dpi),
    text(M, 103.5, 7, s.clientName || '—', dpi),
  ]
  return ramka(body, dpi)
}

export function etykietaPaletyZpl(p: SeasonedPallet, dpi = LABEL_DPI): string {
  const body = [
    text(M, 4, 3.6, 'MIĘSO PRZYPRAWIONE', dpi),
    text(M, 9, 11, `PALETA ${p.palletNo ?? '—'}`, dpi),
    qr(W_MM - M - 40, 4, p.qr, dpi),
  ]
  if (p.isRemainder) body.push(text(M, 23, 5.5, `KOŃCÓWKA z palety ${p.parentPalletNo ?? '?'}`, dpi))
  body.push(
    kreska(48, dpi),
    text(M, 51, 3.6, 'PARTIA', dpi),
    text(M, 55.5, 16, p.batchNo || '—', dpi),
    kreska(75, dpi),
    text(M, 78, 3.6, 'RECEPTURA', dpi),
    text(M, 82.5, 8, p.recipeName || '—', dpi),
  )
  if (p.materialName) body.push(text(M, 93, 5.5, p.materialName.toUpperCase(), dpi))
  body.push(
    kreska(101, dpi),
    text(M, 104, 3.6, 'WAGA', dpi),
    text(M, 108.5, 12, `${fmtLabelKg(p.kgWeighed)} kg`, dpi),
    text(M, 126, 3.6, 'MASOWANIE', dpi),
    text(M, 130.5, 7, dzienPl(p.mixedAt), dpi),
  )
  if (p.expiryDate) body.push(textRight(M, 126, POLE, 3.6, 'TERMIN', dpi), textRight(M, 130.5, POLE, 7, fmtLabelDate(p.expiryDate), dpi))
  return ramka(body, dpi)
}
