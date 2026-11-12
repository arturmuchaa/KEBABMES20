import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Scale, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  bledyZaleglego, dodajDni, doGroszy, ileDokumentow, kwotaBezWaluty, kwotaSalda, liczba, normNumeru, pustyZalegly, symbolWaluty, znakSalda,
  type BledyZaleglego, type Karta, type Ksiega, type WierszZaleglego,
} from './model'
import type { ZakladkaOtwarcia } from './KartaKlienta'
import { OdmowaSerwera, PoleKwoty, Segment, klasaSalda, naEnter, tekstBledu, useZapis } from './wspolne'

type Kierunek = 'winien' | 'nadplata'
type Stan = { kierunek: Kierunek; tekst: string; zalegle: string; uwagi: string }

const KIERUNKI = [['winien', 'klient winien'], ['nadplata', 'nadpłata']] as const
const KSIEGI: Ksiega[] = ['wz', 'fv']
const NAZWA: Record<Ksiega, 'WZ' | 'Faktury'> = { wz: 'WZ', fv: 'Faktury' }
const SKROT: Record<Ksiega, string> = { wz: 'WZ', fv: 'FV' }
const BLAD_KWOTY = 'Wpisz kwotę bez znaku — kierunek wybierz wyżej'
const ZAKLADKI: Array<[ZakladkaOtwarcia, string]> = [['zalegle', 'Zaległe dokumenty'], ['kwota', 'Jedna kwota']]

const poczatek = (k: Karta, ks: Ksiega): Stan => {
  const o = k.otwarcia[ks]
  if (!o) return { kierunek: 'winien', tekst: '', zalegle: '', uwagi: '' }
  return {
    kierunek: znakSalda(o.kwota) > 0 ? 'nadplata' : 'winien',
    tekst: znakSalda(o.kwota) === 0 ? '' : kwotaBezWaluty(Math.abs(o.kwota)),
    zalegle: o.zalegleOd ?? '', uwagi: o.uwagi,
  }
}

/** Kwota bez znaku z pola (puste = 0); ze znakiem albo nie liczba — NaN. */
const kwotaBezZnaku = (t: string) => {
  if (!t.trim()) return 0
  if (/^\s*[-+−–]/.test(t)) return NaN
  const x = liczba(t)
  return Number.isFinite(x) && x >= 0 ? doGroszy(x) : NaN
}

type Dto = { kwota: number; zalegle_od: string | null; uwagi: string }

/**
 * Saldo otwarcia z karty w kształcie `doApi` — punkt odniesienia „co się zmieniło”.
 * `null` — klient nie ma jeszcze żadnego salda otwarcia: zapisać trzeba obie księgi,
 * także puste (= 0), bo dopiero wtedy saldo zaczyna drukować się na WZ.
 */
const zKarty = (k: Karta, ks: Ksiega): Dto | null => {
  const o = k.otwarcia[ks]
  if (!o && !k.otwarcia.wz && !k.otwarcia.fv) return null
  return { kwota: o?.kwota ?? 0, zalegle_od: o?.zalegleOd ?? null, uwagi: o?.uwagi ?? '' }
}

/** Wartość do API: minus — klient winien, plus — nadpłata; „zaległe od” tylko przy długu. */
const doApi = (s: Stan): Dto => {
  const k = kwotaBezZnaku(s.tekst)
  return {
    kwota: k === 0 ? 0 : s.kierunek === 'winien' ? -k : k,
    zalegle_od: s.kierunek === 'winien' && s.zalegle ? s.zalegle : null,
    uwagi: s.uwagi.trim(),
  }
}

/** Domyślna zakładka: klient z samą kwotą zbiorczą — „Jedna kwota”; inaczej zaległe dokumenty. */
const domyslnaZakladka = (k: Karta): ZakladkaOtwarcia => {
  const zalegle = [...k.dokumenty.wz, ...k.dokumenty.fv].some(d => d.zalegly)
  return (k.otwarcia.wz || k.otwarcia.fv) && !zalegle ? 'kwota' : 'zalegle'
}

/**
 * Saldo otwarcia (D13) — dwie zakładki:
 * - „Zaległe dokumenty” — niezapłacone WZ i faktury sprzed startu, każdy osobno (numer, data,
 *   termin, kwota do zapłaty): wpłatę można potem przypiąć do konkretnej faktury;
 * - „Jedna kwota” — stan z arkusza na początek dnia startu, osobno WZ i faktury (klienci bez szczegółów).
 */
export function OtwarcieDialog({ karta, ksiega, zakladka, onClose, onZapisano, onOdswiez }: {
  karta: Karta; onClose: () => void; onZapisano: () => void
  /** Księga, z której otwarto okno — tam fokus (jedna kwota) albo domyślna księga nowych wierszy. */
  ksiega?: Ksiega
  /** Zakładka na start; bez niej — według tego, co klient już ma. */
  zakladka?: ZakladkaOtwarcia
  /** Odświeżenie karty bez zamykania okna — gdy zapisała się tylko jedna księga. */
  onOdswiez?: () => void
}) {
  const [tab, setTab] = useState<ZakladkaOtwarcia>(() => zakladka ?? domyslnaZakladka(karta))
  const kw = useJednaKwota(karta, ksiega, onZapisano, onOdswiez)
  const zal = useZalegle(karta, ksiega, onZapisano)
  const akt = tab === 'kwota' ? kw : zal
  const cialo = useRef<HTMLDivElement>(null)
  const pierwszy = useRef(true)
  // Zmiana zakładki — fokus w pierwszym polu nowej (na starcie robi to okno).
  useEffect(() => {
    if (pierwszy.current) { pierwszy.current = false; return }
    cialo.current?.querySelector<HTMLElement>('[data-autofocus], input, select')?.focus()
  }, [tab])
  const nowyKlient = !karta.otwarcia.wz && !karta.otwarcia.fv && ![...karta.dokumenty.wz, ...karta.dokumenty.fv].some(d => d.zalegly)

  const naKlawisz = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); akt.zapisz() }
  }
  return (
    <Dialog xl icon={<Scale size={20} />} onClose={onClose}
      title={<>Saldo otwarcia <span className="rr-dlg-klient">{karta.klient.nazwa}</span></>}
      footer={<>
        {tab === 'zalegle' && <span className="left"><span className="kbd">Enter</span> w kwocie — następny wiersz · <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> zapisuje</span>}
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!akt.ok || akt.busy} data-tip={akt.tip} onClick={akt.zapisz}>
          {akt.busy ? 'Zapisuję…' : akt.etykieta}
        </button>
      </>}>
      <div className="rr-otw-cialo" ref={cialo} onKeyDown={naKlawisz}>
        <div className="dock-tabs rr-otw-tabs" role="tablist" aria-label="Sposób wpisania salda otwarcia">
          {ZAKLADKI.map(([z, t]) => (
            <button key={z} type="button" role="tab" id={`rr-otw-${z}`} className="dock-tab" aria-selected={tab === z} aria-controls={`rr-otw-p-${z}`}
              onClick={() => setTab(z)}>{t}</button>
          ))}
        </div>
        <div className="note"><FlagIcon level="info" size={15} />
          <div>Stan na początek dnia {dataPl(karta.start)}. Dokumenty z tego dnia i późniejsze liczą się już w systemie.</div>
        </div>
        {nowyKlient && (
          <div className="note warn"><FlagIcon level="warn" size={15} />
            <div>Klient nie ma jeszcze salda otwarcia, więc saldo nie drukuje się na WZ ani w papierach kursu.
              {tab === 'zalegle' ? ' Wpisz jego niezapłacone dokumenty. Nic nie jest winien? Zapisz 0 w zakładce „Jedna kwota”.' : ' Puste pole to 0 (klient nic nie jest winien) — też można je zapisać.'}</div>
          </div>
        )}
        <div role="tabpanel" id={`rr-otw-p-${tab}`} aria-labelledby={`rr-otw-${tab}`}>{akt.ui}</div>
      </div>
    </Dialog>
  )
}

// ─── Jedna kwota (dotychczasowe saldo otwarcia) ────────────────────────

function useJednaKwota(karta: Karta, ksiega: Ksiega | undefined, onZapisano: () => void, onOdswiez?: () => void) {
  const app = useApp()
  const w = karta.klient.waluta
  const [stan, setStan] = useState<Record<Ksiega, Stan>>(() => ({ wz: poczatek(karta, 'wz'), fv: poczatek(karta, 'fv') }))
  const zapis = useZapis('Nie udało się zapisać salda otwarcia')
  // Stan na serwerze: z karty, a po częściowym zapisie — z tego, co już przeszło (ponowny zapis wysyła tylko resztę).
  const [zapisane, setZapisane] = useState<Record<Ksiega, Dto | null>>(() => ({ wz: zKarty(karta, 'wz'), fv: zKarty(karta, 'fv') }))
  const zmien = (ks: Ksiega, z: Partial<Stan>) => setStan(s => ({ ...s, [ks]: { ...s[ks], ...z } }))

  const bladKwoty = (ks: Ksiega) => (Number.isNaN(kwotaBezZnaku(stan[ks].tekst)) ? BLAD_KWOTY : null)
  const bladZaleglych = (ks: Ksiega) => (stan[ks].kierunek === 'winien' && stan[ks].zalegle && stan[ks].zalegle > karta.start
    ? `Data „zaległe od” nie może być po dacie startu (${dataPl(karta.start)})` : null)
  const zmieniona = (ks: Ksiega) => {
    const teraz = doApi(stan[ks]), przed = zapisane[ks]
    if (!przed) return true
    return doGroszy(teraz.kwota) !== doGroszy(przed.kwota)
      || (znakSalda(teraz.kwota) < 0 && teraz.zalegle_od !== przed.zalegle_od) || teraz.uwagi !== przed.uwagi
  }
  const bledne = KSIEGI.some(ks => bladKwoty(ks) || bladZaleglych(ks))
  const doZapisu = KSIEGI.filter(zmieniona)
  const ok = !bledne && doZapisu.length > 0
  const tip = bledne ? 'Popraw zaznaczone pola' : !doZapisu.length ? 'Nic nie zmieniono' : undefined

  const zapisz = () => {
    if (!ok) return
    void zapis.zapisz(async () => {
      const opisy: string[] = []
      const gotowe: Ksiega[] = []
      for (const ks of doZapisu) {
        const dto = doApi(stan[ks])
        try {
          await rozliczeniaApi.ustawOtwarcie(karta.klient.id, ks, dto)
        } catch (e) {
          if (!gotowe.length) throw e
          // Część przeszła: karta ma to pokazać, a komunikat — powiedzieć, co jest zapisane.
          onOdswiez?.()
          throw new Error(`Saldo otwarcia ${SKROT[ks]} nie zapisano — ${tekstBledu(e, 'błąd serwera')}. `
            + `Saldo otwarcia ${gotowe.map(g => SKROT[g]).join(' i ')} jest już zapisane.`)
        }
        gotowe.push(ks)
        setZapisane(z => ({ ...z, [ks]: dto }))
        opisy.push(`${SKROT[ks]}: ${znakSalda(dto.kwota) < 0 ? `klient winien ${kwota(-dto.kwota, w)}` : znakSalda(dto.kwota) > 0 ? `nadpłata ${kwota(dto.kwota, w)}` : 'zero'}`)
      }
      app.toast({ kind: 'ok', title: 'Saldo otwarcia zapisane', detail: opisy.join(' · ') })
      onZapisano()
    })
  }

  const ui = (
    <>
      <div className="rr-otw">
        {KSIEGI.map(ks => {
          const s = stan[ks], n = NAZWA[ks], dto = doApi(s)
          return (
            <section key={ks} className="rr-otw-k" role="group" aria-label={`Saldo otwarcia — ${n}`}>
              <h3>{n}</h3>
              <div className="fld"><span className="label">Na początek dnia startu</span>
                <Segment label={`Kierunek ${n}`} value={s.kierunek} opcje={KIERUNKI} onChange={k => zmien(ks, { kierunek: k })} />
              </div>
              <div className="fld"><span className="label">Kwota ({w}) — puste = 0</span>
                <PoleKwoty label={`Kwota ${n}`} value={s.tekst} onChange={t => zmien(ks, { tekst: t })} waluta={w} blad={bladKwoty(ks)}
                  onEnter={zapisz} autofocus={ks === (ksiega ?? 'wz')} />
                {!bladKwoty(ks) && (
                  <span className="rr-pole-pod">na start księgi: <b className={`tnum${klasaSalda(dto.kwota)}`}>{kwotaSalda(dto.kwota, w)}</b></span>
                )}
              </div>
              {s.kierunek === 'winien' && (
                <label className="fld"><span className="label">Zaległe od (opcjonalnie)</span>
                  <input type="date" className={`field${bladZaleglych(ks) ? ' invalid' : ''}`} value={s.zalegle} max={karta.start}
                    aria-label={`Zaległe od ${n}`} onChange={e => zmien(ks, { zalegle: e.target.value })} onKeyDown={naEnter(zapisz)} />
                  {bladZaleglych(ks)
                    ? <span className="rr-pole-blad">{bladZaleglych(ks)}</span>
                    : <span className="rr-pole-pod">dni po terminie policzą się od tej daty, nie od dnia startu</span>}
                </label>
              )}
              <label className="fld"><span className="label">Uwagi</span>
                <input className="field" value={s.uwagi} aria-label={`Uwagi ${n}`}
                  onChange={e => zmien(ks, { uwagi: e.target.value })} onKeyDown={naEnter(zapisz)} />
              </label>
            </section>
          )
        })}
      </div>
      <OdmowaSerwera blad={zapis.blad} />
    </>
  )
  return { ui, ok, tip, zapisz, busy: zapis.busy, etykieta: 'Zapisz saldo otwarcia' }
}

// ─── Zaległe dokumenty sprzed startu (D13) ─────────────────────────────

let licznik = 0

function useZalegle(karta: Karta, ksiega: Ksiega | undefined, onZapisano: () => void) {
  const app = useApp()
  const w = karta.klient.waluta
  const terminKsiegi = (ks: Ksiega) => (ks === 'wz' ? karta.klient.terminWz : karta.klient.terminFv)
  /** Skąd termin: `+ 7 dni` albo — przy terminie 0 — `termin = data (gotówka)`. */
  const podpisTerminu = (ks: Ksiega) => {
    const t = terminKsiegi(ks)
    if (t > 0) return `+ ${t} dni`
    const forma = ks === 'wz' ? karta.klient.formaWz : karta.klient.formaFv
    return `termin = data${forma === 'gotowka' ? ' (gotówka)' : ''}`
  }
  const nowy = (po?: WierszZaleglego): WierszZaleglego => {
    const ks = po?.ksiega ?? ksiega ?? 'fv'
    const data = po?.data ?? ''
    return { klucz: `z${++licznik}`, ksiega: ks, numer: '', data, termin: data ? dodajDni(data, terminKsiegi(ks)) : '', terminReczny: false, kwota: '', uwagi: '' }
  }
  const [wiersze, setWiersze] = useState<WierszZaleglego[]>(() => [nowy()])
  const [dotkniete, setDotkniete] = useState<Set<string>>(() => new Set())
  const [doFokusu, setDoFokusu] = useState<string | null>(null)
  const tabela = useRef<HTMLTableSectionElement>(null)
  const zapis = useZapis('Nie udało się zapisać zaległych dokumentów')
  const istniejace = useMemo(() => [...karta.dokumenty.wz, ...karta.dokumenty.fv].filter(d => d.zalegly)
    .map(d => ({ ...d, ksiega: (karta.dokumenty.wz.includes(d) ? 'wz' : 'fv') as Ksiega })), [karta])

  const zmien = (klucz: string, z: Partial<WierszZaleglego>) => setWiersze(ws => ws.map(r => {
    if (r.klucz !== klucz) return r
    const n = { ...r, ...z }
    if ('termin' in z) n.terminReczny = !!z.termin
    else if (('data' in z || 'ksiega' in z) && !n.terminReczny) n.termin = n.data ? dodajDni(n.data, terminKsiegi(n.ksiega)) : ''
    return n
  }))
  const dotknij = (klucz: string) => setDotkniete(s => (s.has(klucz) ? s : new Set(s).add(klucz)))

  // Błędy w kolejności wierszy: numer zajęty na karcie (ta księga) albo we wcześniejszym wierszu.
  const bledy = useMemo(() => {
    const zajete: Record<Ksiega, Set<string>> = {
      wz: new Set(karta.dokumenty.wz.filter(d => !d.otwarcie).map(d => normNumeru(d.numer))),
      fv: new Set(karta.dokumenty.fv.filter(d => !d.otwarcie).map(d => normNumeru(d.numer))),
    }
    const wynik: Record<string, BledyZaleglego> = {}
    for (const r of wiersze) {
      if (pustyZalegly(r)) continue
      wynik[r.klucz] = bledyZaleglego(r, karta.start, zajete[r.ksiega])
      if (r.numer.trim()) zajete[r.ksiega].add(normNumeru(r.numer))
    }
    return wynik
  }, [wiersze, karta])
  const niepuste = wiersze.filter(r => !pustyZalegly(r))
  const pierwszy = wiersze.findIndex(r => bledy[r.klucz] && Object.keys(bledy[r.klucz]).length)
  const ok = niepuste.length > 0 && pierwszy < 0
  const tip = !niepuste.length ? 'Wpisz co najmniej jeden dokument'
    : pierwszy >= 0 ? `Wiersz ${pierwszy + 1}: ${Object.values(bledy[wiersze[pierwszy].klucz])[0]}` : undefined
  /** Błąd pola widoczny: po opuszczeniu wiersza (albo Enter w kwocie) — wszystkie; wcześniej tylko dla wpisanych wartości. */
  const widoczny = (r: WierszZaleglego, pole: keyof BledyZaleglego) => {
    const b = bledy[r.klucz]?.[pole]
    if (!b) return undefined
    if (dotkniete.has(r.klucz)) return b
    const wartosc = pole === 'numer' ? r.numer : pole === 'data' ? r.data : pole === 'termin' ? r.termin : r.kwota
    return wartosc.trim() ? b : undefined
  }

  useEffect(() => {
    if (!doFokusu) return
    tabela.current?.querySelector<HTMLInputElement>(`tr[data-klucz="${doFokusu}"] input[data-pole="numer"]`)?.focus()
    setDoFokusu(null)
  }, [doFokusu, wiersze])

  const dalej = (r: WierszZaleglego) => {
    dotknij(r.klucz)
    const i = wiersze.findIndex(x => x.klucz === r.klucz)
    if (i < wiersze.length - 1) { setDoFokusu(wiersze[i + 1].klucz); return }
    if (pustyZalegly(r)) return
    const n = nowy(r)
    setWiersze(ws => [...ws, n])
    setDoFokusu(n.klucz)
  }
  /** Enter w polu (poza kwotą) — następne pole wiersza. */
  const nastepnePole = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey) return
    e.preventDefault()
    const pola = [...(e.currentTarget.closest('tr')?.querySelectorAll<HTMLElement>('input, select') ?? [])]
    pola[pola.indexOf(e.currentTarget) + 1]?.focus()
  }
  const usunWiersz = (klucz: string) => setWiersze(ws => (ws.length > 1 ? ws.filter(r => r.klucz !== klucz) : [nowy()]))

  const sumy = KSIEGI.map(ks => [ks, niepuste.filter(r => r.ksiega === ks).reduce((a, r) => a + (Number.isFinite(liczba(r.kwota)) ? doGroszy(liczba(r.kwota)) : 0), 0)] as const)
    .filter(([, x]) => x > 0)

  const zapisz = () => {
    if (!ok || zapis.busy) { niepuste.forEach(r => dotknij(r.klucz)); return }
    void zapis.zapisz(async () => {
      await rozliczeniaApi.dodajZalegle(karta.klient.id, niepuste.map(r => ({
        ksiega: r.ksiega, numer: r.numer.trim().replace(/\s+/g, ' '), data: r.data, termin: r.termin || null,
        kwota: doGroszy(liczba(r.kwota)), uwagi: r.uwagi.trim(),
      })))
      app.toast({
        kind: 'ok', title: `Zapisano ${ileDokumentow(niepuste.length)} sprzed startu`,
        detail: `${sumy.map(([ks, x]) => `${SKROT[ks]}: ${kwota(x, w)}`).join(' · ')} — są na karcie, wpłatę można przypiąć do każdego`,
      })
      onZapisano()
    })
  }

  const ui = (
    <div className="rr-zal">
      <p className="muted rr-dlg-p">Wpisz niezapłacone WZ i faktury sprzed {dataPl(karta.start)} — kwotę, która <b>została do zapłaty</b>.
        Każdy będzie osobnym wierszem na karcie: wpłatę przypniesz do konkretnego dokumentu, a dni po terminie policzą się od jego terminu.
        Nie wchodzą do obrotu ani kg.</p>
      {(karta.otwarcia.wz || karta.otwarcia.fv) && (
        <div className="note warn"><FlagIcon level="warn" size={15} />
          <div>Klient ma już saldo otwarcia jedną kwotą ({KSIEGI.filter(ks => karta.otwarcia[ks]).map(ks => `${SKROT[ks]}: ${kwotaSalda(karta.otwarcia[ks]!.kwota, w)}`).join(' · ')}).
            Nie wpisuj tych samych długów drugi raz — wyzeruj kwotę w zakładce „Jedna kwota”, jeśli rozpisujesz ją na dokumenty.</div>
        </div>
      )}
      <div className="rr-przewin">
        <table className="tbl rr-zal-tbl" aria-label="Zaległe dokumenty do zapisania">
          <thead><tr>
            <th className="rr-zal-ks">Księga</th><th>Numer</th><th>Data wystawienia</th><th>Termin</th><th className="num">Do zapłaty ({w})</th><th>Uwagi</th><th />
          </tr></thead>
          <tbody ref={tabela}>
            {wiersze.map((r, i) => (
              <tr key={r.klucz} data-klucz={r.klucz}
                onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !pustyZalegly(r)) dotknij(r.klucz) }}>
                <td className="rr-zal-ks">
                  <select className="field" value={r.ksiega} aria-label={`Księga, wiersz ${i + 1}`} onKeyDown={nastepnePole}
                    onChange={e => zmien(r.klucz, { ksiega: e.target.value as Ksiega })}>
                    <option value="fv">FV</option><option value="wz">WZ</option>
                  </select>
                </td>
                <td><Komorka blad={widoczny(r, 'numer')}>
                  <input className={`field${widoczny(r, 'numer') ? ' invalid' : ''}`} value={r.numer} data-pole="numer" autoComplete="off"
                    aria-label={`Numer, wiersz ${i + 1}`} onChange={e => zmien(r.klucz, { numer: e.target.value })} onKeyDown={nastepnePole}
                    {...(i === 0 ? { 'data-autofocus': true } : {})} />
                </Komorka></td>
                <td><Komorka blad={widoczny(r, 'data')}>
                  <input type="date" className={`field${widoczny(r, 'data') ? ' invalid' : ''}`} value={r.data} max={dodajDni(karta.start, -1)}
                    aria-label={`Data wystawienia, wiersz ${i + 1}`} onChange={e => zmien(r.klucz, { data: e.target.value })} onKeyDown={nastepnePole} />
                </Komorka></td>
                <td><Komorka blad={widoczny(r, 'termin')} pod={!r.terminReczny && r.termin ? podpisTerminu(r.ksiega) : undefined}>
                  <input type="date" className={`field${widoczny(r, 'termin') ? ' invalid' : ''}`} value={r.termin} min={r.data || undefined}
                    aria-label={`Termin, wiersz ${i + 1}`} onChange={e => zmien(r.klucz, { termin: e.target.value })} onKeyDown={nastepnePole} />
                </Komorka></td>
                <td><Komorka blad={widoczny(r, 'kwota')}>
                  <span className="rr-kwota-pole">
                    <input className={`field num${widoczny(r, 'kwota') ? ' invalid' : ''}`} inputMode="decimal" autoComplete="off" value={r.kwota}
                      aria-label={`Do zapłaty, wiersz ${i + 1}`} onChange={e => zmien(r.klucz, { kwota: e.target.value })}
                      onFocus={e => e.currentTarget.select()}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); dalej(r) } }} />
                    <span className="rr-sfx" aria-hidden="true">{symbolWaluty(w)}</span>
                  </span>
                </Komorka></td>
                <td><input className="field" value={r.uwagi} aria-label={`Uwagi, wiersz ${i + 1}`}
                  onChange={e => zmien(r.klucz, { uwagi: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); dalej(r) } }} /></td>
                <td className="r">
                  <button type="button" className="btn sm ghost icon" tabIndex={-1} onClick={() => usunWiersz(r.klucz)}
                    aria-label={`Usuń wiersz ${i + 1}`} data-tip="Usuń wiersz"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rr-zal-dol">
        <button type="button" className="btn sm" onClick={() => { const n = nowy(wiersze[wiersze.length - 1]); setWiersze(ws => [...ws, n]); setDoFokusu(n.klucz) }}>
          <Plus size={14} />Następny dokument</button>
        <span className="rr-zal-suma">{niepuste.length
          ? <>Do zapisania: <b>{ileDokumentow(niepuste.length)}</b>{sumy.map(([ks, x]) => <span key={ks} className="tnum"> · {SKROT[ks]} <b>{kwota(x, w)}</b></span>)}</>
          : <span className="muted">Termin podpowiada się z daty i ustawień klienta (WZ {karta.klient.terminWz} dni, FV {karta.klient.terminFv} dni).</span>}</span>
      </div>
      <OdmowaSerwera blad={zapis.blad} />
      {istniejace.length > 0 && (
        <div className="rr-sekcja">
          <span className="label">Już wpisane zaległe dokumenty ({istniejace.length}) — zmienisz albo usuniesz je w szczegółach dokumentu na karcie</span>
          <table className="tbl rr-mini" aria-label="Wpisane zaległe dokumenty">
            <thead><tr><th>Księga</th><th>Numer</th><th>Data</th><th>Termin</th><th className="num">Kwota</th><th className="num">Zostało</th></tr></thead>
            <tbody>{istniejace.map(d => (
              <tr key={d.id} className="row">
                <td>{SKROT[d.ksiega]}</td><td className="code id-no">{d.numer}</td><td className="tnum">{dataPl(d.data)}</td>
                <td className="tnum">{d.termin ? dataPl(d.termin) : '—'}</td>
                <td className="num">{kwota(d.kwota, w)}</td><td className="num">{kwota(d.zostalo, w)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
  return { ui, ok, tip, zapisz, busy: zapis.busy, etykieta: niepuste.length > 1 ? `Zapisz ${ileDokumentow(niepuste.length)}` : 'Zapisz zaległy dokument' }
}

function Komorka({ blad, pod, children }: { blad?: string; pod?: string; children: React.ReactNode }) {
  return (
    <div className="rr-zal-k">
      {children}
      {blad ? <span className="rr-pole-blad">{blad}</span> : pod ? <span className="rr-pole-pod">{pod}</span> : null}
    </div>
  )
}
