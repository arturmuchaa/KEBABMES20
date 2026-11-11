import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Printer, Scale, Settings2, StickyNote, Trash2, Wallet } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletBloku } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  FORMA_SLOWEM, KLASA_TONU, OKRESY, dni, dzisIso, etykietaStanu, kwotaBezWaluty, kwotaSalda, mapujKarte, opisPlatnosci, rozliczyla, symbolWaluty,
  wOkresie, zakresOkresu,
  znakSalda, type Dok, type Karta, type Ksiega, type Okres, type Wplata, type Zakres,
} from './model'
import { Dziennik } from './Dziennik'
import { SzczegolyDokumentu } from './SzczegolyDokumentu'
import { OdmowaSerwera, klasaSalda, naEnter, pamiec, tekstBledu, useZapis } from './wspolne'

export type RodzajOkna = 'wplata' | 'faktura' | 'otwarcie' | 'druk' | 'ustawienia'
/**
 * Okno do otwarcia nad kartą (dostarcza je moduł). `karta` — aktualny stan klienta
 * (domyślne formy, terminy, dokumenty do wskazania); `ksiega`/`dokumentId` —
 * gdy biuro zaczęło od konkretnej księgi lub dokumentu.
 */
export type Okno = { rodzaj: RodzajOkna; karta: Karta; ksiega?: Ksiega; dokumentId?: string }

const KLUCZ_UKRYJ = 'protrima.rozrachunki.karta.ukryjZaplacone'
const ETYKIETA_OKRESU: Record<Okres, string> = { wszystko: 'Wszystko', miesiac: 'Ten miesiąc', kwartal: 'Kwartał', rok: 'Rok', zakres: 'Od–do' }

/** Data w wierszu księgi: w bieżącym roku krótko (27.10), inaczej pełna. */
const dataWiersza = (iso: string | null, rok: string) => (!iso ? '—' : iso.slice(0, 4) === rok ? dataPl(iso).slice(0, 5) : dataPl(iso))

/**
 * Karta klienta w Rozrachunkach: dwie księgi (WZ i faktury) obok siebie jak dwie
 * kolumny w arkuszu biura, pełna historia dokumentów, wpłaty z tym, co rozliczyły,
 * dziennik ustaleń. Salda liczy serwer; filtry okresu i „ukryj zapłacone”
 * zawężają tylko listy dokumentów.
 */
export function KartaKlienta({ clientId, onWroc, onOtworz, nazwa, wersja = 0 }: {
  clientId: string; onWroc: () => void; onOtworz: (d: Okno) => void
  /** Nazwa z listy — w nagłówku, zanim karta się wczyta. */
  nazwa?: string
  /** Zmiana wartości odświeża kartę (np. po zapisie w oknie modułu). */
  wersja?: number
}) {
  const res = useApi(() => rozliczeniaApi.karta(clientId).then(mapujKarte), [clientId, wersja])
  const k = res.data
  const odswiez = () => { void res.refetch() }
  const [ukryj, setUkryjStan] = useState(() => pamiec.czytaj(KLUCZ_UKRYJ) === '1')
  // Okres zawsze od „Wszystko” (spec 8.2) — wybór nie przechodzi na kartę kolejnego klienta; „Ukryj zapłacone” jest zapamiętane.
  const [okres, setOkres] = useState<Okres>('wszystko')
  const [od, setOd] = useState('')
  const [do_, setDo] = useState('')
  const [dokument, setDokument] = useState<string | null>(null)
  const [usunWplate, setUsunWplate] = useState<Wplata | null>(null)

  const setUkryj = (v: boolean) => { setUkryjStan(v); pamiec.zapisz(KLUCZ_UKRYJ, v ? '1' : null) }
  const dzis = dzisIso()
  const zakres = zakresOkresu(okres, dzis, od, do_)
  const otworz = (rodzaj: RodzajOkna, extra: Partial<Okno> = {}) => { if (k) onOtworz({ rodzaj, karta: k, ...extra }) }

  const naglowek = k?.klient.nazwa || nazwa || ''
  return (
    <div className="rr rr-karta">
      <div className="rr-karta-h">
        <button type="button" className="btn" onClick={onWroc} data-tip="Wróć do listy (Esc)">← Kontrahenci</button>
        <div className="rr-karta-id">
          <h2 className="rr-karta-nazwa" title={naglowek}>{naglowek}</h2>
          {k && (
            <div className="rr-karta-meta">
              <span>{k.klient.nip ? `NIP ${k.klient.nip}` : 'bez NIP'}</span>
              <span>Waluta: <b>{k.klient.waluta}</b></span>
              <span>{`Termin FV: ${dni(k.klient.terminFv)}${k.klient.formaFv !== 'przelew' ? `, ${FORMA_SLOWEM[k.klient.formaFv] ?? k.klient.formaFv}` : ''}`}</span>
              <span>{`WZ: ${opisPlatnosci(k.klient.formaWz, k.klient.terminWz)}`}</span>
              <span className="faint">{`rozliczenia od ${dataPl(k.start)}`}</span>
            </div>
          )}
        </div>
        <div className="rr-karta-akcje">
          <button type="button" className="btn primary" disabled={!k} onClick={() => otworz('wplata')}>+ Wpłata</button>
          <button type="button" className="btn" disabled={!k} onClick={() => otworz('faktura')}>+ Faktura</button>
          <button type="button" className="btn" disabled={!k} onClick={() => otworz('druk')}><Printer size={15} />Drukuj saldo</button>
          <button type="button" className="btn" disabled={!k} onClick={() => otworz('otwarcie')}><Scale size={15} />Saldo otwarcia</button>
          <button type="button" className="btn" disabled={!k} onClick={() => otworz('ustawienia')}><Settings2 size={15} />Ustawienia</button>
        </div>
      </div>

      {res.error && (
        <div className="note crit" role="alert"><FlagIcon level="crit" size={15} />
          <div><b>Nie udało się wczytać karty klienta:</b> {res.error} <button type="button" className="btn sm" onClick={odswiez}>Spróbuj ponownie</button></div>
        </div>
      )}
      {!k && res.loading && <SzkieletBloku linie={6} opis="Wczytywanie karty klienta…" />}

      {k && (
        <>
          <Notatka clientId={clientId} notatka={k.klient.notatka} />
          {k.klient.walutaPodpowiedz && (
            <div className="note info"><FlagIcon level="info" size={15} />
              <div>NIP wskazuje na rozliczenia w <b>{k.klient.walutaPodpowiedz}</b>, a ustawiona jest <b>{k.klient.waluta}</b>. Jeśli to pomyłka — zmień walutę w <button type="button" className="rr-link" onClick={() => otworz('ustawienia')}>Ustawieniach</button>.</div>
            </div>
          )}
          <Salda k={k} />
          {k.innaWaluta.length > 0 && (
            <div className="note warn"><FlagIcon level="warn" size={15} />
              <div><b>Pominięte w saldzie — w innej walucie niż {k.klient.waluta} ({k.innaWaluta.length}):</b>{' '}
                {k.innaWaluta.map(d => `${d.numer} z ${dataPl(d.data)} — ${kwota(d.kwota, d.waluta)}`).join('; ')}. Bez przeliczania kursów: popraw walutę dokumentu albo kontrahenta.</div>
            </div>
          )}

          <div className="rr-bar">
            <div className="seg" role="group" aria-label="Okres dokumentów">
              {OKRESY.map(o => (
                <button key={o} type="button" aria-pressed={okres === o} onClick={() => setOkres(o)}>{ETYKIETA_OKRESU[o]}</button>
              ))}
            </div>
            {okres === 'zakres' && (
              <span className="rr-zakres">
                <input type="date" className="field" value={od} max={do_ || undefined} onChange={e => setOd(e.target.value)} aria-label="Od dnia" />
                <span className="muted">–</span>
                <input type="date" className="field" value={do_} min={od || undefined} onChange={e => setDo(e.target.value)} aria-label="Do dnia" />
              </span>
            )}
            <label className="rr-przel"><input type="checkbox" className="cbx" checked={ukryj} onChange={e => setUkryj(e.target.checked)} />Ukryj zapłacone</label>
            {(zakres || ukryj) && <span className="muted rr-bar-info">salda zawsze za całość — filtr zawęża tylko listy dokumentów</span>}
          </div>

          <div className="rr-ksiegi">
            <Ksiega k={k} ksiega="wz" zakres={zakres} ukryj={ukryj} rok={dzis.slice(0, 4)}
              onDokument={d => (d.otwarcie ? otworz('otwarcie', { ksiega: 'wz' }) : setDokument(d.id))}
              onBezCen={id => setDokument(id)} onPokazWszystko={() => { setUkryj(false); setOkres('wszystko') }} onDodaj={() => otworz('otwarcie', { ksiega: 'wz' })} />
            <Ksiega k={k} ksiega="fv" zakres={zakres} ukryj={ukryj} rok={dzis.slice(0, 4)}
              onDokument={d => (d.otwarcie ? otworz('otwarcie', { ksiega: 'fv' }) : setDokument(d.id))}
              onBezCen={id => setDokument(id)} onPokazWszystko={() => { setUkryj(false); setOkres('wszystko') }} onDodaj={() => otworz('faktura')} />
          </div>

          <div className="rr-dolne">
            <Wplaty k={k} onUsun={setUsunWplate} onDodaj={() => otworz('wplata')} />
            <Dziennik clientId={clientId} wpisy={k.dziennik} onZmiana={odswiez} />
          </div>
        </>
      )}

      {dokument && k && (
        <SzczegolyDokumentu dokId={dokument} waluta={k.klient.waluta} onClose={() => setDokument(null)}
          onZmiana={() => { setDokument(null); odswiez() }}
          onWplata={d => {
            setDokument(null)
            const ksiega: Ksiega = k.dokumenty.fv.some(x => x.id === d.id) ? 'fv' : 'wz'
            otworz('wplata', { ksiega, dokumentId: d.id })
          }} />
      )}
      {usunWplate && k && (
        <UsunWplate w={usunWplate} waluta={k.klient.waluta} onClose={() => setUsunWplate(null)} onUsunieto={() => { setUsunWplate(null); odswiez() }} />
      )}
    </div>
  )
}

/** Stała notatka o kliencie („płaci w piątki”, „limit 20 000 €”) — edycja w miejscu, zapis po wyjściu z pola. */
function Notatka({ clientId, notatka }: { clientId: string; notatka: string }) {
  const app = useApp()
  const [v, setV] = useState(notatka)
  const [zapisana, setZapisana] = useState(notatka)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const cofnij = useRef(false)
  const pole = useRef<HTMLInputElement>(null)
  // Nowa notatka z serwera (zmiana z innego stanowiska) — pole przejmuje ją, o ile biuro właśnie w nim nie pisze.
  useEffect(() => {
    setZapisana(notatka)
    if (document.activeElement !== pole.current) setV(notatka)
  }, [notatka])

  const zapisz = async () => {
    if (cofnij.current) { cofnij.current = false; return }
    const nowa = v.trim()
    if (nowa === zapisana || busy) return
    setBusy(true); setBlad(null)
    try {
      await rozliczeniaApi.ustawKlienta(clientId, { notatka: nowa })
      setZapisana(nowa); setV(nowa)
      app.toast({ kind: 'ok', title: nowa ? 'Notatka o kliencie zapisana' : 'Notatka o kliencie usunięta', detail: nowa || undefined })
    } catch (e) {
      setBlad(tekstBledu(e, 'Nie udało się zapisać notatki'))
    } finally { setBusy(false) }
  }
  return (
    <div className="rr-notatka-w">
      <label className="rr-notatka" data-tip="Stała notatka o kliencie — zapisuje się po wyjściu z pola (Enter), Esc cofa zmianę">
        <StickyNote size={16} />
        <input ref={pole} className={`field${blad ? ' invalid' : ''}`} value={v} onChange={e => setV(e.target.value)} onBlur={() => void zapisz()}
          aria-label="Notatka o kliencie" placeholder="Stała notatka o kliencie, np. „płaci w piątki”, „limit 20 000 €”"
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            else if (e.key === 'Escape') { e.stopPropagation(); setV(zapisana); setBlad(null); cofnij.current = true; e.currentTarget.blur(); cofnij.current = false }
          }} />
        {busy && <span className="muted">Zapisuję…</span>}
      </label>
      {blad && <div className="crit-ink rr-pole-blad" role="alert">Nie zapisano notatki: {blad} — popraw i wyjdź z pola, żeby spróbować ponownie.</div>}
    </div>
  )
}

function Kafel({ tytul, saldo, waluta, poTerminie, najstarsza, glowny }: {
  tytul: string; saldo: number; waluta: string; poTerminie: number; najstarsza: number; glowny?: boolean
}) {
  const podpis = znakSalda(poTerminie) > 0 ? `po terminie ${kwota(poTerminie, waluta)} · najstarsza ${dni(najstarsza)}`
    : znakSalda(saldo) > 0 ? 'nadpłata — pokryje kolejne dokumenty'
      : znakSalda(saldo) < 0 ? 'nic po terminie' : 'rozliczone'
  return (
    <div className={`rr-sum${glowny ? ' rr-sum-glowny' : ''}`}>
      <span className="k">{tytul}</span>
      <span className={`v${klasaSalda(saldo)}`}>{kwotaSalda(saldo, waluta)}</span>
      <span className={`s${znakSalda(poTerminie) > 0 ? ' crit-ink' : ''}`}>{podpis}</span>
    </div>
  )
}

function Salda({ k }: { k: Karta }) {
  const w = k.klient.waluta, s = k.saldo
  return (
    <div className="rr-sumy" role="group" aria-label="Salda klienta">
      <Kafel tytul="Saldo WZ" saldo={s.wz} waluta={w} poTerminie={s.poTerminieWz} najstarsza={s.najstarszaDniWz} />
      <Kafel tytul="Saldo FV" saldo={s.fv} waluta={w} poTerminie={s.poTerminieFv} najstarsza={s.najstarszaDniFv} />
      <Kafel tytul="Saldo łącznie" saldo={s.lacznie} waluta={w} poTerminie={s.poTerminieWz + s.poTerminieFv}
        najstarsza={Math.max(s.najstarszaDniWz, s.najstarszaDniFv)} glowny />
    </div>
  )
}

const KOLUMNY_KSIEGI = 8

/** Strzałki, Home i End przesuwają po wierszach tej samej księgi, Enter/spacja otwiera dokument. */
function naWierszu(e: React.KeyboardEvent<HTMLTableRowElement>, otworz: () => void) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); otworz(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const wiersze = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('tr[data-numer]') ?? [])]
  const i = wiersze.indexOf(e.currentTarget)
  const cel = e.key === 'Home' ? 0 : e.key === 'End' ? wiersze.length - 1 : e.key === 'ArrowDown' ? Math.min(i + 1, wiersze.length - 1) : Math.max(i - 1, 0)
  wiersze[cel]?.focus()
}

function Ksiega({ k, ksiega, zakres, ukryj, rok, onDokument, onBezCen, onPokazWszystko, onDodaj }: {
  k: Karta; ksiega: Ksiega; zakres: Zakres; ukryj: boolean; rok: string
  onDokument: (d: Dok) => void; onBezCen: (id: string) => void; onPokazWszystko: () => void; onDodaj: () => void
}) {
  const w = k.klient.waluta
  const wszystkie = k.dokumenty[ksiega]
  const docs = useMemo(() => wszystkie.filter(d => wOkresie(d.data, zakres) && !(ukryj && d.stan.kod === 'zaplacony')), [wszystkie, zakres, ukryj])
  const bezCen = useMemo(() => (ksiega === 'wz' ? k.czekaNaCeny.filter(c => wOkresie(c.data, zakres)) : []), [k.czekaNaCeny, ksiega, zakres])
  const ukryte = wszystkie.length - docs.length
  const saldo = ksiega === 'wz' ? k.saldo.wz : k.saldo.fv
  const tytul = ksiega === 'wz' ? 'WZ' : 'Faktury'
  const opis = ksiega === 'wz' ? opisPlatnosci(k.klient.formaWz, k.klient.terminWz) : opisPlatnosci(k.klient.formaFv, k.klient.terminFv)
  const sym = symbolWaluty(w)
  // Jeden wiersz księgi w kolejności Tab (jak na liście kontrahentów) — Tab nie przechodzi przez całą historię.
  const [kursor, setKursor] = useState<string | null>(null)
  const ids = [...bezCen.map(c => c.id), ...docs.map(d => d.id)]
  const aktywny = kursor && ids.includes(kursor) ? kursor : ids[0]
  const tab = (id: string) => (id === aktywny ? 0 : -1)
  return (
    <section className="box rr-panel rr-ksiega" aria-label={`${tytul} — księga`}>
      <div className="rr-panel-h">
        <h3>{tytul} <small>{opis}</small></h3>
        {ukryte > 0 && <span className="muted rr-ukryte">ukryto {ukryte}</span>}
        <span className={`rr-ksiega-saldo${klasaSalda(saldo)}`} data-tip={ksiega === 'wz' ? 'Saldo księgi WZ' : 'Saldo księgi faktur'}>{kwotaSalda(saldo, w)}</span>
      </div>
      <div className="rr-przewin">
        <table className="tbl rr-tbl rr-dok-tbl" aria-label={ksiega === 'wz' ? 'Księga WZ' : 'Faktury'}>
          <thead><tr>
            <th>Data</th><th>Numer</th><th className="num">Kwota {sym}</th><th className="num">Zapłacono {sym}</th><th className="num">Zostało {sym}</th>
            <th>Termin</th><th>Stan</th><th>Uwagi</th>
          </tr></thead>
          <tbody>
            {bezCen.map(c => (
              <tr key={c.id} className="row click rr-bez-cen" data-numer={c.numer} tabIndex={tab(c.id)} onFocus={() => setKursor(c.id)} onClick={() => onBezCen(c.id)}
                onKeyDown={e => naWierszu(e, () => onBezCen(c.id))} aria-label={`${c.numer}, czeka na ceny`}>
                <td className="tnum" title={dataPl(c.data)}>{dataWiersza(c.data, rok)}</td>
                <td className="code id-no">{c.numer}</td>
                <td className="num faint">—</td><td className="num faint">—</td><td className="num faint">—</td>
                <td className="faint">—</td>
                <td><span className="tag warn">czeka na ceny</span></td>
                <td className="rr-uwagi muted" title="WZ wejdzie do salda, gdy dostanie ceny">bez kwoty, dopóki nie ma cen</td>
              </tr>
            ))}
            {docs.map(d => <WierszDokumentu key={d.id} d={d} waluta={w} rok={rok} tabIndex={tab(d.id)} onFocus={() => setKursor(d.id)} onOtworz={() => onDokument(d)} />)}
            {docs.length === 0 && bezCen.length === 0 && (
              <tr><td colSpan={KOLUMNY_KSIEGI} className="docs-empty">
                {wszystkie.length > 0
                  ? <>Wszystkie dokumenty ukryte filtrem. <button type="button" className="btn sm" onClick={onPokazWszystko}>Pokaż wszystko</button></>
                  : ksiega === 'wz'
                    ? <>Brak WZ od {dataPl(k.start)}. Wycenione WZ pojawią się tu same; dług sprzed tej daty wpisz jako <button type="button" className="rr-link" onClick={onDodaj}>saldo otwarcia</button>.</>
                    : <>Brak faktur. <button type="button" className="btn sm" onClick={onDodaj}>+ Faktura</button></>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const BEZ_VAT = 'bez VAT — sprawdź wycenę'

function WierszDokumentu({ d, waluta, rok, tabIndex, onFocus, onOtworz }: {
  d: Dok; waluta: string; rok: string; tabIndex: number; onFocus: () => void; onOtworz: () => void
}) {
  const st = etykietaStanu(d.stan)
  // Pigułka bez dopisku „· częściowo” — ten idzie do drugiej linii, żeby kolumna Stan była wąska.
  const pig = etykietaStanu({ ...d.stan, czesciowo: false })
  const zaplacony = d.stan.kod === 'zaplacony'
  const poTerminie = d.stan.kod === 'po_terminie'
  return (
    <tr className={`row click${zaplacony ? ' closed' : ''}${d.otwarcie ? ' rr-otwarcie' : ''}`} data-numer={d.numer} tabIndex={tabIndex}
      onFocus={onFocus} onClick={onOtworz} onKeyDown={e => naWierszu(e, onOtworz)}
      aria-label={`${d.numer}, ${kwota(d.kwota, waluta)}, ${st.tekst}`}
      data-tip={d.otwarcie ? 'Saldo otwarcia — stan z arkusza na dzień startu; kliknij, żeby zmienić' : undefined}>
      <td className="tnum" title={dataPl(d.data)}>{dataWiersza(d.data, rok)}</td>
      <td className={d.otwarcie ? 'rr-otwarcie-nr' : 'code id-no'}>{d.numer}
        {/* W komórce numeru, nie w Uwagach — ostrzeżenie nie może wpaść do ucinanej kolumny. */}
        {d.brakVat && <span className="tag warn rr-vat" role="img" aria-label={BEZ_VAT} data-tip={BEZ_VAT}><AlertTriangle size={13} /></span>}
      </td>
      <td className="num">{kwotaBezWaluty(d.kwota)}</td>
      <td className="num">{kwotaBezWaluty(d.zaplacono)}</td>
      <td className={`num${poTerminie ? ' crit-ink' : znakSalda(d.zostalo) === 0 ? ' faint' : ''}`}>{kwotaBezWaluty(d.zostalo)}</td>
      <td className="tnum" title={d.termin ? dataPl(d.termin) : undefined}>{dataWiersza(d.termin, rok)}</td>
      <td className="rr-stan">
        <span className={`tag ${KLASA_TONU[pig.ton]}`}>{pig.tekst}</span>
        {d.stan.czesciowo && <span className="rr-stan-2">częściowo</span>}
        {d.zamkniety && <span className="rr-stan-2" title="Data zamknięcia (ostatnia wpłata)">zamknięta {dataWiersza(d.zamkniety, rok)}</span>}
      </td>
      <td className="rr-uwagi" title={d.uwagi || undefined}>{d.uwagi}</td>
    </tr>
  )
}

function Wplaty({ k, onUsun, onDodaj }: { k: Karta; onUsun: (w: Wplata) => void; onDodaj: () => void }) {
  const w = k.klient.waluta
  const numer = (id: string | null) => (id ? [...k.dokumenty.wz, ...k.dokumenty.fv].find(d => d.id === id)?.numer : undefined)
  return (
    <section className="box rr-panel rr-wplaty" aria-label="Wpłaty klienta">
      <div className="rr-panel-h"><h3><Wallet size={16} />Wpłaty</h3></div>
      {k.wplaty.length === 0
        ? <Pusto tytul="Brak wpłat" akcja={<button type="button" className="btn sm primary" onClick={onDodaj}>+ Wpłata</button>}>
            Wpłata gotówką lub przelewem rozliczy dokumenty od najstarszych.</Pusto>
        : (
          <div className="rr-przewin">
            <table className="tbl rr-tbl rr-dok-tbl" aria-label="Wpłaty">
              <thead><tr>
                <th>Data</th><th>Do czego</th><th>Forma</th><th className="num">Kwota</th><th>Rozliczyła</th><th>Uwagi</th><th>Kto</th><th />
              </tr></thead>
              <tbody>{k.wplaty.map(p => {
                const r = rozliczyla(p)
                const nr = numer(p.dokumentId)
                return (
                  <tr key={p.id} className="row" data-id={p.id}>
                    <td className="tnum">{dataPl(p.data)}</td>
                    <td>{p.ksiega === 'wz' ? 'WZ' : 'FV'}{nr && <span className="sub" data-tip="Wpłata wskazana na ten dokument">→ {nr}</span>}</td>
                    <td>{FORMA_SLOWEM[p.forma] ?? p.forma}</td>
                    <td className="num">{kwota(p.kwota, w)}</td>
                    <td className="rr-rozliczyla">{r || <span className="faint">—</span>}</td>
                    <td className="rr-uwagi" title={p.uwagi || undefined}>{p.uwagi || <span className="faint">—</span>}</td>
                    <td className="muted">{p.utworzyl || '—'}</td>
                    <td className="r">
                      <button type="button" className="btn sm ghost icon danger" onClick={() => onUsun(p)} aria-label={`Usuń wpłatę ${kwota(p.kwota, w)} z ${dataPl(p.data)}`}
                        data-tip="Usuń wpłatę (z powodem) — rozliczenie przeliczy się od zera"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
    </section>
  )
}

function UsunWplate({ w, waluta, onClose, onUsunieto }: { w: Wplata; waluta: string; onClose: () => void; onUsunieto: () => void }) {
  const app = useApp()
  const [powod, setPowod] = useState('')
  const { busy, blad, zapisz } = useZapis('Nie udało się usunąć wpłaty')
  const ok = !!powod.trim()
  const usun = () => {
    if (!ok || busy) return
    void zapisz(async () => {
      await rozliczeniaApi.usunWplate(w.id, powod.trim())
      app.toast({ kind: 'ok', title: `Wpłata ${kwota(w.kwota, waluta)} usunięta`, detail: 'rozliczenie przeliczone od zera — dokumenty, które pokryła, wróciły do zapłaty' })
      onUsunieto()
    })
  }
  const r = rozliczyla(w)
  return (
    <Dialog title="Usuń wpłatę" icon={<Trash2 size={20} />} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary danger" disabled={!ok || busy} onClick={usun} data-tip={ok ? undefined : 'Wpisz powód usunięcia'}>
          {busy ? 'Usuwam…' : 'Usuń wpłatę'}
        </button>
      </>}>
      <div className="rr-dlg-info"><b>{kwota(w.kwota, waluta)}</b> · {FORMA_SLOWEM[w.forma] ?? w.forma} · {dataPl(w.data)} · księga {w.ksiega === 'wz' ? 'WZ' : 'faktur'}
        {r && <div className="muted">rozliczyła: {r}</div>}</div>
      <label className="fld"><span className="label">Powód (obowiązkowy, trafi do historii)</span>
        <input className="field" value={powod} onChange={e => setPowod(e.target.value)} onKeyDown={naEnter(usun)} aria-label="Powód"
          placeholder="np. wpłata wpisana dwa razy" data-autofocus /></label>
      <div className="note"><FlagIcon level="info" size={15} /><div>Wpłata zniknie z salda, ale zostanie w historii. Dokumenty, które pokryła, wrócą do zapłaty.</div></div>
      <OdmowaSerwera blad={blad} />
    </Dialog>
  )
}

