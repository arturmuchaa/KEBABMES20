/// <reference types="vite/client" />

/**
 * Rasteryzacja PDF do PNG — pdfjs ładowany NA ŻĄDANIE.
 *
 * pdfjs-dist waży ~100 kB po gzipie i był w paczce wejściowej, choć potrzebny
 * jest wyłącznie przy wczytywaniu skanu HDI. Na słabym łączu biura (transfery
 * powyżej ~200 kB rwały się) każdy zbędny kilobajt w starcie aplikacji
 * decydował o tym, czy MES w ogóle wstanie.
 *
 * Import w środku funkcji: przeglądarka pobiera pdfjs dopiero, gdy ktoś
 * naprawdę wczytuje PDF. Worker przypinamy przy tym samym wywołaniu — dawniej
 * robił to efekt uboczny na poziomie modułu.
 */

let workerReady = false

/** Rasteryzuje 1. stronę PDF do PNG (data URL). targetWidth = szerokość docelowa w px. */
export async function pdfFirstPageToPng(file: File, targetWidth = 2480): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  if (!workerReady) {
    // Worker bundlowany przez Vite (?url daje ścieżkę do zasobu).
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
    workerReady = true
  }

  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const page = await pdf.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = targetWidth / base.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Brak kontekstu canvas')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png')
}
