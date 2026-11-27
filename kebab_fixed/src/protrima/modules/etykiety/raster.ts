/// <reference types="vite/client" />
/**
 * Tło Zebry z PDF: pierwsza strona rysowana przez pdfjs w rozdzielczości
 * drukarki (203 dpi) na rozmiar rolki, progowana do 1 bitu i pakowana do
 * `^GFA` (bit 1 = czarny). pdfjs ładowany na żądanie (jak w oknie druku).
 */
import { obrazZBitow } from './rasterObraz'

export const PROG_JASNOSCI = 160

/** RGBA → 1 = czarny (ciemniejszy niż próg i nieprzezroczysty), 0 = biały. */
export function progujDoBitow(rgba: Uint8ClampedArray, w: number, h: number, prog = PROG_JASNOSCI): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3]
    if (a < 128) continue
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    if (l < prog) out[i] = 1
  }
  return out
}

/** Bity (1 = czarny) → `^GFA,total,total,bajtówNaWiersz,HEX`. */
export function bityDoGfa(bits: Uint8Array, w: number, h: number): string {
  const wb = Math.ceil(w / 8)
  let hex = ''
  for (let y = 0; y < h; y++) {
    for (let b = 0; b < wb; b++) {
      let bajt = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit
        if (x < w && bits[y * w + x]) bajt |= 0x80 >> bit
      }
      hex += bajt.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return `^GFA,${wb * h},${wb * h},${wb},${hex}`
}

let workerGotowy = false

/** PDF → tło Zebry {png do podglądu, gfa do druku}; strona wpasowana w rolkę z zachowaniem proporcji. */
export async function pdfDoTlaZebry(plik: File, wMm: number, hMm: number, dpi = 203): Promise<{ png: string; gfa: string }> {
  const pdfjs = await import('pdfjs-dist')
  if (!workerGotowy) {
    const { default: url } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = url
    workerGotowy = true
  }
  const pdf = await pdfjs.getDocument({ data: await plik.arrayBuffer() }).promise
  try {
    const strona = await pdf.getPage(1)
    const W = Math.round((wMm * dpi) / 25.4), H = Math.round((hMm * dpi) / 25.4)
    const baza = strona.getViewport({ scale: 1 })
    const skala = Math.min(W / baza.width, H / baza.height)
    const vp = strona.getViewport({ scale: skala })
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
    ctx.translate(Math.round((W - vp.width) / 2), Math.round((H - vp.height) / 2))
    await strona.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise
    const bits = progujDoBitow(ctx.getImageData(0, 0, W, H).data, W, H)
    return { png: obrazZBitow(bits, W, H), gfa: bityDoGfa(bits, W, H) }
  } finally {
    void pdf.destroy()
  }
}
