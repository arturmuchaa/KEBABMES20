/**
 * Tabelka „Stan rozliczeń na dzień … — dokumenty niezapłacone” (spec p. 10.1).
 *
 * Ta sama treść drukuje się pod WZ wychodzącą do klienta i na osobnej
 * kartce „Zestawienie należności”. WZ i faktury to dwie OSOBNE tabele —
 * klient płaci je osobno (gotówka przy WZ, przelew za faktury) i tak samo
 * je sprawdza.
 *
 * Wygląd: delikatne linie między wierszami zamiast siatki i szarych pasów,
 * kwoty do prawej cyframi tabelarycznymi, suma w wyraźnym panelu po prawej.
 * Rozmiary w `em` — pod WZ tabelka bierze krój i skalę dokumentu WZ,
 * na kartce zestawienia krój kartki.
 *
 * Druk bywa czarno-biały: wiersz po terminie jest czerwony, ale liczba dni
 * jest dodatkowo pogrubiona, żeby była czytelna bez koloru. Czerwień tylko
 * dla zaległości — saldo w terminie jest zwykłym tuszem.
 *
 * Zaległe dokumenty sprzed startu przychodzą z backendu z prawdziwym
 * numerem, datą i terminem — drukują się jak każdy dokument. Tylko zbiorcza
 * kwota salda otwarcia ma numer „Saldo otwarcia”.
 */
import type { CSSProperties } from 'react'
import { dataPl, kwota, type KsiegaZestawienia, type Zestawienie } from './druk'
import { DRUK, LICZBOWA } from './NaglowekDruku'

const S = {
  h: { fontSize: '1.05em', fontWeight: 600, margin: '0 0 .7em' } as CSSProperties,
  ks: { fontSize: '1em', fontWeight: 600, margin: '1.1em 0 .35em' } as CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } as CSSProperties,
  th: { padding: '.35em .55em .4em', fontWeight: 600, fontSize: '.84em', color: DRUK.szary,
        textAlign: 'left', borderBottom: `0.75pt solid ${DRUK.liniaMocna}`, verticalAlign: 'bottom' } as CSSProperties,
  td: { padding: '.48em .55em', borderBottom: `0.5pt solid ${DRUK.linia}`, verticalAlign: 'baseline' } as CSSProperties,
  sum: { padding: '.5em .55em .2em', fontWeight: 600 } as CSSProperties,
}

const KOLUMNY = ['Dokument', 'Data wystawienia', 'Termin płatności', 'Kwota', 'Zapłacono', 'Pozostało', 'Dni po terminie']
/** Te same szerokości w tabeli WZ i faktur — kolumny stoją jedna pod drugą. */
const SZEROKOSCI = ['22%', '13%', '13%', '14%', '13%', '14%', '11%']

function Ksiega({ k, naglowek, tytul, waluta }: { k: KsiegaZestawienia; naglowek: string; tytul: string; waluta: string }) {
  if (k.pozycje.length === 0) return null
  return (
    <>
      <h3 style={S.ks}>{naglowek}</h3>
      <table style={S.table}>
        <colgroup>{SZEROKOSCI.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            {KOLUMNY.map((n, i) => (
              <th key={n} style={i >= 3 ? { ...S.th, textAlign: 'right' } : S.th}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {k.pozycje.map((p, i) => {
            const po = p.dni_po_terminie > 0
            return (
              <tr key={`${p.numer}-${i}`} data-po-terminie={po ? '1' : undefined}
                  style={po ? { color: DRUK.czerwony } : undefined}>
                <td style={{ ...S.td, fontWeight: 500 }}>
                  <span>{p.numer}</span>
                  {p.ten_dokument ? <span style={{ fontWeight: 400, fontSize: '.88em' }}> (ten dokument)</span> : null}
                </td>
                <td style={{ ...S.td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{dataPl(p.data)}</td>
                <td style={{ ...S.td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{dataPl(p.termin)}</td>
                <td style={{ ...S.td, ...LICZBOWA }}>{kwota(p.kwota, waluta)}</td>
                <td style={{ ...S.td, ...LICZBOWA }}>{kwota(p.zaplacono, waluta)}</td>
                <td style={{ ...S.td, ...LICZBOWA, fontWeight: 600 }}>{kwota(p.pozostalo, waluta)}</td>
                <td style={{ ...S.td, ...LICZBOWA, fontWeight: po ? 700 : undefined }}>
                  {po ? p.dni_po_terminie : '–'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={S.sum} colSpan={5}>{tytul}</td>
            <td style={{ ...S.sum, ...LICZBOWA }}>{kwota(k.razem, waluta)}</td>
            <td style={S.sum} />
          </tr>
        </tfoot>
      </table>
    </>
  )
}

const wierszPanelu: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1.5em',
}

/**
 * `naWz` — tabelka drukowana pod WZ: WZ ma już własne „Razem do zapłaty” (za
 * ten dokument), więc suma wszystkich niezapłaconych nazywa się inaczej, żeby
 * klient nie zapłacił WZ drugi raz. Osobna kartka zostaje przy „Razem do zapłaty”.
 *
 * `bezTytulu` — osobna kartka ma stan na dzień w nagłówku, więc tytuł
 * tabelki byłby powtórzeniem.
 */
export function TabelaSalda({ z, naWz = false, bezTytulu = false }: {
  z: Zestawienie; naWz?: boolean; bezTytulu?: boolean
}) {
  const dzien = dataPl(z.na_dzien)
  const nadplata = z.nadplata_wz > 0 || z.nadplata_fv > 0
  const brakPozycji = z.wz.pozycje.length === 0 && z.fv.pozycje.length === 0
  const poTerminie = z.po_terminie > 0

  return (
    <div style={{ fontSize: naWz ? 10 : '1em', color: DRUK.tusz, lineHeight: 1.35 }}>
      {!bezTytulu && <div style={S.h}>Stan rozliczeń na dzień {dzien} — dokumenty niezapłacone</div>}

      {z.razem === 0 && brakPozycji && !nadplata ? (
        <div style={{ fontSize: '1.1em', fontWeight: 500, padding: '.6em 0' }}>Brak należności — dziękujemy</div>
      ) : (
        <>
          <Ksiega k={z.wz} naglowek="WZ" tytul="Razem WZ" waluta={z.waluta} />
          <Ksiega k={z.fv} naglowek="Faktury" tytul="Razem faktury" waluta={z.waluta} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.1em' }}>
            <div data-testid="panel-sumy" style={{
              minWidth: '48%', border: `0.75pt solid ${DRUK.linia}`, borderTop: `1.5pt solid ${DRUK.liniaMocna}`,
              background: DRUK.tlo, padding: '.65em .9em .7em', display: 'grid', rowGap: '.3em',
            }}>
              {z.razem > 0 && (
                <>
                  <div data-testid="suma-po-terminie"
                       style={{ ...wierszPanelu, color: poTerminie ? DRUK.czerwony : undefined }}>
                    <span>W tym po terminie</span>
                    <b style={{ ...LICZBOWA, fontWeight: 600 }}>{kwota(z.po_terminie, z.waluta)}</b>
                  </div>
                  <div data-testid="suma-razem" style={{ ...wierszPanelu, fontSize: '1.22em' }}>
                    <span style={{ fontWeight: 600 }}>
                      {naWz ? 'Łącznie do zapłaty (wszystkie niezapłacone dokumenty)' : 'Razem do zapłaty'}
                    </span>
                    <b style={{ ...LICZBOWA, fontWeight: 700 }}>{kwota(z.razem, z.waluta)}</b>
                  </div>
                </>
              )}
              {z.nadplata_wz > 0 && (
                <div style={wierszPanelu}>
                  <span>Nadpłata (WZ)</span>
                  <b style={LICZBOWA}>{kwota(z.nadplata_wz, z.waluta)}</b>
                </div>
              )}
              {z.nadplata_fv > 0 && (
                <div style={wierszPanelu}>
                  <span>Nadpłata (faktury)</span>
                  <b style={LICZBOWA}>{kwota(z.nadplata_fv, z.waluta)}</b>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: '.9em', fontSize: '.86em', color: DRUK.szary }}>
            Wpłaty zaksięgowane do {dzien}. Jeżeli zapłacili Państwo w ostatnich dniach,
            prosimy uznać zestawienie za nieaktualne.
          </div>
        </>
      )}
    </div>
  )
}
