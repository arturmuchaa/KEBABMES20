/**
 * Zawieszka palety przyjętego surowca — ZPL 50×80 mm.
 *
 * Drukowana w BIURZE zaraz po zarejestrowaniu dostawy, na tej samej taśmie i
 * przez ten sam most Zebra BrowserPrint co wydruki z hali. Zawieszkę wiesza
 * się na palecie jadącej do chłodni: bez niej po dwóch dniach nikt nie
 * odróżni, z którego numeru porządkowego jest stos w rogu.
 *
 * Rozmiar i pułapki taśmy bierzemy z `byproductLabelZpl` — JEDNO źródło:
 * 50 mm w poprzek, 80 mm wzdłuż, `^MNY` dla etykiet wykrawanych, `^LH0,0`
 * kasujące przesunięcie zapisane w drukarce.
 *
 * Ile zawieszek na numer porządkowy liczy `palletTags`; ten moduł tylko
 * rysuje jedną z nich. Czysta funkcja bez DOM — testowana jednostkowo.
 */
import {
  LABEL_DPI, LABEL_H_MM, LABEL_W_MM, fmtLabelDate, fmtLabelKg, mmToDots,
} from '@/features/deboning/byproductLabelZpl'

export interface ReceptionTagInput {
  /** Numer dokumentu dostawy („12/08/2026"). */
  receptionNo: string
  supplierName: string
  /** Numer porządkowy partii („471") — największy napis na zawieszce. */
  batchNo: string
  /** Waga netto TEJ palety. */
  netKg: number
  containers: number
  /** Kaliber pojemnika w kg; null/brak = surowiec niekalibrowany. */
  containerKg?: number | null
  palletIndex: number
  palletCount: number
  /** Waga netto całego numeru porządkowego — kontekst dla palety. */
  batchKg: number
  /** ISO (yyyy-mm-dd). */
  slaughterDate: string
  expiryDate: string
  receivedDate: string
  /** false = paleta niepełna (reszta stosu); domyślnie pełna. */
  full?: boolean
}

export interface ReceptionTagOptions {
  dpi?: number
  copies?: number
}

/** Formy prawne, które na 44 mm pola zadruku zjadają nazwę, a nic nie mówią
 *  operatorowi w chłodni. Kolejność ma znaczenie: dłuższe wzorce najpierw. */
const FORMY_PRAWNE = [
  // Bez \b na końcu: JS liczy granicę słowa po ASCII, a po „ą" jej nie ma.
  /\bspółka\s+z\s+ograniczoną\s+odpowiedzialnością/gi,
  /\bspółka\s+(akcyjna|jawna|komandytowa)\b/gi,
  /\bsp\.?\s*z\s*o\.?\s*o\.?/gi,
  /\bsp\.?\s*[jk]\.?/gi,
  /\bs\.\s*a\./gi,
]

/** Ile znaków nazwy dostawcy mieści się w wierszu 3,5 mm na 44 mm zadruku
 *  (font 0 jest proporcjonalny, ~0,6 wysokości na wielką literę). */
const MAX_DOSTAWCA = 20

/** Nazwa dostawcy przycięta do szerokości taśmy.
 *  Przycinamy MY, a nie drukarka: ona ucina w losowym miejscu, bez śladu. */
export function shortenSupplier(name: string): string {
  let out = (name ?? '')
  for (const wzorzec of FORMY_PRAWNE) out = out.replace(wzorzec, ' ')
  out = out.replace(/\s+/g, ' ').replace(/[\s,–-]+$/, '').trim()
  if (out.length <= MAX_DOSTAWCA) return out
  const ciete = out.slice(0, MAX_DOSTAWCA)
  // Wolimy urwać na granicy słowa, ale nie kosztem połowy nazwy.
  const spacja = ciete.lastIndexOf(' ')
  return (spacja > MAX_DOSTAWCA / 2 ? ciete.slice(0, spacja) : ciete).trim()
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

export function receptionTagZpl(
  input: ReceptionTagInput,
  { dpi = LABEL_DPI, copies = 1 }: ReceptionTagOptions = {},
): string {
  const M = 3 // margines mm — 44 mm pola zadruku na 50 mm taśmy
  const W = LABEL_W_MM - 2 * M

  // Kaliber tylko wtedy, gdy jest: „199 poj. x  kg" wyglądałoby jak błąd wagi.
  const pojemniki = input.containerKg
    ? `${input.containers} poj. x ${fmtLabelKg(input.containerKg)} kg`
    : `${input.containers} poj.`

  // UWAGA: układ jest policzony pod NAJDŁUŻSZE dane, jakie mogą przyjść z
  // przyjęcia (nazwa dostawcy 20 znaków, czterocyfrowy numer porządkowy,
  // waga „1245,5 kg", paleta „12 / 12"). Drukarka nie zawija tekstu — wiersz
  // szerszy niż 44 mm po prostu znika na taśmie. Każda zmiana fontu albo
  // treści musi przejść testy szerokości w `receptionTagZpl.test.ts`.
  const body = [
    text(M, 2.5, 3, 'Przyjęcie', dpi),
    text(M, 5.8, 4.6, input.receptionNo ?? '', dpi),
    text(M, 11, 3.5, shortenSupplier(input.supplierName), dpi),
    line(M, 15.8, W, dpi),

    text(M, 17.3, 3, 'Nr porządkowy', dpi),
    text(M, 20.8, 10.5, input.batchNo ?? '', dpi),
    line(M, 32.8, W, dpi),

    text(M, 34.3, 3, 'Waga netto palety', dpi),
    text(M, 37.8, 7.5, `${fmtLabelKg(input.netKg)} kg`, dpi),
    text(M, 46, 3, pojemniki, dpi),
    text(M, 49.8, 2.8, `z partii ${fmtLabelKg(input.batchKg)} kg`, dpi),
    line(M, 54, W, dpi),

    text(M, 55.5, 4.2, `PALETA ${input.palletIndex} / ${input.palletCount}`, dpi),
    // „NIEPEŁNA" idzie OSOBNYM wierszem, a nie doklejone do numeru palety:
    // w jednym wierszu przy tym foncie tekst wychodził na 64 mm i drukarka
    // ucinałaby go w połowie.
    ...(input.full === false ? [text(M, 60.3, 3.4, 'NIEPEŁNA', dpi)] : []),
    line(M, 65, W, dpi),

    text(M, 66.5, 3, `Ubój      ${fmtLabelDate(input.slaughterDate)}`, dpi),
    text(M, 70, 3, `Ważność   ${fmtLabelDate(input.expiryDate)}`, dpi),
    text(M, 73.5, 3, `Przyjęcie ${fmtLabelDate(input.receivedDate)}`, dpi),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28',
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,
    `^LL${mmToDots(LABEL_H_MM, dpi)}`,
    '^LH0,0',
    '^MNY',
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
