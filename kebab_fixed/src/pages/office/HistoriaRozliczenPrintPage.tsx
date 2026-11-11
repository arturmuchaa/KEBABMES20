/**
 * „Historia rozliczeń” za okres (spec p. 10.3) — wyciąg jak z banku, do
 * wyjaśniania „ja to już zapłaciłem”: saldo na początek, dokumenty i wpłaty
 * w kolejności dat z saldem narastającym, saldo na koniec — osobno WZ
 * i faktury, na końcu saldo łączne.
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
import { CSS_DRUKU, NaglowekDruku, STYL_STRONY } from '@/features/rozliczenia/NaglowekDruku'
import { dataPl, kwota, type HistoriaOkresu, type KsiegaHistorii } from '@/features/rozliczenia/druk'

const RAMKA = '1px solid #9a9a9a'
const S = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 10, marginBottom: 10 } as CSSProperties,
  th: { border: RAMKA, background: '#d7d7d7', padding: '3px 5px', fontWeight: 700,
        fontSize: 9.5, textAlign: 'left' } as CSSProperties,
  td: { border: RAMKA, padding: '2px 5px' } as CSSProperties,
  sum: { border: RAMKA, background: '#efefef', padding: '3px 5px', fontWeight: 700 } as CSSProperties,
}
const liczbowa: CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const KOLUMNY = ['Data', 'Opis', 'Obciążenie', 'Wpłata', 'Saldo']

function pusta(k: KsiegaHistorii): boolean {
  return k.wiersze.length === 0 && k.saldo_poczatek === 0 && k.saldo_koniec === 0
}

function Ksiega({ k, tytul, waluta, od, do_ }: {
  k: KsiegaHistorii; tytul: string; waluta: string; od: string; do_: string
}) {
  const kw = (n: number) => (n ? kwota(n, waluta) : '')
  return (
    <section>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>{tytul}</h2>
      <table style={S.table}>
        <colgroup>
          <col style={{ width: '22mm' }} /><col />
          <col style={{ width: '30mm' }} /><col style={{ width: '30mm' }} /><col style={{ width: '32mm' }} />
        </colgroup>
        <thead>
          <tr>
            {KOLUMNY.map((n, i) => (
              <th key={n} style={i >= 2 ? { ...S.th, textAlign: 'right' } : S.th}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={S.sum}>{dataPl(od)}</td>
            <td style={S.sum} colSpan={3}>Saldo na początek okresu</td>
            <td style={{ ...S.sum, ...liczbowa }}>{kwota(k.saldo_poczatek, waluta)}</td>
          </tr>
          {k.wiersze.map((w, i) => (
            <tr key={i} data-rodzaj={w.rodzaj}>
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{dataPl(w.data)}</td>
              <td style={S.td}>{w.opis}</td>
              <td style={{ ...S.td, ...liczbowa }}>{kw(w.obciazenie)}</td>
              <td style={{ ...S.td, ...liczbowa }}>{kw(w.wplata)}</td>
              <td style={{ ...S.td, ...liczbowa }}>{kwota(w.saldo, waluta)}</td>
            </tr>
          ))}
          {k.wiersze.length === 0 && (
            <tr><td style={S.td} colSpan={5}>Brak dokumentów i wpłat w tym okresie.</td></tr>
          )}
          <tr>
            <td style={S.sum}>{dataPl(do_)}</td>
            <td style={S.sum} colSpan={3}>Saldo na koniec okresu</td>
            <td style={{ ...S.sum, ...liczbowa }}>{kwota(k.saldo_koniec, waluta)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
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
    <div style={STYL_STRONY}>
      <PrintToolbar powrot="/office" />
      <style>{CSS_DRUKU}</style>
      <NaglowekDruku firma={firma} klient={h.klient}
        tytul={`Historia rozliczeń ${dataPl(h.od)} – ${dataPl(h.do)}`}
        podtytul="Saldo ujemne oznacza kwotę do zapłaty, dodatnie — nadpłatę." />
      {pokaz.map(([ks, tytul]) => (
        <Ksiega key={ks} k={h[ks]} tytul={tytul} waluta={h.waluta} od={h.od} do_={h.do} />
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 12,
                    borderTop: '1.5px solid #111', paddingTop: 6 }}>
        <span>Saldo łącznie: <b>{kwota(h.saldo_koniec, h.waluta)}</b></span>
      </div>
    </div>
  )
}
