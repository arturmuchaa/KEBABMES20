import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Wallet, RefreshCw, CalendarDays, Search, ArrowUp, ArrowDown, BellRing, ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { Wybor, type WyborItem } from '../../ui/Wybor'
import { useApi } from '@/hooks/useApi'
import { clientsApi, rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  FILTRY, KLASA_TONU, KOLUMNY, PIERWSZY_KIERUNEK, filtruj, kwotaSalda, mapujListe, pigulka, podpowiedzKlienta, sortuj,
  walutyPodsumowania, znakSalda,
  type Filtr, type Kierunek, type Kolumna, type Kontrahent, type ListaRozliczen, type WzBezKontrahenta,
} from './model'

type Sort = { kol: Kolumna; kier: Kierunek } | null

const KLUCZ_SORT = 'protrima.rozrachunki.sort'
const KLUCZ_FILTR = 'protrima.rozrachunki.filtr'
const pamiec = {
  czytaj(k: string) { try { return window.localStorage.getItem(k) } catch { return null } },
  zapisz(k: string, v: string | null) {
    try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v) } catch { /* bez pamięci przeglądarki */ }
  },
}
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
const KOLUMNY_TABELI: Array<{ kol: Kolumna; label: string; num?: boolean; tip?: string }> = [
  { kol: 'nazwa', label: 'Kontrahent' },
  { kol: 'waluta', label: 'Waluta' },
  { kol: 'saldoWz', label: 'Saldo WZ', num: true, tip: 'Księga WZ — minus: klient winien, plus: nadpłata' },
  { kol: 'saldoFv', label: 'Saldo FV', num: true, tip: 'Księga faktur — minus: klient winien, plus: nadpłata' },
  { kol: 'saldo', label: 'Saldo łącznie', num: true },
  { kol: 'poTerminie', label: 'Po terminie', num: true, tip: 'Niezapłacona reszta dokumentów po terminie płatności' },
  { kol: 'najstarszaDni', label: 'Najstarsza zaległość' },
]
const KOLUMN = KOLUMNY_TABELI.length
const klasaSalda = (x: number) => (znakSalda(x) < 0 ? ' crit-ink' : znakSalda(x) > 0 ? ' ok-ink' : '')
const tekstBledu = (e: unknown, zast: string) => (e instanceof Error && e.message ? e.message : zast)

/**
 * Rozrachunki — salda odbiorców z WZ i faktur (zastępuje arkusz biura):
 * sumy osobno PLN i EUR, filtry, sortowanie (zapamiętane), WZ bez kontrahenta
 * do przypisania, karta klienta wewnątrz modułu. Salda liczy serwer.
 */
export function RozrachunkiModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const res = useApi(() => rozliczeniaApi.lista().then(mapujListe))
  const l = res.data
  const [wybrany, setWybrany] = useState<string | null>(null)
  const [okno, setOkno] = useState<'start' | null>(null)
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
  const setFiltr = (f: Filtr) => { setFiltrStan(f); pamiec.zapisz(KLUCZ_FILTR, f === 'wszyscy' ? null : f) }
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

  const otworz = (k: Kontrahent) => { setKursor(k.id); setWybrany(k.id) }
  const wroc = useCallback(() => { doFokusu.current = wybrany; setWybrany(null) }, [wybrany])
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
      if (e.key === 'Escape' && wybrany) { e.preventDefault(); wroc() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !wybrany) { e.preventDefault(); szukajRef.current?.focus() }
    }
    window.addEventListener('keydown', klawisz)
    return () => window.removeEventListener('keydown', klawisz)
  }, [active, wybrany, wroc])

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'reload', group: 1, label: 'Odśwież', icon: <RefreshCw size={17} />, run: odswiez },
    { id: 'start', group: 2, label: 'Data startu rozliczeń', icon: <CalendarDays size={17} />, disabled: !l, tip: 'najpierw wczytaj rozrachunki',
      run: () => setOkno('start') },
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
          <div className="dock-pad rr">
            <div className="rr-karta-h">
              <button type="button" className="btn" onClick={wroc} data-tip="Wróć do listy (Esc)">← Kontrahenci</button>
              <h2 className="rr-karta-nazwa" title={wybranyK?.nazwa}>{wybranyK?.nazwa ?? ''}</h2>
            </div>
            {/* Karta klienta (Task 10) osadza się tutaj. */}
            <Pusto ikona={<Wallet size={22} />} tytul="Karta klienta — w przygotowaniu">Tu pojawią się księgi WZ i faktur, wpłaty i dziennik ustaleń tego kontrahenta.</Pusto>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} hidden={!!wybrany}>
        <div className="dock-pad rr">
          {blad}
          {l && <Sumy l={l} />}

          {l && wszyscy.length > 0 && (
            <div className="rr-bar">
              <div className="rr-chips" role="group" aria-label="Filtr kontrahentów">
                {FILTRY.filter(f => f === filtr || ['wszyscy', 'poTerminie', 'nadplaty'].includes(f) || (liczniki[f] > 0
                  && (f === 'przypomnienia' || (liczniki.PLN > 0 && liczniki.EUR > 0)))).map(f => (
                  <button key={f} type="button" className={`chip${filtr === f ? ' on' : ''}`} aria-pressed={filtr === f} onClick={() => setFiltr(f)}>
                    {ETYKIETA_FILTRA[f]}<span className={`count${f === 'poTerminie' && liczniki[f] ? ' crit' : f === 'przypomnienia' && liczniki[f] ? ' warn' : ''}`}>{liczniki[f]}</span>
                  </button>
                ))}
              </div>
              <div className="field-wrap rr-szukaj">
                <Search size={15} />
                <input ref={szukajRef} className="field" value={szukaj} onChange={e => setSzukaj(e.target.value)} onKeyDown={naSzukaniu}
                  placeholder="Szukaj kontrahenta lub NIP" aria-label="Szukaj kontrahenta" />
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

          {l && wszyscy.length === 0
            ? <Pusto ikona={<Wallet size={22} />} tytul="Nikt jeszcze nie ma rozliczeń — dodaj saldo otwarcia albo wystaw WZ">
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
                          <button type="button" className="rr-th" onClick={() => klikNaglowka(c.kol)} data-tip={c.tip}>
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

      {okno === 'start' && l && (
        <DataStartu start={l.start} onClose={() => setOkno(null)} onZapisano={nowa => {
          setOkno(null)
          app.toast({ kind: 'ok', title: `Data startu rozliczeń: ${dataPl(nowa)}`, detail: 'salda wszystkich kontrahentów przeliczone od tego dnia' })
          odswiez()
        }} />
      )}
    </>
  )
}

function WierszKontrahenta({ k, zebra, tabIndex, onOtworz, onFocus, onKey }: {
  k: Kontrahent; zebra: boolean; tabIndex: number
  onOtworz: () => void; onFocus: () => void; onKey: (e: React.KeyboardEvent<HTMLTableRowElement>) => void
}) {
  const p = pigulka(k)
  return (
    <tr className={`row click${zebra ? ' zebra' : ''}${k.stan === 'rozliczony' ? ' closed' : ''}`} data-id={k.id} data-nazwa={k.nazwa}
      tabIndex={tabIndex} onClick={onOtworz} onFocus={onFocus} onKeyDown={onKey} aria-label={`${k.nazwa}, saldo ${kwotaSalda(k.saldo, k.waluta)}, ${p.tekst}`}>
      <td className="rr-nazwa" title={k.nip ? `${k.nazwa} · NIP ${k.nip}` : k.nazwa}>{k.nazwa}
        {k.przypomnienie && <span className="rr-dzwonek" role="img" aria-label="Przypomnienie na dziś" data-tip="Przypomnienie w dzienniku na dziś — zajrzyj do karty"><BellRing size={14} /></span>}
      </td>
      <td><span className="cc rr-waluta">{k.waluta}</span></td>
      <td className={`num${klasaSalda(k.saldoWz)}`}>{kwotaSalda(k.saldoWz, k.waluta)}</td>
      <td className={`num${klasaSalda(k.saldoFv)}`}>{kwotaSalda(k.saldoFv, k.waluta)}</td>
      <td className={`num rr-saldo${klasaSalda(k.saldo)}`}>{kwotaSalda(k.saldo, k.waluta)}</td>
      <td className={`num${znakSalda(k.poTerminie) > 0 ? ' crit-ink' : ' faint'}`}>{znakSalda(k.poTerminie) > 0 ? kwota(k.poTerminie, k.waluta) : '–'}</td>
      <td><span className={`tag ${KLASA_TONU[p.ton]}`}>{p.tekst}</span></td>
    </tr>
  )
}

const ZERO = { naleznosci: 0, poTerminie: 0, gotowkaWz: 0, nadplaty: 0 }

/** Kafelki sum osobno dla każdej waluty — bez przeliczania kursów. */
function Sumy({ l }: { l: ListaRozliczen }) {
  const z = walutyPodsumowania(l)
  const waluty = z.length ? z : [l.kontrahenci[0]?.waluta || 'PLN']
  const suma = (w: string) => l.podsumowanie[w] ?? ZERO
  const nadplacajacy = l.kontrahenci.filter(k => znakSalda(k.saldoWz) > 0 || znakSalda(k.saldoFv) > 0).length
  const nadplaty = waluty.filter(w => znakSalda(suma(w).nadplaty) > 0)
  return (
    <div className="rr-sumy" role="group" aria-label="Sumy rozrachunków">
      {waluty.map(w => {
        const p = suma(w)
        return (
          <div key={w} className="rr-sum">
            <span className="k">Należności {w}</span>
            <span className={`v${klasaSalda(-p.naleznosci)}`}>{kwotaSalda(-p.naleznosci, w)}</span>
            <span className="s">w tym po terminie <b className={znakSalda(p.poTerminie) > 0 ? 'crit-ink' : undefined}>{kwota(p.poTerminie, w)}</b></span>
          </div>
        )
      })}
      <div className="rr-sum">
        <span className="k">Gotówka z WZ do odebrania</span>
        <span className="v">{waluty.map(w => kwota(suma(w).gotowkaWz, w)).join(' · ')}</span>
        <span className="s">niezapłacone WZ płatne gotówką</span>
      </div>
      <div className="rr-sum">
        <span className="k">Nadpłaty klientów</span>
        <span className={`v${nadplaty.length ? ' ok-ink' : ''}`}>{nadplaty.length ? nadplaty.map(w => kwotaSalda(suma(w).nadplaty, w)).join(' · ') : kwota(0, waluty[0])}</span>
        <span className="s">{nadplacajacy ? `kontrahentów z nadpłatą: ${nadplacajacy}` : 'nikt nie ma nadpłaty'}</span>
      </div>
    </div>
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
                  placeholder={klienciRes.loading ? 'Wczytuję kontrahentów…' : 'Wpisz nazwę lub NIP'} disabled={klienciRes.loading && !klienci.length} />
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

/** Data startu rozliczeń: dokumenty i wpłaty od tego dnia liczą się w systemie, wcześniejsze siedzą w saldzie otwarcia. */
function DataStartu({ start, onClose, onZapisano }: { start: string; onClose: () => void; onZapisano: (nowa: string) => void }) {
  const [d, setD] = useState(start)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)
  const ok = !!d && d !== start
  const zapisz = async () => {
    if (!ok || lock.current) return
    lock.current = true; setBusy(true); setBlad(null)
    try {
      const r = await rozliczeniaApi.ustawStart(d)
      onZapisano(r?.start || d)
    } catch (e) {
      setBlad(tekstBledu(e, 'Nie udało się zapisać daty startu'))
    } finally { lock.current = false; setBusy(false) }
  }
  return (
    <Dialog title="Data startu rozliczeń" icon={<CalendarDays size={20} />} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || busy} data-tip={ok ? undefined : d ? 'Data bez zmian' : 'Wpisz datę'}
          onClick={() => void zapisz()}>{busy ? 'Zapisuję…' : 'Zapisz'}</button>
      </>}>
      <form onSubmit={e => { e.preventDefault(); void zapisz() }}>
        <label className="fld"><span className="label">Data startu</span>
          <input type="date" className="field" value={d} onChange={e => setD(e.target.value)} aria-label="Data startu" data-autofocus required /></label>
      </form>
      <p className="muted" style={{ margin: 0 }}>Liczą się dokumenty i wpłaty z tą datą i późniejsze. Wcześniejsze są w saldzie otwarcia klienta (stan na początek tego dnia).</p>
      <div className="note"><FlagIcon level="info" size={15} /><div>Zmiana przelicza salda wszystkich kontrahentów.</div></div>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}
