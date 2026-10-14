/** GC420t w zakładzie: 203 dpi, etykiety z przerwami, bez kalki. */
export const ZEBRA_PROFILES = {
  '50x80': { width: 50, height: 80, name: '50 × 80 mm — rozbiór' },
  '80x100': { width: 80, height: 100, name: '80 × 100 mm — przyjęcie' },
  '100x150': { width: 100, height: 150, name: '100 × 150 mm — masownia / magazyn / przyprawy' },
} as const
export type ZebraProfileId = keyof typeof ZEBRA_PROFILES
const PRINTER_KEY = 'kebab.zebra.printer'
const mediaKey = (uid: string) => `kebab.zebra.media.${uid}`

function get(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function set(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* druk działa też bez trwałej pamięci */ }
}
export const selectedZebraUid = () => get(PRINTER_KEY) ?? ''
export const selectZebra = (uid: string) => set(PRINTER_KEY, uid)
export function loadedZebraMedia(uid: string): ZebraProfileId | null {
  const value = get(mediaKey(uid))
  return value && Object.prototype.hasOwnProperty.call(ZEBRA_PROFILES, value) ? value as ZebraProfileId : null
}
export function rememberZebraMedia(uid: string, id: ZebraProfileId) {
  set(mediaKey(uid), id)
  set(`${mediaKey(uid)}.calibration`, 'verified')
}
export function beginZebraCalibration(uid: string, id: ZebraProfileId) {
  set(mediaKey(uid), id)
  set(`${mediaKey(uid)}.calibration`, 'pending')
}
export const zebraDots = (mm: number) => Math.round(mm * 203 / 25.4)

/** Sprawdzamy znaną rolkę, zanim ^LL nadpisze długość w drukarce. */
export function checkZebraMedia(uid: string, zpl: string): void {
  if (get(`${mediaKey(uid)}.calibration`) === 'pending') {
    throw new Error('Nie potwierdzono ostatniej kalibracji tej drukarki. Sprawdź rolkę i ponownie użyj „Zmieniam rolkę / kalibruj” przed wydrukiem.')
  }
  const id = loadedZebraMedia(uid)
  if (!id) return
  const profile = ZEBRA_PROFILES[id]
  const widths = [...zpl.matchAll(/\^PW(\d+)/g)].map(m => Number(m[1]) * 25.4 / 203)
  const lengths = [...zpl.matchAll(/\^LL(\d+)/g)].map(m => Number(m[1]) * 25.4 / 203)
  if (widths.some(w => Math.abs(w - profile.width) > 2)
    || lengths.some(h => h < profile.height - 2 || h > profile.height + 10)) {
    throw new Error(`Projekt etykiety nie pasuje do zapamiętanej rolki ${profile.width} × ${profile.height} mm. Załóż właściwą rolkę i użyj „Zmieniam rolkę / kalibruj”.`)
  }
}

export function zebraMediaSetupZpl(id: ZebraProfileId): string {
  // Bez ^LL: przed pomiarem nie wpisujemy wyniku, który chcemy potem odczytać.
  return `^XA^MNY^MTD^PW${zebraDots(ZEBRA_PROFILES[id].width)}^XZ`
}

export function zebraMediaTestZpl(id: ZebraProfileId): string {
  const { width, height } = ZEBRA_PROFILES[id]
  return [
    `^XA^MNY^MTD^PW${zebraDots(width)}^LL${zebraDots(height)}^LH0,0^LS0^LT0`,
    `^FO${zebraDots(2)},${zebraDots(2)}^GB${zebraDots(width - 4)},${zebraDots(height - 4)},2^FS`,
    `^FO${zebraDots(5)},${zebraDots(8)}^A0N,26,26^FD${width} x ${height} mm^FS`,
    `^FO${zebraDots(5)},${zebraDots(14)}^A0N,20,20^FDGC420t 203 dpi^FS`,
    ...Array.from({ length: Math.floor((height - 10) / 10) }, (_, i) => {
      const y = (i + 1) * 10
      return `^FO${zebraDots(2)},${zebraDots(y)}^GB${zebraDots(3)},2,2^FS`
    }),
    '^PQ1^XZ',
  ].join('\n')
}
