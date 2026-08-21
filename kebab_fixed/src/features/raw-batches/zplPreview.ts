/**
 * zplPreview — podgląd etykiety rysowany Z SAMEGO ZPL.
 *
 * Podgląd odwzorowany ręcznie (druga wersja układu w HTML) rozjeżdża się z
 * wydrukiem przy pierwszej zmianie fontu, a biuro decyduje na jego podstawie,
 * czy wypuścić kilkanaście etykiet. Dlatego czytamy dokładnie ten ciąg, który
 * pojedzie na drukarkę, i przeliczamy punkty na milimetry.
 *
 * Obsługujemy tylko to, czego używają nasze etykiety: `^FO` + `^A0N` (tekst)
 * i `^FO` + `^GB` (kreska). Reszta komend to ustawienia drukarki — nie mają
 * odpowiednika na obrazku.
 */
import { LABEL_DPI } from '@/features/deboning/byproductLabelZpl'

export interface ZplPreviewBox {
  kind: 'text' | 'line'
  xMm: number
  yMm: number
  /** Wysokość fontu w mm — tylko dla tekstu. */
  fontMm?: number
  text?: string
  /** Wymiary kreski w mm — tylko dla linii. */
  widthMm?: number
  heightMm?: number
}

const POLE = /\^FO(\d+),(\d+)(?:\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS|\^GB(\d+),(\d+),\d+\^FS)/g

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
    } else {
      out.push({ kind: 'line', xMm, yMm, widthMm: mm(Number(m[5])), heightMm: mm(Number(m[6])) })
    }
  }
  return out
}
