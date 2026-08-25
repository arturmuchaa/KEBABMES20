/**
 * Etykieta palety / wózka mięsa z ważenia zbiorczego — ZPL 50×80 mm.
 *
 * Sedno: operator masowania ma z niej wiedzieć, ILE bierze i Z JAKICH PARTII,
 * bez ważenia po raz drugi u siebie. Numer palety powtarzamy w kodzie QR —
 * gdy powstanie ekran odbioru na masowni, wystarczy go zeskanować.
 *
 * Rozmiar i pułapki taśmy jak przy etykiecie ubocznych (patrz
 * `byproductLabelZpl`): 50 mm w poprzek, 80 mm wzdłuż, `^MNY` dla etykiet
 * wykrawanych, `^LH0,0` kasujące przesunięcie z ustawień drukarki.
 *
 * Czysta funkcja bez DOM — testowana jednostkowo.
 */
import {
  LABEL_DPI, LABEL_H_MM, LABEL_W_MM, fmtLabelDate, fmtLabelKg, mmToDots,
} from './byproductLabelZpl'
import type { LotPick } from './meatPallet'

/** Ile partii mieści się na etykiecie; reszta idzie jako „+ N kolejnych". */
export const MAX_LOTS_ON_LABEL = 4

/** Wysokość czcionki wagi palety. */
const KG_FONT_MM = 7.5

/** Numer porządkowy — NAJWIĘKSZY napis na etykiecie. To po niego operator
 *  masowania sięga wzrokiem z drugiego końca chłodni. */
const NR_FONT_MM = 11

/** Ile milimetrów szerokości zjada jeden znak czcionki skalowalnej ZPL (A0)
 *  o wysokości 1 mm. Zmierzone na wydruku — z zapasem, żeby numer nigdy nie
 *  wyjechał poza taśmę. */
const SZEROKOSC_ZNAKU = 0.62

/**
 * Największa czcionka, przy której napis mieści się w podanej szerokości.
 *
 * Numer partii bywa krótki („505") i długi („505-BS-2026"), a etykieta ma
 * stałe 50 mm. Sztywna wartość albo marnuje miejsce, albo ucina numer —
 * dlatego liczymy ją z długości tekstu i przycinamy sufitem pionowym.
 */
export function nrFontMm(tekst: string, szerokoscMm: number, sufitMm: number): number {
  const znaki = Math.max(1, (tekst || '').length)
  const zSzerokosci = szerokoscMm / (znaki * SZEROKOSC_ZNAKU)
  return Math.max(3, Math.min(sufitMm, Math.floor(zSzerokosci * 10) / 10))
}

/** Sufit czcionki numeru. Jedna partia zostaje przy 11 mm — hala zna tę
 *  etykietę i nie zgłaszała do niej zastrzeżeń; kilka partii dostaje tyle,
 *  ile realnie zmieści się wszerz i w pionie. */
const SUFIT_NR_MM = 11

/**
 * Ile pionu wolno zabrać liście partii (od y=23 w dół).
 *
 * Pod nią muszą jeszcze wejść: waga netto z pojemnikami (20,5 mm) oraz dwie
 * linijki dat (11 mm). Etykieta ma 80 mm, więc lista kończy się najpóźniej
 * na ~49 mm. Bez tego budżetu cztery partie po 9 mm zepchnęły daty poza
 * taśmę (sprawdzone testem — 646 punktów przy 639 dostępnych).
 */
const PION_NA_PARTIE_MM = 26

/** Poniżej tej wysokości numer przestaje być czytelny z odległości, więc
 *  zamiast go zmniejszać — pokazujemy MNIEJ partii i „+ N kolejnych". */
const MIN_CZYTELNA_MM = 4.5

/** Odstęp między numerem a kilogramami w wierszu partii. */
const ODSTEP_MM = 2

/** Kilogramy o tyle mniejsze od numeru — „trochę, ale nie dużo". */
const MNIEJ_KG_MM = 1

/** Szerokość napisu przy danej wysokości czcionki. */
const szerokoscMm = (tekst: string, fontMm: number): number =>
  Math.max(1, (tekst || '').length) * SZEROKOSC_ZNAKU * fontMm

/**
 * Czcionka wiersza partii: numer i kilogramy jedną wielkością (kg o 1 mm
 * mniejsze), tak duże, jak pozwala taśma.
 *
 * Dwa ograniczenia naraz:
 *  • WSZERZ — `505` + `119,5` w jednej wielkości muszą zmieścić się w 44 mm;
 *    dlatego jednostka „kg" stoi w nagłówku sekcji, a nie przy każdej liczbie
 *    (z sufiksem wiersz ma 65 mm i nie ma szans),
 *  • W PIONIE — pod partiami muszą jeszcze wejść waga i daty, więc cztery
 *    partie dostają mniejszą czcionkę niż dwie.
 *
 * Gdy numer jest długi (`505-BS-2026`), czcionka schodzi poniżej 9 mm:
 * mniejszy numer jest lepszy niż ucięty.
 */
export function wierszPartiiFontMm(
  wiersze: readonly { nr: string; kg: string }[],
  szerokoscDostepnaMm: number,
  pionDostepnyMm: number,
): { nr: number; kg: number } {
  const n = Math.max(1, wiersze.length)
  // W pionie każdy wiersz zajmuje czcionkę + odstęp.
  const zPionu = pionDostepnyMm / n - ODSTEP_MM
  const zSzerokosci = wiersze.map(w => {
    const jednostkowa = SZEROKOSC_ZNAKU * (w.nr.length + w.kg.length)
    // f·0,62·|nr| + odstęp + (f−1)·0,62·|kg| ≤ szerokość
    return (szerokoscDostepnaMm - ODSTEP_MM + SZEROKOSC_ZNAKU * w.kg.length * MNIEJ_KG_MM)
      / Math.max(0.01, jednostkowa)
  })
  const f = Math.max(3, Math.min(SUFIT_NR_MM, zPionu, ...zSzerokosci))
  const nr = Math.floor(f * 10) / 10
  return { nr, kg: Math.max(3, Math.round((nr - MNIEJ_KG_MM) * 10) / 10) }
}

export interface MeatPalletLabelInput {
  palletNo: string
  netKg: number
  containers: number
  /** ISO (yyyy-mm-dd) — dzień produkcyjny rozbioru. */
  productionDate: string
  /** ISO (yyyy-mm-dd) — najkrótszy termin ze składu palety. */
  expiryDate: string
  /** ISO — ubój ćwiartki. Tylko dla palety Z JEDNEJ partii; przy mieszance
   *  dwie ćwiartki mają dwie różne daty i jedna byłaby nieprawdą. */
  slaughterDate?: string
  /** ISO — przyjęcie ćwiartki. Jak wyżej: tylko przy jednej partii. */
  receivedDate?: string
  lots: LotPick[]
}

function esc(value: string): string {
  return (value ?? '').replace(/[\^~]/g, ' ')
}

function text(xMm: number, yMm: number, fontMm: number, value: string, dpi: number): string {
  const h = mmToDots(fontMm, dpi)
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

/** Napis wyrównany do PRAWEJ w podanej szerokości — kilogramy stają wtedy
 *  równo przy krawędzi, obok dużego numeru, bez liczenia szerokości znaków. */
function textRight(xMm: number, yMm: number, fontMm: number, wMm: number, value: string, dpi: number): string {
  const h = mmToDots(fontMm, dpi)
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^A0N,${h},${h}`
    + `^FB${mmToDots(wMm, dpi)},1,0,R^FD${esc(value)}^FS`
}

function line(xMm: number, yMm: number, wMm: number, dpi: number): string {
  const t = Math.max(1, mmToDots(0.6, dpi))
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^GB${mmToDots(wMm, dpi)},${t},${t}^FS`
}

export function meatPalletLabelZpl(
  input: MeatPalletLabelInput, { dpi = LABEL_DPI }: { dpi?: number } = {},
): string {
  // Układ jak na etykiecie ubocznych: opis małą czcionką NAD wartością,
  // a liczby, po które operator masowania sięga z odległości — duże.
  // Kolejność ustalona przez biuro 24.08.2026: rodzaj, numer porządkowy,
  // waga, a daty małym drukiem na dole. QR zdjęty — masownia go nie skanuje.
  const M = 3
  const W = LABEL_W_MM - 2 * M

  const widoczne = input.lots.slice(0, MAX_LOTS_ON_LABEL)
  const reszta = input.lots.length - widoczne.length
  const jednaPartia = widoczne.length === 1 && reszta === 0

  const body: string[] = [
    text(M, 3, 7, 'MIĘSO', dpi),
    text(M, 11.5, 3.5, input.palletNo, dpi),
    line(M, 16.5, W, dpi),
  ]

  // ── Numer porządkowy ──
  let y: number
  if (jednaPartia) {
    const f = nrFontMm(widoczne[0].lotNo, W, SUFIT_NR_MM)
    body.push(
      text(M, 19, 3.2, 'Nr porządkowy', dpi),
      text(M, 23, f, widoczne[0].lotNo, dpi),
    )
    y = 23 + f + 2
  } else {
    // Paleta z kilku partii: numer sam w sobie nic nie mówi, liczy się SKŁAD.
    // Do 1.0.94 cały wiersz („475 — 420 kg") szedł jedną czcionką 4 mm i z
    // chłodni był nieczytelny. Teraz numer i kilogramy idą jedną wielkością,
    // a jednostka stoi w nagłówku — z sufiksem „kg" przy każdej liczbie
    // wiersz miałby 65 mm i nie zmieściłby się na 50-milimetrowej taśmie.
    // Ile partii wypisać, żeby każdy numer był jeszcze czytelny. Pięć
    // wierszy mieściło się tylko przy 3,3 mm — mniej niż przed poprawką.
    let wiersze = widoczne.map(l => ({ nr: l.lotNo, kg: fmtLabelKg(l.kg) }))
    let ukryte = reszta
    let f = wierszPartiiFontMm(wiersze, W, PION_NA_PARTIE_MM - (ukryte > 0 ? 4.5 : 0))
    while (wiersze.length > 1 && f.nr < MIN_CZYTELNA_MM) {
      wiersze = wiersze.slice(0, -1)
      ukryte = input.lots.length - wiersze.length
      f = wierszPartiiFontMm(wiersze, W, PION_NA_PARTIE_MM - (ukryte > 0 ? 4.5 : 0))
    }
    body.push(text(M, 19, 3.2, 'Partie · kg', dpi))
    wiersze.forEach((w, i) => {
      const wiersz = 23 + i * (f.nr + ODSTEP_MM)
      body.push(
        text(M, wiersz, f.nr, w.nr, dpi),
        textRight(M, wiersz + (f.nr - f.kg), f.kg, W, w.kg, dpi),
      )
    })
    y = 23 + wiersze.length * (f.nr + ODSTEP_MM)
    if (ukryte > 0) {
      body.push(text(M, y, 3.5, `+ ${ukryte} kolejnych`, dpi))
      y += 4.5
    }
  }

  // ── Waga ──
  body.push(
    line(M, y, W, dpi),
    text(M, y + 2.5, 3.2, 'Waga netto', dpi),
    text(M, y + 6.5, KG_FONT_MM, `${fmtLabelKg(input.netKg)} kg`, dpi),
    text(M, y + 16, 3.2, `${input.containers} pojemników`, dpi),
  )
  y = y + 20.5

  // ── Daty, małym drukiem ──
  //
  // Ubój i przyjęcie TYLKO przy jednej partii: przy mieszance dwie ćwiartki
  // mają dwie różne daty, a jedna wydrukowana byłaby nieprawdą. Ważenie
  // i najkrótsza ważność opisują całą paletę, więc zostają zawsze.
  const daty: string[] = [`Ważenie ${fmtLabelDate(input.productionDate)}`]
  if (jednaPartia && input.slaughterDate) daty.push(`Ubój ${fmtLabelDate(input.slaughterDate)}`)
  daty.push(`Ważność ${fmtLabelDate(input.expiryDate)}`)
  if (jednaPartia && input.receivedDate) daty.push(`Przyjęcie ${fmtLabelDate(input.receivedDate)}`)

  body.push(line(M, y, W, dpi))
  daty.forEach((d, i) => body.push(text(M, y + 2.5 + i * 4.5, 3.4, d, dpi)))

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
