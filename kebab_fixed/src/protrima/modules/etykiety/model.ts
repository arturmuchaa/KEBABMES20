/**
 * Projektor etykiet kebabów — czyste funkcje (spec 2026-11-27-projektor-etykiet-design.md).
 *
 * Wymiary w mm od lewego-górnego rogu strony, tekst w pt. Strona A4 to zawsze
 * cały arkusz 210 × 297 mm (tło PDF rozciągane na arkusz, jak w starym MES),
 * Zebra — rozmiar etykiety z szablonu. Slot 2 na arkuszu A4 = pola slotu 1
 * przesunięte o `slotOffset`, chyba że pole ma własną pozycję w `slot2Fields`.
 */
import type { LabelDesign, LabelField, LabelFieldKind, UnitForLabel } from '@/lib/api'
import { numerKebaba } from '../plan-produkcji/etykiety'

export const A4_MM = { w: 210, h: 297 }
export const KROK_MM = 0.5
export const MIN_QR_MM = 18

export const RODZAJE_POL: Record<LabelFieldKind, { nazwa: string; domyslnie: Partial<LabelField> }> = {
  weight: { nazwa: 'Waga', domyslnie: { sizePt: 36, bold: true, font: 'arial' } },
  batch: { nazwa: 'Partia', domyslnie: { sizePt: 10, bold: true, font: 'arial' } },
  prod_date: { nazwa: 'Data produkcji', domyslnie: { sizePt: 10, bold: true, font: 'arial' } },
  freeze_date: { nazwa: 'Data zamrożenia', domyslnie: { sizePt: 10, bold: true, font: 'arial' } },
  best_before: { nazwa: 'Termin przydatności', domyslnie: { sizePt: 10, bold: true, font: 'arial' } },
  org_code: { nazwa: 'Kod HALAL', domyslnie: { sizePt: 10, font: 'arial' } },
  qr: { nazwa: 'Kod QR sztuki', domyslnie: { qrMm: 25 } },
  client: { nazwa: 'Klient', domyslnie: { sizePt: 10, font: 'arial' } },
  recipe: { nazwa: 'Receptura', domyslnie: { sizePt: 10, font: 'arial' } },
  product_type: { nazwa: 'Rodzaj', domyslnie: { sizePt: 10, font: 'arial' } },
  unit_no: { nazwa: 'Numer sztuki', domyslnie: { sizePt: 10, font: 'arial' } },
  static_text: { nazwa: 'Stały tekst', domyslnie: { sizePt: 10, font: 'arial', text: 'Tekst' } },
  box: { nazwa: 'Ramka / zakrywka', domyslnie: { wMm: 30, hMm: 8, fill: 'white', thickMm: 0.3 } },
}

const dzien = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function plusDni(iso: string, dni: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() + (dni || 0))
  return d.toISOString().slice(0, 10)
}

const waga = (kg: number) => `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3, useGrouping: false }).format(kg)} kg`

/** Wartości pól dla jednej sztuki. Termin = data produkcji + dni z receptury (jak HDI). */
export function wartosciPol(u: UnitForLabel, opts: { orgCode?: string; razem?: number }): Record<LabelFieldKind, string> {
  const prod = (u.producedDate || '').slice(0, 10)
  return {
    weight: u.weightKg ? waga(u.weightKg) : '',
    batch: numerKebaba(prod, u.batchNo),
    prod_date: dzien(prod),
    freeze_date: dzien(prod),
    best_before: dzien(plusDni(prod, u.shelfLifeDays ?? 0)),
    org_code: opts.orgCode ?? '',
    qr: u.qrCode,
    client: u.clientName,
    recipe: u.recipeName,
    product_type: u.productTypeName,
    unit_no: opts.razem ? `${u.qrSeq}/${opts.razem}` : String(u.qrSeq ?? ''),
    static_text: '',
    box: '',
  }
}

/** Przykładowa sztuka do podglądu i próbnego druku. */
export const PRZYKLAD: UnitForLabel = {
  id: 'przyklad', qrCode: 'U|przyklad', qrSeq: 3, planLineId: '', linePosition: 1, batchNo: '724',
  recipeName: 'KIRMIZI', productTypeName: 'KEBAB UDO 100%', packagingName: 'METAL 65CM', clientName: 'KLIENT',
  weightKg: 40, producedDate: new Date().toISOString().slice(0, 10), status: 'planned', labelPrintedAt: null, shelfLifeDays: 364,
}

export function nowySzablon(tryb: 'a4' | 'zebra'): LabelDesign {
  return {
    name: '', clientId: '', productTypeId: '', recipeId: '', printMode: tryb,
    widthMm: tryb === 'zebra' ? 100 : 0, heightMm: tryb === 'zebra' ? 150 : 0, dpi: 203,
    labelsPerSheet: 1, slotOffset: { dxMm: 105, dyMm: 0 }, calibration: { dxMm: 0, dyMm: 0, scale: 100 },
    fields: [], slot2Fields: {},
  }
}

export function rozmiarStrony(d: LabelDesign): { w: number; h: number } {
  return d.printMode === 'a4' ? { ...A4_MM } : { w: d.widthMm, h: d.heightMm }
}

/** Pole na danym slocie arkusza (slot 2 tylko dla A4 z dwiema etykietami). */
export function polePlotna(d: LabelDesign, f: LabelField, slot: 0 | 1): LabelField {
  if (slot === 0) return f
  const wlasne = d.slot2Fields?.[f.id]
  if (wlasne) return { ...f, xMm: wlasne.xMm, yMm: wlasne.yMm }
  return { ...f, xMm: f.xMm + (d.slotOffset?.dxMm ?? 105), yMm: f.yMm + (d.slotOffset?.dyMm ?? 0) }
}

/** Przybliżony prostokąt pola w mm (tekst: wysokość z pt, szerokość z `wMm` albo szacunek). */
export function prostokat(f: LabelField, tekst = ''): { w: number; h: number } {
  if (f.kind === 'qr') return { w: f.qrMm ?? 25, h: f.qrMm ?? 25 }
  if (f.kind === 'box') return { w: f.wMm ?? 30, h: f.hMm ?? 8 }
  const h = (f.sizePt ?? 10) * 25.4 / 72
  const w = f.wMm ?? Math.max(h, (tekst || 'XXXXXXXX').length * h * 0.55)
  return (f.rotation === 90 || f.rotation === 270) ? { w: h, h: w } : { w, h }
}

export function poZaEtykieta(d: LabelDesign, f: LabelField, tekst = ''): boolean {
  const s = rozmiarStrony(d)
  const p = prostokat(f, tekst)
  return f.xMm < 0 || f.yMm < 0 || f.xMm + p.w > s.w + 0.01 || f.yMm + p.h > s.h + 0.01
}

const zaokr = (n: number) => Math.round(n * 100) / 100

export function przesun(f: LabelField, dxMm: number, dyMm: number, d: LabelDesign): LabelField {
  const s = rozmiarStrony(d)
  return { ...f, xMm: zaokr(Math.min(s.w, Math.max(0, f.xMm + dxMm))), yMm: zaokr(Math.min(s.h, Math.max(0, f.yMm + dyMm))) }
}

let nr = 0
export function nowePole(kind: LabelFieldKind, d: LabelDesign): LabelField {
  const s = rozmiarStrony(d)
  nr += 1
  return { id: `p${Date.now().toString(36)}${nr}`, kind, xMm: zaokr(s.w * 0.1), yMm: zaokr(s.h * 0.1), ...RODZAJE_POL[kind].domyslnie }
}
