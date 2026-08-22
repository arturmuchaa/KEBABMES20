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
  /** Wymiary w mm — kreska i znak firmowy. */
  widthMm?: number
  heightMm?: number
}

const POLE = /\^FO(\d+),(\d+)(?:\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS|\^GB(\d+),(\d+),\d+\^FS|\^GFA,(\d+),\d+,(\d+),[0-9A-F]*\^FS)/g

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
      out.push({ kind: 'text', xMm, yMm, fontMm: mm(Number(m[3])), text: m[4] ?? '' })
    } else if (m[5] !== undefined) {
      out.push({ kind: 'line', xMm, yMm, widthMm: mm(Number(m[5])), heightMm: mm(Number(m[6])) })
    } else {
      // `^GFA,<bajtów>,<bajtów>,<bajtów w wierszu>` — z tego liczymy rozmiar
      // mapy bitowej: szerokość to bajty w wierszu × 8, wysokość to reszta.
      const bajtowNaWiersz = Number(m[8])
      out.push({
        kind: 'logo', xMm, yMm,
        widthMm: mm(bajtowNaWiersz * 8),
        heightMm: mm(Number(m[7]) / bajtowNaWiersz),
      })
    }
  }
  return out
}
