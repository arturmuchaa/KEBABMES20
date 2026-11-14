import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText, Search, X, RefreshCw, ArrowUp, ArrowDown, FileDown, Printer, ListPlus, Ban, Coins, Pencil, ShoppingCart, AlertTriangle,
  PanelBottom, PanelRight, Maximize2, Minimize2,
} from 'lucide-react'
import { useApp, CommandBar, Menu, useMenu, type Cmd } from '../../shell/context'
import { useDock } from '../../shell/useDock'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { cmrApi, dokumentyApi, downloadDocPdf, hdiApi, wzApi } from '@/lib/api'
import { useZaznaczonePapiery } from '../wysylki/Papiery'
import type { PapierKursu } from '../wysylki/kurs'
import { DopiszPozycjeDialog } from '../orders/wz/DopiszPozycjeDialog'
import { Podglad } from './Podglad'
import { OknoDzialania, type Okno } from './Okna'
import {
  FILTR_DOMYSLNY, dzialania, filtruj, normKlient, sortuj, zCmr, zHdi, zWz,
  type Dok, type Dzialanie, type Filtr, type Kolumna, type Okres, type Rodzaj,
} from './model'

const dzisIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dataPl = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '—')
const zl = (n: number, cur?: string) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${cur === 'EUR' ? '€' : 'zł'}`
const ZAKLADKI: Array<{ key: Rodzaj; label: string }> = [{ key: 'wz', label: 'WZ' }, { key: 'cmr', label: 'CMR' }, { key: 'hdi', label: 'HDI' }]
const OKRESY: Array<{ key: Okres; label: string }> = [
  { key: 'dzis', label: 'Dziś' }, { key: '7dni', label: 'Ostatnie 7 dni' }, { key: 'miesiac', label: 'Ten miesiąc' },
  { key: 'poprzedni', label: 'Poprzedni miesiąc' }, { key: 'wszystko', label: 'Wszystko' }, { key: 'zakres', label: 'Zakres dat…' },
]
const STANY: Array<{ key: Filtr['stan']; label: string }> = [{ key: 'aktywne', label: 'Aktywne' }, { key: 'anulowane', label: 'Anulowane' }, { key: 'wszystkie', label: 'Wszystkie' }]
const pdfUrl = (d: Dok) => (d.rodzaj === 'wz' ? wzApi.pdfUrl(d.id) : d.rodzaj === 'cmr' ? cmrApi.pdfUrl(d.id) : hdiApi.pdfUrl(d.id))
const prefiks = (d: Dok) => (d.rodzaj === 'wz' ? d.seria ?? 'WZ' : d.rodzaj.toUpperCase())
const papier = (d: Dok): PapierKursu => ({ key: `${d.rodzaj}-${d.id}`, etykieta: prefiks(d), numer: d.numer, url: pdfUrl(d), plik: `${prefiks(d)}-${d.numer.replace(/[\\/]/g, '-')}.pdf`, data: d.data })
const KLASA_STANU: Record<string, string> = { wystawiony: 'neutral', załadowany: 'ok', rozjazd: 'warn', anulowany: 'crit', niekompletny: 'warn' }

/** Zdarzenie z palety Ctrl+K: „Dokumenty: CMR” otwiera moduł na zakładce CMR. */
export const ZDARZENIE_ZAKLADKI = 'protrima:dokumenty-zakladka'

/**
 * Dokumenty wydania — jedna karta z zakładkami WZ / CMR / HDI (decyzja właściciela 14.11.2026:
 * nie rozwijana grupa w sidebarze). Filtry klient/okres/szukaj/stan są wspólne dla zakładek,
 * zaznaczenie do druku — osobne dla każdej. Podgląd po prawej to PDF z serwera.
 */
export function DokumentyModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const [zakladka, setZakladka] = useState<Rodzaj>('wz')
  const [dane, setDane] = useState<Record<Rodzaj, Dok[] | null>>({ wz: null, cmr: null, hdi: null })
  const [blad, setBlad] = useState<string | null>(null)
  const [filtr, setFiltr] = useState<Filtr>(FILTR_DOMYSLNY)
  const [sort, setSort] = useState<{ kol: Kolumna; kier: 'asc' | 'desc' }>({ kol: 'numer', kier: 'desc' })
  const [sel, setSel] = useState<Record<Rodzaj, string | null>>({ wz: null, cmr: null, hdi: null })
  const [maxed, setMaxed] = useState(false)
  const [okno, setOkno] = useState<Okno | null>(null)
  const [dopisz, setDopisz] = useState<string | null>(null)
  const okresMenu = useMenu(), klientMenu = useMenu(), stanMenu = useMenu()
  const workRef = useRef<HTMLDivElement>(null)
  const dock = useDock(workRef, 'dokumenty')
  const dzis = dzisIso()

  const wczytaj = useCallback(() => {
    setBlad(null)
    Promise.all([dokumentyApi.wz(), dokumentyApi.cmr(), dokumentyApi.hdi()])
      .then(([w, c, h]) => setDane({ wz: (w ?? []).map(zWz), cmr: (c ?? []).map(zCmr), hdi: (h ?? []).map(zHdi) }))
      .catch(e => setBlad(e instanceof Error ? e.message : 'Nie udało się pobrać dokumentów'))
  }, [])
  useEffect(() => { wczytaj() }, [wczytaj])
  useEffect(() => {
    const on = (e: Event) => { const z = (e as CustomEvent<Rodzaj>).detail; if (z === 'wz' || z === 'cmr' || z === 'hdi') setZakladka(z) }
    window.addEventListener(ZDARZENIE_ZAKLADKI, on)
    return () => window.removeEventListener(ZDARZENIE_ZAKLADKI, on)
  }, [])

  const wszystkie = dane[zakladka]
  const widoczne = useMemo(() => sortuj(filtruj(wszystkie ?? [], filtr, dzis), sort.kol, sort.kier), [wszystkie, filtr, dzis, sort])
  const wybrany = (wszystkie ?? []).find(d => d.id === sel[zakladka]) ?? null
  const klienci = useMemo(() => {
    const m = new Map<string, { nazwa: string; n: number }>()
    for (const r of ZAKLADKI) for (const d of dane[r.key] ?? []) { if (!d.klient) continue; const k = normKlient(d.klient); const x = m.get(k); m.set(k, { nazwa: x?.nazwa ?? d.klient, n: (x?.n ?? 0) + 1 }) }
    return [...m.values()].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))
  }, [dane])
  const papiery = useMemo(() => widoczne.map(papier), [widoczne])
  const z = useZaznaczonePapiery(papiery, `Dokumenty ${zakladka.toUpperCase()} ${dataPl(dzis)}`)
  const wybierz = (id: string) => { setSel(s => ({ ...s, [zakladka]: id })) }
  const ustawFiltr = (p: Partial<Filtr>) => setFiltr(f => ({ ...f, ...p }))
  const filtry = filtr.szukaj || filtr.klient || filtr.okres !== FILTR_DOMYSLNY.okres || filtr.stan !== 'aktywne' || filtr.seria !== 'wszystkie'

  const otworz = useCallback(async (d: Dok) => {
    try { await downloadDocPdf(pdfUrl(d), papier(d).plik) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
  }, [app])
  const uruchom = (d: Dok, co: Dzialanie) => {
    if (co === 'dopisz') setDopisz(d.id)
    else setOkno({ co, dok: d })
  }

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'print', group: 1, label: z.zaznaczone.length ? `Drukuj zaznaczone (${z.zaznaczone.length})` : 'Drukuj zaznaczone', icon: <Printer size={17} />, primary: true, disabled: !z.zaznaczone.length || !!z.busy,
      tip: 'Jeden PDF ze wszystkimi zaznaczonymi — drukujesz raz', run: () => void z.drukuj() },
    { id: 'pdf', group: 2, label: 'Otwórz PDF', icon: <FileDown size={17} />, disabled: !wybrany, run: () => wybrany && void otworz(wybrany) },
    { id: 'reload', group: 4, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: wczytaj },
  ], [z, wybrany, otworz, wczytaj])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Dokumenty {zakladka.toUpperCase()}: widoczne <b>{widoczne.length}</b> z {wszystkie?.length ?? 0}{z.zaznaczone.length ? <> · zaznaczone <b>{z.zaznaczone.length}</b></> : null}</span>)
  }, [active, zakladka, widoczne.length, wszystkie?.length, z.zaznaczone.length, setCtx])

  const KOL: Array<{ kol: Kolumna | null; label: string; cls?: string }> = [
    { kol: 'numer', label: 'Numer' }, { kol: 'data', label: 'Data' }, { kol: 'klient', label: 'Klient' }, { kol: 'zamowienie', label: 'Zamówienie' },
    ...(zakladka === 'wz' ? [{ kol: 'wartosc' as Kolumna, label: 'Wartość', cls: 'num' }] : zakladka === 'cmr' ? [{ kol: null, label: 'Przewoźnik' }] : [{ kol: null, label: 'Rodzaj' }]),
    { kol: 'stan', label: 'Stan' },
  ]
  const th = (k: (typeof KOL)[number]) => {
    if (!k.kol) return <th key={k.label} className={k.cls}>{k.label}</th>
    const on = sort.kol === k.kol
    return <th key={k.label} role="columnheader" className={`sortable ${k.cls ?? ''}`} aria-sort={on ? (sort.kier === 'asc' ? 'ascending' : 'descending') : undefined}
      onClick={() => setSort(s => s.kol === k.kol ? { kol: k.kol!, kier: s.kier === 'asc' ? 'desc' : 'asc' } : { kol: k.kol!, kier: k.kol === 'numer' || k.kol === 'data' || k.kol === 'wartosc' ? 'desc' : 'asc' })}>
      {k.label}<span className="sort">{on ? (sort.kier === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</span></th>
  }
  const wszystkieZazn = papiery.length > 0 && papiery.every(p => z.wybrane.has(p.key))
  const COLS = KOL.length + 1
  const ladowanie = !wszystkie && !blad
  const okresLabel = filtr.okres === 'zakres' ? `${filtr.od ? dataPl(filtr.od) : '…'} – ${filtr.do ? dataPl(filtr.do) : '…'}` : OKRESY.find(o => o.key === filtr.okres)!.label

  return (
    <>
      <CommandBar title="Dokumenty" count="WZ, CMR i HDI — lista, podgląd, druk zbiorczy" cmds={cmds} />
      <div className="toolbar dk-toolbar" role="toolbar" aria-label="Rodzaj dokumentów i filtry">
        <div className="seg" role="tablist" aria-label="Rodzaj dokumentów">
          {ZAKLADKI.map(t => <button key={t.key} type="button" role="tab" aria-selected={zakladka === t.key} aria-pressed={zakladka === t.key} onClick={() => setZakladka(t.key)}>
            {t.label}<span className="count">{dane[t.key]?.length ?? '…'}</span></button>)}
        </div>
        <span className="vsep" />
        <div className="field-wrap search">
          <Search size={15} />
          <input className="field" placeholder="Numer, klient, zamówienie…" value={filtr.szukaj} onChange={e => ustawFiltr({ szukaj: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape' && filtr.szukaj) { e.stopPropagation(); ustawFiltr({ szukaj: '' }) } }} aria-label="Szukaj dokumentu" />
        </div>
        <button className={`chip${filtr.okres !== 'wszystko' ? ' on' : ''}`} onClick={okresMenu.open} aria-label="Okres">Okres: {okresLabel}</button>
        {filtr.okres === 'zakres' && <span className="dk-zakres">
          <input type="date" className="field" value={filtr.od ?? ''} onChange={e => ustawFiltr({ od: e.target.value })} aria-label="Od dnia" />
          <input type="date" className="field" value={filtr.do ?? ''} onChange={e => ustawFiltr({ do: e.target.value })} aria-label="Do dnia" /></span>}
        <button className={`chip${filtr.klient ? ' on' : ''}`} onClick={klientMenu.open}>
          Klient{filtr.klient ? `: ${filtr.klient}` : ''}
          {filtr.klient ? <span className="x" role="button" aria-label="Wyczyść filtr klienta" onClick={e => { e.stopPropagation(); ustawFiltr({ klient: '' }) }}><X size={13} /></span> : null}
        </button>
        <button className={`chip${filtr.stan !== 'aktywne' ? ' on' : ''}`} onClick={stanMenu.open}>Stan: {STANY.find(s => s.key === filtr.stan)!.label}</button>
        {zakladka === 'wz' && <div className="seg sm" role="group" aria-label="Seria">
          {(['wszystkie', 'WZ', 'WM'] as const).map(s => <button key={s} type="button" aria-pressed={filtr.seria === s} onClick={() => ustawFiltr({ seria: s })}>{s === 'wszystkie' ? 'WZ + WM' : s}</button>)}
        </div>}
        {filtry && <button className="btn sm ghost" onClick={() => setFiltr(FILTR_DOMYSLNY)}>Wyczyść filtry</button>}
      </div>

      <div className={`workarea${dock.side ? ' side' : ''}`} ref={workRef}>
        <div className="list-pane" style={dock.listStyle(!!wybrany, maxed)}>
          <div className="tbl-wrap" tabIndex={0} aria-label="Lista dokumentów"
            onKeyDown={e => {
              const i = widoczne.findIndex(d => d.id === wybrany?.id)
              if (e.key === 'ArrowDown') { e.preventDefault(); const d = widoczne[Math.min(widoczne.length - 1, i + 1)]; if (d) wybierz(d.id) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); const d = widoczne[Math.max(0, i - 1)]; if (d) wybierz(d.id) }
              else if (e.key === ' ' && wybrany) { e.preventDefault(); z.przelacz(papier(wybrany).key) }
            }}>
            <table className="tbl dk-lista" role="grid" aria-label={`Lista dokumentów ${zakladka.toUpperCase()}`}>
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" className="cbx" checked={wszystkieZazn} disabled={!papiery.length}
                  onChange={() => z.ustaw(papiery.map(p => p.key), !wszystkieZazn)} aria-label="Zaznacz wszystkie widoczne" /></th>
                {KOL.map(th)}
              </tr></thead>
              <tbody>
                {ladowanie && <SzkieletWierszy kolumny={COLS} wiersze={8} />}
                {blad && <tr><td colSpan={COLS}><Pusto ikona={<FileText size={20} />} tytul="Nie udało się pobrać dokumentów" akcja={<button className="btn sm" onClick={wczytaj}>Spróbuj ponownie</button>}>{blad}</Pusto></td></tr>}
                {!ladowanie && !blad && widoczne.length === 0 && <tr><td colSpan={COLS}>
                  <Pusto ikona={<Search size={20} />} tytul="Żaden dokument nie pasuje" akcja={filtry ? <button className="btn sm" onClick={() => setFiltr(FILTR_DOMYSLNY)}>Wyczyść filtry</button> : undefined}>
                    {filtr.okres === 'miesiac' ? 'Pokazujemy dokumenty z tego miesiąca — zmień okres na „Wszystko”, żeby zobaczyć starsze.' : 'Zmień filtry albo okres.'}</Pusto></td></tr>}
                {widoczne.map((d, i) => {
                  const p = papier(d)
                  return (
                    <tr key={d.id} className={`row${i % 2 ? ' zebra' : ''}${wybrany?.id === d.id ? ' sel' : ''}${d.stan === 'anulowany' ? ' dk-anul' : ''}`} aria-selected={wybrany?.id === d.id} onClick={() => wybierz(d.id)}>
                      <td onClick={e => e.stopPropagation()}><input type="checkbox" className="cbx" checked={z.wybrane.has(p.key)} onChange={() => z.przelacz(p.key)} aria-label={`Zaznacz ${d.numer}`} /></td>
                      <td className="code strong" data-testid="numer">{d.numer}</td>
                      <td className="tnum">{dataPl(d.data)}</td>
                      <td className="ell" style={{ maxWidth: 260 }}>{d.klient || <span className="faint">—</span>}</td>
                      <td className="code">{d.orderNo ?? <span className="faint">{d.rodzaj === 'wz' ? 'ręczna' : '—'}</span>}</td>
                      {zakladka === 'wz' && <td className="num tnum">{d.wartosc != null ? zl(d.wartosc, d.waluta) : <span className="faint" data-tip="dokument bez cen">—</span>}</td>}
                      {zakladka === 'cmr' && <td className="ell" style={{ maxWidth: 180 }}>{d.przewoznik ?? <span className="faint">—</span>}</td>}
                      {zakladka === 'hdi' && <td>{d.rodzajHdi}</td>}
                      <td>{d.seria === 'WM' && <span className="tag outline" data-tip="Wydanie z magazynu — zdejmuje stan" style={{ marginRight: 6 }}>WM</span>}
                        <span className={`tag ${KLASA_STANU[d.etykietaStanu] ?? 'neutral'}`}>{d.etykietaStanu}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {wybrany && <>
          <div className={`splitter${dock.drag ? ' drag' : ''}`} role="separator" aria-orientation={dock.side ? 'vertical' : 'horizontal'}
            onMouseDown={e => { setMaxed(false); dock.startDrag(e) }} onDoubleClick={() => { dock.reset(); setMaxed(false) }} data-tip="Przeciągnij, aby zmienić rozmiar. Dwuklik — domyślnie." />
          <div className="dock" aria-label={`Dokument ${wybrany.numer}`}>
            <PanelDokumentu d={wybrany} maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setSel(s => ({ ...s, [zakladka]: null }))}
              onOtworz={() => void otworz(wybrany)} onDzialanie={co => uruchom(wybrany, co)} />
          </div>
        </>}
      </div>

      {okresMenu.anchor && <Menu anchor={okresMenu.anchor} onClose={okresMenu.close} items={[{ header: 'Okres (data wydania)' },
        ...OKRESY.map(o => ({ label: o.label, checked: filtr.okres === o.key, onSelect: () => ustawFiltr({ okres: o.key }) }))]} />}
      {klientMenu.anchor && <Menu anchor={klientMenu.anchor} onClose={klientMenu.close} items={[{ header: 'Klient' },
        { label: 'Wszyscy', checked: !filtr.klient, onSelect: () => ustawFiltr({ klient: '' }) },
        ...klienci.map(k => ({ label: `${k.nazwa} (${k.n})`, checked: normKlient(filtr.klient) === normKlient(k.nazwa), onSelect: () => ustawFiltr({ klient: k.nazwa }) }))]} />}
      {stanMenu.anchor && <Menu anchor={stanMenu.anchor} onClose={stanMenu.close} items={[{ header: 'Stan dokumentu' },
        ...STANY.map(s => ({ label: s.label, checked: filtr.stan === s.key, onSelect: () => ustawFiltr({ stan: s.key }) }))]} />}

      {dopisz && <DopiszPozycjeDialog wzId={dopisz} onClose={() => setDopisz(null)} onZmiana={wczytaj} />}
      {okno && <OknoDzialania okno={okno} onClose={() => setOkno(null)} onZmiana={() => { wczytaj() }} />}
    </>
  )
}

function PanelDokumentu({ d, maxed, onMax, onClose, onOtworz, onDzialanie }: {
  d: Dok; maxed: boolean; onMax: () => void; onClose: () => void; onOtworz: () => void; onDzialanie: (co: Dzialanie) => void
}) {
  const app = useApp()
  const dz = dzialania(d)
  const przycisk = (co: Dzialanie, label: string, ikona: React.ReactNode, aria?: string, danger?: boolean) => (
    <button className={`btn sm${danger ? ' danger-ghost' : ''}`} disabled={!dz[co].ok} data-tip={dz[co].ok ? undefined : dz[co].powod} aria-label={aria ?? label} onClick={() => onDzialanie(co)}>{ikona}{label}</button>
  )
  return (
    <>
      <div className="dock-head">
        <div className="dock-id">
          <div className="l1"><h2>{d.numer}</h2><span className={`tag ${KLASA_STANU[d.etykietaStanu] ?? 'neutral'}`}>{d.etykietaStanu}</span></div>
          <div className="l2">{d.klient || '—'} · {dataPl(d.data)}{d.orderNo ? <> · zam. <b className="code">{d.orderNo}</b></> : null}{d.wartosc != null ? <> · {zl(d.wartosc, d.waluta)}</> : null}</div>
        </div>
        <div className="dock-actions">
          <button className="btn ghost icon" onClick={() => app.setPanel(app.panel === 'bok' ? 'dol' : 'bok')} aria-label={app.panel === 'bok' ? 'Panel na dole' : 'Panel z boku'} data-tip={app.panel === 'bok' ? 'Przenieś panel na dół' : 'Przenieś panel na bok'}>{app.panel === 'bok' ? <PanelBottom size={16} /> : <PanelRight size={16} />}</button>
          <button className="btn ghost icon" onClick={onMax} aria-label={maxed ? 'Przywróć panel' : 'Powiększ panel'} data-tip={maxed ? 'Przywróć' : 'Powiększ panel'}>{maxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn ghost icon" onClick={onClose} aria-label="Zamknij panel" data-tip="Zamknij panel (Esc)"><X size={17} /></button>
        </div>
      </div>
      <div className="dk-akcje" role="toolbar" aria-label="Działania na dokumencie">
        <button className="btn sm primary" onClick={onOtworz}><Printer size={14} />Drukuj / PDF</button>
        {d.rodzaj === 'wz' && <>
          {przycisk('ceny', 'Ceny i waluta', <Coins size={14} />)}
          {przycisk('dopisz', 'Dopisz pozycję…', <ListPlus size={14} />)}
          {dz.rozjazd.ok && przycisk('rozjazd', 'Raport rozjazdu', <AlertTriangle size={14} />)}
          {przycisk('anuluj', 'Anuluj', <Ban size={14} />, 'Anuluj dokument', true)}
        </>}
        {d.rodzaj === 'cmr' && przycisk('edytujCmr', 'Edytuj CMR', <Pencil size={14} />)}
        {d.rodzaj === 'hdi' && przycisk('anulujHdi', 'Anuluj', <Ban size={14} />, 'Anuluj dokument', true)}
        {d.orderId && <button className="btn sm ghost" onClick={() => app.openOrder(d.orderId!)}><ShoppingCart size={14} />Zamówienie</button>}
      </div>
      <div className="dock-body dk-podglad-wrap">
        <Podglad url={pdfUrl(d)} tytul={d.numer} onOtworz={onOtworz} />
      </div>
    </>
  )
}
