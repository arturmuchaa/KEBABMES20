/**
 * signatureImage — matematyka rysunku podpisu, bez DOM.
 *
 * Wzór przycinamy do ramki rysunku, zanim trafi na serwer: człowiek rysuje
 * gdzieś w wielkim polu, a na karcie 1.1.1 kratka podpisu ma 18 mm
 * szerokości i 9,5 mm wysokości. Bez przycięcia podpis byłby znaczkiem
 * w rogu białej plamy.
 *
 * Czysta funkcja, bo canvas w vitest nie renderuje — sprawdzamy matematykę,
 * nie przeglądarkę.
 */
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Ramka niepustych (nieprzezroczystych) pikseli albo null dla pustego płótna. */
export function bounds(data: Uint8ClampedArray, w: number, h: number): Bounds | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** Czy nic nie narysowano. Pusty wzór nie może pójść na serwer — na karcie
 *  zostałaby pusta kratka udająca podpis. */
export function isBlank(data: Uint8ClampedArray, w: number, h: number): boolean {
  return bounds(data, w, h) === null
}

/** Docelowy rozmiar wzoru wysyłanego na serwer. Proporcja 3:1 odpowiada
 *  kratce podpisu na karcie; 8 px marginesu, żeby kreska nie kleiła się
 *  do krawędzi po przycięciu. */
export const SIG_W = 600
export const SIG_H = 200
export const SIG_PAD = 8
