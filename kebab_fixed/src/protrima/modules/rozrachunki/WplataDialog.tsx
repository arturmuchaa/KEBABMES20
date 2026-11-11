import React, { useEffect, useMemo, useState } from 'react'
import { Wallet } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  FORMA_SLOWEM, dzisIso, kwotaSalda, mapujPodglad, opisRozliczenia, znakSalda,
  type Forma, type Karta, type Ksiega, type PodgladWplaty,
} from './model'
import { OdmowaSerwera, PoleKwoty, Segment, klasaSalda, kwotaZPola, naEnter, tekstBledu, useZapis } from './wspolne'

const KSIEGI = [['wz', 'WZ'], ['fv', 'Faktury']] as const
const FORMY = [['gotowka', 'Gotówka'], ['przelew', 'Przelew']] as const
const BLAD_KWOTY = 'Wpisz kwotę większą od zera'
/** Podgląd rozliczenia pyta serwer dopiero, gdy biuro przestanie pisać. */
const ZWLOKA_PODGLADU = 250

const doGroszy = (x: number) => Math.round(x * 100) / 100

/** Domyślna forma księgi z ustawień klienta (WZ zwykle gotówka, faktury przelew). */
const formaKsiegi = (k: Karta, ks: Ksiega): Forma => {
  const f = ks === 'wz' ? k.klient.formaWz : k.klient.formaFv
  return f === 'gotowka' || f === 'przelew' ? f : ks === 'wz' ? 'gotowka' : 'przelew'
}

/** Dokumenty z czymś do zapłaty, od najstarszego — kolejność, w jakiej wpłata je pokrywa. */
const otwarte = (k: Karta, ks: Ksiega) => k.dokumenty[ks]
  .filter(d => !d.otwarcie && znakSalda(d.zostalo) > 0)
  .sort((a, b) => a.data.localeCompare(b.data) || a.numer.localeCompare(b.numer, 'pl', { numeric: true }))

/**
 * Wpłata gotówką albo przelewem do księgi WZ lub faktur. Wspólny przypadek:
 * okno → kwota → Enter. Pod formularzem podgląd na żywo z serwera: które
 * dokumenty ta wpłata zamknie, co zostanie, ile pójdzie na nadpłatę.
 */
export function WplataDialog({ karta, ksiega: ksiegaStart, dokumentId, onClose, onZapisano }: {
  karta: Karta; onClose: () => void; onZapisano: () => void
  /** Księga, od której biuro zaczęło (np. z dokumentu); domyślnie faktury. */
  ksiega?: Ksiega
  /** Dokument wskazany w tytule przelewu — wpłata pokrywa go pierwszy. */
  dokumentId?: string
}) {
  const app = useApp()
  const w = karta.klient.waluta
  const [ksiega, setKsiega] = useState<Ksiega>(ksiegaStart ?? 'fv')
  const [forma, setForma] = useState<Forma>(() => formaKsiegi(karta, ksiegaStart ?? 'fv'))
  const [formaReczna, setFormaReczna] = useState(false)
  const [tekst, setTekst] = useState('')
  const [data, setData] = useState(dzisIso)
  const [dokument, setDokument] = useState(dokumentId ?? '')
  const [uwagi, setUwagi] = useState('')
  const zapis = useZapis('Nie udało się zapisać wpłaty')

  const lista = useMemo(() => otwarte(karta, ksiega), [karta, ksiega])
  const kw = kwotaZPola(tekst)
  const kwR = Number.isFinite(kw) ? doGroszy(kw) : NaN
  const okKwota = kwR > 0
  const bladKwoty = tekst.trim() && !okKwota ? BLAD_KWOTY : null
  const bladDaty = !data ? 'Wpisz datę wpłaty'
    : data < karta.start ? `Data przed startem rozliczeń (${dataPl(karta.start)}) — ta wpłata siedzi już w saldzie otwarcia` : null
  const ok = okKwota && !bladDaty
  const tip = !okKwota ? BLAD_KWOTY : bladDaty ?? undefined

  const zmienKsiege = (k: Ksiega) => {
    setKsiega(k)
    // Forma idzie za księgą (WZ — gotówka, faktury — przelew), dopóki biuro samo jej nie wybrało.
    if (!formaReczna) setForma(formaKsiegi(karta, k))
    if (!otwarte(karta, k).some(d => d.id === dokument)) setDokument('')
  }

  // Podgląd: po chwili bez pisania; odpowiedź do starej kwoty nie nadpisuje nowej.
  const [podglad, setPodglad] = useState<{ klucz: string; p?: PodgladWplaty; blad?: string } | null>(null)
  const klucz = okKwota ? `${ksiega}|${kwR}|${dokument}` : ''
  useEffect(() => {
    if (!klucz) { setPodglad(null); return }
    let aktualny = true
    const t = setTimeout(() => {
      rozliczeniaApi.podgladWplaty(karta.klient.id, { ksiega, kwota: kwR, dokument_id: dokument || null })
        .then(r => { if (aktualny) setPodglad({ klucz, p: mapujPodglad(r) }) })
        .catch(e => { if (aktualny) setPodglad({ klucz, blad: tekstBledu(e, 'nie udało się policzyć') }) })
    }, ZWLOKA_PODGLADU)
    return () => { aktualny = false; clearTimeout(t) }
  }, [klucz]) // eslint-disable-line react-hooks/exhaustive-deps

  const zapisz = () => {
    if (!ok) return
    void zapis.zapisz(async () => {
      const r = await rozliczeniaApi.dodajWplate(karta.klient.id, {
        ksiega, forma, kwota: kwR, data, dokument_id: dokument || null, uwagi: uwagi.trim(),
      })
      const opis = opisRozliczenia(mapujPodglad(r), w)
      app.toast({
        kind: 'ok', title: `Wpłata ${kwota(kwR, w)} zapisana${opis ? ` — ${opis}` : ''}`,
        detail: `${karta.klient.nazwa} · ${ksiega === 'wz' ? 'księga WZ' : 'księga faktur'} · ${FORMA_SLOWEM[forma]} · ${dataPl(data)}`,
      })
      onZapisano()
    })
  }

  const saldo = ksiega === 'wz' ? karta.saldo.wz : karta.saldo.fv
  const poTerminie = ksiega === 'wz' ? karta.saldo.poTerminieWz : karta.saldo.poTerminieFv
  const wskazany = lista.find(d => d.id === dokument)
  return (
    <Dialog wide icon={<Wallet size={20} />} onClose={onClose}
      title={<>Wpłata <span className="rr-dlg-klient">{karta.klient.nazwa}</span></>}
      footer={<>
        <span className="left"><span className="kbd">Enter</span> zapisuje · <span className="kbd">Esc</span> zamyka</span>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || zapis.busy} data-tip={tip} onClick={zapisz}>
          {zapis.busy ? 'Zapisuję…' : 'Zapisz wpłatę'}
        </button>
      </>}>
      <div className="rr-form">
        <div className="fld"><span className="label">Do czego</span>
          <Segment label="Do czego" value={ksiega} opcje={KSIEGI} onChange={zmienKsiege} />
          <span className="rr-pole-pod">Saldo {ksiega === 'wz' ? 'WZ' : 'faktur'}: <b className={`tnum${klasaSalda(saldo)}`}>{kwotaSalda(saldo, w)}</b>
            {znakSalda(poTerminie) > 0 && <> · po terminie <b className="tnum crit-ink">{kwota(poTerminie, w)}</b></>}</span>
        </div>
        <div className="fld"><span className="label">Forma</span>
          <Segment label="Forma" value={forma} opcje={FORMY} onChange={f => { setForma(f); setFormaReczna(true) }} />
        </div>
        <div className="fld"><span className="label">Kwota ({w})</span>
          <PoleKwoty label="Kwota" value={tekst} onChange={setTekst} waluta={w} blad={bladKwoty} onEnter={zapisz} autofocus duze />
        </div>
        <label className="fld"><span className="label">Data wpłaty</span>
          <input type="date" className={`field${bladDaty ? ' invalid' : ''}`} value={data} min={karta.start} aria-label="Data wpłaty"
            aria-invalid={bladDaty ? true : undefined} onChange={e => setData(e.target.value)} onKeyDown={naEnter(zapisz)} />
          {bladDaty && <span className="rr-pole-blad">{bladDaty}</span>}
        </label>
        <label className="fld rr-form-cala"><span className="label">Dokument</span>
          <select className="field" value={dokument} aria-label="Dokument" onChange={e => setDokument(e.target.value)}>
            <option value="">Od najstarszych</option>
            {lista.map(d => <option key={d.id} value={d.id}>{`${d.numer} · ${dataPl(d.data)} · zostało ${kwota(d.zostalo, w)}`}</option>)}
          </select>
          <span className="rr-pole-pod">Wskaż dokument, gdy klient podał go w tytule przelewu — pokryje go pierwszy, reszta pójdzie od najstarszych.</span>
        </label>
        <label className="fld rr-form-cala"><span className="label">Uwagi</span>
          <input className="field" value={uwagi} aria-label="Uwagi" placeholder="np. tytuł przelewu, „zapłacił kierowcy”"
            onChange={e => setUwagi(e.target.value)} onKeyDown={naEnter(zapisz)} />
        </label>
      </div>

      <Podglad podglad={podglad} aktualny={!!podglad && podglad.klucz === klucz} pusty={!klucz} waluta={w} wskazany={wskazany?.numer} />
      <OdmowaSerwera blad={zapis.blad} />
    </Dialog>
  )
}

function Podglad({ podglad, aktualny, pusty, waluta, wskazany }: {
  podglad: { p?: PodgladWplaty; blad?: string } | null; aktualny: boolean; pusty: boolean; waluta: string; wskazany?: string
}) {
  const p = podglad?.p
  return (
    <div className="rr-sekcja rr-podglad-w">
      <span className="label">Ta wpłata rozliczy {wskazany ? `(najpierw ${wskazany}, reszta od najstarszych)` : '(od najstarszych)'}:</span>
      {pusty
        ? <p className="muted rr-dlg-p">Wpisz kwotę — tu zobaczysz, które dokumenty zamknie i co zostanie do zapłaty.</p>
        : podglad?.blad
          ? <p className="muted rr-dlg-p">Podgląd niedostępny: {podglad.blad}. Wpłatę i tak można zapisać.</p>
          : !p
            ? <p className="muted rr-dlg-p" aria-busy="true">Liczę rozliczenie…</p>
            : (
              <ul className={`rr-podglad${aktualny ? '' : ' nieaktualny'}`} aria-label="Podgląd rozliczenia" aria-busy={!aktualny || undefined}>
                {p.przydzialy.map(x => (
                  <li key={x.dokumentId}>
                    <span className="code">{x.numer}</span>
                    {x.zamyka
                      ? <span>{kwota(x.kwota, waluta)} z {kwota(x.zostaloPrzed, waluta)} → <b>zapłacona</b></span>
                      : <span>{`${kwota(x.kwota, waluta)} z ${kwota(x.zostaloPrzed, waluta)} → zostaje ${kwota(x.zostaloPo, waluta)}`}</span>}
                  </li>
                ))}
                {znakSalda(p.nadwyzka) > 0 && (
                  <li className="rr-nadwyzka"><span>Nadwyżka</span><span>{`${kwotaSalda(p.nadwyzka, waluta)} zostaje jako saldo na plus`}</span></li>
                )}
              </ul>
            )}
    </div>
  )
}
