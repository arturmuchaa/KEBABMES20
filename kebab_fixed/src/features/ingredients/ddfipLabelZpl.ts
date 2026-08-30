/**
 * Etykieta przyjęcia DDFiP — ZPL 100×150 mm, NAKLEJANA na paletę.
 *
 * Inna taśma niż zawieszki surowca (50×80 mm): tamte wiesza się na palecie
 * w chłodni, te przykleja się na paletę z przyprawami i opakowaniami stojącą
 * w magazynie nr 28. Rozmiar podał właściciel 30.08.2026.
 *
 * Jedna etykieta = JEDNA POZYCJA dostawy (jeden lot magazynu przypraw), bo
 * jedno auto potrafi przywieźć przyprawę, folię i osłonkę naraz, a każda z
 * nich stoi potem gdzie indziej.
 *
 * Etykieta powstaje TYLKO dla dostawy przyjętej (ocena K). Odmowa nie tworzy
 * lotu magazynu, więc nie ma czego oklejać.
 *
 * Instrukcja 1.3 oPRP wymienia „brak identyfikowalności partii" jako jedno
 * z zagrożeń, przed którymi to przyjęcie ma chronić — dlatego numer partii
 * DOSTAWCY i termin przydatności są na etykiecie obowiązkowo, a termin dostał
 * największy font po numerze dokumentu: po nim jedzie FEFO w naważaniu.
 *
 * Czysta funkcja bez DOM — testowana jednostkowo.
 */
import { LABEL_DPI, fmtLabelDate, fmtLabelKg, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { LOGO_DOTS_W, labelLogoZpl } from '@/lib/labelLogo'

export const DDFIP_LABEL_W_MM = 100
export const DDFIP_LABEL_H_MM = 150

/** Margines taśmy. Zebra gubi pierwszy milimetr przy krawędzi. */
const M = 4
export const DDFIP_PRINT_W_MM = DDFIP_LABEL_W_MM - 2 * M

/** Ile znaków wchodzi w wiersz danego fontu (font 0 jest proporcjonalny,
 *  ~0,6 wysokości na znak — ta sama stała co na zawieszkach). */
export function znakowWWierszu(fontMm: number): number {
  return Math.floor(DDFIP_PRINT_W_MM / (fontMm * 0.6))
}

/**
 * Tekst rozłożony na wiersze o zadanej szerokości.
 *
 * Drukarka NIE zawija: wiersz szerszy niż taśma po prostu znika. Przycinamy
 * więc sami i zostawiamy wielokropek — inaczej urwana nazwa wygląda na pełną.
 */
export function zawinTekst(tekst: string, maxZnakow: number, maxWierszy: number): string[] {
  const slowa = (tekst ?? '').trim().split(/\s+/).filter(Boolean)
  if (slowa.length === 0) return []

  const wiersze: string[] = []
  for (const slowo of slowa) {
    const i = wiersze.length - 1
    const kandydat = i >= 0 ? `${wiersze[i]} ${slowo}` : slowo
    if (i >= 0 && kandydat.length <= maxZnakow) {
      wiersze[i] = kandydat
      continue
    }
    if (wiersze.length >= maxWierszy) {
      // Zabrakło miejsca — ostatni wiersz dostaje wielokropek.
      wiersze[i] = `${wiersze[i].slice(0, Math.max(0, maxZnakow - 2)).trimEnd()} …`
      return wiersze
    }
    wiersze.push(slowo.length <= maxZnakow ? slowo : `${slowo.slice(0, maxZnakow - 1)}…`)
  }
  return wiersze
}

export interface DdfipLabelInput {
  /** Numer dokumentu dostawy („DF/1/08"). */
  receptionNo:    string
  ingredientName: string
  qty:            number
  unit:           string
  /** Numer partii DOSTAWCY z opakowania. */
  batchNo:        string
  /** ISO (yyyy-mm-dd); puste = towar bez terminu (sól, folia). */
  expiryDate:     string
  supplierName:   string
  /** Faktura albo atest — kolumna (e) karty 1.3.1. */
  documentNo:     string
  receivedDate:   string
}

export interface DdfipLabelOptions {
  dpi?:           number
  copies?:        number
  offsetXMm?:     number
  offsetYMm?:     number
  labelLengthMm?: number
}

/** Znaki sterujące ZPL z DANYCH (^ ~) rozbiłyby komendy — wycinamy je. */
function esc(value: string): string {
  return (value ?? '').replace(/[\^~]/g, ' ')
}

interface Rysunek { dpi: number; ox: number; oy: number }

/** Ujemna współrzędna wywala CAŁY format — przycinamy do zera. */
function dot(g: Rysunek, mm: number): number {
  return Math.max(0, mmToDots(mm, g.dpi))
}

function text(g: Rysunek, xMm: number, yMm: number, fontMm: number, value: string): string {
  const h = mmToDots(fontMm, g.dpi)
  return `^FO${dot(g, xMm + g.ox)},${dot(g, yMm + g.oy)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

function line(g: Rysunek, yMm: number): string {
  const t = Math.max(1, mmToDots(0.6, g.dpi))
  return `^FO${dot(g, M + g.ox)},${dot(g, yMm + g.oy)}^GB${mmToDots(DDFIP_PRINT_W_MM, g.dpi)},${t},${t}^FS`
}

/** Podpis sekcji — mały, szary w druku tylko przez rozmiar. */
const PODPIS_MM = 3.2

export function ddfipLabelZpl(
  input: DdfipLabelInput,
  {
    dpi = LABEL_DPI, copies = 1,
    offsetXMm = 0, offsetYMm = 0, labelLengthMm = DDFIP_LABEL_H_MM,
  }: DdfipLabelOptions = {},
): string {
  const g: Rysunek = { dpi, ox: offsetXMm, oy: offsetYMm }

  // Nazwa składnika: dwa wiersze po 7 mm. Najdłuższe realne nazwy w kartotece
  // („Mieszanka przyprawowa KEBAB MIX 95/5") nie mieszczą się w jednym.
  const NAZWA_MM = 7
  const nazwa = zawinTekst(input.ingredientName, znakowWWierszu(NAZWA_MM), 2)

  // Dostawca i dokument jednym wierszem każdy — pełna nazwa z KRS bywa dłuższa
  // niż taśma, więc tniemy zamiast pozwolić drukarce zgubić koniec.
  const DOSTAWCA_MM = 4.5
  const [dostawca = ''] = zawinTekst(input.supplierName, znakowWWierszu(DOSTAWCA_MM), 1)
  const DOKUMENT_MM = 4
  const [dokument = ''] = zawinTekst(input.documentNo, znakowWWierszu(DOKUMENT_MM), 1)
  const PARTIA_MM = 6
  const [partia = '—'] = zawinTekst(input.batchNo || '—', znakowWWierszu(PARTIA_MM), 1)

  // Sól, folia i kartony terminu nie mają. Pusta kratka na palecie wygląda
  // jak zapomniany wpis, więc mówimy wprost, że terminu nie ma.
  const termin = input.expiryDate ? fmtLabelDate(input.expiryDate) : 'bez terminu'
  const TERMIN_MM = input.expiryDate ? 9 : 6

  // Znak firmowy w prawym górnym rogu — jedyne miejsce, które nie zabiera
  // wiersza treści. Wyrównanie liczone w PUNKTACH: raster ma stałą szerokość.
  const logoX = Math.max(0, mmToDots(DDFIP_LABEL_W_MM - M, dpi) - LOGO_DOTS_W + mmToDots(g.ox, dpi))

  const body = [
    labelLogoZpl(logoX, dot(g, 3 + g.oy)),

    text(g, M, 4, PODPIS_MM, 'Przyjęcie DDFiP'),
    text(g, M, 8.5, 11, input.receptionNo || '—'),
    line(g, 21.5),

    text(g, M, 24, PODPIS_MM, 'Asortyment'),
    ...nazwa.map((w, i) => text(g, M, 28.5 + i * (NAZWA_MM + 1.2), NAZWA_MM, w)),
    line(g, 46),

    text(g, M, 48.5, PODPIS_MM, 'Ilość'),
    // Mniejsza niż termin ważności ŚWIADOMIE: ilość na palecie topnieje przy
    // każdym naważaniu, a termin jest niezmienny i to on decyduje o FEFO.
    text(g, M, 53, 8, `${fmtLabelKg(input.qty)} ${input.unit || 'kg'}`),
    line(g, 66),

    text(g, M, 68.5, PODPIS_MM, 'Partia dostawcy'),
    text(g, M, 73, PARTIA_MM, partia),
    line(g, 82),

    text(g, M, 84.5, PODPIS_MM, 'Termin przydatności'),
    text(g, M, 89, TERMIN_MM, termin),
    line(g, 101),

    text(g, M, 103.5, PODPIS_MM, 'Dostawca'),
    text(g, M, 108, DOSTAWCA_MM, dostawca || '—'),

    text(g, M, 116, PODPIS_MM, 'Faktura / atest'),
    text(g, M, 120.5, DOKUMENT_MM, dokument || '—'),
    line(g, 128),

    text(g, M, 131, PODPIS_MM, 'Data przyjęcia'),
    text(g, M, 135.5, 5.5, fmtLabelDate(input.receivedDate)),
  ]

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28',
    `^PW${mmToDots(DDFIP_LABEL_W_MM, dpi)}`,
    `^LL${mmToDots(labelLengthMm, dpi)}`,
    '^LH0,0',
    '^MNY',
    ...body,
    '^XZ',
  ].join('')
}
