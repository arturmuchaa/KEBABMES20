/**
 * Logo zakładu na dokumentach (WZ, zestawienie należności, historia
 * rozliczeń). JEDYNE miejsce ze ścieżką do pliku logo dla tych wydruków —
 * inny zakład podmienia plik i wymiary tutaj, a nie w każdym dokumencie.
 *
 * Plik ma szeroki biały margines (tak wygląda na WZ w wysokości 72 px).
 * `znak` to prostokąt samego logo w pikselach pliku: wariant `przyciete`
 * pokazuje tylko jego, z tego samego pliku, żeby logo w nagłówku kartki
 * stało równo z tekstem pod spodem.
 */
import type { CSSProperties } from 'react'

export const LOGO_ZAKLADU = {
  src: '/logo-ksiezyc.png',
  alt: 'Księżyc',
  /** Wymiary całego pliku (px). */
  plik: { w: 3667, h: 1267 },
  /** Obszar samego znaku w pliku (px). */
  znak: { x: 444, y: 444, w: 2779, h: 379 },
} as const

export function LogoZakladu({ wysokosc, przyciete = false, style }: {
  /** Wysokość w px (całego pliku albo — przy `przyciete` — samego znaku). */
  wysokosc: number
  przyciete?: boolean
  style?: CSSProperties
}) {
  const { src, alt, plik, znak } = LOGO_ZAKLADU
  if (!przyciete) {
    return <img src={src} alt={alt} style={{ height: wysokosc, width: 'auto', ...style }} />
  }
  const skala = wysokosc / znak.h
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', lineHeight: 0,
                   width: Math.round(znak.w * skala * 10) / 10, height: wysokosc, ...style }}>
      <img src={src} alt={alt} style={{
        display: 'block', maxWidth: 'none',
        width: plik.w * skala, height: plik.h * skala,
        marginLeft: -znak.x * skala, marginTop: -znak.y * skala,
      }} />
    </span>
  )
}
