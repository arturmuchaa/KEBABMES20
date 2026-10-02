/**
 * Zawieszka palety przyjętego surowca — ZPL 80×100 mm.
 *
 * Drukowana w BIURZE zaraz po zarejestrowaniu dostawy, przez ten sam most
 * Zebra BrowserPrint co wydruki z hali. Zawieszkę wiesza się na palecie
 * jadącej do chłodni: bez niej po dwóch dniach nikt nie odróżni, z którego
 * numeru porządkowego jest stos w rogu.
 *
 * Od 02.10.2026 zawieszki mają WŁASNĄ rolkę 80×100 (80 mm w poprzek taśmy,
 * 100 mm wzdłuż) — wcześniej jechały na taśmie hali 50×80 i numer partii
 * dostawcy mieścił się tylko fontem 3 mm. Rozmiar trzymamy tutaj, a nie
 * w `byproductLabelZpl`: hala dalej drukuje na 50×80.
 *
 * Ile zawieszek na numer porządkowy liczy `palletTags`; ten moduł tylko
 * rysuje jedną z nich. Czysta funkcja bez DOM — testowana jednostkowo.
 */
import { LABEL_DPI, fmtLabelDate, fmtLabelKg, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { LOGO_LARGE_DOTS_H, LOGO_LARGE_DOTS_W, labelLogoLargeZpl } from '@/lib/labelLogo'

/** Zawieszka: 80 mm w poprzek taśmy, 100 mm wzdłuż podawania. */
export const TAG_W_MM = 80
export const TAG_H_MM = 100

/** Margines i pole zadruku: 74 mm szerokości na 80 mm taśmy. */
export const TAG_MARGIN_MM = 3
export const TAG_FIELD_W_MM = TAG_W_MM - 2 * TAG_MARGIN_MM

/** Font 0 jest proporcjonalny; 0,6 wysokości na znak to bezpieczna górna
 *  granica dla wielkich liter i cyfr (Zebra Programming Guide). */
const SZEROKOSC_ZNAKU = 0.6

/** Ile znaków wchodzi w wiersz pola zadruku przy danym foncie. */
const znakowWWierszu = (fontMm: number, szerMm: number = TAG_FIELD_W_MM) =>
  Math.floor(szerMm / (fontMm * SZEROKOSC_ZNAKU))

export interface ReceptionTagInput {
  /** Numer dokumentu dostawy („12/08/2026"). */
  receptionNo: string
  supplierName: string
  /** Numer przyjęcia zewnętrznego („471"). */
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

/** Formy prawne, które zjadają pole zadruku, a nic nie mówią operatorowi
 *  w chłodni. Kolejność ma znaczenie: dłuższe wzorce najpierw. */
const FORMY_PRAWNE = [
  // Bez \b na końcu: JS liczy granicę słowa po ASCII, a po „ą" jej nie ma.
  /\bspółka\s+z\s+ograniczoną\s+odpowiedzialnością/gi,
  /\bspółka\s+(akcyjna|jawna|komandytowa)\b/gi,
  /\bsp\.?\s*z\s*o\.?\s*o\.?/gi,
  /\bsp\.?\s*[jk]\.?/gi,
  /\bs\.\s*a\./gi,
]

/** Font nazwy dostawcy. */
const DOSTAWCA_FONT_MM = 4.2

/** Prawa kolumna zawieszki (dostawca, paleta) — jedna linia pionowa od góry
 *  do dołu, żeby układ czytał się jak tabela, a nie rozsypane napisy. */
const KOLUMNA_MM = 46

/** Ile znaków nazwy dostawcy mieści się w prawej kolumnie (31 mm). */
const MAX_DOSTAWCA = znakowWWierszu(DOSTAWCA_FONT_MM, TAG_W_MM - TAG_MARGIN_MM - KOLUMNA_MM)

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

/** Znak firmowy w milimetrach — duży raster pod 203 dpi (`labelLogo`). */
export const LOGO_W_MM = (LOGO_LARGE_DOTS_W * 25.4) / LABEL_DPI
export const LOGO_H_MM = (LOGO_LARGE_DOTS_H * 25.4) / LABEL_DPI

/**
 * Fonty partii dostawcy, od największego. Bierzemy pierwszy, przy którym
 * WSZYSTKIE loty mieszczą się w ramce bez ucinania.
 *
 * Na 50×80 szedł fontem 3 mm i był nie do przeczytania. Pierwsza wersja
 * 80×100 dała mu 11 mm, ale wtedy przykrywał numer przyjęcia zewnętrznego,
 * który jest u nas NAJWAŻNIEJSZY — biuro (02.10.2026): partie mają być
 * mniejsze, „ale nie za małe", żeby magazynier odczytał je przy rozładunku.
 * Stąd sufit 7,5 mm (sześć lotów wciąż ~6 mm). Poniżej 4,5 mm nie schodzimy:
 * nieczytelny numer to żadna informacja — wtedy wielokropek.
 */
export const LOT_FONTS_MM = [7.5, 6.5, 6, 5.5, 5, 4.5] as const
export const LOT_FONT_MAX_MM = LOT_FONTS_MM[0]
export const LOT_FONT_MIN_MM = LOT_FONTS_MM[LOT_FONTS_MM.length - 1]

/** Skok wiersza partii względem fontu — 12% światła, żeby wiersze się nie zlewały. */
const LOT_SKOK = 1.12

/** Ramka partii dostawcy na zawieszce (mm od góry etykiety). */
export const LOTY_GORA_MM = 63.6
export const LOTY_DOL_MM = 85.4

/** Ile wierszy danego fontu wchodzi w ramkę partii. */
export function lotRowsFor(fontMm: number, wysokoscMm: number = LOTY_DOL_MM - LOTY_GORA_MM): number {
  if (fontMm > wysokoscMm) return 0
  return 1 + Math.floor((wysokoscMm - fontMm) / (fontMm * LOT_SKOK) + 1e-9)
}

/** Jedna partia dostawcy złożona na numer przyjęcia zewnętrznego. */
export interface SupplierLotTag {
  readonly no: string
  /** Kilogramy TEGO lotu z sekcji identyfikacji HDI; brak = starsze przyjęcia. */
  readonly kg?: number | null
}

/** Wiersz z sygnałem, że lotów było więcej, niż weszło. */
function zWielokropkiem(linia: string, maxZnakow: number): string {
  const pelny = linia ? `${linia} …` : '…'
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
 *
 * Pakujemy zachłannie: ile wejdzie w wiersz, reszta do następnego. Dopiero
 * gdy zabraknie wierszy, ucinamy — i robimy to MY, wielokropkiem, bo drukarka
 * utnie w losowym miejscu i urwany numer będzie wyglądał na pełny.
 */
export function splitSupplierLots(
  loty?: readonly SupplierLotTag[],
  { maxZnakow = znakowWWierszu(LOT_FONT_MIN_MM), maxWierszy = 2, zKilogramami = false }: {
    maxZnakow?: number; maxWierszy?: number; zKilogramami?: boolean
  } = {},
): string[] {
  const opisy = unikalneOpisy(loty, zKilogramami)
  if (opisy.length === 0) return ['—']

  const wiersze: string[] = ['']
  for (const opis of opisy) {
    const i = wiersze.length - 1
    const kandydat = wiersze[i] ? `${wiersze[i]} / ${opis}` : opis
    if (kandydat.length <= maxZnakow) {
      wiersze[i] = kandydat
      continue
    }
    if (wiersze.length >= maxWierszy || !wiersze[i]) {
      wiersze[i] = zWielokropkiem(wiersze[i], maxZnakow)
      return wiersze
    }
    wiersze.push(opis.length <= maxZnakow ? opis : zWielokropkiem(opis, maxZnakow))
  }
  return wiersze
}

function unikalneOpisy(loty: readonly SupplierLotTag[] | undefined, zKilogramami: boolean): string[] {
  const opisy: string[] = []
  const widziane = new Set<string>()
  for (const lot of loty ?? []) {
    const opis = zKilogramami ? opisLotu(lot) : (lot.no ?? '').trim()
    if (!opis || widziane.has(opis)) continue
    widziane.add(opis)
    opisy.push(opis)
  }
  return opisy
}

/** Partia dostawcy rozpisana na zawieszkę: font i wiersze. */
export interface SupplierLotsLayout {
  fontMm: number
  /** Wiersze; przy partii łączonej `kg` idzie wyrównane do prawej krawędzi. */
  rows: ReadonlyArray<{ readonly no: string; readonly kg?: string }>
  /** true = kilka lotów ze znanymi kilogramami. */
  laczona: boolean
}

/**
 * Dobór fontu i wierszy dla rubryki partii dostawcy.
 *
 * Partia łączona (kilka lotów ze znanymi kilogramami — prośba biura
 * 29.08.2026) idzie TABELKĄ: lot w wierszu, numer z lewej, kilogramy
 * z prawej. Gdy lotów jest tyle, że nawet najmniejszy font nie mieści ich
 * jeden pod drugim, wracamy do pakowania w wiersze z „/" — wszystko widać,
 * tylko ciaśniej.
 */
export function layoutSupplierLots(loty?: readonly SupplierLotTag[]): SupplierLotsLayout {
  const lista = loty ?? []
  const laczona = lista.length > 1 && lista.some(l => Number(l.kg) > 0)

  if (laczona) {
    const tabela: Array<{ no: string; kg: string }> = []
    const widziane = new Set<string>()
    for (const lot of lista) {
      const no = (lot.no ?? '').trim()
      const kg = Number(lot.kg)
      const klucz = `${no}|${kg}`
      if (!no || widziane.has(klucz)) continue
      widziane.add(klucz)
      tabela.push({ no, kg: Number.isFinite(kg) && kg > 0 ? `${fmtLabelKg(kg)} kg` : '' })
    }
    for (const fontMm of LOT_FONTS_MM) {
      // Numer i kilogramy w jednym wierszu z odstępem dwóch znaków między nimi.
      const miesciSie = tabela.length <= lotRowsFor(fontMm)
        && tabela.every(r => r.no.length + r.kg.length + 2 <= znakowWWierszu(fontMm))
      if (miesciSie) return { fontMm, rows: tabela, laczona }
    }
  }

  for (const fontMm of LOT_FONTS_MM) {
    const wiersze = splitSupplierLots(lista, {
      maxZnakow: znakowWWierszu(fontMm), maxWierszy: lotRowsFor(fontMm), zKilogramami: laczona,
    })
    if (!wiersze.some(w => w.includes('…'))) {
      return { fontMm, rows: wiersze.map(no => ({ no })), laczona }
    }
  }
  // Z kilogramami nie weszło — oddajemy kilogramy, nie numery: lot jest tym,
  // o co pyta dostawca, a wagę każdego lotu ma przyjęcie w systemie.
  if (laczona) {
    for (const fontMm of LOT_FONTS_MM) {
      const wiersze = splitSupplierLots(lista, {
        maxZnakow: znakowWWierszu(fontMm), maxWierszy: lotRowsFor(fontMm),
      })
      if (!wiersze.some(w => w.includes('…'))) {
        return { fontMm, rows: wiersze.map(no => ({ no })), laczona: false }
      }
    }
  }
  const wiersze = splitSupplierLots(lista, {
    maxZnakow: znakowWWierszu(LOT_FONT_MIN_MM),
    maxWierszy: lotRowsFor(LOT_FONT_MIN_MM),
  })
  return { fontMm: LOT_FONT_MIN_MM, rows: wiersze.map(no => ({ no })), laczona: false }
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

/** Współrzędna z przesunięciem kalibracyjnym. Ujemna wywala CAŁY format —
 *  drukarka odrzuca etykietę w całości, więc przycinamy do zera.
 *  Przesunięcie przeliczamy na
 *  punkty OSOBNO: `mmToDots(y + off)` zaokrągla sumę i ten sam 1 mm dawał
 *  jednym polom 8 punktów, a innym 7 — układ rozjeżdżał się o punkt. */
function px(g: Rysunek, mm: number): number {
  return Math.max(0, mmToDots(mm, g.dpi) + mmToDots(g.ox, g.dpi))
}
function py(g: Rysunek, mm: number): number {
  return Math.max(0, mmToDots(mm, g.dpi) + mmToDots(g.oy, g.dpi))
}

function text(g: Rysunek, xMm: number, yMm: number, fontMm: number, value: string): string {
  const h = mmToDots(fontMm, g.dpi)
  return `^FO${px(g, xMm)},${py(g, yMm)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

/** Tekst wyrównany do PRAWEJ krawędzi bloku — bez liczenia szerokości znaków. */
function textRight(g: Rysunek, xMm: number, yMm: number, wMm: number, fontMm: number, value: string): string {
  const h = mmToDots(fontMm, g.dpi)
  return `^FO${px(g, xMm)},${py(g, yMm)}^A0N,${h},${h}`
    + `^FB${mmToDots(wMm, g.dpi)},1,0,R^FD${esc(value)}^FS`
}

function line(g: Rysunek, xMm: number, yMm: number, wMm: number): string {
  const t = Math.max(1, mmToDots(0.6, g.dpi))
  return `^FO${px(g, xMm)},${py(g, yMm)}^GB${mmToDots(wMm, g.dpi)},${t},${t}^FS`
}

export function receptionTagZpl(
  input: ReceptionTagInput,
  {
    dpi = LABEL_DPI, copies = 1,
    offsetXMm = 0, offsetYMm = 0, labelLengthMm = TAG_H_MM,
  }: ReceptionTagOptions = {},
): string {
  const g: Rysunek = { dpi, ox: offsetXMm, oy: offsetYMm }
  const M = TAG_MARGIN_MM
  const W = TAG_FIELD_W_MM
  const P = KOLUMNA_MM

  // Kaliber tylko wtedy, gdy jest: „199 poj. x  kg" wyglądałoby jak błąd wagi.
  const pojemniki = input.containerKg
    ? `${input.containers} poj. x ${fmtLabelKg(input.containerKg)} kg`
    : `${input.containers} poj.`

  // UWAGA: układ jest policzony pod NAJDŁUŻSZE dane, jakie mogą przyjść z
  // przyjęcia (nazwa dostawcy przycięta przez `shortenSupplier`, czterocyfrowy
  // numer przyjęcia, waga „1245,5 kg", paleta „12 / 12"). Drukarka nie zawija
  // tekstu — wiersz szerszy niż pole zadruku po prostu znika na taśmie. Każda
  // zmiana fontu albo treści musi przejść testy szerokości
  // w `receptionTagZpl.test.ts`.
  const loty = layoutSupplierLots(input.supplierLots)
  const lotSkok = loty.fontMm * LOT_SKOK
  const lotyWysokosc = (loty.rows.length - 1) * lotSkok + loty.fontMm
  // Wiersze lotów wyśrodkowane w ramce: jeden numer nie wisi pod nagłówkiem
  // z pustką do samych dat.
  const lotyY = LOTY_GORA_MM + Math.max(0, (LOTY_DOL_MM - LOTY_GORA_MM - lotyWysokosc) / 2)

  const body = [
    // Znak firmowy w nagłówku z lewej, obok numer dokumentu dostawy. Wcześniej
    // 16 mm w rogu wyglądał jak doklejony; teraz to 36 mm i stoi na równi
    // z numerem przyjęcia.
    // Znak firmowy na górze, pod nim dane dostawy w dwóch kolumnach:
    // numer dokumentu z lewej, dostawca z prawej (biuro, 02.10.2026).
    labelLogoLargeZpl(px(g, M), py(g, 3)),
    text(g, M, 12.2, 2.8, 'Przyjęcie'),
    text(g, M, 15.2, 5, input.receptionNo ?? ''),
    text(g, P, 12.2, 2.8, 'Dostawca'),
    text(g, P, 15.6, DOSTAWCA_FONT_MM, shortenSupplier(input.supplierName)),
    line(g, M, 21.4, W),

    // Numer przyjęcia zewnętrznego — NAJWAŻNIEJSZY napis zawieszki (biuro,
    // 02.10.2026). Sam w swojej sekcji, między kreskami, od lewej krawędzi
    // jak reszta i wyraźnie większy od wszystkiego innego.
    // Zwykłym czarnym drukiem: biały na czarnym pasie odrzucony, bo na Zebrze
    // duża zaczerniona plama potrafi wyjść nieczytelnie.
    text(g, M, 22.6, 2.8, 'Nr przyjęcia zewnętrznego'),
    text(g, M, 25.8, 13, input.batchNo ?? ''),
    line(g, M, 40.2, W),

    text(g, M, 41.4, 2.8, 'Waga netto palety'),
    text(g, M, 44.4, 7, `${fmtLabelKg(input.netKg)} kg`),
    text(g, M, 52.2, 2.8, pojemniki),
    text(g, M, 55.6, 2.8, `z partii ${fmtLabelKg(input.batchKg)} kg`),
    text(g, P, 41.4, 2.8, 'Paleta'),
    text(g, P, 44.4, 7, `${input.palletIndex} / ${input.palletCount}`),
    // „NIEPEŁNA" osobnym wierszem pod numerem palety — doklejona do numeru
    // rozpychałaby wiersz poza pole zadruku.
    ...(input.full === false ? [text(g, P, 52.4, 4.2, 'NIEPEŁNA')] : []),
    line(g, M, 59.4, W),

    text(g, M, 60.6, 2.8, loty.rows.length > 1 || loty.laczona ? 'Partie dostawcy' : 'Partia dostawcy'),
    ...loty.rows.flatMap((r, i) => {
      const y = lotyY + i * lotSkok
      return r.kg
        ? [text(g, M, y, loty.fontMm, r.no), textRight(g, M, y, W, loty.fontMm, r.kg)]
        : [text(g, M, y, loty.fontMm, r.no)]
    }),
    line(g, M, 86.6, W),

    // Daty w trzech kolumnach po 25 mm — „04.08.2026" fontem 4 mm ma 24 mm.
    text(g, M, 87.8, 2.8, 'Ubój'),
    text(g, M + 25, 87.8, 2.8, 'Ważność'),
    text(g, M + 50, 87.8, 2.8, 'Przyjęcie'),
    text(g, M, 91.2, 4, fmtLabelDate(input.slaughterDate)),
    text(g, M + 25, 91.2, 4, fmtLabelDate(input.expiryDate)),
    text(g, M + 50, 91.2, 4, fmtLabelDate(input.receivedDate)),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28',
    `^PW${mmToDots(TAG_W_MM, dpi)}`,
    // `^LL` i `^MNY` MUSZĄ być w KAŻDEJ etykiecie.
    //
    // 22.08.2026 wyniosłem je stąd do preambuły wysyłanej raz na serię, licząc,
    // że to one gubią rejestrację. Zebra GC420t (G-series) tego nie wybacza:
    // bez `^LL` w formacie bierze DŁUGOŚĆ ZAPISANĄ U SIEBIE i kończy wydruk
    // tam, gdzie ona się kończy — biuro dostało etykiety urwane w 3/4.
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
 * `^PQ` nie wchodzi w grę: każda zawieszka ma inny numer palety i inną wagę.
 */
export function receptionTagsStreamZpl(
  tags: readonly ReceptionTagInput[],
  options: ReceptionTagOptions = {},
): string {
  return tags.map(tag => receptionTagZpl(tag, options)).join('\n')
}
