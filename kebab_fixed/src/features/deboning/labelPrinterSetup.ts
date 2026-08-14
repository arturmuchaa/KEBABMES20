/**
 * Ustawienia drukarki etykiet — komendy serwisowe ZPL.
 *
 * Punkt, w którym drukarka zatrzymuje taśmę po wydruku, jest cechą KONKRETNEJ
 * drukarki i rolki, nie układu etykiety — nie da się go zgadnąć z kodu. Hala
 * ustawia go raz palcem w menu serwisowym (kod 0099), a drukarka zapamiętuje
 * wartość u siebie.
 *
 * Czysta logika bez DOM — testowana jednostkowo.
 */
import { LABEL_DPI } from './byproductLabelZpl'

/** Zakres regulacji punktu odrywania w punktach drukarki (limit ZPL dla ~TA). */
export const TEAR_OFF_MAX_DOTS = 120

/** Klucz w localStorage — kiosk pamięta ustawioną wartość, żeby ją pokazać. */
export const TEAR_OFF_STORAGE_KEY = 'kebab.rozbior.tearOffMm'

/** Kalibracja mediów: drukarka sama mierzy długość etykiety i przerwę. */
export const CALIBRATE_ZPL = '~JC'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Ile milimetrów regulacji mieści się w limicie ~TA przy danej rozdzielczości. */
export function tearOffMaxMm(dpi: number = LABEL_DPI): number {
  return Math.floor((TEAR_OFF_MAX_DOTS * 25.4) / dpi * 10) / 10
}

/**
 * `~TA` — przesunięcie punktu odrywania. Dodatnia wartość wysuwa taśmę dalej,
 * ujemna cofa. Wartość zawsze trzycyfrowa: część firmware'ów ignoruje krótszą.
 */
export function tearOffZpl(offsetMm: number, dpi: number = LABEL_DPI): string {
  const dots = clamp(Math.round((offsetMm * dpi) / 25.4), -TEAR_OFF_MAX_DOTS, TEAR_OFF_MAX_DOTS)
  const znak = dots < 0 ? '-' : ''
  return `~TA${znak}${String(Math.abs(dots)).padStart(3, '0')}`
}
