/**
 * ZPL etykiety z szablonu Zebry: tło `^GFA` z importu (PRN albo PDF) + pola
 * sztuki. 203 dpi, `^CI28` (polskie znaki), dane bez `^` i `~`. Pole, które
 * wychodzi poza etykietę, jest pomijane (projektor ostrzega o nim wcześniej).
 */
import type { LabelDesign, LabelField, UnitForLabel } from '@/lib/api'
import { ZEBRA_PROFILES, type ZebraProfileId } from '@/lib/zebraProfiles'
import { poZaEtykieta, rozmiarStrony, wartosciPol } from './model'

const dots = (mm: number, dpi: number) => Math.round((mm * dpi) / 25.4)
const esc = (v: string) => (v ?? '').replace(/[\^~]/g, ' ')
const OBROT: Record<number, string> = { 0: 'N', 90: 'R', 180: 'I', 270: 'B' }
/** Moduły QR dla kodu sztuki (`U|` + id, poziom Q) — wersja 3, 29 modułów. */
const MODULY_QR = 29

export function profilRolki(d: LabelDesign): ZebraProfileId {
  const hit = (Object.keys(ZEBRA_PROFILES) as ZebraProfileId[])
    .find(k => Math.abs(ZEBRA_PROFILES[k].width - d.widthMm) <= 2 && Math.abs(ZEBRA_PROFILES[k].height - d.heightMm) <= 2)
  if (!hit) throw new Error(`Brak rolki ${Math.round(d.widthMm)} × ${Math.round(d.heightMm)} mm — wybierz rozmiar rolki w szablonie`)
  return hit
}

function blok(f: LabelField, wartosc: string, dpi: number): string {
  const x = dots(f.xMm, dpi), y = dots(f.yMm, dpi)
  if (f.kind === 'qr') {
    const m = Math.max(2, Math.min(10, Math.floor(dots(f.qrMm ?? 25, dpi) / MODULY_QR)))
    return `^FO${x},${y}^BQN,2,${m}^FDQA,${esc(wartosc)}^FS`
  }
  if (f.kind === 'box') {
    const w = dots(f.wMm ?? 30, dpi), h = dots(f.hMm ?? 8, dpi)
    const bialy = f.fill === 'white'
    const t = bialy ? Math.min(w, h) : Math.max(1, dots(f.thickMm ?? 0.3, dpi))
    return `^FO${x},${y}^GB${w},${h},${t},${bialy ? 'W' : 'B'}^FS`
  }
  if (!wartosc) return ''
  const h = dots((f.sizePt ?? 10) * 25.4 / 72, dpi)
  const w = Math.round(h * (f.bold ? 1.12 : 0.92))
  const font = `^A0${OBROT[f.rotation ?? 0] ?? 'N'},${h},${w}`
  const fb = f.wMm ? `^FB${dots(f.wMm, dpi)},1,0,${f.align ?? 'L'},0` : ''
  return `^FO${x},${y}${font}${fb}^FD${esc(wartosc)}^FS`
}

/**
 * Tło do pamięci drukarki raz na serię (`~DG`), żeby ~240 KB grafiki 100 × 150
 * nie szło z każdą etykietą — etykieta przywołuje je `^XG`. Nazwa z hasha tła
 * (8 znaków, R: = pamięć RAM drukarki, znika po wyłączeniu).
 */
export function tloDoPamieci(d: LabelDesign): { zpl: string; nazwa: string } {
  const m = /^\^GFA,(\d+),(\d+),(\d+),([0-9A-Fa-f]+)$/.exec(d.backgroundZpl ?? '')
  if (!m) throw new Error('Szablon Zebry nie ma tła do druku — wczytaj plik etykiety ponownie')
  let h = 2166136261
  for (let i = 0; i < m[4].length; i++) { h ^= m[4].charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  const nazwa = `K${h.toString(36).toUpperCase().slice(0, 7)}`
  return { zpl: `~DGR:${nazwa}.GRF,${m[1]},${m[3]},${m[4]}`, nazwa }
}

export function zplSzablonu(d: LabelDesign, u: UnitForLabel, opts: { orgCode?: string; razem?: number; tloZPamieci?: string }): string {
  const dpi = d.dpi || 203
  const s = rozmiarStrony(d)
  const w = wartosciPol(u, opts)
  const pola = d.fields
    .map(f => ({ f, v: f.kind === 'static_text' ? (f.text ?? '') : w[f.kind] }))
    .filter(({ f, v }) => !poZaEtykieta(d, f, v))
    .map(({ f, v }) => blok(f, v, dpi))
    .filter(Boolean)
  return [
    '^XA', '^CI28', `^PW${dots(s.w, dpi)}`, `^LL${dots(s.h, dpi)}`, '^LH0,0', '^LT0', '^MNY', '^MTD', '^LS0',
    opts.tloZPamieci ? `^FO0,0^XGR:${opts.tloZPamieci}.GRF,1,1^FS` : d.backgroundZpl ? `^FO0,0${d.backgroundZpl}^FS` : '',
    ...pola,
    '^XZ',
  ].filter(Boolean).join('\n')
}
