import React from 'react'
import { pct } from '../data/model'

const clamp = (n: number) => Math.max(0, Math.min(100, n))

/** Produkcja zgłoszona — osobna miara, nigdy nie sumowana z pokryciem. */
export function ProdMeter({ value, w = 64 }: { value: number; w?: number }) {
  return (
    <span className="meter" style={{ ['--meter-w' as string]: `${w}px` }}>
      <span className="track"><i className="fill f-prod" style={{ width: `${clamp(value)}%` }} /></span>
      <span className="val">{pct(value)}</span>
    </span>
  )
}

/** Poziom pokrycia do koloru: komplet — zielony, częściowe — pomarańczowy, nic — czerwony. */
export type PoziomPokrycia = 'ok' | 'part' | 'none'
export const poziomPokrycia = (pokrycie: number): PoziomPokrycia => pokrycie >= 99.95 ? 'ok' : pokrycie > 0 ? 'part' : 'none'

/** Pokrycie = wydano (ciemniejszy odcień) + w magazynie (jaśniejszy); kolor wg stanu pokrycia. */
export function CoverMeter({ ship, stock, w = 64 }: { ship: number; stock: number; w?: number }) {
  const s = clamp(ship), k = clamp(Math.min(100 - s, stock))
  return (
    <span className={`meter cov-${poziomPokrycia(s + k)}`} style={{ ['--meter-w' as string]: `${w}px` }}>
      <span className="track">
        {s > 0 && <i className="fill f-ship" style={{ width: `${s}%` }} />}
        {k > 0 && <i className="fill f-stock" style={{ width: `${k}%` }} />}
      </span>
      <span className="val">{pct(s + k)}</span>
    </span>
  )
}

export function MeasureLegend({ withShort = true, withProd = true }: { withShort?: boolean; withProd?: boolean }) {
  return (
    <span className="legend">
      {withProd && <span><i className="f-prod" />Produkcja (zgłoszono)</span>}
      <span className="cov-ok"><i className="f-ship" />komplet</span>
      <span className="cov-part"><i className="f-ship" />częściowo</span>
      {withShort && <span><i className="f-short" />brak</span>}
      <span className="muted">ciemniej — wydano, jaśniej — w magazynie</span>
    </span>
  )
}
