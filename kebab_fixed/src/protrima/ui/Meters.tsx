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

/**
 * Procent pokrycia słowami jednej zasady w całym programie: w dół, a dopóki czegoś brakuje —
 * najwyżej 99% (zwykłe zaokrąglenie pokazywało „100%” przy braku kilku kilogramów).
 */
export const pctPokrycia = (v: number) => v >= 99.95 ? 100 : Math.max(0, Math.min(99, Math.floor(v)))

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
      <span className="val">{pctPokrycia(s + k)}%</span>
    </span>
  )
}

/**
 * Legenda miar — te same klasy co paski, kolor stanu na RODZICU (.cov-ok .f-ship), więc legenda
 * nie rozjedzie się z paskiem. Próbka pokrycia ma oba odcienie w kolejności paska: wydano, w magazynie.
 * Słowa „pełny / przygaszony”, nie „ciemniej / jaśniej”: w motywie grafitowym odcień „w magazynie”
 * jest ciemniejszy od „wydano” (tokens.css), a pełny kolor = wydano zgadza się w obu motywach.
 */
export function MeasureLegend({ withShort = true, withProd = true }: { withShort?: boolean; withProd?: boolean }) {
  const probka = <span className="lg2" aria-hidden="true"><i className="f-ship" /><i className="f-stock" /></span>
  return (
    <span className="legend">
      {withProd && <span><i className="f-prod" />Produkcja (zgłoszono)</span>}
      <span className="cov-ok">{probka}komplet</span>
      <span className="cov-part">{probka}częściowo</span>
      {withShort && <span><i className="f-short" />brak</span>}
      <span className="lg-note">pełny kolor — wydano, przygaszony — w magazynie</span>
    </span>
  )
}
