import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Wallet, RefreshCw, Search, ArrowUp, ArrowDown, BellRing, ChevronDown, ChevronRight, Link2, Plus, UserPlus, Undo2, UserX, Landmark } from 'lucide-react'
import { KontaDialog } from './KontaDialog'
import { useApp, CommandBar, Dialog, type Cmd } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { Wybor, type WyborItem } from '../../ui/Wybor'
import { useApi } from '@/hooks/useApi'
import { clientsApi, rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  ETYKIETA_OKRESU_OBROTU, FILTRY, KLASA_TONU, KOLUMNY, PIERWSZY_KIERUNEK, bladZakresu, dzisIso, filtruj, kandydaciDoDodania, kilogramy,
  kafelekKpi, kwotaSalda, mapujListe, podpisKursu, opisOkresu, pigulka, podpowiedzKlienta, pozycje, sortuj, walutyPodsumowania, zakresObrotu, znakSalda,
  type Filtr, type Kierunek, type Kolumna, type Kontrahent, type KafelekKpi, type ListaRozliczen, type Wylaczony, type WyborOkresuObrotu, type WzBezKontrahenta,
} from './model'
import { KartaKlienta, type Okno } from './KartaKlienta'
import { WyborOkresu, klasaSalda, klasaZaleglosci, pamiec, tekstBledu, useOkresObrotu } from './wspolne'
import { WplataDialog } from './WplataDialog'
import { FakturaDialog } from './FakturaDialog'
import { OtwarcieDialog } from './OtwarcieDialog'
import { UstawieniaKlientaDialog } from './UstawieniaKlientaDialog'
import { DrukSaldaDialog } from './DrukSaldaDialog'

type Sort = { kol: Kolumna; kier: Kierunek } | null

const KLUCZ_SORT = 'protrima.rozrachunki.sort'
const KLUCZ_FILTR = 'protrima.rozrachunki.filtr'
const czytajSort = (): Sort => {
  try {
    const s = JSON.parse(pamiec.czytaj(KLUCZ_SORT) ?? 'null')
    return s && KOLUMNY.includes(s.kol) && (s.kier === 'asc' || s.kier === 'desc') ? { kol: s.kol, kier: s.kier } : null
  } catch { return null }
}
const czytajFiltr = (): Filtr => { const f = pamiec.czytaj(KLUCZ_FILTR) as Filtr | null; return f && FILTRY.includes(f) ? f : 'wszyscy' }

const ETYKIETA_FILTRA: Record<Filtr, string> = {
  wszyscy: 'Wszyscy', poTerminie: 'Po terminie', nadplaty: 'Nadpłaty', przypomnienia: 'Przypomnienia', PLN: 'PLN', EUR: 'EUR',
}
const KOLUMNY_TABELI: Array<{ kol: Kolumna; label: string; num?: boolean; tip?: string; okres?: boolean }> = [
  { kol: 'nazwa', label: 'Kontrahent' },
  { kol: 'waluta', label: 'Waluta' },
  { kol: 'saldoWz', label: 'Saldo WZ', num: true, tip: 'Księga WZ — minus: klient winien, plus: nadpłata' },
  { kol: 'saldoFv', label: 'Saldo FV', num: true, tip: 'Księga faktur — minus: klient winien, plus: nadpłata' },
  { kol: 'saldo', label: 'Saldo łącznie', num: true },
  { kol: 'poTerminie', label: 'Po terminie', num: true, tip: 'Niezapłacona reszta dokumentów po terminie płatności' },
  { kol: 'najstarszaDni', label: 'Najstarsza zaległość' },
  { kol: 'obrot', label: 'Obrót', num: true, okres: true },
  { kol: 'kg', label: 'kg', num: true, okres: true },
]
const KOLUMN = KOLUMNY_TABELI.length
/**
 * Rozrachunki — salda odbiorców z WZ i faktur (zastępuje arkusz biura):
 * sumy osobno PLN i EUR, filtry, sortowanie (zapamiętane), WZ bez kontrahenta
 * do przypisania, karta klienta wewnątrz modułu. Salda liczy serwer.
 */
export function RozrachunkiModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const dzis = dzisIso()
  const [okresWybor, setOkresWybor] = useOkresObrotu()
  // Zły własny zakres (brak daty, „do” przed „od”) — zostaje ostatni poprawny, bez zapytania do serwera.
  const [okresOk, setOkresOk] = useState<WyborOkresuObrotu>(() => (bladZakresu(okresWybor) ? { okres: 'miesiac', od: '', do: '' } : okresWybor))
  const zmienOkres = (w: WyborOkresuObrotu) => { setOkresWybor(w); if (!bladZakresu(w)) setOkresOk(w) }
  const z = zakresObrotu(okresOk, dzis)
  const res = useApi(() => rozliczeniaApi.lista(z.od, z.do).then(mapujListe), [z.od, z.do])
  const l = res.data
  const [wybrany, setWybrany] = useState<string | null>(null)
  const [nazwaNowego, setNazwaNowego] = useState<string | undefined>(undefined)
  const [nowyZKartoteki, setNowyZKartoteki] = useState(false)
  const [okno, setOkno] = useState<'dodaj' | 'konta' | null>(null)
  const [wylaczeniOn, setWylaczeniOn] = useState(false)
  const [oknoKarty, setOknoKarty] = useState<Okno | null>(null)
  const [wersjaKarty, setWersjaKarty] = useState(0)
  const [filtr, setFiltrStan] = useState<Filtr>(czytajFiltr)
  const [szukaj, setSzukaj] = useState('')
  const [sort, setSortStan] = useState<Sort>(czytajSort)
  const [kursor, setKursor] = useState<string | null>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const szukajRef = useRef<HTMLInputElement>(null)
  const doFokusu = useRef<string | null>(null)

  const { refetch } = res
  const odswiez = useCallback(() => { void refetch() }, [refetch])
  const wierszDom = (id: string) => [...(tbodyRef.current?.querySelectorAll<HTMLElement>('tr[data-id]') ?? [])].find(r => r.dataset.id === id)
  const setFiltr = (f: Filtr) => { setFiltrStan(f); setWylaczeniOn(false); pamiec.zapisz(KLUCZ_FILTR, f === 'wszyscy' ? null : f) }
  const klikNaglowka = (kol: Kolumna) => {
    const pierwszy = PIERWSZY_KIERUNEK[kol]
    // Pierwszy klik — kierunek najbardziej przydatny dla kolumny, drugi odwraca, trzeci wraca do kolejności serwera.
    const nowy: Sort = sort?.kol !== kol ? { kol, kier: pierwszy }
      : sort.kier === pierwszy ? { kol, kier: pierwszy === 'asc' ? 'desc' : 'asc' } : null
    setSortStan(nowy)
    pamiec.zapisz(KLUCZ_SORT, nowy ? JSON.stringify(nowy) : null)
  }

  const wszyscy = useMemo(() => l?.kontrahenci ?? [], [l])
  const liczniki = useMemo(() => Object.fromEntries(FILTRY.map(f => [f, filtruj(wszyscy, f, '').length])) as Record<Filtr, number>, [wszyscy])
  const widoczni = useMemo(() => {
    const f = filtruj(wszyscy, filtr, szukaj)
    return sort ? sortuj(f, sort.kol, sort.kier) : f
  }, [wszyscy, filtr, szukaj, sort])
  const wybranyK = wszyscy.find(k => k.id === wybrany) ?? null
  const wylaczeni = useMemo(() => l?.wylaczeni ?? [], [l])
  const pokazWylaczonych = wylaczeniOn && wylaczeni.length > 0
  const opisWybranego = opisOkresu(okresWybor, dzis, l?.start ?? '')
  const okresSlowem = `${ETYKIETA_OKRESU_OBROTU[okresOk.okres]} · ${opisOkresu(okresOk, dzis, l?.start ?? '')}`

  const otworz = (k: Kontrahent) => { setKursor(k.id); setNowyZKartoteki(false); setWybrany(k.id) }
  // Kontrahent z kartoteki bez rozrachunków: karta (pusta) w module — tam saldo otwarcia, potem jest na liście.
  const otworzNowego = (id: string, nazwa: string) => { setOkno(null); setNazwaNowego(nazwa); setNowyZKartoteki(true); setWybrany(id) }
  // Powrót z karty — lista po cichu się odświeża (wpłata, wpis w dzienniku mogły zmienić saldo i przypomnienia).
  const wroc = useCallback(() => { doFokusu.current = wybrany; setWybrany(null); odswiez() }, [wybrany, odswiez])
  // Okna karty (wpłata, faktura, saldo otwarcia, druk, ustawienia). Po zapisie: karta i lista od nowa
  // (saldo, przypomnienia), okno samo oddaje fokus przyciskowi, z którego je otwarto.
  const otworzOkno = useCallback((o: Okno) => setOknoKarty(o), [])
  const zamknijOkno = useCallback(() => setOknoKarty(null), [])
  const odswiezKarte = useCallback(() => { setWersjaKarty(v => v + 1); odswiez() }, [odswiez])
  const poZapisie = useCallback(() => { setOknoKarty(null); odswiezKarte() }, [odswiezKarte])
  // Po powrocie z karty kursor wraca na wiersz klienta — Enter otwiera następnego bez szukania.
  useEffect(() => {
    if (wybrany || !doFokusu.current) return
    const id = doFokusu.current
    doFokusu.current = null
    wierszDom(id)?.focus()
  }, [wybrany])

  useEffect(() => {
    if (!active) return
    const klawisz = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-wrap, .overlay')) return
      const cel = e.target as HTMLElement | null
      // Esc w polu karty (dziennik, daty) najpierw tylko z niego wychodzi — wpisany tekst nie znika razem z kartą.
      if (e.key === 'Escape' && wybrany && cel?.matches?.('input:not([type=checkbox]), textarea, select')) { e.preventDefault(); cel.blur() }
      else if (e.key === 'Escape' && wybrany) { e.preventDefault(); wroc() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !wybrany) { e.preventDefault(); szukajRef.current?.focus() }
    }
    window.addEventListener('keydown', klawisz)
    return () => window.removeEventListener('keydown', klawisz)
  }, [active, wybrany, wroc])

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'reload', group: 1, label: 'Odśwież', icon: <RefreshCw size={17} />, run: odswiez },
    { id: 'dodaj', group: 2, label: 'Kontrahent', icon: <Plus size={17} />, disabled: !l, tip: l ? 'Dodaj kontrahenta z kartoteki — np. z samym saldem otwarcia' : 'najpierw wczytaj rozrachunki',
      run: () => setOkno('dodaj') },
    { id: 'konta', group: 3, label: 'Rachunki do wpłat', icon: <Landmark size={17} />, tip: 'Numery rachunków PLN i EUR drukowane na dokumentach dla klienta', run: () => setOkno('konta') },
  ], [odswiez, l])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(l
      ? <span>Kontrahenci <b>{wszyscy.length}</b> · po terminie <b>{liczniki.poTerminie}</b> · rozliczenia od <b>{dataPl(l.start)}</b></span>
      : null)
  }, [active, l, wszyscy.length, liczniki.poTerminie, setCtx])

  const naWierszu = (e: React.KeyboardEvent<HTMLTableRowElement>, i: number) => {
    const cel = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? widoczni.length - 1 : null
    if (cel != null) {
      e.preventDefault()
      const k = widoczni[Math.max(0, Math.min(widoczni.length - 1, cel))]
      if (k) wierszDom(k.id)?.focus()
    } else if (e.key === 'Enter') { e.preventDefault(); otworz(widoczni[i]) }
  }
  // Z pola szukania: strzałka w dół — na pierwszy wiersz, Enter przy jednym trafieniu — od razu karta.
  const naSzukaniu = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && widoczni[0]) { e.preventDefault(); wierszDom(widoczni[0].id)?.focus() }
    else if (e.key === 'Enter' && widoczni.length === 1) { e.preventDefault(); otworz(widoczni[0]) }
  }
  const kursorWidoczny = widoczni.some(k => k.id === kursor) ? kursor : widoczni[0]?.id

  const blad = res.error && (
    <div className="note crit" role="alert"><FlagIcon level="crit" size={15} />
      <div><b>Nie udało się wczytać rozrachunków:</b> {res.error} <button type="button" className="btn sm" onClick={odswiez}>Spróbuj ponownie</button></div>
    </div>
  )

  return (
    <>
      <CommandBar title="Rozrachunki" count={l ? `salda odbiorców od ${dataPl(l.start)}` : undefined} cmds={cmds} />

      {wybrany && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div className="dock-pad">
            <KartaKlienta key={wybrany} clientId={wybrany} nazwa={wybranyK?.nazwa ?? nazwaNowego} wersja={wersjaKarty} onWroc={wroc} onOtworz={otworzOkno}
              okres={okresWybor} onOkres={zmienOkres} fokusNaStart={nowyZKartoteki} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} hidden={!!wybrany}>
        <div className="dock-pad rr">
          {blad}
          {l && (
            <div className="rr-okres-pasek">
              <span className="rr-okres-tyt">Obrót i kg za</span>
              <WyborOkresu wybor={okresWybor} onChange={zmienOkres} dzis={dzis} opis={opisWybranego} />
            </div>
          )}
          {l && <Sumy l={l} okres={okresSlowem} />}

          {l && (wszyscy.length > 0 || wylaczeni.length > 0) && (
            <div className="rr-bar">
              <div className="rr-chips" role="group" aria-label="Filtr kontrahentów">
                {FILTRY.filter(f => f === filtr || ['wszyscy', 'poTerminie', 'nadplaty'].includes(f) || (liczniki[f] > 0
                  && (f === 'przypomnienia' || (liczniki.PLN > 0 && liczniki.EUR > 0)))).map(f => (
                  <button key={f} type="button" className={`chip${filtr === f && !pokazWylaczonych ? ' on' : ''}`} aria-pressed={filtr === f && !pokazWylaczonych} onClick={() => setFiltr(f)}>
                    {ETYKIETA_FILTRA[f]}<span className={`count${f === 'poTerminie' && liczniki[f] ? ' crit' : f === 'przypomnienia' && liczniki[f] ? ' warn' : ''}`}>{liczniki[f]}</span>
                  </button>
                ))}
                {wylaczeni.length > 0 && (
                  <button type="button" className={`chip rr-chip-wyl${pokazWylaczonych ? ' on' : ''}`} aria-pressed={pokazWylaczonych}
                    data-tip="Kontrahenci, dla których nie prowadzisz rozrachunków — można ich przywrócić" onClick={() => setWylaczeniOn(v => !v)}>
                    Wyłączeni<span className="count">{wylaczeni.length}</span>
                  </button>
                )}
              </div>
              <div className="field-wrap rr-szukaj">
                <Search size={15} />
                <input ref={szukajRef} className="field" value={szukaj} onChange={e => setSzukaj(e.target.value)} onKeyDown={naSzukaniu}
                  aria-label="Szukaj kontrahenta" title="Szukaj po nazwie albo NIP" disabled={pokazWylaczonych} />
                {!szukaj && <span className="kbd">Ctrl F</span>}
              </div>
            </div>
          )}

          {l && l.bezKontrahenta.length > 0 && <PasekWzBezKontrahenta docs={l.bezKontrahenta} onPrzypisano={odswiez} />}
          {l && l.innaWaluta > 0 && (
            <div className="note warn"><FlagIcon level="warn" size={15} />
              <div><b>Dokumenty w innej walucie niż kontrahent ({l.innaWaluta})</b> — nie wchodzą do sald (bez przeliczania kursów).
                Sprawdź walutę kontrahenta albo dokument na karcie klienta.</div>
            </div>
          )}

          {pokazWylaczonych
            ? <ListaWylaczonych wylaczeni={wylaczeni} onPrzywrocono={odswiez} />
            : l && wszyscy.length === 0
            ? <Pusto ikona={<Wallet size={22} />} tytul="Nikt jeszcze nie ma rozliczeń — dodaj saldo otwarcia albo wystaw WZ"
                akcja={<button type="button" className="btn sm" onClick={() => setOkno('dodaj')}><UserPlus size={14} />Dodaj kontrahenta</button>}>
                Rozliczenia liczą się od {dataPl(l.start)}. Wycenione WZ wystawione od tego dnia pojawią się tu same,
                a stan z arkusza wpiszesz jako saldo otwarcia klienta.</Pusto>
            : (l || res.loading) && (
              <div className="box">
                <table className="tbl rr-tbl" aria-label="Kontrahenci z saldami">
                  <thead><tr>
                    {KOLUMNY_TABELI.map(c => {
                      const on = sort?.kol === c.kol
                      return (
                        <th key={c.kol} className={c.num ? 'num' : undefined} aria-sort={on ? (sort!.kier === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="rr-th" onClick={() => klikNaglowka(c.kol)} data-tip={c.okres ? `${c.label === 'kg' ? 'Sprzedane kg' : 'Obrót brutto'} · ${okresSlowem}` : c.tip}>
                            {c.label}<span className="sort" aria-hidden="true">{on ? (sort!.kier === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</span>
                          </button>
                        </th>
                      )
                    })}
                  </tr></thead>
                  <tbody ref={tbodyRef}>
                    {res.loading && !l && <SzkieletWierszy kolumny={KOLUMN} wiersze={6} />}
                    {widoczni.map((k, i) => (
                      <WierszKontrahenta key={k.id} k={k} zebra={i % 2 === 1} tabIndex={k.id === kursorWidoczny ? 0 : -1}
                        onOtworz={() => otworz(k)} onFocus={() => setKursor(k.id)} onKey={e => naWierszu(e, i)} />
                    ))}
                    {l && widoczni.length === 0 && (
                      <tr><td colSpan={KOLUMN}>
                        <Pusto tytul="Nikt nie pasuje do filtra" akcja={<button type="button" className="btn sm" onClick={() => { setFiltr('wszyscy'); setSzukaj('') }}>Pokaż wszystkich</button>}>
                          {szukaj ? `Brak kontrahenta „${szukaj}”` : 'Brak kontrahentów'}{filtr !== 'wszyscy' ? ` w filtrze „${ETYKIETA_FILTRA[filtr]}”` : ''}.
                        </Pusto>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>

      {oknoKarty && <OknoKarty o={oknoKarty} onClose={zamknijOkno} onZapisano={poZapisie} onOdswiez={odswiezKarte} />}

      {okno === 'konta' && <KontaDialog onClose={() => setOkno(null)} />}
      {okno === 'dodaj' && l && (
        <DodajKontrahentaDialog naLiscie={wszyscy} wylaczeni={wylaczeni} onClose={() => setOkno(null)} onWybierz={otworzNowego} />
      )}
    </>
  )
}

/** Okno nad kartą klienta — dialog wybrany przez przycisk karty. */
function OknoKarty({ o, onClose, onZapisano, onOdswiez }: { o: Okno; onClose: () => void; onZapisano: () => void; onOdswiez: () => void }) {
  const p = { karta: o.karta, onClose, onZapisano }
  switch (o.rodzaj) {
    case 'wplata': return <WplataDialog {...p} ksiega={o.ksiega} dokumentId={o.dokumentId} />
    case 'faktura': return <FakturaDialog {...p} />
    case 'wz': return <FakturaDialog {...p} ksiega="wz" />
    case 'otwarcie': return <OtwarcieDialog {...p} ksiega={o.ksiega} zakladka={o.zakladka} onOdswiez={onOdswiez} />
    case 'ustawienia': return <UstawieniaKlientaDialog {...p} />
    case 'druk': return <DrukSaldaDialog {...p} />
  }
}

function WierszKontrahenta({ k, zebra, tabIndex, onOtworz, onFocus, onKey }: {
  k: Kontrahent; zebra: boolean; tabIndex: number
  onOtworz: () => void; onFocus: () => void; onKey: (e: React.KeyboardEvent<HTMLTableRowElement>) => void
}) {
  const p = pigulka(k)
  return (
    <tr className={`row click${zebra ? ' zebra' : ''}${k.stan === 'rozliczony' ? ' closed' : ''}`} data-id={k.id} data-nazwa={k.nazwa}
      tabIndex={tabIndex} onClick={onOtworz} onFocus={onFocus} onKeyDown={onKey} aria-label={`${k.nazwa}, saldo ${kwotaSalda(k.saldo, k.waluta)}, ${p.tekst}`}>
      <td className="rr-nazwa-td">
        <span className="rr-nazwa-w">
          <span className="rr-nazwa" title={k.nip ? `${k.nazwa} · NIP ${k.nip}` : k.nazwa}>{k.nazwa}</span>
          {k.przypomnienie && <span className="rr-dzwonek" role="img" aria-label="Przypomnienie na dziś" data-tip="Przypomnienie w dzienniku na dziś — zajrzyj do karty"><BellRing size={14} /></span>}
          {k.fvBezKwoty > 0 && <span className="tag warn rr-fv-bez" data-tip="Faktury z papierów kursu czekają na kwotę — wpisz ją na karcie klienta. Do salda wejdą dopiero z kwotą.">FV bez kwoty ({k.fvBezKwoty})</span>}
        </span>
      </td>
      <td><span className="cc rr-waluta">{k.waluta}</span></td>
      <td className={`num${klasaSalda(k.saldoWz)}`}>{kwotaSalda(k.saldoWz, k.waluta)}</td>
      <td className={`num${klasaSalda(k.saldoFv)}`}>{kwotaSalda(k.saldoFv, k.waluta)}</td>
      <td className={`num rr-saldo${klasaSalda(k.saldo)}`}>{kwotaSalda(k.saldo, k.waluta)}</td>
      <td className={`num${klasaZaleglosci(k.poTerminie) || ' faint'}`}>{znakSalda(k.poTerminie) > 0 ? kwota(k.poTerminie, k.waluta) : '–'}</td>
      <td><span className={`tag ${KLASA_TONU[p.ton]}`}
        data-tip={k.stan === 'sprawdz_walute' ? `${pozycje(k.innaWaluta)} w innej walucie niż ${k.waluta} — poza saldem. Sprawdź walutę klienta w Ustawieniach karty.` : undefined}>{p.tekst}</span></td>
      <td className={`num rr-okres-td${znakSalda(k.obrot) === 0 ? ' faint' : ''}`}>{znakSalda(k.obrot) === 0 ? '–' : kwota(k.obrot, k.waluta)}</td>
      <td className={`num rr-okres-td${Math.round(k.kg * 10) === 0 ? ' faint' : ''}`}>{Math.round(k.kg * 10) === 0 ? '–' : kilogramy(k.kg)}</td>
    </tr>
  )
}

const ZERO = { naleznosci: 0, poTerminie: 0, gotowkaWz: 0, nadplaty: 0, obrot: 0, kg: 0 }

/**
 * Kafelki KPI (D6, D14): należności i po terminie (stan na dziś), obrót i sprzedane kg (za wybrany okres).
 * Przy dwóch walutach główna liczba to suma w złotówkach po kursie NBP (`≈`), pod nią rozbicie zł · €;
 * kurs (tabela, data) raz, w pasku pod kafelkami. Bez kursu — kwoty osobno, z dopiskiem. Jedna waluta —
 * sama kwota. kg razem. Gotówka z WZ i nadpłaty w pasku podpisu. Same zera — bez kafelków.
 */
function Sumy({ l, okres }: { l: ListaRozliczen; okres: string }) {
  const waluty = walutyPodsumowania(l)
  if (!waluty.length) return null
  const suma = (w: string) => l.podsumowanie[w] ?? ZERO
  const nadplacajacy = l.kontrahenci.filter(k => znakSalda(k.saldoWz) > 0 || znakSalda(k.saldoFv) > 0).length
  const poTerminieIlu = l.kontrahenci.filter(k => znakSalda(k.poTerminie) > 0).length
  const nadplaty = waluty.filter(w => znakSalda(suma(w).nadplaty) > 0)
  const gotowka = waluty.filter(w => znakSalda(suma(w).gotowkaWz) > 0)
  const zaleglosc = waluty.some(w => znakSalda(suma(w).poTerminie) > 0)
  const kg = waluty.reduce((a, w) => a + suma(w).kg, 0)
  const kupujacy = l.kontrahenci.filter(k => Math.round(k.kg * 10) !== 0).length
  const naleznosci = kafelekKpi(l, 'naleznosci', waluty)
  const poTerminie = kafelekKpi(l, 'poTerminie', waluty)
  const obrot = kafelekKpi(l, 'obrot', waluty)
  const kafle = [naleznosci, poTerminie, obrot]
  const kurs = l.przeliczenie.kurs && kafle.some(k => k.wZlotowkach) ? podpisKursu(l.przeliczenie.kurs) : null
  const brakKursu = kafle.some(k => k.brakKursu)
  return (
    <div className="rr-sumy-w" role="group" aria-label="Sumy rozrachunków">
      <div className="rr-sumy">
        <div className="rr-sum">
          <span className="k">Należności łącznie</span>
          <KwotyKpi className="v" kafel={naleznosci} kurs={kurs} />
          <span className="s">do zapłaty przez kontrahentów, dziś</span>
        </div>
        <div className="rr-sum">
          <span className="k">Po terminie</span>
          <KwotyKpi className={`v${zaleglosc ? ' crit-ink' : ''}`} kafel={poTerminie} kurs={kurs} />
          <span className="s">{poTerminieIlu ? `kontrahentów z zaległością: ${poTerminieIlu}` : 'nikt nie zalega'}</span>
        </div>
        <div className="rr-sum rr-sum-okres">
          <span className="k">Obrót</span>
          <KwotyKpi className="v" kafel={obrot} kurs={kurs} />
          <span className="s">{okres}</span>
        </div>
        <div className="rr-sum rr-sum-okres">
          <span className="k">Sprzedane kg</span>
          {/* Ten sam krój co kwoty obok (przy kwotach osobno mniejszy) — kafelki w jednej linii. */}
          <span className={`v${naleznosci.kwoty.length > 1 ? ' multi' : ''}`}><span className="rr-kw">{kilogramy(kg)}</span></span>
          <span className="s">{kupujacy ? `kontrahentów z towarem: ${kupujacy}` : 'w tym okresie nic nie wyjechało'}</span>
        </div>
      </div>
      <div className="rr-sumy-pod">
        <span>Gotówka z WZ do odebrania <b className="tnum">{gotowka.length ? gotowka.map(w => kwota(suma(w).gotowkaWz, w)).join(' · ') : kwota(0, waluty[0])}</b></span>
        <span>Nadpłaty klientów <b className={`tnum${nadplaty.length ? ' ok-ink' : ''}`}>{nadplaty.length ? nadplaty.map(w => kwotaSalda(suma(w).nadplaty, w)).join(' · ') : kwota(0, waluty[0])}</b>
          {nadplacajacy > 0 && <span className="muted"> ({nadplacajacy === 1 ? '1 kontrahent' : `kontrahentów: ${nadplacajacy}`})</span>}</span>
        {kurs && <span className="rr-kurs" data-tip="Kwoty w euro przeliczone na złotówki po średnim kursie NBP (tabela A) — tylko w kafelkach; salda i wydruki zostają w walucie kontrahenta">{kurs}</span>}
        {brakKursu && <span className="rr-kurs warn-ink" data-tip="Nie udało się pobrać kursu EUR z NBP — kafelki pokazują złotówki i euro osobno. Odśwież za chwilę.">brak kursu NBP — kwoty osobno</span>}
      </div>
    </div>
  )
}

/** Główna liczba kafelka KPI: suma w zł (≈, z rozbiciem pod spodem) albo kwoty osobno — każda w całości, przy kilku mniejszy krój. */
function KwotyKpi({ className, kafel, kurs }: { className: string; kafel: KafelekKpi; kurs: string | null }) {
  return (
    <>
      <span className={`${className}${kafel.kwoty.length > 1 ? ' multi' : ''}`} data-tip={kafel.wZlotowkach && kurs ? `${kafel.rozbicie} · ${kurs}` : undefined}>
        {kafel.kwoty.map(k => <span key={k} className="rr-kw">{k}</span>)}
      </span>
      {kafel.rozbicie && <span className="rr-rozbicie">{kafel.rozbicie}</span>}
    </>
  )
}

/** WZ bez kontrahenta: nie liczą się do żadnego salda, dopóki biuro nie wskaże odbiorcy. */
function PasekWzBezKontrahenta({ docs, onPrzypisano }: { docs: WzBezKontrahenta[]; onPrzypisano: () => void }) {
  const [otwarty, setOtwarty] = useState(false)
  return (
    <div className="note warn rr-ostrz"><FlagIcon level="warn" size={15} />
      <div className="rr-ostrz-b">
        <button type="button" className="rr-ostrz-t" aria-expanded={otwarty} onClick={() => setOtwarty(o => !o)}>
          {otwarty ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<b>WZ bez kontrahenta ({docs.length})</b>
        </button>
        <span> — nie liczą się do żadnego salda. Wskaż odbiorcę, a WZ wejdzie do jego księgi WZ.</span>
        {otwarty && <ListaWzBezKontrahenta docs={docs} onPrzypisano={onPrzypisano} />}
      </div>
    </div>
  )
}

function ListaWzBezKontrahenta({ docs, onPrzypisano }: { docs: WzBezKontrahenta[]; onPrzypisano: () => void }) {
  const app = useApp()
  const klienciRes = useApi(() => clientsApi.list())
  const klienci = useMemo(() => (klienciRes.data ?? [])
    .filter(c => (c as { active?: boolean }).active !== false)
    .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl')), [klienciRes.data])
  const items = useMemo<WyborItem[]>(() => klienci.map(c => ({ id: c.id, label: c.displayName || c.name, sub: c.nip || undefined })), [klienci])
  const [wybor, setWybor] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [bledy, setBledy] = useState<Record<string, string>>({})
  const lock = useRef(false)
  const przyciski = useRef<Record<string, HTMLButtonElement | null>>({})
  const wartosc = (d: WzBezKontrahenta) => wybor[d.id] ?? podpowiedzKlienta(d.nabywca, klienci)

  const przypisz = async (d: WzBezKontrahenta) => {
    const cid = wartosc(d)
    if (!cid || lock.current) return
    lock.current = true; setBusy(d.id); setBledy(b => ({ ...b, [d.id]: '' }))
    try {
      await rozliczeniaApi.przypiszWz(d.id, cid)
      const nazwa = items.find(i => i.id === cid)?.label ?? ''
      app.toast({ kind: 'ok', title: `${d.numer} przypisana do ${nazwa}`, detail: `${kwota(d.kwota, d.waluta)} liczy się już w saldzie WZ kontrahenta` })
      onPrzypisano()
    } catch (e) {
      setBledy(b => ({ ...b, [d.id]: tekstBledu(e, 'Nie udało się przypisać WZ') }))
    } finally { lock.current = false; setBusy(null) }
  }

  return (
    <div className="rr-wz">
      {klienciRes.loading && !klienci.length && <div className="muted rr-wz-info">Wczytuję kontrahentów z kartoteki…</div>}
      {klienciRes.error && <div className="crit-ink">Nie udało się wczytać kontrahentów: {klienciRes.error} <button type="button" className="btn sm" onClick={() => void klienciRes.refetch()}>Spróbuj ponownie</button></div>}
      <table className="tbl">
        <thead><tr><th>WZ</th><th>Data</th><th className="num">Kwota</th><th>Nabywca na WZ</th><th>Kontrahent</th><th /></tr></thead>
        <tbody>{docs.map(d => {
          const v = wartosc(d)
          return (
            <tr key={d.id} className="row">
              <td className="code id-no">{d.numer}</td>
              <td className="tnum">{dataPl(d.data)}</td>
              <td className="num">{kwota(d.kwota, d.waluta)}</td>
              <td className="rr-nabywca" title={d.nabywca}>{d.nabywca || '—'}</td>
              <td className="rr-wz-wybor">
                <Wybor id={`rr-wz-${d.id}`} label={`Kontrahent dla ${d.numer}`} items={items} value={v}
                  onChange={id => setWybor(w => ({ ...w, [d.id]: id }))} onDalej={() => przyciski.current[d.id]?.focus()}
                  disabled={klienciRes.loading && !klienci.length} />
                {bledy[d.id] && <div className="crit-ink rr-wz-blad" role="alert">{bledy[d.id]}</div>}
              </td>
              <td className="r">
                <button ref={el => { przyciski.current[d.id] = el }} type="button" className="btn sm primary" disabled={!v || busy === d.id}
                  data-tip={v ? undefined : 'Najpierw wybierz kontrahenta'} onClick={() => void przypisz(d)}>
                  <Link2 size={14} />{busy === d.id ? 'Przypisuję…' : 'Przypisz'}
                </button>
              </td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

/** Wyłączeni z rozrachunków (D1): nie ma ich na liście ani w sumach; jednym przyciskiem wracają. */
function ListaWylaczonych({ wylaczeni, onPrzywrocono }: { wylaczeni: Wylaczony[]; onPrzywrocono: () => void }) {
  const app = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [bledy, setBledy] = useState<Record<string, string>>({})
  const lock = useRef(false)
  const przywroc = async (k: Wylaczony) => {
    if (lock.current) return
    lock.current = true; setBusy(k.id); setBledy(b => ({ ...b, [k.id]: '' }))
    try {
      await rozliczeniaApi.ustawWylaczenie(k.id, false)
      app.toast({ kind: 'ok', title: `${k.nazwa} wraca do rozrachunków`, detail: 'saldo znowu liczy się na liście, w sumach i na WZ' })
      onPrzywrocono()
    } catch (e) {
      setBledy(b => ({ ...b, [k.id]: tekstBledu(e, 'Nie udało się przywrócić kontrahenta') }))
    } finally { lock.current = false; setBusy(null) }
  }
  return (
    <div className="box">
      <div className="rr-wyl-opis"><UserX size={16} /><span>Tych kontrahentów nie ma na liście ani w sumach, a na ich WZ nie drukuje się saldo.
        Dokumenty dalej się zapisują — po przywróceniu nic nie zginie.</span></div>
      <table className="tbl rr-tbl" aria-label="Wyłączeni z rozrachunków">
        <thead><tr><th>Kontrahent</th><th>NIP</th><th>Waluta</th><th /></tr></thead>
        <tbody>{wylaczeni.map((k, i) => (
          <tr key={k.id} className={`row${i % 2 === 1 ? ' zebra' : ''}`}>
            <td className="rr-nazwa-td"><span className="rr-nazwa" title={k.nazwa}>{k.nazwa}</span>
              {bledy[k.id] && <div className="rr-pole-blad" role="alert">{bledy[k.id]}</div>}</td>
            <td className="tnum">{k.nip || '—'}</td>
            <td><span className="cc rr-waluta">{k.waluta}</span></td>
            <td className="r">
              <button type="button" className="btn sm" disabled={busy === k.id} onClick={() => void przywroc(k)}>
                <Undo2 size={14} />{busy === k.id ? 'Przywracam…' : 'Przywróć do rozrachunków'}
              </button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

/**
 * „+ Kontrahent” (D11): klient z kartoteki, którego jeszcze nie ma na liście (np. same zaległości
 * sprzed startu, bez nowych dokumentów). Wybór otwiera jego kartę — tam saldo otwarcia.
 */
function DodajKontrahentaDialog({ naLiscie, wylaczeni, onClose, onWybierz }: {
  naLiscie: Kontrahent[]; wylaczeni: Wylaczony[]; onClose: () => void; onWybierz: (id: string, nazwa: string) => void
}) {
  const klienciRes = useApi(() => clientsApi.list())
  const items = useMemo<WyborItem[]>(() => kandydaciDoDodania((klienciRes.data ?? []) as Array<{ id: string; name: string; displayName?: string; nip?: string; active?: boolean }>, naLiscie, wylaczeni)
    .map(c => ({ id: c.id, label: c.displayName || c.name, sub: c.nip || undefined }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pl')), [klienciRes.data, naLiscie, wylaczeni])
  const [id, setId] = useState('')
  // Po wyborze (Enter) fokus na „Otwórz kartę” — dopiero po przerysowaniu, gdy przycisk przestał być wyłączony; drugi Enter otwiera.
  const przycisk = useRef<HTMLButtonElement>(null)
  const wybrany = items.find(i => i.id === id)
  const otworz = () => { if (wybrany) onWybierz(wybrany.id, wybrany.label) }
  const wczytuje = klienciRes.loading && !klienciRes.data
  return (
    <Dialog title="Dodaj kontrahenta do rozrachunków" icon={<UserPlus size={20} />} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button ref={przycisk} type="button" className="btn primary" disabled={!wybrany} data-tip={wybrany ? undefined : 'Najpierw wybierz kontrahenta'}
          onClick={otworz}>Otwórz kartę</button>
      </>}>
      <form onSubmit={e => { e.preventDefault(); otworz() }}>
        <div className="fld"><span className="label">Kontrahent z kartoteki</span>
          <Wybor id="rr-dodaj-kontrahenta" label="Kontrahent z kartoteki" items={items} value={id} autoFocus
            pusto={wczytuje ? 'Wczytuję kartotekę…' : 'Wszyscy kontrahenci z kartoteki są już w rozrachunkach'}
            onChange={setId} onDalej={() => setTimeout(() => przycisk.current?.focus(), 0)} />
          <span className="rr-pole-pod">{wczytuje ? 'Wczytuję kartotekę kontrahentów…' : 'Szukaj po nazwie albo NIP.'}</span>
        </div>
      </form>
      <p className="muted" style={{ margin: 0 }}>Otworzy się karta — wpisz tam saldo otwarcia.</p>
      {klienciRes.error && (
        <div className="note crit" role="alert"><FlagIcon level="crit" size={15} />
          <div><b>Nie udało się wczytać kartoteki:</b> {klienciRes.error} <button type="button" className="btn sm" onClick={() => void klienciRes.refetch()}>Spróbuj ponownie</button></div>
        </div>
      )}
    </Dialog>
  )
}
