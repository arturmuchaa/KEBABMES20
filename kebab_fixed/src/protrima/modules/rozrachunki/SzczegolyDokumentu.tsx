import React, { useEffect, useRef, useState } from 'react'
import { Ban, FileText, History, RotateCcw, Trash2, Wallet } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { SzkieletBloku } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import {
  FORMA_SLOWEM, KLASA_TONU, dni, doGroszy, dodajDni, etykietaStanu, kilogramy, kwotaBezWaluty, liczba, mapujSzczegoly, numerZSeria, znakSalda,
  type Forma, type SzczegolyDokumentu as Szczegoly,
} from './model'
import { OdmowaSerwera, PoleKwoty, klasaZaleglosci, kwotaZPola, naEnter, useZapis } from './wspolne'

const ZRODLO: Record<string, string> = {
  mes_wz: 'WZ z MES', reczna: 'faktura wpisana ręcznie', subiekt: 'faktura z Subiekta', kurs: 'faktura z papierów kursu',
  otwarcie: 'zaległy dokument sprzed startu rozliczeń',
}
const czas = (iso: string) => { const [d, t] = iso.split('T'); return `${dataPl(d)}${t ? ` ${t.slice(0, 5)}` : ''}` }
/** Kilogramy z pola: puste — null (brak danych), inaczej liczba ≥ 0 albo NaN. */
const kgZPola = (t: string) => { if (!t.trim()) return null; const x = liczba(t); return Number.isFinite(x) && x >= 0 ? Math.round(x * 1000) / 1000 : NaN }

type Edycja = { termin: string; forma: string; uwagi: string; powod: string; numer: string; data: string; kwota: string; kg: string }

/**
 * Szczegóły dokumentu (D12): na górze kafelki — kwota, zapłacono, zostało, kg, termin;
 * pod nimi wpłaty do tego dokumentu z „+ Wpłata do tego dokumentu”. Faktura z papierów kursu
 * bez kwoty — pole „Wpisz kwotę” (D4). WZ — „nie licz do rozrachunków” z powodem (D2).
 * Niżej, mniej eksponowane: zmiana danych, historia zmian, usunięcie (z powodem).
 */
export function SzczegolyDokumentu({ dokId, waluta, start, terminFv, wpiszKwote, onClose, onZmiana, onWplata }: {
  dokId: string; waluta: string; onClose: () => void
  /** Data startu rozliczeń — zaległe dokumenty muszą mieć datę wcześniejszą, inne — nie. */
  start: string
  /** Termin FV klienta (dni) — termin faktury z kursu po wpisaniu kwoty. */
  terminFv: number
  /** Otwarte z „Wpisz kwotę” w wierszu karty — pole kwoty od razu z fokusem. */
  wpiszKwote?: boolean
  /** Po zapisie: karta się odświeża, okno zamyka. */
  onZmiana: () => void
  /** „+ Wpłata do tego dokumentu” — okno wpłaty z przypiętym dokumentem i księgą. */
  onWplata?: (d: Szczegoly) => void
}) {
  const app = useApp()
  const res = useApi(() => rozliczeniaApi.dokument(dokId).then(mapujSzczegoly), [dokId])
  const d = res.data
  const [e, setE] = useState<Edycja | null>(null)
  const [usuwanie, setUsuwanie] = useState(false)
  const [powodUsuniecia, setPowodUsuniecia] = useState('')
  const [wpisywanie, setWpisywanie] = useState(!!wpiszKwote)
  const zapis = useZapis('Nie udało się zapisać zmian')
  const usun = useZapis('Nie udało się usunąć dokumentu')
  const cialo = useRef<HTMLDivElement>(null)
  const gotowy = !!(d && e)
  // Okno otwiera się, zanim dokument się wczyta — fokus na najważniejszej akcji dopiero po wczytaniu.
  useEffect(() => {
    if (gotowy) cialo.current?.closest('.dialog')?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [gotowy])

  useEffect(() => {
    if (d && !e) {
      setE({
        termin: d.termin ?? '', forma: d.forma, uwagi: d.uwagi, powod: '', numer: d.numer, data: d.data,
        kwota: d.bezKwoty ? '' : kwotaBezWaluty(d.kwota), kg: d.kg == null ? '' : String(d.kg).replace('.', ','),
      })
    }
  }, [d, e])

  const korekta = !!d?.korekta
  const zr = d?.zrodlo ?? ''
  const mozeKwote = !korekta && (zr === 'reczna' || zr === 'otwarcie' || (zr === 'kurs' && !d?.bezKwoty))
  const mozeNumerDate = !korekta && (zr === 'reczna' || zr === 'otwarcie')
  const mozeKg = !korekta && (zr === 'reczna' || zr === 'kurs')
  const mozeUsunac = zr === 'reczna' || zr === 'otwarcie' || zr === 'kurs'

  const zmiany: Record<string, string | number | null> = {}
  const bledy: Partial<Record<keyof Edycja, string>> = {}
  if (d && e) {
    if (!korekta && e.termin && e.termin !== (d.termin ?? '')) zmiany.termin = e.termin
    if (!korekta && e.forma && e.forma !== d.forma) zmiany.forma = e.forma
    if (e.uwagi.trim() !== d.uwagi) zmiany.uwagi = e.uwagi.trim()
    if (mozeNumerDate) {
      const nr = e.numer.trim().replace(/\s+/g, ' ')
      if (!nr) bledy.numer = 'Wpisz numer'
      else if (nr !== d.numer) zmiany.numer = nr
      if (!e.data) bledy.data = 'Wpisz datę'
      else {
        if (zr === 'otwarcie' && e.data >= start) bledy.data = `Zaległy dokument musi mieć datę sprzed ${dataPl(start)}`
        if (zr === 'reczna' && e.data < start) bledy.data = `Data nie może być przed startem rozliczeń (${dataPl(start)})`
        if (e.data !== d.data) zmiany.data = e.data
      }
    }
    if (mozeKwote) {
      const k = kwotaZPola(e.kwota)
      if (!Number.isFinite(k) || doGroszy(k) <= 0) bledy.kwota = 'Wpisz kwotę większą od zera'
      else if (doGroszy(k) !== doGroszy(d.kwota)) zmiany.kwota = doGroszy(k)
    }
    if (mozeKg) {
      const kg = kgZPola(e.kg)
      if (kg !== null && Number.isNaN(kg)) bledy.kg = 'Wpisz liczbę kilogramów (0 lub więcej)'
      else if (kg !== d.kg) zmiany.kg = kg
    }
    const data = (zmiany.data as string | undefined) ?? d.data
    if (!korekta && e.termin && data && e.termin < data) bledy.termin = `Termin nie może być przed datą dokumentu (${dataPl(data)})`
    if ('kwota' in zmiany && !e.powod.trim()) bledy.powod = 'Zmiana kwoty wymaga powodu'
  }
  const zmienione = Object.keys(zmiany).length > 0
  const pierwszyBlad = Object.values(bledy)[0]
  const ok = zmienione && !pierwszyBlad
  const wTrakcie = zapis.busy || usun.busy

  const zapisz = () => {
    if (!d || !e || !ok || wTrakcie) return
    void zapis.zapisz(async () => {
      await rozliczeniaApi.edytujDokument(d.id, { ...zmiany, ...(e.powod.trim() ? { powod: e.powod.trim() } : {}) })
      const co = [
        'numer' in zmiany && `numer ${zmiany.numer}`, 'data' in zmiany && `data ${dataPl(String(zmiany.data))}`,
        'kwota' in zmiany && `kwota ${kwota(Number(zmiany.kwota), waluta)}`,
        'kg' in zmiany && (zmiany.kg == null ? 'kg usunięte' : kilogramy(Number(zmiany.kg))),
        zmiany.termin && `termin ${dataPl(String(zmiany.termin))}`, zmiany.forma && `forma: ${FORMA_SLOWEM[String(zmiany.forma)] ?? zmiany.forma}`,
        'uwagi' in zmiany && (zmiany.uwagi ? `uwagi „${zmiany.uwagi}”` : 'uwagi usunięte'),
      ].filter(Boolean).join(' · ')
      app.toast({ kind: 'ok', title: `${d.numer} — zmiany zapisane`, detail: co })
      onZmiana()
    })
  }
  const usunDokument = () => {
    if (!d || !powodUsuniecia.trim() || wTrakcie) return
    void usun.zapisz(async () => {
      await rozliczeniaApi.usunDokument(d.id, powodUsuniecia.trim())
      app.toast({ kind: 'ok', title: `${d.numer} usunięty`, detail: 'saldo przeliczone; wpłaty z tego dokumentu przeszły na najstarsze otwarte dokumenty' })
      onZmiana()
    })
  }

  const st = d && etykietaStanu(d.stan)
  const maWplate = !!(d && onWplata && znakSalda(d.zostalo) > 0)
  const coUsunac = korekta ? 'korektę' : d?.ksiega === 'wz' ? 'dokument' : 'fakturę'
  return (
    <Dialog wide icon={<FileText size={20} />} onClose={onClose}
      title={<>{d ? numerZSeria(d.numer, d.ksiega) : 'Dokument'}{st && <span className={`tag ${KLASA_TONU[st.ton]} rr-dlg-tag`}>{st.tekst}</span>}
        {d?.zalegly && <span className="tag outline rr-dlg-tag">sprzed startu</span>}</>}
      footer={<>
        <button type="button" className="btn" onClick={onClose} {...(d && !maWplate && !(d.bezKwoty && wpisywanie) ? { 'data-autofocus': true } : {})}>Zamknij</button>
        <button type="button" className="btn primary" disabled={!ok || wTrakcie} onClick={zapisz}
          data-tip={ok ? undefined : pierwszyBlad ?? 'Nic nie zmieniono'}>
          {zapis.busy ? 'Zapisuję…' : 'Zapisz zmiany'}
        </button>
      </>}>
      {res.error && (
        <div className="note crit" role="alert"><FlagIcon level="crit" size={15} />
          <div><b>Nie udało się wczytać dokumentu:</b> {res.error} <button type="button" className="btn sm" onClick={() => void res.refetch()}>Spróbuj ponownie</button></div>
        </div>
      )}
      {!d && !res.error && <SzkieletBloku linie={5} opis="Wczytywanie dokumentu…" />}
      {d && e && (
        <div className="rr-dok-cialo" ref={cialo}>
          <Kafle d={d} waluta={waluta} terminFv={terminFv} onWpiszKwote={wpisywanie ? undefined : () => setWpisywanie(true)} />
          <p className="muted rr-dlg-p rr-dok-meta">
            {`Wystawiony ${dataPl(d.data)} · ${korekta ? `korekta — ${ZRODLO[zr] ?? zr}` : ZRODLO[zr] ?? zr}`}
            {d.zamkniety && ` · zapłacony ${dataPl(d.zamkniety)}`}
          </p>
          {d.bezKwoty && wpisywanie && <WpiszKwote d={d} waluta={waluta} terminFv={terminFv} onZapisano={onZmiana} />}
          {d.brakVat && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Bez VAT — sprawdź wycenę.</b> Klient z polskim NIP, a na WZ nie ma żadnej stawki VAT.</div></div>}

          {korekta ? <Zmniejszyla d={d} waluta={waluta} /> : <WplatyDokumentu d={d} waluta={waluta} onWplata={maWplate ? () => onWplata?.(d) : undefined} />}

          {d.ksiega === 'wz' && !korekta && <NieLicz d={d} onZapisano={onZmiana} />}

          <div className="rr-sekcja rr-dok-edycja">
            <span className="label">Zmiana danych</span>
            <div className="rr-edycja">
              {mozeNumerDate && <>
                <Pole label="Numer" blad={bledy.numer}>
                  <input className={`field${bledy.numer ? ' invalid' : ''}`} value={e.numer} aria-label="Numer" autoComplete="off"
                    onChange={x => setE({ ...e, numer: x.target.value })} onKeyDown={naEnter(zapisz)} />
                </Pole>
                <Pole label="Data wystawienia" blad={bledy.data}>
                  <input type="date" className={`field${bledy.data ? ' invalid' : ''}`} value={e.data} aria-label="Data wystawienia"
                    onChange={x => setE({ ...e, data: x.target.value })} onKeyDown={naEnter(zapisz)} />
                </Pole>
              </>}
              {mozeKwote && (
                <div className="fld"><span className="label">{zr === 'otwarcie' ? 'Kwota do zapłaty' : 'Kwota brutto'}</span>
                  <PoleKwoty label="Kwota" value={e.kwota} onChange={t => setE({ ...e, kwota: t })} waluta={waluta} blad={bledy.kwota} onEnter={zapisz} />
                </div>
              )}
              {mozeKg && (
                <Pole label="Kilogramy" blad={bledy.kg}>
                  <span className="rr-kwota-pole rr-kg-pole">
                    <input className={`field num${bledy.kg ? ' invalid' : ''}`} inputMode="decimal" value={e.kg} aria-label="Kilogramy"
                      onChange={x => setE({ ...e, kg: x.target.value })} onFocus={x => x.currentTarget.select()} onKeyDown={naEnter(zapisz)} />
                    <span className="rr-sfx" aria-hidden="true">kg</span>
                  </span>
                </Pole>
              )}
              {!korekta && <>
                <Pole label="Termin płatności" blad={bledy.termin}>
                  <input type="date" className={`field${bledy.termin ? ' invalid' : ''}`} value={e.termin} aria-label="Termin płatności"
                    aria-invalid={bledy.termin ? true : undefined} onChange={x => setE({ ...e, termin: x.target.value })} onKeyDown={naEnter(zapisz)} />
                </Pole>
                <div className="fld"><span className="label">Forma płatności</span>
                  <div className="seg" role="group" aria-label="Forma płatności">
                    {(['gotowka', 'przelew'] as Forma[]).map(f => (
                      <button key={f} type="button" aria-pressed={e.forma === f} onClick={() => setE({ ...e, forma: f })}>{FORMA_SLOWEM[f]}</button>
                    ))}
                  </div>
                </div>
              </>}
              <label className="fld rr-pole-szerokie"><span className="label">Uwagi</span>
                <input className="field" value={e.uwagi} aria-label="Uwagi" onChange={x => setE({ ...e, uwagi: x.target.value })} onKeyDown={naEnter(zapisz)} /></label>
              <Pole label={'kwota' in zmiany ? 'Powód zmiany kwoty (obowiązkowy)' : 'Powód zmiany (opcjonalnie, trafi do historii)'} blad={bledy.powod} szerokie>
                <input className={`field${bledy.powod ? ' invalid' : ''}`} value={e.powod} aria-label="Powód zmiany"
                  onChange={x => setE({ ...e, powod: x.target.value })} onKeyDown={naEnter(zapisz)} />
              </Pole>
            </div>
            {zr === 'mes_wz' && <p className="muted rr-dlg-p">Kwotę, numer i datę WZ zmienia się w dokumentach WZ — saldo przeliczy się samo, a zmiana trafi do historii.</p>}
            {zr === 'kurs' && <p className="muted rr-dlg-p">Numer i datę faktury z kursu zmienia się w papierach kursu.</p>}
            <OdmowaSerwera blad={zapis.blad} />
          </div>

          <HistoriaZmian d={d} />

          {mozeUsunac && (
            <div className="rr-usun">
              {!usuwanie
                ? <button type="button" className="btn sm danger" onClick={() => setUsuwanie(true)}><Trash2 size={14} />{`Usuń ${coUsunac}…`}</button>
                : <>
                    <label className="fld"><span className="label">Powód usunięcia (obowiązkowy, trafi do historii)</span>
                      <input className="field" value={powodUsuniecia} aria-label="Powód usunięcia" autoFocus
                        onChange={x => setPowodUsuniecia(x.target.value)} onKeyDown={naEnter(usunDokument)} /></label>
                    <div className="rr-usun-akcje">
                      <button type="button" className="btn sm" onClick={() => { setUsuwanie(false); setPowodUsuniecia('') }}>Nie usuwaj</button>
                      <button type="button" className="btn sm primary danger" disabled={!powodUsuniecia.trim() || wTrakcie} onClick={usunDokument}
                        data-tip={powodUsuniecia.trim() ? undefined : 'Wpisz powód usunięcia'}>
                        <Trash2 size={14} />{usun.busy ? 'Usuwam…' : `Usuń ${coUsunac}`}
                      </button>
                    </div>
                    <p className="muted rr-dlg-p">{korekta
                      ? 'Korekta zniknie z salda, ale zostanie w historii. Faktury, które zmniejszyła, wrócą do pełnej kwoty.'
                      : 'Dokument zniknie z salda, ale zostanie w historii. Wpłaty, które go pokryły, przejdą na najstarsze otwarte dokumenty.'}</p>
                    <OdmowaSerwera blad={usun.blad} />
                  </>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function Pole({ label, blad, szerokie, children }: { label: string; blad?: string; szerokie?: boolean; children: React.ReactNode }) {
  return (
    <label className={`fld${szerokie ? ' rr-pole-szerokie' : ''}`}><span className="label">{label}</span>
      {children}
      {blad && <span className="rr-pole-blad">{blad}</span>}
    </label>
  )
}

/** Pasek kafelków na górze okna: kwota, zapłacono, zostało, kg, termin ze stanem. */
function Kafle({ d, waluta, terminFv, onWpiszKwote }: { d: Szczegoly; waluta: string; terminFv: number; onWpiszKwote?: () => void }) {
  const poza = d.bezKwoty || d.nieLicz
  const po = d.stan.kod === 'po_terminie'
  const st = etykietaStanu({ ...d.stan, czesciowo: false })
  const kafel = (k: string, v: React.ReactNode, s?: React.ReactNode, cls = '') => (
    <div className="rr-sum"><span className="k">{k}</span><span className={`v${cls}`}>{v}</span>{s != null && <span className="s">{s}</span>}</div>
  )
  return (
    <div className="rr-sumy-w rr-dok-kafle">
      <div className="rr-sumy" role="group" aria-label="Podsumowanie dokumentu">
        {d.bezKwoty
          ? kafel('Kwota', 'czeka na kwotę',
            onWpiszKwote ? <button type="button" className="btn sm primary" onClick={onWpiszKwote}>Wpisz kwotę</button> : 'wpisz ją poniżej', ' rr-czeka')
          : kafel(d.korekta ? 'Kwota korekty' : 'Kwota', kwota(d.kwota, waluta), d.nieLicz ? 'nie liczy się do salda' : undefined)}
        {!d.korekta && kafel('Zapłacono', poza ? '—' : kwota(d.zaplacono, waluta), undefined, poza ? ' faint' : '')}
        {!d.korekta && kafel('Zostało', poza ? '—' : kwota(d.zostalo, waluta), d.stan.czesciowo ? 'zapłacona częściowo' : undefined,
          poza ? ' faint' : po ? klasaZaleglosci(d.zostalo) : '')}
        {kafel('kg', d.kg == null ? '—' : kilogramy(d.kg), undefined, d.kg == null ? ' faint' : '')}
        {!d.korekta && (d.bezKwoty
          ? kafel('Termin', '—', `po wpisaniu kwoty: data + ${dni(terminFv)}`, ' faint')
          : kafel('Termin', d.termin ? dataPl(d.termin) : '—', <span className={`tag ${KLASA_TONU[st.ton]}`}>{st.tekst}</span>))}
      </div>
    </div>
  )
}

/** FV z papierów kursu bez kwoty: kwota brutto z Subiekta → faktura wchodzi do salda (pierwsza kwota bez powodu). */
function WpiszKwote({ d, waluta, terminFv, onZapisano }: { d: Szczegoly; waluta: string; terminFv: number; onZapisano: () => void }) {
  const app = useApp()
  const [tekst, setTekst] = useState('')
  const pole = useRef<HTMLInputElement>(null)
  const { busy, blad, zapisz } = useZapis('Nie udało się zapisać kwoty')
  const k = kwotaZPola(tekst)
  const kR = Number.isFinite(k) ? doGroszy(k) : NaN
  const ok = kR > 0
  const bladPola = tekst.trim() && !ok ? 'Wpisz kwotę większą od zera' : null
  const termin = dodajDni(d.data, terminFv)
  useEffect(() => { pole.current?.focus() }, [])
  const zapiszKwote = () => {
    if (!ok || busy) return
    void zapisz(async () => {
      await rozliczeniaApi.wpiszKwoteFv(d.id, kR)
      app.toast({ kind: 'ok', title: `${d.numer} — kwota ${kwota(kR, waluta)} wpisana`, detail: `faktura weszła do salda · termin ${dataPl(termin)}` })
      onZapisano()
    })
  }
  return (
    <div className="rr-wpisz-kwote" role="group" aria-label="Wpisz kwotę faktury">
      <div className="rr-wpisz-kwote-t"><b>Faktura z papierów kursu czeka na kwotę.</b> Wpisz kwotę brutto z Subiekta — faktura wejdzie do salda z terminem {dataPl(termin)}.</div>
      <div className="rr-wpisz-kwote-f">
        <div className="fld"><span className="label">Kwota brutto ({waluta})</span>
          <PoleKwoty label="Kwota brutto" value={tekst} onChange={setTekst} waluta={waluta} blad={bladPola} onEnter={zapiszKwote} autofocus duze inputRef={pole} />
        </div>
        <button type="button" className="btn primary" disabled={!ok || busy} onClick={zapiszKwote} data-tip={ok ? undefined : 'Wpisz kwotę brutto'}>
          {busy ? 'Zapisuję…' : 'Zapisz kwotę'}
        </button>
      </div>
      <OdmowaSerwera blad={blad} />
    </div>
  )
}

const FORMA_POKRYCIA = (p: Szczegoly['pokrycie'][number]) =>
  p.rodzaj === 'korekta' ? 'korekta' : p.rodzaj === 'otwarcie' ? 'nadpłata z salda otwarcia' : FORMA_SLOWEM[p.forma] ?? (p.forma || '—')

/** Wpłaty do tego dokumentu — wyraźna tabela; częściowe pokrycie pokazuje też całą wpłatę. */
function WplatyDokumentu({ d, waluta, onWplata }: { d: Szczegoly; waluta: string; onWplata?: () => void }) {
  const przycisk = onWplata && (
    <button type="button" className="btn sm primary" onClick={onWplata} data-autofocus><Wallet size={14} />+ Wpłata do tego dokumentu</button>
  )
  return (
    <section className="rr-sekcja rr-dok-wplaty" aria-label="Wpłaty do tego dokumentu">
      <div className="rr-sekcja-h"><h3><Wallet size={15} />Wpłaty do tego dokumentu</h3>{d.pokrycie.length > 0 && przycisk}</div>
      {d.nieLicz
        ? <p className="muted rr-dlg-p">WZ nie liczy się do rozrachunków — wpłat się do niej nie przypina.</p>
        : d.bezKwoty
          ? <p className="muted rr-dlg-p">Wpłatę przypniesz po wpisaniu kwoty faktury.</p>
          : d.pokrycie.length === 0
            ? <div className="rr-dok-brak"><span>Brak wpłat</span>{przycisk}</div>
            : (
              <div className="rr-przewin"><table className="tbl rr-mini" aria-label="Pokrycie wpłatami">
                <thead><tr><th>Data</th><th>Forma</th><th className="num">Na ten dokument</th><th className="num">Cała wpłata</th><th>Uwagi</th><th>Kto</th></tr></thead>
                <tbody>{d.pokrycie.map((p, i) => (
                  <tr key={i} className="row">
                    <td className="tnum">{dataPl(p.data)}</td>
                    <td>{FORMA_POKRYCIA(p)}</td>
                    <td className="num rr-pokrylo">{kwota(p.kwota, waluta)}</td>
                    <td className={`num${doGroszy(p.kwotaWplaty) === doGroszy(p.kwota) ? ' faint' : ''}`}>{kwota(p.kwotaWplaty, waluta)}</td>
                    <td className="rr-uwagi" title={p.uwagi}>{p.uwagi || <span className="faint">—</span>}</td>
                    <td className="muted">{p.kto || '—'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
    </section>
  )
}

/** WZ „nie licz do rozrachunków” (D2) albo cofnięcie — zawsze z powodem. */
function NieLicz({ d, onZapisano }: { d: Szczegoly; onZapisano: () => void }) {
  const app = useApp()
  const [otwarte, setOtwarte] = useState(false)
  const [powod, setPowod] = useState('')
  const { busy, blad, zapisz } = useZapis('Nie udało się zmienić liczenia WZ')
  const nowa = !d.nieLicz
  const ok = !!powod.trim()
  const wykonaj = () => {
    if (!ok || busy) return
    void zapisz(async () => {
      await rozliczeniaApi.nieLicz(d.id, nowa, powod.trim())
      app.toast(nowa
        ? { kind: 'ok', title: `${d.numer} nie liczy się do rozrachunków`, detail: 'zniknęła z salda, obrotu, kg i zestawień; zostaje na karcie wyszarzona' }
        : { kind: 'ok', title: `${d.numer} znów liczy się do rozrachunków`, detail: 'saldo przeliczone' })
      onZapisano()
    })
  }
  return (
    <div className="rr-sekcja rr-nielicz">
      {d.nieLicz && (
        <div className="note"><FlagIcon level="info" size={15} />
          <div><b>Nie liczona do rozrachunków.</b>{d.nieLiczPowod && <> Powód: „{d.nieLiczPowod}”.</>}</div>
        </div>
      )}
      {!otwarte
        ? <button type="button" className="btn sm" onClick={() => setOtwarte(true)}>
            {nowa ? <><Ban size={14} />Nie licz do rozrachunków…</> : <><RotateCcw size={14} />Licz z powrotem…</>}
          </button>
        : <>
            <label className="fld"><span className="label">{nowa ? 'Dlaczego nie liczyć tej WZ? (obowiązkowe, trafi do historii)' : 'Powód cofnięcia (obowiązkowy, trafi do historii)'}</span>
              <input className="field" value={powod} aria-label={nowa ? 'Powód nieliczenia' : 'Powód cofnięcia'} autoFocus
                onChange={x => setPowod(x.target.value)} onKeyDown={naEnter(wykonaj)} /></label>
            <div className="rr-usun-akcje">
              <button type="button" className="btn sm" onClick={() => { setOtwarte(false); setPowod('') }}>Anuluj</button>
              <button type="button" className="btn sm primary" disabled={!ok || busy} onClick={wykonaj} data-tip={ok ? undefined : 'Wpisz powód'}>
                {busy ? 'Zapisuję…' : nowa ? 'Nie licz tej WZ' : 'Licz z powrotem'}
              </button>
            </div>
            {nowa && <p className="muted rr-dlg-p">WZ zniknie z salda, „po terminie”, obrotu, kg i wydruków. Zostanie na karcie wyszarzona — w każdej chwili można to cofnąć.</p>}
            <OdmowaSerwera blad={blad} />
          </>}
    </div>
  )
}

/** Faktura korygująca: które dokumenty zmniejszyła i o ile (reszta zostaje nadpłatą księgi). */
function Zmniejszyla({ d, waluta }: { d: Szczegoly; waluta: string }) {
  return (
    <div className="rr-sekcja">
      <span className="label">Zmniejszyła</span>
      {d.rozliczyla.length === 0
        ? <p className="muted rr-dlg-p">Nie było czego zmniejszyć — kwota korekty zostaje jako nadpłata w księdze faktur.</p>
        : <ul className="rr-hist">{d.rozliczyla.map((r, i) => <li key={i} className="tnum">{`${numerZSeria(r.numer, 'fv')}: ${kwota(r.kwota, waluta)}`}</li>)}</ul>}
    </div>
  )
}

function HistoriaZmian({ d }: { d: Szczegoly }) {
  return (
    <div className="rr-sekcja">
      <span className="label"><History size={13} /> Historia zmian</span>
      {d.historia.length === 0
        ? <p className="muted rr-dlg-p">Bez zmian od wystawienia.</p>
        : (
          <ul className="rr-hist">
            {d.historia.map((h, i) => (
              <li key={i}><span className="faint tnum">{czas(h.kiedy)}{h.kto ? ` · ${h.kto}` : ''}</span> {h.opis}
                {h.powod && <i className="muted"> — powód: „{h.powod}”</i>}</li>
            ))}
          </ul>
        )}
    </div>
  )
}
