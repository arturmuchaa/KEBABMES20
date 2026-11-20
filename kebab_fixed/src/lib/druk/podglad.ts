/// <reference types="vite/client" />
/**
 * Podgląd wydruku w oknie druku: strony PDF (ten sam, który pójdzie do
 * drukarki) zamienione na obrazy przez pdfjs — ładowany na żądanie, jak
 * w pdfToImage.ts. Strony oddawane po kolei, żeby długi dokument nie czekał.
 */
import { zBase64 } from './base64'

export const MAKS_STRON_PODGLADU = 40
let workerGotowy = false

export interface StronaPodgladu { src: string; szer: number; wys: number }

export async function stronyPodgladu(pdfBase64: string, naStrone: (i: number, s: StronaPodgladu, wszystkich: number) => void,
  czyDalej: () => boolean, szerPx = 900): Promise<number> {
  const pdfjs = await import('pdfjs-dist')
  if (!workerGotowy) {
    const { default: url } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = url
    workerGotowy = true
  }
  const pdf = await pdfjs.getDocument({ data: zBase64(pdfBase64) }).promise
  try {
    const n = pdf.numPages
    for (let i = 1; i <= Math.min(n, MAKS_STRON_PODGLADU) && czyDalej(); i++) {
      const strona = await pdf.getPage(i)
      const baza = strona.getViewport({ scale: 1 })
      // Szerokość obrazu wg dłuższego boku, żeby poziome strony nie były rozmyte.
      const vp = strona.getViewport({ scale: szerPx / Math.max(baza.width, baza.height) * 1.4 })
      const c = document.createElement('canvas')
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('Brak kontekstu canvas')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      await strona.render({ canvasContext: ctx, viewport: vp }).promise
      naStrone(i - 1, { src: c.toDataURL('image/png'), szer: baza.width, wys: baza.height }, n)
    }
    return n
  } finally { void pdf.destroy() }
}
