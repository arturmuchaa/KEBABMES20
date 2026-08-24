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
    body.push(
      text(M, 19, 3.2, 'Nr porządkowy', dpi),
      text(M, 23, NR_FONT_MM, widoczne[0].lotNo, dpi),
    )
    y = 23 + NR_FONT_MM + 2
  } else {
    // Paleta z kilku partii: numer sam w sobie nic nie mówi, liczy się SKŁAD.
    body.push(
      text(M, 19, 3.2, 'Partie:', dpi),
      ...widoczne.map((l, i) =>
        text(M, 23 + i * 4.5, 4, `${l.lotNo} — ${fmtLabelKg(l.kg)} kg`, dpi)),
    )
    y = 23 + widoczne.length * 4.5
    if (reszta > 0) {
      body.push(text(M, y, 3.5, `+ ${reszta} kolejnych`, dpi))
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
