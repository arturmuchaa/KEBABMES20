/**
 * Kartka rozliczeń dla klienta (zestawienie należności, historia rozliczeń):
 * arkusz A4, nagłówek z logo zakładu i danymi firmy, tytuł dokumentu,
 * nabywca w ramce, stopka z kontaktem i chwilą wydruku.
 *
 * Dane firmy zawsze z `settingsApi.getCompany()` — nigdy wpisane w kod;
 * logo ze wspólnego `LogoZakladu` (to samo co na WZ).
 *
 * Wygląd: jeden krój (Fira Sans, self-hosted w aplikacji — działa też
 * w renderze PDF bez internetu), delikatne linie zamiast szarych pasów,
 * kwoty do prawej cyframi tabelarycznymi. Na ekranie kartka leży na tle
 * jak arkusz papieru; w druku tło i cień znikają.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { CompanySettings } from '@/lib/api'
import { LogoZakladu } from '@/components/print/LogoZakladu'
import { chwilaWydruku, type KlientWydruku } from './druk'

/** Kolory kartki — druk bywa czarno-biały, więc treść niesie tusz,
 *  a szarości tylko porządkują (etykiety, linie). */
export const DRUK = {
  tusz: '#1a1d21',
  szary: '#5d646d',
  linia: '#d3d8de',
  liniaMocna: '#1a1d21',
  tlo: '#f5f7f9',
  czerwony: '#b00020',
} as const

export const LICZBOWA: CSSProperties = {
  textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
}

/** Marginesy @page; `min-height` arkusza w druku = wysokość A4 minus
 *  marginesy minus zapas, żeby stopka stała na dole jedynej kartki,
 *  a zaokrąglenia nie wypchnęły pustej drugiej strony. */
export const CSS_DRUKU = `
  @page { size: A4 portrait; margin: 12mm 14mm 11mm; }
  html, body { margin: 0; padding: 0; }
  .druk-arkusz {
    box-sizing: border-box; display: flex; flex-direction: column;
    background: #fff; color: ${DRUK.tusz};
    font-family: 'Fira Sans', 'Segoe UI', Arial, sans-serif;
    font-size: 9.5pt; line-height: 1.38;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .druk-arkusz h1, .druk-arkusz h2, .druk-arkusz h3 { margin: 0; }
  .druk-tresc { flex: 1 0 auto; }
  .druk-arkusz tr { break-inside: avoid; }
  .druk-arkusz thead { display: table-header-group; }
  @media screen {
    html, body { background: #e8ebee; }
    .druk-arkusz {
      width: 210mm; min-height: 297mm; margin: 16px auto 32px; padding: 12mm 14mm 11mm;
      box-shadow: 0 1px 2px rgba(16, 24, 32, .10), 0 10px 30px rgba(16, 24, 32, .10);
    }
  }
  @media print {
    html, body { background: #fff; }
    .druk-arkusz { min-height: 270mm; }
  }
`

function adresFirmy(f: CompanySettings): string {
  const miasto = [f.postalCode, f.city].filter(Boolean).join(' ')
  return [f.address, miasto].filter(Boolean).join(', ')
}

/** Arkusz ze stopką na dole. Treść kartki to `children`. */
export function ArkuszDruku({ firma, children }: { firma: CompanySettings | null; children: ReactNode }) {
  return (
    <div className="druk-arkusz">
      <style>{CSS_DRUKU}</style>
      <div className="druk-tresc">{children}</div>
      <StopkaDruku firma={firma} />
    </div>
  )
}

function StopkaDruku({ firma }: { firma: CompanySettings | null }) {
  const kontakt = firma
    ? [firma.name, adresFirmy(firma), firma.phone && `tel. ${firma.phone}`, firma.email].filter(Boolean)
    : []
  return (
    <footer data-testid="druk-stopka" style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '6mm',
      marginTop: '8mm', paddingTop: '2.2mm', borderTop: `0.5pt solid ${DRUK.linia}`,
      fontSize: '7.5pt', color: DRUK.szary, lineHeight: 1.45,
    }}>
      <div>{kontakt.join('  ·  ')}</div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div>Wydrukowano {chwilaWydruku()}</div>
        <div>Dokument wygenerowany w systemie PROTRIMA</div>
      </div>
    </footer>
  )
}

export const ETYKIETA: CSSProperties = {
  fontSize: '7.5pt', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
  color: DRUK.szary,
}

export function NaglowekDruku({ firma, klient, tytul, dane }: {
  firma: CompanySettings | null
  klient: KlientWydruku
  tytul: string
  /** Pary etykieta–wartość obok ramki nabywcy (np. „Stan na dzień”, „Waluta”). */
  dane: [string, ReactNode][]
}) {
  const adres = firma ? adresFirmy(firma) : ''
  return (
    <header style={{ marginBottom: '7mm' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: '8mm', paddingBottom: '4.5mm', borderBottom: `0.75pt solid ${DRUK.liniaMocna}` }}>
        <div data-testid="druk-firma" style={{ lineHeight: 1.45 }}>
          <LogoZakladu wysokosc={34} przyciete style={{ marginBottom: '3.2mm' }} />
          {firma ? (
            <>
              <div style={{ fontWeight: 600, fontSize: '10pt' }}>{firma.name}</div>
              {adres && <div style={{ color: DRUK.szary }}>{adres}</div>}
              {firma.nip && <div style={{ color: DRUK.szary }}>NIP {firma.nip}</div>}
            </>
          ) : null}
        </div>
        <h1 style={{ fontSize: '19pt', fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.15,
                     textAlign: 'right', paddingTop: '1mm', maxWidth: '85mm' }}>
          {tytul}
        </h1>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: '8mm', marginTop: '5mm' }}>
        <div data-testid="druk-nabywca" style={{
          flex: '0 1 98mm', border: `0.75pt solid ${DRUK.linia}`, borderRadius: '1.5mm',
          padding: '3mm 4mm', lineHeight: 1.45,
        }}>
          <div style={{ ...ETYKIETA, marginBottom: '1.2mm' }}>Nabywca</div>
          <div style={{ fontWeight: 600, fontSize: '11pt' }}>{klient.nazwa}</div>
          {klient.adres && <div>{klient.adres}</div>}
          {klient.nip && <div>NIP {klient.nip}</div>}
        </div>
        <dl data-testid="druk-dane" style={{
          margin: 0, display: 'grid', gridTemplateColumns: 'auto auto', columnGap: '6mm', rowGap: '1.4mm',
          paddingTop: '3mm',
        }}>
          {dane.map(([etykieta, wartosc]) => (
            <div key={etykieta} style={{ display: 'contents' }}>
              <dt style={{ color: DRUK.szary }}>{etykieta}</dt>
              <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {wartosc}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  )
}
