/**
 * Etykieta palety produktów ubocznych (grzbiety / kości) — ZPL 50×80 mm.
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

/** Etykieta z rolki na hali: 50 mm W POPRZEK taśmy, 80 mm wzdłuż podawania.
 *  Pierwsze wydanie miało to odwrotnie (80×50) i drukarka ucinała lewą stronę
 *  każdego wiersza — na taśmie zostawały same końcówki („ŚCI" zamiast
 *  „KOŚCI"). Szerokość jest tu wąskim gardłem, wysokości mamy w zapasie. */
export const LABEL_W_MM = 50
export const LABEL_H_MM = 80

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
  // Układ pionowy: wąska etykieta nie zmieści „etykieta: wartość" w jednym
  // wierszu, więc opis idzie małą czcionką NAD wartością. Liczby, po które
  // operator sięga z odległości (numer partii, waga), zostają duże.
  const M = 3 // margines mm — 44 mm pola zadruku na 50 mm taśmy
  const W = LABEL_W_MM - 2 * M

  const body = [
    text(M, 3, 7, KIND_TITLE[input.kind] ?? '', dpi),
    line(M, 12.5, W, dpi),

    text(M, 15, 3.2, 'Nr porządkowy', dpi),
    text(M, 19, 11, input.batchNo ?? '', dpi),
    line(M, 32, W, dpi),

    text(M, 34.5, 3.2, 'Waga netto', dpi),
    // 7,5 mm, nie więcej: przy czterocyfrowej wadze („1245,5 kg") większy
    // font nie mieści się w 44 mm pola zadruku i drukarka utnie końcówkę.
    text(M, 38.5, 7.5, `${fmtLabelKg(input.netKg)} kg`, dpi),
    line(M, 50, W, dpi),

    text(M, 52.5, 3.2, 'Data produkcji', dpi),
    text(M, 56.5, 5, fmtLabelDate(input.productionDate), dpi),

    text(M, 64, 3.2, 'Data ważności', dpi),
    text(M, 68, 5, fmtLabelDate(input.expiryDate), dpi),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28', // UTF-8 — polskie znaki (KOŚCI, porządkowy, ważności)
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,   // szerokość TAŚMY — za duża ucina wiersze
    `^LL${mmToDots(LABEL_H_MM, dpi)}`,
    '^LH0,0',                            // zeruj przesunięcie z ustawień drukarki
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
