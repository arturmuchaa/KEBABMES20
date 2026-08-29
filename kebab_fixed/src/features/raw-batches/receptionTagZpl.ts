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
import { LOGO_DOTS_H, LOGO_DOTS_W, labelLogoZpl } from '@/lib/labelLogo'

export interface ReceptionTagInput {
  /** Numer dokumentu dostawy („12/08/2026"). */
  receptionNo: string
  supplierName: string
  /** Numer przyjęcia zewnętrznego („471") — największy napis na zawieszce. */
  batchNo: string
  /** Waga netto TEJ palety. */
  netKg: number
  containers: number
  /** Kaliber pojemnika w kg; null/brak = surowiec niekalibrowany. */
  containerKg?: number | null
  palletIndex: number
  palletCount: number
  /** Waga netto całego numeru przyjęcia zewnętrznego — kontekst dla palety. */
  batchKg: number
  /** Partie DOSTAWCY złożone na ten numer przyjęcia zewnętrznego (z HDI).
   *  Jeden numer potrafi zebrać kilka lotów jednego dostawcy — wtedy zawieszka
   *  pokazuje przy każdym jego kilogramy. */
  supplierLots?: readonly SupplierLotTag[]
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

/** Znak firmowy w milimetrach — raster jest robiony pod 203 dpi (`labelLogo`). */
export const LOGO_W_MM = (LOGO_DOTS_W * 25.4) / LABEL_DPI
export const LOGO_H_MM = (LOGO_DOTS_H * 25.4) / LABEL_DPI

/** Wysokość wiersza partii dostawcy. Mniejsza niż reszta, bo lotów bywa
 *  sześć — czytelność jednego numeru przegrywa z pokazaniem wszystkich. */
export const LOT_FONT_MM = 3

/** PARTIA ŁĄCZONA (kilka lotów dostawcy na jednym numerze przyjęcia
 *  zewnętrznego): przy każdym numerze idą jeszcze kilogramy, więc wiersz
 *  robi się o połowę dłuższy. Font schodzi o oczko i dokładamy trzeci
 *  wiersz — inaczej przy czterech lotach (a tyle mają dostawy KOKO)
 *  zawieszka urywałaby się wielokropkiem po drugim numerze.
 *  Prośba biura 29.08.2026. */
export const LOT_FONT_LACZONA_MM = 2.4

/** Ile znaków wchodzi w wiersz na 44 mm pola zadruku (font 0 jest
 *  proporcjonalny, ~0,6 wysokości na znak). */
const znakowWWierszu = (fontMm: number) => Math.floor(44 / (fontMm * 0.6))
const MAX_ZNAKOW_LOTU = znakowWWierszu(LOT_FONT_MM)

/** Ile wierszy zawieszka oddaje partiom dostawcy. Dwa = sześć krótkich lotów. */
export const WIERSZE_LOTOW = 2

/** Partia łączona dostaje trzeci wiersz — mieści się w tej samej ramce, bo
 *  font jest mniejszy. */
export const WIERSZE_LOTOW_LACZONA = 3

/** Jedna partia dostawcy złożona na numer przyjęcia zewnętrznego. */
export interface SupplierLotTag {
  readonly no: string
  /** Kilogramy TEGO lotu z sekcji identyfikacji HDI; brak = starsze przyjęcia. */
  readonly kg?: number | null
}

/** Wiersz z sygnałem, że lotów było więcej, niż weszło. */
function zWielokropkiem(linia: string, maxZnakow: number): string {
  const pelny = `${linia} …`
  if (pelny.length <= maxZnakow) return pelny
  return `${linia.slice(0, maxZnakow - 2).trimEnd()} …`
}

/** „112906 450 kg" albo sam numer, gdy przyjęcie nie zna wagi lotu. */
export function opisLotu(lot: SupplierLotTag): string {
  const no = (lot.no ?? '').trim()
  const kg = Number(lot.kg)
  if (!no) return ''
  return Number.isFinite(kg) && kg > 0 ? `${no} ${fmtLabelKg(kg)} kg` : no
}

/**
 * Partie dostawcy rozłożone na wiersze zawieszki.
 *
 * Numer przyjęcia zewnętrznego bywa złożony z kilku lotów jednego dostawcy
 * (sekcja identyfikacji z HDI) i wtedy na zawieszce muszą być WSZYSTKIE —
 * inaczej przy reklamacji nie wiadomo, który lot jechał na tej palecie.
 * Przy partii łączonej dokładamy do każdego numeru jego kilogramy: paleta
 * pokazuje wagę własną i wagę całego numeru, ale bez rozbicia nie widać,
 * ile przyszło z którego lotu (prośba biura 29.08.2026).
 *
 * Pakujemy zachłannie: ile wejdzie w wiersz, reszta do następnego. Dopiero
 * gdy zabraknie wierszy, ucinamy — i robimy to MY, wielokropkiem, bo drukarka
 * utnie w losowym miejscu i urwany numer będzie wyglądał na pełny.
 */
export function splitSupplierLots(
  loty?: readonly SupplierLotTag[],
  { maxZnakow = MAX_ZNAKOW_LOTU, maxWierszy = WIERSZE_LOTOW, zKilogramami = false }: {
    maxZnakow?: number; maxWierszy?: number; zKilogramami?: boolean
  } = {},
): string[] {
  const opisy: string[] = []
  const widziane = new Set<string>()
  for (const lot of loty ?? []) {
    // Kilogramy tylko przy partii łączonej: przy jednym locie waga numeru
    // stoi już wyżej („z partii 3 000 kg") i drugi raz nic nie wnosi.
    const opis = zKilogramami ? opisLotu(lot) : (lot.no ?? '').trim()
    if (!opis || widziane.has(opis)) continue
    widziane.add(opis)
    opisy.push(opis)
  }
  if (opisy.length === 0) return ['—']

  const wiersze: string[] = ['']
  for (const opis of opisy) {
    const i = wiersze.length - 1
    const kandydat = wiersze[i] ? `${wiersze[i]} / ${opis}` : opis
    if (kandydat.length <= maxZnakow) {
      wiersze[i] = kandydat
      continue
    }
    if (wiersze.length >= maxWierszy) {
      wiersze[i] = zWielokropkiem(wiersze[i], maxZnakow)
      return wiersze
    }
    wiersze.push(opis.length <= maxZnakow ? opis : zWielokropkiem(opis, maxZnakow))
  }
  return wiersze
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
    offsetXMm = 0, offsetYMm = 0, labelLengthMm = LABEL_H_MM,
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
  // przyjęcia (nazwa dostawcy 20 znaków, czterocyfrowy numer przyjęcia,
  // waga „1245,5 kg", paleta „12 / 12"). Drukarka nie zawija tekstu — wiersz
  // szerszy niż 44 mm po prostu znika na taśmie. Każda zmiana fontu albo
  // treści musi przejść testy szerokości w `receptionTagZpl.test.ts`.
  // Partia łączona = kilka lotów dostawcy na jednym numerze przyjęcia
  // zewnętrznego. Wtedy przy każdym numerze idą kilogramy, font schodzi
  // o oczko i mamy trzy wiersze zamiast dwóch — cała sekcja zostaje w tej
  // samej ramce, bo mniejszy font oddaje wysokość, którą zabiera wiersz.
  // Łączona TYLKO wtedy, gdy jest co pokazać: kilka lotów i znane kilogramy.
  // Starsze przyjęcia mają same numery — te drukujemy jak dotąd, większym
  // fontem w dwóch wierszach.
  const laczona = (input.supplierLots ?? []).length > 1
    && (input.supplierLots ?? []).some(l => Number(l.kg) > 0)
  const lotFont = laczona ? LOT_FONT_LACZONA_MM : LOT_FONT_MM
  const lotSkok = laczona ? 2.85 : 3.4
  const loty = splitSupplierLots(input.supplierLots, {
    maxZnakow: znakowWWierszu(lotFont),
    maxWierszy: laczona ? WIERSZE_LOTOW_LACZONA : WIERSZE_LOTOW,
    zKilogramami: laczona,
  })
  const lotyY = laczona ? 59.7 : 60.7
  const lotyKoniec = lotyY + loty.length * lotSkok

  // Znak firmowy w prawym górnym rogu: jedyne wolne miejsce na zawieszce,
  // które nie zabiera wiersza treści. Wisi na wysokości nagłówka „Przyjęcie",
  // obok numeru dokumentu, a nie nad nim — pionu tu nie ma ani milimetra.
  // Wyrównanie do prawej liczone w PUNKTACH, nie w milimetrach: raster ma
  // stałą szerokość w punktach, więc przeliczanie przez mm zostawiało go
  // ułamek milimetra poza polem zadruku.
  const logoX = Math.max(0, mmToDots(LABEL_W_MM - M, dpi) - LOGO_DOTS_W + mmToDots(g.ox, dpi))

  const body = [
    labelLogoZpl(logoX, dot(g, 2 + g.oy)),

    text(g, M, 2.2, 2.6, 'Przyjęcie'),
    text(g, M, 5.4, 4, input.receptionNo ?? ''),
    text(g, M, 10.3, 3.2, shortenSupplier(input.supplierName)),
    line(g, M, 14.3, W),

    text(g, M, 15.5, 2.6, 'Nr przyjęcia zewnętrznego'),
    text(g, M, 18.6, 9.2, input.batchNo ?? ''),
    line(g, M, 28.8, W),

    text(g, M, 30.2, 2.6, 'Waga netto palety'),
    text(g, M, 33.3, 6.4, `${fmtLabelKg(input.netKg)} kg`),
    text(g, M, 40.4, 2.8, pojemniki),
    text(g, M, 43.7, 2.6, `z partii ${fmtLabelKg(input.batchKg)} kg`),
    line(g, M, 47.2, W),

    text(g, M, 48.6, 3.6, `PALETA ${input.palletIndex} / ${input.palletCount}`),
    // „NIEPEŁNA" idzie OSOBNYM wierszem, a nie doklejone do numeru palety:
    // w jednym wierszu przy tym foncie tekst wychodził na 64 mm i drukarka
    // ucinałaby go w połowie.
    ...(input.full === false ? [text(g, M, 52.6, 2.8, 'NIEPEŁNA')] : []),
    line(g, M, 56.2, W),

    // Partia DOSTAWCY nisko, tuż nad datami: numer porządkowy jest nasz i wisi
    // wielkim drukiem u góry, a ten numer służy do rozmowy z dostawcą przy
    // reklamacji (biuro, 22.08.2026). DWA wiersze mniejszym fontem — jeden lot
    // czyta się gorzej, ale sześć lotów mieści się w całości zamiast urywać się
    // wielokropkiem po dwóch.
    text(g, M, laczona ? 56.9 : 57.6, 2.6,
      laczona ? 'Partie dostawcy (kg)' : 'Partia dostawcy'),
    ...loty.map((linia, i) => text(g, M, lotyY + i * lotSkok, lotFont, linia)),
    line(g, M, Math.max(67.8, lotyKoniec + 0.2), W),

    text(g, M, 69.2, 2.8, `Ubój      ${fmtLabelDate(input.slaughterDate)}`),
    text(g, M, 72.6, 2.8, `Ważność   ${fmtLabelDate(input.expiryDate)}`),
    text(g, M, 76, 2.8, `Przyjęcie ${fmtLabelDate(input.receivedDate)}`),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28',
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,
    // `^LL` i `^MNY` MUSZĄ być w KAŻDEJ etykiecie.
    //
    // 22.08.2026 wyniosłem je stąd do preambuły wysyłanej raz na serię, licząc,
    // że to one gubią rejestrację. Zebra GC420t (G-series) tego nie wybacza:
    // bez `^LL` w formacie bierze DŁUGOŚĆ ZAPISANĄ U SIEBIE i kończy wydruk
    // tam, gdzie ona się kończy — biuro dostało etykiety urwane w 3/4. Wcześniej
    // działało właśnie dlatego, że każda etykieta narzucała 639 punktów na nowo.
    // Rejestrację naprawia kalibracja `~JC` z panelu, a nie odchudzanie formatu.
    `^LL${mmToDots(labelLengthMm, dpi)}`,
    '^LH0,0',
    '^MNY',
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}

/**
 * Cała seria zawieszek JEDNYM strumieniem.
 *
 * Wysyłanie etykieta-po-etykiecie to tyle osobnych zadań, ile zawieszek: między
 * nimi drukarka zdąży dojechać do punktu odrywania i cofnąć taśmę, a GC420t
 * lubi przy tym zgubić rejestrację. Jeden strumień formatów (`^XA…^XZ^XA…^XZ`)
 * drukarka przerabia bez przerw — to jest ten „druk wszystkiego na raz".
 *
 * `^PQ` nie wchodzi w grę: każda zawieszka ma inny numer palety i inną wagę.
 */
export function receptionTagsStreamZpl(
  tags: readonly ReceptionTagInput[],
  options: ReceptionTagOptions = {},
): string {
  return tags.map(tag => receptionTagZpl(tag, options)).join('\n')
}
