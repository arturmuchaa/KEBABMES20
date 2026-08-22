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
  /** Partie DOSTAWCY złożone na ten numer porządkowy (z HDI). Jeden numer
   *  porządkowy potrafi zebrać kilka lotów jednego dostawcy. */
  supplierBatchNos?: string[]
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
  /** Kalibracja stanowiska: przesunięcie wydruku w poprzek taśmy (+ w prawo). */
  offsetXMm?: number
  /** Kalibracja stanowiska: przesunięcie wzdłuż taśmy (+ w dół). */
  offsetYMm?: number
  /** Rzeczywisty skok taśmy (etykieta + przerwa). */
  labelLengthMm?: number
  /** false = ustawienia taśmy poszły już preambułą (`printerSetupZpl`). */
  setup?: boolean
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

/** Ile znaków numeru partii dostawcy mieści się w wierszu 3,6 mm na 44 mm. */
const MAX_PARTIE_DOSTAWCY = 19

/**
 * Partie dostawcy w jednym wierszu. Numer porządkowy bywa złożony z kilku
 * lotów jednego dostawcy (sekcja identyfikacji z HDI) i wtedy na zawieszce
 * muszą być WSZYSTKIE — inaczej przy reklamacji nie wiadomo, który lot jechał
 * na tej palecie. Za długą listę ucinamy MY, wielokropkiem: drukarka ucięłaby
 * ją w losowym miejscu i wyglądałoby to na pełny numer.
 */
export function fmtSupplierBatches(numery?: readonly string[]): string {
  const czyste = (numery ?? []).map(n => (n ?? '').trim()).filter(Boolean)
  if (czyste.length === 0) return '—'
  const linia = Array.from(new Set(czyste)).join(' / ')
  if (linia.length <= MAX_PARTIE_DOSTAWCY) return linia
  return `${linia.slice(0, MAX_PARTIE_DOSTAWCY - 1).trimEnd()}…`
}

/** Znaki sterujące ZPL z DANYCH (^ ~) rozbiłyby komendy — wycinamy je. */
function esc(value: string): string {
  return (value ?? '').replace(/[\^~]/g, ' ')
}

/** Rysunek etykiety: rozdzielczość drukarki i przesunięcie kalibracyjne. */
interface Rysunek {
  dpi: number
  /** Przesunięcie w mm doklejane do KAŻDEJ współrzędnej, a nie do `^LH`:
   *  `^LH` nie przyjmuje wartości ujemnych, a kalibracja bywa „w górę". */
  ox: number
  oy: number
}

/** Milimetry na punkty drukarki. Ujemna współrzędna wywala CAŁY format —
 *  drukarka odrzuca etykietę w całości, więc przycinamy do zera. */
function dot(g: Rysunek, mm: number): number {
  return Math.max(0, mmToDots(mm, g.dpi))
}

function text(g: Rysunek, xMm: number, yMm: number, fontMm: number, value: string): string {
  const h = mmToDots(fontMm, g.dpi)
  return `^FO${dot(g, xMm + g.ox)},${dot(g, yMm + g.oy)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

function line(g: Rysunek, xMm: number, yMm: number, wMm: number): string {
  const t = Math.max(1, mmToDots(0.6, g.dpi))
  return `^FO${dot(g, xMm + g.ox)},${dot(g, yMm + g.oy)}^GB${mmToDots(wMm, g.dpi)},${t},${t}^FS`
}

export function receptionTagZpl(
  input: ReceptionTagInput,
  {
    dpi = LABEL_DPI, copies = 1,
    offsetXMm = 0, offsetYMm = 0, labelLengthMm = LABEL_H_MM, setup = true,
  }: ReceptionTagOptions = {},
): string {
  const g: Rysunek = { dpi, ox: offsetXMm, oy: offsetYMm }
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
    text(g, M, 2.2, 2.6, 'Przyjęcie'),
    text(g, M, 5.4, 4.2, input.receptionNo ?? ''),
    text(g, M, 10.3, 3.2, shortenSupplier(input.supplierName)),
    line(g, M, 14.3, W),

    text(g, M, 15.5, 2.6, 'Nr porządkowy'),
    text(g, M, 18.6, 9.8, input.batchNo ?? ''),
    line(g, M, 29.4, W),

    text(g, M, 30.8, 2.6, 'Waga netto palety'),
    text(g, M, 33.9, 6.8, `${fmtLabelKg(input.netKg)} kg`),
    text(g, M, 41.4, 2.8, pojemniki),
    text(g, M, 44.7, 2.6, `z partii ${fmtLabelKg(input.batchKg)} kg`),
    line(g, M, 48.2, W),

    text(g, M, 49.6, 3.8, `PALETA ${input.palletIndex} / ${input.palletCount}`),
    // „NIEPEŁNA" idzie OSOBNYM wierszem, a nie doklejone do numeru palety:
    // w jednym wierszu przy tym foncie tekst wychodził na 64 mm i drukarka
    // ucinałaby go w połowie.
    ...(input.full === false ? [text(g, M, 53.9, 3, 'NIEPEŁNA')] : []),
    line(g, M, 57.6, W),

    // Partia DOSTAWCY nisko, tuż nad datami: numer porządkowy jest nasz i wisi
    // wielkim drukiem u góry, a ten numer służy do rozmowy z dostawcą przy
    // reklamacji (biuro, 22.08.2026).
    text(g, M, 59, 2.6, 'Partia dostawcy'),
    text(g, M, 62.1, 3.6, fmtSupplierBatches(input.supplierBatchNos)),
    line(g, M, 66.8, W),

    text(g, M, 68.4, 2.9, `Ubój      ${fmtLabelDate(input.slaughterDate)}`),
    text(g, M, 71.8, 2.9, `Ważność   ${fmtLabelDate(input.expiryDate)}`),
    text(g, M, 75.2, 2.9, `Przyjęcie ${fmtLabelDate(input.receivedDate)}`),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28',
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,
    // `^LL` i `^MNY` sterują OBSŁUGĄ MEDIÓW i zostają w drukarce na stałe.
    // Powtarzane przy każdej etykiecie potrafią kazać jej przepozycjonować
    // taśmę — stąd „co druga zawieszka krzywo" (biuro, 22.08.2026). Przy druku
    // serii idą RAZ, preambułą `printerSetupZpl`, a tutaj zostaje sam układ.
    ...(setup ? [`^LL${mmToDots(labelLengthMm, dpi)}`] : []),
    '^LH0,0',
    ...(setup ? ['^MNY'] : []),
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
