/**
 * „Historia rozliczeń” za okres (spec p. 10.3) — wyciąg jak z banku, do
 * wyjaśniania „ja to już zapłaciłem”: saldo na początek, dokumenty i wpłaty
 * w kolejności dat z saldem narastającym, saldo na koniec — osobno WZ
 * i faktury, na końcu saldo łączne.
 *
 * Kartka: logo zakładu, firma, nabywca w ramce, okres i waluta w nagłówku
 * (NaglowekDruku), panel „Saldo łącznie na …” na końcu, stopka z kontaktem.
 *
 * Dokument z niezapłaconą resztą po terminie (stan na koniec okresu) jest
 * czerwony, a liczba dni pogrubiona — czytelne też na drukarce czarno-białej.
 *
 * Saldo otwarcia przychodzi jako wiersz „Saldo otwarcia”: dług w kolumnie
 * Obciążenie, nadpłata w kolumnie Wpłata.
 *
 * /office/rozliczenia/:clientId/historia/druk?od=&do= — auto-druk
 * (?pdf=1 wyłącza; tak renderuje serwer do PDF).
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { rozliczeniaApi, settingsApi, type CompanySettings } from '@/lib/api'
import { drukuj } from '@/lib/print'
import { PrintToolbar } from '@/components/print/PrintToolbar'
import { ArkuszDruku, DRUK, LICZBOWA, NaglowekDruku } from '@/features/rozliczenia/NaglowekDruku'
import { dataPl, kwota, type HistoriaOkresu, type KsiegaHistorii } from '@/features/rozliczenia/druk'

const S = {
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } as CSSProperties,
  th: { padding: '.35em .55em .4em', fontWeight: 600, fontSize: '.84em', color: DRUK.szary,
        textAlign: 'left', borderBottom: `0.75pt solid ${DRUK.liniaMocna}`, verticalAlign: 'bottom' } as CSSProperties,
  td: { padding: '.45em .55em', borderBottom: `0.5pt solid ${DRUK.linia}`, verticalAlign: 'baseline' } as CSSProperties,
  /** Saldo na początek — wiersz otwierający, spokojny. */
  pocz: { padding: '.45em .55em', borderBottom: `0.5pt solid ${DRUK.linia}`, color: DRUK.szary,
          fontWeight: 600 } as CSSProperties,
  /** Saldo na koniec — zamyka księgę mocniejszą linią. */
  kon: { padding: '.5em .55em .3em', borderTop: `0.75pt solid ${DRUK.liniaMocna}`, fontWeight: 600 } as CSSProperties,
}
const KOLUMNY = ['Data', 'Opis', 'Obciążenie', 'Wpłata', 'Saldo', 'Dni po terminie']
const dataKom: CSSProperties = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }

function pusta(k: KsiegaHistorii): boolean {
  return k.wiersze.length === 0 && k.saldo_poczatek === 0 && k.saldo_koniec === 0
}

function Ksiega({ k, tytul, waluta, od, do_ }: {
  k: KsiegaHistorii; tytul: string; waluta: string; od: string; do_: string
}) {
  const kw = (n: number) => (n ? kwota(n, waluta) : '')
  return (
    <section style={{ marginBottom: '6mm' }}>
      <h2 style={{ fontSize: '1.05em', fontWeight: 600, margin: '0 0 .35em' }}>{tytul}</h2>
      <table style={S.table}>
        <colgroup>
          <col style={{ width: '19mm' }} /><col />
          <col style={{ width: '27mm' }} /><col style={{ width: '27mm' }} /><col style={{ width: '29mm' }} />
          <col style={{ width: '23mm' }} />
        </colgroup>
        <thead>
          <tr>
            {KOLUMNY.map((n, i) => (
              <th key={n} style={i >= 2 ? { ...S.th, textAlign: 'right', whiteSpace: 'nowrap' } : S.th}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...S.pocz, ...dataKom }}>{dataPl(od)}</td>
            <td style={S.pocz} colSpan={3}>Saldo na początek okresu</td>
            <td style={{ ...S.pocz, ...LICZBOWA }}>{kwota(k.saldo_poczatek, waluta)}</td>
            <td style={S.pocz} />
          </tr>
          {k.wiersze.map((w, i) => {
            const po = w.dni_po_terminie > 0
            return (
              <tr key={i} data-rodzaj={w.rodzaj} data-po-terminie={po ? '1' : undefined}
                  style={po ? { color: DRUK.czerwony } : undefined}>
                <td style={{ ...S.td, ...dataKom }}>{dataPl(w.data)}</td>
                <td style={{ ...S.td, fontWeight: w.rodzaj === 'dokument' ? 500 : undefined }}>{w.opis}</td>
                <td style={{ ...S.td, ...LICZBOWA }}>{kw(w.obciazenie)}</td>
                <td style={{ ...S.td, ...LICZBOWA }}>{kw(w.wplata)}</td>
                <td style={{ ...S.td, ...LICZBOWA }}>{kwota(w.saldo, waluta)}</td>
                <td style={{ ...S.td, ...LICZBOWA, fontWeight: po ? 700 : undefined }}>
                  {po ? w.dni_po_terminie : '–'}
                </td>
              </tr>
            )
          })}
          {k.wiersze.length === 0 && (
            <tr><td style={{ ...S.td, color: DRUK.szary }} colSpan={6}>Brak dokumentów i wpłat w tym okresie.</td></tr>
          )}
          <tr>
            <td style={{ ...S.kon, ...dataKom }}>{dataPl(do_)}</td>
            <td style={S.kon} colSpan={3}>Saldo na koniec okresu</td>
            <td style={{ ...S.kon, ...LICZBOWA }}>{kwota(k.saldo_koniec, waluta)}</td>
            <td style={S.kon} />
          </tr>
        </tbody>
      </table>
    </section>
  )
}

const wierszPanelu: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1.5em',
}

export function HistoriaRozliczenPrintPage() {
  const { clientId = '' } = useParams()
  const [sp] = useSearchParams()
  const isPdf = sp.get('pdf') === '1'
  const od = sp.get('od') || ''
  const do_ = sp.get('do') || ''
  const [h, setH] = useState<HistoriaOkresu | null>(null)
  // undefined = jeszcze się wczytuje; null = nie udało się (drukujemy bez niej)
  const [firma, setFirma] = useState<CompanySettings | null | undefined>(undefined)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!od || !do_) { setErr('Brak zakresu dat (parametry od/do)'); return }
    rozliczeniaApi.historia(clientId, od, do_)
      .then(setH).catch(e => setErr(String(e?.message || e)))
    settingsApi.getCompany().then(setFirma).catch(() => setFirma(null))
  }, [clientId, od, do_])

  useEffect(() => {
    if (h && firma !== undefined && !isPdf) setTimeout(() => void drukuj(), 300)
  }, [h, firma, isPdf])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!h || firma === undefined) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  // Księga bez żadnego ruchu i z zerowym saldem tylko zaśmieca kartkę;
  // gdy obie są puste, zostawiamy obie — kartka mówi wtedy wprost „zero”.
  const ksiegi = ([['wz', 'WZ'], ['fv', 'Faktury']] as const).filter(([ks]) => !pusta(h[ks]))
  const pokaz = ksiegi.length ? ksiegi : ([['wz', 'WZ'], ['fv', 'Faktury']] as const)

  return (
    <>
      <PrintToolbar powrot="/office" />
      <ArkuszDruku firma={firma}>
        <NaglowekDruku firma={firma} klient={h.klient} tytul="Historia rozliczeń"
          dane={[['Okres', `${dataPl(h.od)} – ${dataPl(h.do)}`], ['Waluta', h.waluta]]} />
        {pokaz.map(([ks, tytul]) => (
          <Ksiega key={ks} k={h[ks]} tytul={tytul} waluta={h.waluta} od={h.od} do_={h.do} />
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8mm' }}>
          <div style={{ fontSize: '.86em', color: DRUK.szary, maxWidth: '80mm' }}>
            Saldo ujemne oznacza kwotę do zapłaty, dodatnie — nadpłatę.
          </div>
          <div style={{ minWidth: '48%', border: `0.75pt solid ${DRUK.linia}`,
                        borderTop: `1.5pt solid ${DRUK.liniaMocna}`, background: DRUK.tlo,
                        padding: '.65em .9em .7em', display: 'grid', rowGap: '.3em' }}>
            {pokaz.length > 1 && pokaz.map(([ks, tytul]) => (
              <div key={ks} style={wierszPanelu}>
                <span>Saldo {tytul === 'WZ' ? 'WZ' : 'faktur'}</span>
                <b style={{ ...LICZBOWA, fontWeight: 600 }}>{kwota(h[ks].saldo_koniec, h.waluta)}</b>
              </div>
            ))}
            <div data-testid="saldo-lacznie" style={{ ...wierszPanelu, fontSize: '1.22em' }}>
              <span style={{ fontWeight: 600 }}>Saldo łącznie na {dataPl(h.do)}</span>
              <b style={{ ...LICZBOWA, fontWeight: 700 }}>{kwota(h.saldo_koniec, h.waluta)}</b>
            </div>
          </div>
        </div>
      </ArkuszDruku>
    </>
  )
}
