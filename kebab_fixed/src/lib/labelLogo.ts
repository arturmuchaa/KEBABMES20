/**
 * Logo Księżyc na etykietach — mapa bitowa ZPL wklejona w kod.
 *
 * Drukarka etykiet nie ma dostępu ani do sieci, ani do plików aplikacji:
 * obrazek musi pojechać do niej RAZEM z etykietą, jako pole `^GF`. Dlatego
 * znak siedzi tu jako heks, a nie jest wczytywany z
 * `public/logo-ksiezyc-znak.png` — ten sam plik jest źródłem, tylko
 * zrasteryzowanym raz, przy tej zmianie.
 *
 * Raster zrobiony pod 203 dpi (128 × 29 punktów = 16.0 × 3.6 mm).
 * `^GF` się NIE skaluje — na drukarce 300 dpi znak wyjdzie fizycznie mniejszy
 * i tyle; żeby zachować wielkość, trzeba przerasteryzować źródło.
 *
 * Odtworzenie (Pillow): przytnij `logo-ksiezyc-znak.png` do zawartości,
 * przeskaluj do 128 punktów szerokości, próg 200, bit = piksel czarny.
 */

/** Szerokość znaku w punktach drukarki (203 dpi). */
export const LOGO_DOTS_W = 128
/** Wysokość znaku w punktach drukarki (203 dpi). */
export const LOGO_DOTS_H = 29
/** Bajtów na wiersz mapy bitowej. */
const LOGO_BYTES_PER_ROW = 16

/** Wiersze mapy bitowej — po jednym na linię, żeby diff pokazywał zmianę
 *  znaku, a nie jeden nieczytelny ciąg na cały ekran. */
const LOGO_ROWS = [
  '1FFFFFFFC00000000000000000000000',
  '7FFFFFFFE00000000000000000000000',
  '7FFFFFFFF00000000000000000000000',
  'FFFFFFFFF01C078001C0000300000000',
  'E23FFFC4703E0F8003E0000780000000',
  'F31FFFCC703E0F8003E0000780000000',
  'F19FFF88F03E1F0003E0000780000000',
  '788FFFF9F03E3E0003C0000380000000',
  '7CC7FFF1E03E3E000000000000000000',
  '3C400003E03E7C0000007000000001E0',
  '3E600007C03EFC0FFBE1FE3FFF83C7F8',
  '1E33FFFF803FF81FFBE7FF3FFF87CFFC',
  '1F31007F803FF03FFBE7FF3FFF87DFFE',
  '0F18003F003FF83C03EF8780FFC7BF1F',
  '0788001F003FF83C03EF0781F3C7BC0F',
  '07CCFF1E003E7C3FF3CFFFC3E3C7BC00',
  '03C4633E003E7C1FFBDFFFC7C3CFBC00',
  '03E6263C003E3E0FFBDF000F83CF3C00',
  '01FFC67C003E3E007BEE039F01EF3C0F',
  '01FFCC78003E1F007BEF07BE01EF3E1F',
  '00FF88F0003E1FBFFBEFFFBFF9FF1FFF',
  '007F99F0003E0FBFFBE7FF3FF9FE1FFE',
  '007F11E0003E07FFF3E3FE3FF8FE0FFC',
  '003FFFE0003C07FFC1C0FC3FF8FE03F0',
  '003FFFC0000000000000E000001E0000',
  '001FFF80000000000001C00001FC0000',
  '000FFF00000000000001F00001FC0000',
  '00000000000000000001F00001F80000',
  '00000000000000000001F00001F00000',
]

/**
 * Pole `^GF` ze znakiem, postawione w podanym punkcie etykiety.
 * Współrzędne w PUNKTACH drukarki — przelicza je wywołujący, bo tylko on wie,
 * w jakiej rozdzielczości drukuje etykietę.
 */
export function labelLogoZpl(xDots: number, yDots: number): string {
  const bajtow = LOGO_BYTES_PER_ROW * LOGO_DOTS_H
  const x = Math.max(0, Math.round(xDots))
  const y = Math.max(0, Math.round(yDots))
  return `^FO${x},${y}^GFA,${bajtow},${bajtow},${LOGO_BYTES_PER_ROW},${LOGO_ROWS.join('')}^FS`
}
