/**
 * Nagłówek kartek rozliczeń (zestawienie, historia): wystawca z ustawień
 * firmy po lewej, kontrahent po prawej, tytuł pod spodem.
 *
 * Dane firmy zawsze z `settingsApi.getCompany()` — nigdy wpisane w kod.
 */
import type { ReactNode } from 'react'
import type { CompanySettings } from '@/lib/api'
import type { KlientWydruku } from './druk'

export const STYL_STRONY = {
  padding: '10mm 12mm', background: '#fff', color: '#111',
  fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11,
} as const

export const CSS_DRUKU = `
  @page { size: A4 portrait; margin: 8mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  tr { break-inside: avoid; }
`

export function NaglowekDruku({ firma, klient, tytul, podtytul }: {
  firma: CompanySettings | null
  klient: KlientWydruku
  tytul: string
  podtytul?: ReactNode
}) {
  const miasto = firma ? [firma.postalCode, firma.city].filter(Boolean).join(' ') : ''
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16,
                    borderBottom: '1.5px solid #111', paddingBottom: 6, marginBottom: 10,
                    fontSize: 10.5 }}>
        <div data-testid="druk-firma">
          {firma ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{firma.name}</div>
              {firma.address && <div>{firma.address}</div>}
              {miasto && <div>{miasto}</div>}
              {firma.nip && <div>NIP {firma.nip}</div>}
            </>
          ) : null}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#555', fontSize: 9 }}>Kontrahent</div>
          <div style={{ fontWeight: 700, fontSize: 12 }}>{klient.nazwa}</div>
          {klient.adres && <div>{klient.adres}</div>}
          {klient.nip && <div>NIP {klient.nip}</div>}
        </div>
      </div>
      <h1 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 2px' }}>{tytul}</h1>
      {podtytul ? <div style={{ fontSize: 10.5, marginBottom: 8 }}>{podtytul}</div> : null}
    </>
  )
}
