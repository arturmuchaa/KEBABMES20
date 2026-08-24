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

/** Wysokość czcionki wagi palety. Numer partii przy palecie jednorodnej
 *  dostaje DOKŁADNIE tę samą — ma być czytelny z tej samej odległości. */
const KG_FONT_MM = 7

export interface MeatPalletLabelInput {
  palletNo: string
  netKg: number
  containers: number
  /** ISO (yyyy-mm-dd) — dzień produkcyjny rozbioru. */
  productionDate: string
  /** ISO (yyyy-mm-dd) — najkrótszy termin ze składu palety. */
  expiryDate: string
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

function qr(xMm: number, yMm: number, value: string, dpi: number): string {
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^BQN,2,3^FDQA,${esc(value)}^FS`
}

export function meatPalletLabelZpl(
  input: MeatPalletLabelInput, { dpi = LABEL_DPI }: { dpi?: number } = {},
): string {
  const M = 3
  const W = LABEL_W_MM - 2 * M

  const widoczne = input.lots.slice(0, MAX_LOTS_ON_LABEL)
  const reszta = input.lots.length - widoczne.length

  const body: string[] = [
    text(M, 3, 6, 'MIĘSO', dpi),
    // QR w prawym górnym rogu — nie zabiera miejsca wierszom tekstu.
    qr(34, 3, input.palletNo, dpi),
    text(M, 13, 4.5, input.palletNo, dpi),
    line(M, 19.5, W, dpi),

    text(M, 22, KG_FONT_MM, `${fmtLabelKg(input.netKg)} kg`, dpi),
    text(M, 31, 3.5, `${input.containers} pojemników`, dpi),
    line(M, 36.5, W, dpi),

  ]

  // Paleta z JEDNEJ partii: sam numer, wielkim drukiem.
  //
  // Rozpisywanie „503 — 200 kg" niczego tu nie wnosi — te kilogramy to waga
  // całej palety, wydrukowana wyżej największą czcionką. Operator masowania
  // czyta z zawieszki dwie rzeczy: ile bierze i z czego; numer partii ma być
  // widoczny z tej samej odległości co waga, więc dostaje tę samą wysokość.
  //
  // Skład z kilogramami zostaje TAM, GDZIE ma sens: przy palecie złożonej
  // z dwóch partii i więcej. To dla niej ta etykieta w ogóle powstała.
  let y: number
  if (widoczne.length === 1) {
    body.push(
      text(M, 38.5, 3.2, 'Partia', dpi),
      text(M, 42, KG_FONT_MM, widoczne[0].lotNo, dpi),
    )
    y = 42 + KG_FONT_MM + 2
  } else {
    body.push(
      text(M, 38.5, 3.2, 'Partie:', dpi),
      ...widoczne.map((l, i) =>
        text(M, 42.5 + i * 4.5, 4, `${l.lotNo} — ${fmtLabelKg(l.kg)} kg`, dpi)),
    )
    // Stopka idzie ZARAZ POD składem, a nie na stałej wysokości: przy dwóch
    // partiach stała pozycja zostawiała w środku etykiety pustą dziurę
    // wyglądającą jak błąd druku.
    y = 42.5 + widoczne.length * 4.5
    if (reszta > 0) {
      body.push(text(M, y, 3.5, `+ ${reszta} kolejnych`, dpi))
      y += 4.5
    }
  }

  body.push(
    line(M, y + 1.5, W, dpi),
    text(M, y + 3.5, 3.5, `Prod. ${fmtLabelDate(input.productionDate)}`, dpi),
    text(M, y + 8.5, 3.5, `Ważn. ${fmtLabelDate(input.expiryDate)}`, dpi),
  )

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
