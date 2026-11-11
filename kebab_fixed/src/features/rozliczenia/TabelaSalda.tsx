/**
 * Tabelka „Stan rozliczeń na dzień … — dokumenty niezapłacone” (spec p. 10.1).
 *
 * Ta sama treść drukuje się pod WZ wychodzącą do klienta i na osobnej
 * kartce „Zestawienie należności”. WZ i faktury to dwie OSOBNE tabele —
 * klient płaci je osobno (gotówka przy WZ, przelew za faktury) i tak samo
 * je sprawdza.
 *
 * Druk bywa czarno-biały: wiersz po terminie jest czerwony, ale liczba dni
 * jest dodatkowo pogrubiona, żeby była czytelna bez koloru.
 */
import type { CSSProperties } from 'react'
import { dataPl, kwota, type KsiegaZestawienia, type Zestawienie } from './druk'

const CZERWONY = '#b00020'
const RAMKA = '1px solid #9a9a9a'

const S = {
  h: { fontSize: 10.5, fontWeight: 700, margin: '0 0 4px' } as CSSProperties,
  ks: { fontSize: 10, fontWeight: 700, margin: '6px 0 2px' } as CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 9.5, marginBottom: 6 } as CSSProperties,
  th: { border: RAMKA, background: '#d7d7d7', padding: '2px 5px', fontWeight: 700,
        fontSize: 9, textAlign: 'left' } as CSSProperties,
  td: { border: RAMKA, padding: '2px 5px' } as CSSProperties,
  sum: { border: RAMKA, background: '#d7d7d7', padding: '2px 5px', fontWeight: 700 } as CSSProperties,
}
const liczbowa: CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }

const KOLUMNY = ['Dokument', 'Data wystawienia', 'Termin płatności', 'Kwota', 'Zapłacono', 'Pozostało', 'Dni po terminie']
/** Te same szerokości w tabeli WZ i faktur — kolumny stoją jedna pod drugą. */
const SZEROKOSCI = ['22%', '13%', '13%', '13%', '13%', '13%', '13%']

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
                  style={po ? { color: CZERWONY } : undefined}>
                <td style={S.td}>
                  <span>{p.numer}</span>
                  {p.ten_dokument ? <span> (ten dokument)</span> : null}
                </td>
                <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{dataPl(p.data)}</td>
                <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{dataPl(p.termin)}</td>
                <td style={{ ...S.td, ...liczbowa }}>{kwota(p.kwota, waluta)}</td>
                <td style={{ ...S.td, ...liczbowa }}>{kwota(p.zaplacono, waluta)}</td>
                <td style={{ ...S.td, ...liczbowa }}>{kwota(p.pozostalo, waluta)}</td>
                <td style={{ ...S.td, ...liczbowa, fontWeight: po ? 700 : undefined }}>
                  {po ? p.dni_po_terminie : '–'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={S.sum} colSpan={5}>{tytul}</td>
            <td style={{ ...S.sum, ...liczbowa }}>{kwota(k.razem, waluta)}</td>
            <td style={S.sum} />
          </tr>
        </tfoot>
      </table>
    </>
  )
}

/**
 * `naWz` — tabelka drukowana pod WZ: WZ ma już własne „Razem do zapłaty” (za
 * ten dokument), więc suma wszystkich niezapłaconych nazywa się inaczej, żeby
 * klient nie zapłacił WZ drugi raz. Osobna kartka zostaje przy „Razem do zapłaty”.
 */
export function TabelaSalda({ z, naWz = false }: { z: Zestawienie; naWz?: boolean }) {
  const dzien = dataPl(z.na_dzien)
  const nadplata = z.nadplata_wz > 0 || z.nadplata_fv > 0
  const brakPozycji = z.wz.pozycje.length === 0 && z.fv.pozycje.length === 0

  return (
    <div style={{ fontSize: 10, color: '#111' }}>
      <div style={S.h}>Stan rozliczeń na dzień {dzien} — dokumenty niezapłacone</div>

      {z.razem === 0 && brakPozycji && !nadplata ? (
        <div>Brak należności — dziękujemy</div>
      ) : (
        <>
          <Ksiega k={z.wz} naglowek="WZ" tytul="Razem WZ" waluta={z.waluta} />
          <Ksiega k={z.fv} naglowek="Faktury" tytul="Razem faktury" waluta={z.waluta} />

          {z.razem > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 11,
                          borderTop: '1.5px solid #111', paddingTop: 4, marginTop: 2 }}>
              <span style={z.po_terminie > 0 ? { color: CZERWONY } : undefined}>
                W tym po terminie: <b>{kwota(z.po_terminie, z.waluta)}</b>
              </span>
              <span>{naWz ? 'Łącznie do zapłaty (wszystkie niezapłacone dokumenty)' : 'Razem do zapłaty'}: <b>{kwota(z.razem, z.waluta)}</b></span>
            </div>
          )}
          {z.nadplata_wz > 0 && (
            <div style={{ textAlign: 'right', marginTop: 2 }}>
              Nadpłata (WZ): <b>{kwota(z.nadplata_wz, z.waluta)}</b>
            </div>
          )}
          {z.nadplata_fv > 0 && (
            <div style={{ textAlign: 'right', marginTop: 2 }}>
              Nadpłata (faktury): <b>{kwota(z.nadplata_fv, z.waluta)}</b>
            </div>
          )}

          <div style={{ marginTop: 6, fontSize: 9, color: '#444' }}>
            Wpłaty zaksięgowane do {dzien}. Jeżeli zapłacili Państwo w ostatnich dniach,
            prosimy uznać zestawienie za nieaktualne.
          </div>
        </>
      )}
    </div>
  )
}
