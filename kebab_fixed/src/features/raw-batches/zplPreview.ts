/**
 * zplPreview — podgląd etykiety rysowany Z SAMEGO ZPL.
 *
 * Podgląd odwzorowany ręcznie (druga wersja układu w HTML) rozjeżdża się z
 * wydrukiem przy pierwszej zmianie fontu, a biuro decyduje na jego podstawie,
 * czy wypuścić kilkanaście etykiet. Dlatego czytamy dokładnie ten ciąg, który
 * pojedzie na drukarkę, i przeliczamy punkty na milimetry.
 *
 * Obsługujemy tylko to, czego używają nasze etykiety: `^FO` + `^A0N` (tekst),
 * `^FO` + `^GB` (kreska) i `^FO` + `^GFA` (znak firmowy). Reszta komend to
 * ustawienia drukarki — nie mają odpowiednika na obrazku.
 */
import { LABEL_DPI } from '@/features/deboning/byproductLabelZpl'

export interface ZplPreviewBox {
  kind: 'text' | 'line' | 'logo'
  xMm: number
  yMm: number
  /** Wysokość fontu w mm — tylko dla tekstu. */
  fontMm?: number
  text?: string
  /** Wymiary w mm — kreska, znak firmowy oraz szerokość bloku `^FB`. */
  widthMm?: number
  heightMm?: number
  /** Wyrównanie tekstu w bloku `^FB`; brak = do lewej od `xMm`. */
  align?: 'L' | 'C' | 'R'
}

// `^FB` (blok tekstu) jest OPCJONALNY między `^A0N` a `^FD` — etykieta palety
// mięsa wyrównuje nim kilogramy do prawej krawędzi. Bez tego kawałka wzorca
// podgląd gubił CAŁE kilogramy przy każdej partii, a etykieta drukowała je
// poprawnie: podgląd kłamał w drugą stronę niż zwykle (29.08.2026).
const POLE = /\^FO(\d+),(\d+)(?:\^A0N,(\d+),\d+(?:\^FB(\d+),\d+,-?\d+,([LCR]))?\^FD([\s\S]*?)\^FS|\^GB(\d+),(\d+),\d+\^FS|\^GFA,(\d+),\d+,(\d+),[0-9A-F]*\^FS)/g

export function zplPreviewBoxes(zpl: string, dpi: number = LABEL_DPI): ZplPreviewBox[] {
  const mm = (dots: number) => (dots * 25.4) / dpi
  const out: ZplPreviewBox[] = []
  // Regexp z flagą /g trzyma pozycję między wywołaniami — własna kopia na
  // każdy przebieg, żeby dwa podglądy obok siebie nie gubiły pól.
  const re = new RegExp(POLE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(zpl))) {
    const xMm = mm(Number(m[1]))
    const yMm = mm(Number(m[2]))
    if (m[3] !== undefined) {
      out.push({
        kind: 'text', xMm, yMm, fontMm: mm(Number(m[3])), text: m[6] ?? '',
        ...(m[4] !== undefined
          ? { widthMm: mm(Number(m[4])), align: (m[5] as 'L' | 'C' | 'R') }
          : {}),
      })
    } else if (m[7] !== undefined) {
      out.push({ kind: 'line', xMm, yMm, widthMm: mm(Number(m[7])), heightMm: mm(Number(m[8])) })
    } else {
      // `^GFA,<bajtów>,<bajtów>,<bajtów w wierszu>` — z tego liczymy rozmiar
      // mapy bitowej: szerokość to bajty w wierszu × 8, wysokość to reszta.
      const bajtowNaWiersz = Number(m[10])
      out.push({
        kind: 'logo', xMm, yMm,
        widthMm: mm(bajtowNaWiersz * 8),
        heightMm: mm(Number(m[9]) / bajtowNaWiersz),
      })
    }
  }
  return out
}
