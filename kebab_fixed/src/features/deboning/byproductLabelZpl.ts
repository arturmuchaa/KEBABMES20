/**
 * Etykieta palety produktów ubocznych (grzbiety / kości) — ZPL 80×50 mm.
 *
 * Drukowana z kiosku rozbioru zaraz po zważeniu palety, przez ten sam most co
 * biuro (Zebra BrowserPrint na localhost:9100 — patrz `@/lib/zebra`).
 *
 * Treść uzgodniona z halą: frakcja, numer porządkowy partii, waga NETTO palety
 * (po tarze nośnika i pojemnikach), data produkcji i data ważności.
 * Data ważności NIE jest wyliczana z żadnej normy — przepisujemy ją z
 * ćwiartki, z której paleta pochodzi (uboczne nie mogą przeżyć surowca).
 *
 * Czysta funkcja bez DOM — testowana jednostkowo (byproductLabelZpl.test.ts).
 */

/** Rozdzielczość drukarki na hali. Ta sama co domyślna w biurze (Zebra 203 dpi).
 *  Drukarka 300 dpi = zmiana tej jednej stałej (albo `dpi` w opcjach). */
export const LABEL_DPI = 203
export const LABEL_W_MM = 80
export const LABEL_H_MM = 50

export type ByproductKind = 'backs' | 'bones'

const KIND_TITLE: Record<ByproductKind, string> = { backs: 'GRZBIETY', bones: 'KOŚCI' }

export interface ByproductLabelInput {
  kind: ByproductKind
  /** Numer porządkowy partii surowca (internalBatchNo), np. „471". */
  batchNo: string
  /** Waga netto palety w kg. */
  netKg: number
  /** ISO (yyyy-mm-dd) — dzień ważenia palety. */
  productionDate: string
  /** ISO (yyyy-mm-dd) — data ważności rozbieranej ćwiartki. */
  expiryDate: string
}

export interface ByproductLabelOptions {
  dpi?: number
  copies?: number
}

export function mmToDots(mm: number, dpi: number = LABEL_DPI): number {
  return Math.round((mm * dpi) / 25.4)
}

/** ISO → „dd.mm.rrrr". Brak/śmieć → pusto: pusta rubryka jest uczciwa,
 *  „Invalid Date" na etykiecie towaru już nie. */
export function fmtLabelDate(iso?: string | null): string {
  const s = (iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`
}

/** Kilogramy po polsku: przecinek, jedno miejsce, bez zbędnego „,0". */
export function fmtLabelKg(kg: number): string {
  const n = Number(kg)
  if (!Number.isFinite(n)) return ''
  const r = Math.round(n * 10) / 10
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',')
}

/** Znaki sterujące ZPL z DANYCH (^ ~) rozbiłyby komendy — wycinamy je. */
function esc(value: string): string {
  return (value ?? '').replace(/[\^~]/g, ' ')
}

function text(xMm: number, yMm: number, fontMm: number, value: string, dpi: number): string {
  const h = mmToDots(fontMm, dpi)
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

function line(xMm: number, yMm: number, wMm: number, dpi: number): string {
  const t = Math.max(1, mmToDots(0.6, dpi))
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^GB${mmToDots(wMm, dpi)},${t},${t}^FS`
}

export function byproductLabelZpl(
  input: ByproductLabelInput,
  { dpi = LABEL_DPI, copies = 1 }: ByproductLabelOptions = {},
): string {
  const M = 4 // margines mm
  const W = LABEL_W_MM - 2 * M

  const body = [
    text(M, 3, 10, KIND_TITLE[input.kind] ?? '', dpi),
    line(M, 15.5, W, dpi),
    text(M, 18, 5, `Nr porządkowy: ${input.batchNo ?? ''}`, dpi),
    text(M, 25, 7.5, `${fmtLabelKg(input.netKg)} kg`, dpi),
    text(M, 35.5, 4.2, `Data produkcji: ${fmtLabelDate(input.productionDate)}`, dpi),
    text(M, 41, 4.2, `Data ważności: ${fmtLabelDate(input.expiryDate)}`, dpi),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28', // UTF-8 — polskie znaki (KOŚCI, porządkowy, ważności)
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,
    `^LL${mmToDots(LABEL_H_MM, dpi)}`,
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
