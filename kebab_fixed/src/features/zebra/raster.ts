/**
 * Rasteryzacja do ZPL ^GFA — tekst (dowolny font z systemu, np. Arial, z polskimi
 * znakami) oraz obrazki (logo HALAL, znak WE) zamieniamy na monochromatyczną grafikę
 * i wstawiamy na etykietę. To gwarantuje poprawne polskie znaki i wybór czcionki bez
 * wgrywania fontów do drukarki. Pure (poza canvas API przeglądarki) → łatwe do użycia.
 */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4)
}

export interface Gfa { gf: string; wDots: number; hDots: number; wMm: number; hMm: number }

/** Canvas 1-bit → komenda ^GFA (bez ^FO/^FS — pozycję dokłada wywołujący). */
function canvasToGfa(canvas: HTMLCanvasElement, dpi: number, threshold = 128): Gfa {
  const w = canvas.width, h = canvas.height
  const bytesPerRow = Math.ceil(w / 8)
  const total = bytesPerRow * h
  const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data
  const bytes = new Uint8Array(total)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const alpha = data[i + 3]
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      if (alpha > 128 && lum < threshold) bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return {
    gf: `^GFA,${total},${total},${bytesPerRow},${hex.toUpperCase()}`,
    wDots: w, hDots: h, wMm: (w * 25.4) / dpi, hMm: (h * 25.4) / dpi,
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of (text || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) { out.push(''); continue }
    let line = words[0]
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i]
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = words[i] }
      else line = test
    }
    out.push(line)
  }
  return out
}

export interface TextRasterOpts {
  text: string; fontMm: number; widthMm: number; dpi: number
  family?: string; bold?: boolean; align?: 'L' | 'C' | 'R'
}

/** Tekst → ^GFA (zawijany do szerokości). Font z systemu (Arial itp.) → pełne PL. */
export function textToGfa(o: TextRasterOpts): Gfa {
  const family = o.family || 'Arial, sans-serif'
  const wDots = Math.max(1, mmToDots(o.widthMm, o.dpi))
  const fontPx = Math.max(1, mmToDots(o.fontMm, o.dpi))
  const lineH = Math.round(fontPx * 1.25)
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `${o.bold ? 'bold ' : ''}${fontPx}px ${family}`
  const lines = wrapLines(measure, o.text, wDots)
  const hDots = Math.max(lineH, lines.length * lineH)

  const c = document.createElement('canvas')
  c.width = wDots; c.height = hDots
  const ctx = c.getContext('2d')!
  ctx.font = `${o.bold ? 'bold ' : ''}${fontPx}px ${family}`
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#000'
  lines.forEach((ln, i) => {
    const m = ctx.measureText(ln).width
    const x = o.align === 'C' ? (wDots - m) / 2 : o.align === 'R' ? wDots - m : 0
    ctx.fillText(ln, Math.max(0, x), i * lineH)
  })
  return canvasToGfa(c, o.dpi)
}

/** Obraz (HTMLImageElement) → ^GFA skalowany do widthMm×heightMm. */
export function imageToGfa(img: HTMLImageElement, widthMm: number, heightMm: number, dpi: number, threshold = 160): Gfa {
  const wDots = Math.max(1, mmToDots(widthMm, dpi))
  const hDots = Math.max(1, mmToDots(heightMm, dpi))
  const c = document.createElement('canvas')
  c.width = wDots; c.height = hDots
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, wDots, hDots)   // białe tło → próg luminancji
  ctx.drawImage(img, 0, 0, wDots, hDots)
  return canvasToGfa(c, dpi, threshold)
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nie udało się wczytać obrazu'))
    img.src = src
  })
}
