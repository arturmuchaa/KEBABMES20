import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, History, Printer, Scale, Settings2, StickyNote, Trash2, Wallet } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletBloku } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  ETYKIETA_OKRESU_OBROTU, FORMA_SLOWEM, KLASA_TONU, bladZakresu, dni, dzisIso, etykietaStanu, kilogramy, kwotaBezWaluty, kwotaSalda, mapujHistorieZmian,
  mapujKarte, numerZSeria, opisOkresu, opisPlatnosci, czesciRozliczenia, rozliczyla, symbolWaluty, zakresObrotu,
  znakSalda, type Dok, type Karta, type Ksiega, type Wplata, type WyborOkresuObrotu,
} from './model'
import { Notatki } from './Notatki'
import { SzczegolyDokumentu } from './SzczegolyDokumentu'
import { OdmowaSerwera, WyborOkresu, klasaSalda, naEnter, pamiec, tekstBledu, useOkresObrotu, useZapis } from './wspolne'

export type RodzajOkna = 'wplata' | 'faktura' | 'otwarcie' | 'druk' | 'ustawienia'
/** Zakładka okna salda otwarcia (D13). */
export type ZakladkaOtwarcia = 'zalegle' | 'kwota'
/**
 * Okno do otwarcia nad kartą (dostarcza je moduł). `karta` — aktualny stan klienta
 * (domyślne formy, terminy, dokumenty do wskazania); `ksiega`/`dokumentId` —
 * gdy biuro zaczęło od konkretnej księgi lub dokumentu; `zakladka` — okno salda otwarcia.
 */
export type Okno = { rodzaj: RodzajOkna; karta: Karta; ksiega?: Ksiega; dokumentId?: string; zakladka?: ZakladkaOtwarcia }

const KLUCZ_UKRYJ = 'protrima.rozrachunki.karta.ukryjZaplacone'
const KLUCZ_NIELICZONE = 'protrima.rozrachunki.karta.pokazNieliczone'

/** Data w wierszu księgi: w bieżącym roku krótko (27.10), inaczej pełna. */
const dataWiersza = (iso: string | null, rok: string) => (!iso ? '—' : iso.slice(0, 4) === rok ? dataPl(iso).slice(0, 5) : dataPl(iso))

/**
 * Karta klienta w Rozrachunkach: dwie księgi (WZ i faktury) obok siebie jak dwie
 * kolumny w arkuszu biura, pełna historia dokumentów (także zaległe sprzed startu),
 * wpłaty z tym, co rozliczyły, notatki. Salda liczy serwer — zawsze za całość.
 *
 * Jeden wybór okresu (ten sam co na liście): obrót i sprzedane kg. Księgi pokazują
 * zawsze wszystkie dokumenty — okres ich nie zawęża, żeby żaden niezapłacony dokument
 * (np. zaległy sprzed startu) nie „zniknął”; zawężają je tylko „Ukryj zapłacone”
 * i „Pokaż nieliczone”.
 */
export function KartaKlienta({ clientId, onWroc, onOtworz, nazwa, wersja = 0, okres: okresZListy, onOkres, fokusNaStart }: {
  clientId: string; onWroc: () => void; onOtworz: (d: Okno) => void
  /** Nazwa z listy — w nagłówku, zanim karta się wczyta. */
  nazwa?: string
  /** Zmiana wartości odświeża kartę (np. po zapisie w oknie modułu). */
  wersja?: number
  /** Okres obrotu i kg wspólny z listą (moduł); bez niego karta pamięta własny wybór pod tym samym kluczem. */
  okres?: WyborOkresuObrotu
  onOkres?: (w: WyborOkresuObrotu) => void
  /** Karta otwarta z „+ Kontrahent” — po wczytaniu fokus na „Wprowadź saldo otwarcia” (albo na nazwę). */
  fokusNaStart?: boolean
}) {
  const [okresWlasny, setOkresWlasny] = useOkresObrotu()
  const okres = okresZListy ?? okresWlasny
  const ustawOkres = onOkres ?? setOkresWlasny
  const dzis = dzisIso()
  // Zły własny zakres (brak daty, „do” przed „od”) — liczy dalej ostatni poprawny okres, bez zapytania.
  const [okresOk, setOkresOk] = useState<WyborOkresuObrotu>(() => (bladZakresu(okres) ? { okres: 'miesiac', od: '', do: '' } : okres))
  useEffect(() => { if (!bladZakresu(okres)) setOkresOk(okres) }, [okres])
  const z = zakresObrotu(okresOk, dzis)
  const res = useApi(() => rozliczeniaApi.karta(clientId, '', '', z.od, z.do).then(mapujKarte), [clientId, wersja, z.od, z.do])
  const k = res.data
  const odswiez = () => { void res.refetch() }
  const [ukryj, setUkryjStan] = useState(() => pamiec.czytaj(KLUCZ_UKRYJ) === '1')
  const [nieliczone, setNieliczoneStan] = useState(() => pamiec.czytaj(KLUCZ_NIELICZONE) === '1')
  const [dokument, setDokument] = useState<{ id: string; wpiszKwote?: boolean } | null>(null)
  const [usunWplate, setUsunWplate] = useState<Wplata | null>(null)

  const setUkryj = (v: boolean) => { setUkryjStan(v); pamiec.zapisz(KLUCZ_UKRYJ, v ? '1' : null) }
  const setNieliczone = (v: boolean) => { setNieliczoneStan(v); pamiec.zapisz(KLUCZ_NIELICZONE, v ? '1' : null) }
  const otworz = (rodzaj: RodzajOkna, extra: Partial<Okno> = {}) => { if (k) onOtworz({ rodzaj, karta: k, ...extra }) }
  const liczbaNieliczonych = k ? k.dokumenty.wz.filter(d => d.nieLicz).length : 0

  // Po „+ Kontrahent”: fokus w karcie (nie z powrotem na komendzie) — na saldzie otwarcia, gdy go brak.
  const startRef = useRef<HTMLButtonElement>(null)
  const nazwaRef = useRef<HTMLHeadingElement>(null)
  const fokusZrobiony = useRef(false)
  useEffect(() => {
    if (!fokusNaStart || !k || fokusZrobiony.current) return
    fokusZrobiony.current = true
    ;(startRef.current ?? nazwaRef.current)?.focus()
  }, [fokusNaStart, k])

  const naglowek = k?.klient.nazwa || nazwa || ''
  return (
    <div className="rr rr-karta">
      <div className="rr-karta-h">
        <button type="button" className="btn" onClick={onWroc} data-tip="Wróć do listy (Esc)">← Kontrahenci</button>
        <div className="rr-karta-id">
          <h2 className="rr-karta-nazwa" title={naglowek} ref={nazwaRef} tabIndex={-1}>{naglowek}</h2>
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
          {k.klient.wylaczony && <Wylaczony clientId={clientId} nazwa={k.klient.nazwa} onZmiana={odswiez} />}
          {!k.rozliczeniaOtwarte && !k.klient.wylaczony && (
            <div className="note warn rr-nieotwarte"><FlagIcon level="warn" size={15} />
              <div><b>Saldo nie drukuje się jeszcze na WZ ani w papierach kursu — wprowadź saldo otwarcia (może być 0).</b>{' '}
                Wpisz zaległe dokumenty sprzed {dataPl(k.start)} albo jedną kwotę z arkusza; klient, który nic nie jest winien, ma 0.{' '}
                <button ref={startRef} type="button" className="btn sm" onClick={() => otworz('otwarcie')}><Scale size={14} />Wprowadź saldo otwarcia</button></div>
            </div>
          )}
          <div className="rr-okres-pasek">
            <span className="rr-okres-tyt">Obrót i kg za</span>
            <WyborOkresu wybor={okres} onChange={ustawOkres} dzis={dzis} opis={opisOkresu(okres, dzis, k.start)} />
          </div>
          <Salda k={k} okresSlowem={`${ETYKIETA_OKRESU_OBROTU[okresOk.okres]} · ${opisOkresu(okresOk, dzis, k.start)}`} />
          {k.innaWaluta.length > 0 && (
            <div className="note warn"><FlagIcon level="warn" size={15} />
              <div><b>Pominięte w saldzie — w innej walucie niż {k.klient.waluta} ({k.innaWaluta.length}):</b>{' '}
                {k.innaWaluta.map(d => `${d.numer} z ${dataPl(d.data)} — ${kwota(d.kwota, d.waluta)}`).join('; ')}. Bez przeliczania kursów: popraw walutę dokumentu albo kontrahenta.</div>
            </div>
          )}

          <div className="rr-bar">
            <span className="rr-okres-tyt">Dokumenty:</span>
            <label className="rr-przel"><input type="checkbox" className="cbx" checked={ukryj} onChange={e => setUkryj(e.target.checked)} />Ukryj zapłacone</label>
            {liczbaNieliczonych > 0 && (
              <label className="rr-przel" data-tip="WZ oznaczone „nie licz do rozrachunków” — poza saldem, obrotem i kg">
                <input type="checkbox" className="cbx" checked={nieliczone} onChange={e => setNieliczone(e.target.checked)} />{`Pokaż nieliczone (${liczbaNieliczonych})`}
              </label>
            )}
            <span className="muted rr-bar-info">wszystkie dokumenty od {dataPl(k.start)} i zaległe sprzed tej daty; salda zawsze za całość</span>
          </div>

          <div className="rr-ksiegi">
            {(['wz', 'fv'] as Ksiega[]).map(ks => (
              <Ksiega key={ks} k={k} ksiega={ks} ukryj={ukryj} nieliczone={nieliczone} rok={dzis.slice(0, 4)}
                onDokument={d => (d.otwarcie ? otworz('otwarcie', { ksiega: ks, zakladka: 'kwota' }) : setDokument({ id: d.id }))}
                onWpiszKwote={d => setDokument({ id: d.id, wpiszKwote: true })}
                onBezCen={id => setDokument({ id })} onPokazWszystko={() => { setUkryj(false); setNieliczone(true) }}
                onDodaj={() => (ks === 'wz' ? otworz('otwarcie', { ksiega: 'wz' }) : otworz('faktura'))} />
            ))}
          </div>

          <div className="rr-dolne">
            <Wplaty k={k} onUsun={setUsunWplate} onDodaj={() => otworz('wplata')} />
            <Notatki clientId={clientId} wpisy={k.dziennik} onZmiana={odswiez} />
          </div>
          <HistoriaZmianKlienta clientId={clientId} karta={k} />
        </>
      )}

      {dokument && k && (
        <SzczegolyDokumentu key={dokument.id} dokId={dokument.id} wpiszKwote={dokument.wpiszKwote} waluta={k.klient.waluta} start={k.start}
          terminFv={k.klient.terminFv} onClose={() => setDokument(null)}
          onZmiana={() => { setDokument(null); odswiez() }}
          onWplata={d => { setDokument(null); otworz('wplata', { ksiega: d.ksiega, dokumentId: d.id }) }} />
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
        <StickyNote size={16} /><span className="rr-notatka-l">Notatka o kliencie</span>
        <input ref={pole} className={`field${blad ? ' invalid' : ''}`} value={v} onChange={e => setV(e.target.value)} onBlur={() => void zapisz()}
          aria-label="Notatka o kliencie"
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

/** Salda (zawsze za całość) i obrót z kg za wybrany okres — jedna ramka, okresowe kafelki z podpisem okresu. */
function Salda({ k, okresSlowem }: { k: Karta; okresSlowem: string }) {
  const w = k.klient.waluta, s = k.saldo
  return (
    <div className="rr-sumy-w">
      <div className="rr-sumy" role="group" aria-label="Salda klienta">
        <Kafel tytul="Saldo WZ" saldo={s.wz} waluta={w} poTerminie={s.poTerminieWz} najstarsza={s.najstarszaDniWz} />
        <Kafel tytul="Saldo FV" saldo={s.fv} waluta={w} poTerminie={s.poTerminieFv} najstarsza={s.najstarszaDniFv} />
        <Kafel tytul="Saldo łącznie" saldo={s.lacznie} waluta={w} poTerminie={s.poTerminieWz + s.poTerminieFv}
          najstarsza={Math.max(s.najstarszaDniWz, s.najstarszaDniFv)} glowny />
        <div className="rr-sum rr-sum-okres" role="group" aria-label="Obrót">
          <span className="k">Obrót</span>
          <span className="v">{kwota(k.obrot, w)}</span>
          <span className="s">{okresSlowem}</span>
        </div>
        <div className="rr-sum rr-sum-okres" role="group" aria-label="Sprzedane kg">
          <span className="k">Sprzedane kg</span>
          <span className="v">{kilogramy(k.kg)}</span>
          <span className={`s${k.fvBezKwoty > 0 ? ' warn-ink' : ''}`}>{k.fvBezKwoty > 0 ? `FV bez kwoty: ${k.fvBezKwoty} — kg liczone, obrót jeszcze nie` : 'bez salda otwarcia'}</span>
        </div>
      </div>
    </div>
  )
}

/** Klient wyłączony z rozrachunków (D1) — wyraźnie na karcie, z przywróceniem jednym kliknięciem. */
function Wylaczony({ clientId, nazwa, onZmiana }: { clientId: string; nazwa: string; onZmiana: () => void }) {
  const app = useApp()
  const { busy, blad, zapisz } = useZapis('Nie udało się przywrócić kontrahenta')
  const przywroc = () => void zapisz(async () => {
    await rozliczeniaApi.ustawWylaczenie(clientId, false)
    app.toast({ kind: 'ok', title: `${nazwa} wraca do rozrachunków`, detail: 'jest znów na liście, saldo drukuje się na WZ' })
    onZmiana()
  })
  return (
    <div className="note warn" role="status"><FlagIcon level="warn" size={15} />
      <div><b>Wyłączony z rozrachunków.</b> Nie ma go na liście ani w sumach, saldo nie drukuje się na WZ ani w papierach kursu. Dokumenty dalej się zapisują.{' '}
        <button type="button" className="btn sm" disabled={busy} onClick={przywroc}>{busy ? 'Przywracam…' : 'Przywróć do rozrachunków'}</button>
        <OdmowaSerwera blad={blad} /></div>
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

function Ksiega({ k, ksiega, ukryj, nieliczone, rok, onDokument, onWpiszKwote, onBezCen, onPokazWszystko, onDodaj }: {
  k: Karta; ksiega: Ksiega; ukryj: boolean; nieliczone: boolean; rok: string
  onDokument: (d: Dok) => void; onWpiszKwote: (d: Dok) => void; onBezCen: (id: string) => void; onPokazWszystko: () => void; onDodaj: () => void
}) {
  const w = k.klient.waluta
  const wszystkie = k.dokumenty[ksiega]
  const docs = useMemo(() => wszystkie.filter(d => !(ukryj && d.stan.kod === 'zaplacony') && (nieliczone || !d.nieLicz)), [wszystkie, ukryj, nieliczone])
  const bezCen = ksiega === 'wz' ? k.czekaNaCeny : []
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
            {docs.map(d => (d.korekta
              ? <WierszKorekty key={d.id} d={d} ksiega={ksiega} waluta={w} rok={rok} tabIndex={tab(d.id)} onFocus={() => setKursor(d.id)} onOtworz={() => onDokument(d)} />
              : d.bezKwoty
                ? <WierszBezKwoty key={d.id} d={d} rok={rok} tabIndex={tab(d.id)} onFocus={() => setKursor(d.id)} onWpisz={() => onWpiszKwote(d)} />
                : <WierszDokumentu key={d.id} d={d} waluta={w} rok={rok} tabIndex={tab(d.id)} onFocus={() => setKursor(d.id)} onOtworz={() => onDokument(d)} />))}
            {docs.length === 0 && bezCen.length === 0 && (
              <tr><td colSpan={KOLUMNY_KSIEGI} className="docs-empty">
                {wszystkie.length > 0
                  ? <>Wszystkie dokumenty ukryte. <button type="button" className="btn sm" onClick={onPokazWszystko}>Pokaż wszystko</button></>
                  : ksiega === 'wz'
                    ? <>Brak WZ od {dataPl(k.start)}. Wycenione WZ pojawią się tu same; dług sprzed tej daty wpisz w <button type="button" className="rr-link" onClick={onDodaj}>saldzie otwarcia</button>.</>
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
  const tip = d.otwarcie ? 'Saldo otwarcia — stan z arkusza na dzień startu; kliknij, żeby zmienić'
    : d.nieLicz ? `Nie liczona do rozrachunków${d.nieLiczPowod ? ` — ${d.nieLiczPowod}` : ''}; kliknij, żeby cofnąć`
      : d.zalegly ? 'Zaległy dokument sprzed startu rozliczeń — wpłatę można przypiąć do niego' : undefined
  return (
    <tr className={`row click${zaplacony ? ' closed' : ''}${d.otwarcie ? ' rr-otwarcie' : ''}${d.nieLicz ? ' rr-nieliczona' : ''}`} data-numer={d.numer} tabIndex={tabIndex}
      onFocus={onFocus} onClick={onOtworz} onKeyDown={e => naWierszu(e, onOtworz)}
      aria-label={`${d.numer}, ${kwota(d.kwota, waluta)}, ${st.tekst}`} data-tip={tip}>
      <td className="tnum" title={dataPl(d.data)}>{dataWiersza(d.data, rok)}</td>
      <td className={d.otwarcie ? 'rr-otwarcie-nr' : 'code id-no'}>{d.numer}
        {/* W komórce numeru, nie w Uwagach — ostrzeżenie nie może wpaść do ucinanej kolumny. */}
        {d.brakVat && <span className="tag warn rr-vat" role="img" aria-label={BEZ_VAT} data-tip={BEZ_VAT}><AlertTriangle size={13} /></span>}
        {d.zalegly && <span className="tag outline rr-znacznik">sprzed startu</span>}
      </td>
      <td className="num">{kwotaBezWaluty(d.kwota)}</td>
      {d.nieLicz
        ? <><td className="num faint">—</td><td className="num faint">—</td></>
        : <>
            <td className="num">{kwotaBezWaluty(d.zaplacono)}</td>
            <td className={`num${poTerminie ? ' crit-ink' : znakSalda(d.zostalo) === 0 ? ' faint' : ''}`}>{kwotaBezWaluty(d.zostalo)}</td>
          </>}
      <td className="tnum" title={d.termin ? dataPl(d.termin) : undefined}>{dataWiersza(d.termin, rok)}</td>
      <td className="rr-stan">
        <span className={`tag ${KLASA_TONU[pig.ton]}`}>{pig.tekst}</span>
        {d.stan.czesciowo && <span className="rr-stan-2">częściowo</span>}
        {d.zamkniety && <span className="rr-stan-2" title="Data zamknięcia (ostatnia wpłata)">zamknięta {dataWiersza(d.zamkniety, rok)}</span>}
      </td>
      <td className="rr-uwagi" title={(d.nieLicz ? d.nieLiczPowod : d.uwagi) || undefined}>{d.nieLicz ? d.nieLiczPowod : d.uwagi}</td>
    </tr>
  )
}

/** FV z papierów kursu czekająca na kwotę (D4): zamiast kwoty — „Wpisz kwotę” (otwiera szczegóły z polem kwoty). */
function WierszBezKwoty({ d, rok, tabIndex, onFocus, onWpisz }: {
  d: Dok; rok: string; tabIndex: number; onFocus: () => void; onWpisz: () => void
}) {
  const opis = ['z papierów kursu', d.kg != null ? kilogramy(d.kg) : ''].filter(Boolean).join(' · ')
  return (
    <tr className="row click rr-bez-kwoty" data-numer={d.numer} tabIndex={tabIndex} onFocus={onFocus} onClick={onWpisz}
      onKeyDown={e => naWierszu(e, onWpisz)} aria-label={`${d.numer}, czeka na kwotę`}
      data-tip="Faktura z papierów kursu — wpisz kwotę z Subiekta, wtedy wejdzie do salda">
      <td className="tnum" title={dataPl(d.data)}>{dataWiersza(d.data, rok)}</td>
      <td className="code id-no">{d.numer}</td>
      <td className="num"><button type="button" className="btn sm primary rr-wpisz" tabIndex={-1}
        onClick={e => { e.stopPropagation(); onWpisz() }}>Wpisz kwotę</button></td>
      <td className="num faint">—</td><td className="num faint">—</td>
      <td className="faint">—</td>
      <td className="rr-stan"><span className="tag warn">czeka na kwotę</span></td>
      <td className="rr-uwagi muted" title={d.uwagi || opis}>{d.uwagi || opis}</td>
    </tr>
  )
}

/**
 * Faktura korygująca: kwota ujemna, bez „zapłacono/zostało” (sama zmniejsza inne
 * dokumenty księgi), w kolumnie Stan — co zmniejszyła. Klik → szczegóły z usuwaniem.
 */
function WierszKorekty({ d, ksiega, waluta, rok, tabIndex, onFocus, onOtworz }: {
  d: Dok; ksiega: Ksiega; waluta: string; rok: string; tabIndex: number; onFocus: () => void; onOtworz: () => void
}) {
  const co = d.rozliczyla.map(r => numerZSeria(r.numer, ksiega)).join(', ')
  return (
    <tr className="row click rr-korekta" data-numer={d.numer} tabIndex={tabIndex} onFocus={onFocus} onClick={onOtworz}
      onKeyDown={e => naWierszu(e, onOtworz)} aria-label={`${d.numer}, korekta ${kwota(d.kwota, waluta)}`}
      data-tip="Faktura korygująca — zmniejsza dług w księdze; kliknij, żeby zobaczyć szczegóły albo usunąć">
      <td className="tnum" title={dataPl(d.data)}>{dataWiersza(d.data, rok)}</td>
      <td className="code id-no">{d.numer}</td>
      <td className="num">{kwotaBezWaluty(d.kwota)}</td>
      <td className="num faint">—</td><td className="num faint">—</td>
      <td className="faint">—</td>
      <td className="rr-stan">
        <span className="tag neutral">korekta</span>
        <span className="rr-stan-2">{co ? `zmniejszyła ${co}` : 'nadpłata w księdze'}</span>
      </td>
      <td className="rr-uwagi" title={d.uwagi || undefined}>{d.uwagi}</td>
    </tr>
  )
}

/** Data i godzina wpisu historii w czasie lokalnym: `10.11.2026 15:05`. */
function czasWpisu(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(t.getDate())}.${p(t.getMonth() + 1)}.${t.getFullYear()} ${p(t.getHours())}:${p(t.getMinutes())}`
}

/**
 * Historia zmian klienta (spec 11): każda zmiana kwoty, wpłaty, salda otwarcia
 * i ustawień, także usunięte wpłaty i faktury — z kim, kiedy i powodem.
 * Zwinięta na starcie; wczytuje się dopiero po rozwinięciu i odświeża razem z kartą.
 */
function HistoriaZmianKlienta({ clientId, karta }: { clientId: string; karta: Karta }) {
  const [otwarta, setOtwarta] = useState(false)
  return (
    <section className="box rr-panel rr-historia" aria-label="Historia zmian klienta">
      <div className="rr-panel-h">
        <h3>
          <button type="button" className="rr-rozwin" aria-expanded={otwarta} onClick={() => setOtwarta(o => !o)}>
            <ChevronRight size={16} className="rr-rozwin-ikona" /><History size={16} />Historia zmian
            <small>kwoty, wpłaty, salda otwarcia, ustawienia — także usunięte</small>
          </button>
        </h3>
      </div>
      {otwarta && <ListaHistorii clientId={clientId} karta={karta} />}
    </section>
  )
}

function ListaHistorii({ clientId, karta }: { clientId: string; karta: Karta }) {
  // `karta` w zależnościach: po każdym zapisie karta wczytuje się na nowo — historia też.
  const res = useApi(() => rozliczeniaApi.historiaZmian(clientId).then(mapujHistorieZmian), [clientId, karta])
  const h = res.data
  if (res.error) {
    return (
      <div className="note crit" role="alert"><FlagIcon level="crit" size={15} />
        <div><b>Nie udało się wczytać historii zmian:</b> {res.error} <button type="button" className="btn sm" onClick={() => void res.refetch()}>Spróbuj ponownie</button></div>
      </div>
    )
  }
  if (!h) return <SzkieletBloku linie={3} opis="Wczytywanie historii zmian…" />
  if (!h.wpisy.length) {
    return <Pusto tytul="Brak zmian">Tu pojawi się każda zmiana kwoty, wpłaty, salda otwarcia i ustawień klienta — z tym, kto i dlaczego ją zrobił.</Pusto>
  }
  return (
    <div className="rr-przewin">
      <table className="tbl rr-tbl rr-dok-tbl rr-hist-tbl" aria-label="Historia zmian">
        <thead><tr><th>Kiedy</th><th>Kto</th><th>Czego dotyczy</th><th>Zmiana</th><th>Powód</th></tr></thead>
        <tbody>{h.wpisy.map(w => (
          <tr key={w.id} className={`row${w.usuniete ? ' rr-usuniete' : ''}`} data-id={w.id}>
            <td className="tnum">{czasWpisu(w.kiedy)}</td>
            <td className="muted">{w.kto || '—'}</td>
            <td><span className="rr-hist-czego">{w.czego}</span>
              {w.usuniete && <span className="tag crit rr-hist-tag">{w.akcja === 'anulowano' ? 'anulowana' : 'usunięte'}</span>}</td>
            <td className="rr-hist-opis">{w.opis}</td>
            <td className="rr-hist-powod">{w.powod || <span className="faint">—</span>}</td>
          </tr>
        ))}</tbody>
      </table>
      {h.wiecej && <p className="muted rr-hist-wiecej">Pokazano {h.wpisy.length} najnowszych zmian.</p>}
    </div>
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
                const r = czesciRozliczenia(p, w)
                const nr = numer(p.dokumentId)
                return (
                  <tr key={p.id} className="row" data-id={p.id}>
                    <td className="tnum">{dataPl(p.data)}</td>
                    <td>{p.ksiega === 'wz' ? 'WZ' : 'FV'}{nr && <span className="sub" data-tip="Wpłata wskazana na ten dokument">→ {nr}</span>}</td>
                    <td>{FORMA_SLOWEM[p.forma] ?? p.forma}</td>
                    <td className="num">{kwota(p.kwota, w)}</td>
                    <td className="rr-rozliczyla">{r.length
                      ? r.map((c, i) => <React.Fragment key={i}>{i > 0 && '; '}<span className="rr-nw">{c}</span></React.Fragment>)
                      : <span className="faint">—</span>}</td>
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
  const r = rozliczyla(w, waluta)
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
          data-autofocus /></label>
      <div className="note"><FlagIcon level="info" size={15} /><div>Wpłata zniknie z salda, ale zostanie w historii. Dokumenty, które pokryła, wrócą do zapłaty.</div></div>
      <OdmowaSerwera blad={blad} />
    </Dialog>
  )
}

