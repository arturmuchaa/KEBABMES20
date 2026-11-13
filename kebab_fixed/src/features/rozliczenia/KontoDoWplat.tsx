/**
 * „Rachunek do wpłat” na dokumentach dla klienta (zestawienie należności,
 * historia rozliczeń, tabelka salda pod WZ) — rachunek w walucie kontrahenta
 * z ustawień Rozrachunków. Gdy biuro go nie podało, bloku nie ma.
 */
import type { CSSProperties } from 'react'
import type { KontoWydruku } from './druk'
import { Dw, type Jezyk } from './jezykDruku'
import { DRUK } from './NaglowekDruku'

/** IBAN/NRB czwórkami: „PL61 1090 1014 …”, sam NRB „61 1090 1014 …”. */
export function numerRachunku(n: string): string {
  const s = (n || '').replace(/\s+/g, '').toUpperCase()
  if (/^\d{26}$/.test(s)) return `${s.slice(0, 2)} ${s.slice(2).replace(/(.{4})(?=.)/g, '$1 ')}`
  return s.replace(/(.{4})(?=.)/g, '$1 ')
}

const wiersz: CSSProperties = { display: 'grid', gridTemplateColumns: '15em 1fr', columnGap: '1.2em', alignItems: 'baseline' }

export function KontoDoWplat({ konto, odbiorca, j }: { konto?: KontoWydruku | null; odbiorca?: string; j: Jezyk }) {
  if (!konto?.numer) return null
  return (
    <div data-testid="konto-do-wplat" className="druk-panel" style={{
      marginTop: '1.1em', border: `0.75pt solid ${DRUK.linia}`, borderLeft: `1.5pt solid ${DRUK.liniaMocna}`,
      padding: '.6em .9em .65em', display: 'grid', rowGap: '.22em', breakInside: 'avoid',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '.1em' }}><Dw k="konto_tytul" j={j} /> ({konto.waluta})</div>
      <div style={wiersz}>
        <span style={{ color: DRUK.szary }}><Dw k="konto_numer" j={j} /></span>
        <b style={{ fontWeight: 600, fontSize: '1.08em', fontVariantNumeric: 'tabular-nums', letterSpacing: '.02em' }}>{numerRachunku(konto.numer)}</b>
      </div>
      {(konto.bank || konto.swift) && <div style={wiersz}>
        <span style={{ color: DRUK.szary }}><Dw k="konto_bank" j={j} /></span>
        <span>{[konto.bank, konto.swift && `SWIFT/BIC ${konto.swift}`].filter(Boolean).join(' · ')}</span>
      </div>}
      {odbiorca && <div style={wiersz}>
        <span style={{ color: DRUK.szary }}><Dw k="konto_odbiorca" j={j} /></span>
        <span>{odbiorca}</span>
      </div>}
    </div>
  )
}
