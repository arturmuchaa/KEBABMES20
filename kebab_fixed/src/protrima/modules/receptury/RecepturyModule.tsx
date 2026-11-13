import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Plus, Pencil, Copy, Archive, RotateCcw, RefreshCw, Search, ArrowUp, ArrowDown, X, ExternalLink,
  PanelBottom, PanelRight, Maximize2, Minimize2, Calculator, Droplets,
} from 'lucide-react'
import { useApp, CommandBar, Dialog, Menu, useMenu, type Cmd } from '../../shell/context'
import { useDock } from '../../shell/useDock'
import { num } from '../../data/model'
import { ile } from '../../data/tekst'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { ingredientsApi, productTypesApi, rawBatchesApi, recipesApi, type RecipeUsage, type RecipeUsageDetail } from '@/lib/api'
import type { Ingredient, IngredientStock, Recipe } from '@/features/ingredients/types'
import type { ProductType } from '@/features/products/types'
import { EdytorReceptury, type MaterialType } from './EdytorReceptury'
import {
  ETYKIETA_MASOWANIA, dataPl, dawka, filtruj, kalkulator, kg2, kiedy, liczba, miesoNaPolprodukt, proc1, pustyFormularz, sortuj,
  typowyTermin, wUzyciu, zReceptury, type Formularz, type Kolumna, type Sort,
} from './model'

type Widok = 'aktywne' | 'wycofane'
type Zakladka = 'sklad' | 'kalkulator' | 'uzycie'
type Okno = { rodzaj: 'edytor'; start: Formularz; r?: Recipe } | { rodzaj: 'wycofaj'; r: Recipe } | null

const ZAKLADKI: Array<{ key: Zakladka; label: string }> = [
  { key: 'sklad', label: 'Skład' }, { key: 'kalkulator', label: 'Kalkulator' }, { key: 'uzycie', label: 'Gdzie użyta' },
]
const KOLUMNY: Array<{ kol: Kolumna | null; label: string; cls?: string; tip?: string }> = [
  { kol: 'nazwa', label: 'Receptura' },
  { kol: 'rodzaj', label: 'Rodzaj', cls: 'hide-s' },
  { kol: null, label: 'Składniki', cls: 'num hide-m' },
  { kol: 'wydajnosc', label: 'Półprodukt', cls: 'num', tip: 'Ile kg półproduktu daje 100 kg mięsa' },
  { kol: 'termin', label: 'Termin', cls: 'num hide-m' },
  { kol: null, label: 'Masowanie', cls: 'num hide-m' },
  { kol: 'uzycie', label: 'W użyciu', tip: 'Otwarte zamówienia i niedokończone masowania' },
  { kol: 'ostatnio', label: 'Ostatnio masowana', cls: 'hide-s' },
]

/**
 * Receptury masowania (port ze starego MES, ulepszony): lista z wyszukiwaniem
 * po nazwie i składniku, panel szczegółów ze składem, udziałami i stanem
 * przypraw, kalkulator na dowolną ilość mięsa albo półproduktu, „gdzie użyta”
 * (zamówienia, masowania, partie, katalog), edycja z klawiatury, kopia,
 * wycofanie z blokadą serwera i przywrócenie wycofanej.
 */
export function RecepturyModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const [widok, setWidok] = useState<Widok>('aktywne')
  const listaRes = useApi(() => recipesApi.list())
  const wycofaneRes = useApi(() => recipesApi.archived())
  const uzycieRes = useApi(() => recipesApi.usage())
  const skladnikiRes = useApi(() => ingredientsApi.list())
  const stanyRes = useApi(() => ingredientsApi.stock())
  const rodzajeRes = useApi(() => productTypesApi.list())
  const miesoRes = useApi(() => rawBatchesApi.materialTypes())

  const [q, setQ] = useState('')
  const [rodzaj, setRodzaj] = useState('')
  const [sort, setSort] = useState<Sort>({ kol: 'nazwa', kier: 1 })
  const [sel, setSel] = useState<string | null>(null)
  const [zakladka, setZakladka] = useState<Zakladka>('sklad')
  const [maxed, setMaxed] = useState(false)
  const [okno, setOkno] = useState<Okno>(null)
  const rodzajMenu = useMenu()
  const workRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dock = useDock(workRef, 'receptury')

  const aktywne = listaRes.data ?? []
  const wycofane = wycofaneRes.data ?? []
  const zrodlo = widok === 'aktywne' ? aktywne : wycofane
  const uzycie = useMemo(() => new Map((uzycieRes.data ?? []).map(u => [u.recipeId, u])), [uzycieRes.data])
  const rodzaje = (rodzajeRes.data ?? []) as ProductType[]
  const nazwaRodzaju = useCallback((r: Recipe) => rodzaje.find(p => p.id === r.productTypeId)?.name ?? r.productTypeName ?? '', [rodzaje])
  const widoczne = useMemo(() => sortuj(filtruj(zrodlo, q, rodzaj), sort, uzycie, nazwaRodzaju), [zrodlo, q, rodzaj, sort, uzycie, nazwaRodzaju])
  const wybrana = widoczne.find(r => r.id === sel) ?? zrodlo.find(r => r.id === sel) ?? null
  const skladniki = (skladnikiRes.data ?? []) as Ingredient[]
  const mieso = useMemo<MaterialType[]>(() => ((miesoRes.data ?? []) as Array<{ id: string; name: string; requiresDeboning: boolean }>).filter(m => !m.requiresDeboning), [miesoRes.data])
  const wUzyciuIle = aktywne.filter(r => wUzyciu(uzycie.get(r.id))).length
  const rodzajeWUzyciu = useMemo(() => {
    const m = new Map<string, number>()
    zrodlo.forEach(r => { const k = r.productTypeId || '-'; m.set(k, (m.get(k) ?? 0) + 1) })
    return [...m.entries()].map(([id, n]) => ({ id, n, nazwa: id === '-' ? 'bez rodzaju' : rodzaje.find(p => p.id === id)?.name ?? zrodlo.find(r => r.productTypeId === id)?.productTypeName ?? '?' }))
      .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))
  }, [zrodlo, rodzaje])

  const odswiez = useCallback(() => {
    void listaRes.refetch(); void wycofaneRes.refetch(); void uzycieRes.refetch(); void stanyRes.refetch(); void skladnikiRes.refetch()
  }, [listaRes, wycofaneRes, uzycieRes, stanyRes, skladnikiRes])

  const nowa = useCallback(() => setOkno({ rodzaj: 'edytor', start: pustyFormularz(typowyTermin(aktywne)) }), [aktywne])
  const edytuj = useCallback((r: Recipe) => setOkno({ rodzaj: 'edytor', start: zReceptury(r), r }), [])
  // Kopia otwiera edytor ze składem i pustą nazwą — stary MES od razu zapisywał „KIRMIZI(1)” i trzeba było ją potem przemianowywać.
  const kopiuj = useCallback((r: Recipe) => setOkno({ rodzaj: 'edytor', start: zReceptury(r, true) }), [])
  const przywroc = useCallback(async (r: Recipe) => {
    try {
      await recipesApi.activate(r.id)
      app.toast({ kind: 'ok', title: `Przywrócono „${r.name}”`, detail: 'Receptura wróciła na listę wyboru w zamówieniach i planie masowania.' })
      setWidok('aktywne'); setSel(r.id); odswiez()
    } catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się przywrócić receptury', detail: e instanceof Error ? e.message : undefined }) }
  }, [app, odswiez])

  const cmds = useMemo<Cmd[]>(() => widok === 'aktywne' ? [
    { id: 'new', group: 1, label: 'Nowa receptura', icon: <Plus size={17} />, kbd: 'Ctrl+N', primary: true, run: nowa },
    { id: 'edit', group: 2, label: 'Edytuj', icon: <Pencil size={17} />, kbd: 'F2', disabled: !wybrana, run: () => wybrana && edytuj(wybrana) },
    { id: 'duplicate', group: 2, label: 'Kopiuj skład', icon: <Copy size={17} />, kbd: 'Ctrl+D', disabled: !wybrana, tip: 'Nowa receptura z tym samym składem — zmieniasz jeden składnik zamiast przepisywać wszystkie', run: () => wybrana && kopiuj(wybrana) },
    { id: 'archive', group: 3, label: 'Wycofaj', icon: <Archive size={17} />, disabled: !wybrana, tip: 'Znika z list wyboru; można ją przywrócić', run: () => wybrana && setOkno({ rodzaj: 'wycofaj', r: wybrana }) },
    { id: 'reload', group: 4, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: odswiez },
  ] : [
    { id: 'restore', group: 1, label: 'Przywróć', icon: <RotateCcw size={17} />, primary: true, disabled: !wybrana, run: () => wybrana && void przywroc(wybrana) },
    { id: 'reload', group: 4, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: odswiez },
  ], [widok, wybrana, nowa, edytuj, kopiuj, przywroc, odswiez])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Receptury <b>{aktywne.length}</b> · w użyciu <b>{wUzyciuIle}</b>{wycofane.length ? <> · wycofane <b>{wycofane.length}</b></> : null}</span>)
  }, [active, aktywne.length, wUzyciuIle, wycofane.length, setCtx])

  // Klawisze modułu: Ctrl+F szukaj, F2 edytuj, Esc zamyka panel, Alt+1..3 zakładki panelu.
  useEffect(() => {
    if (!active || okno) return
    const key = (e: KeyboardEvent) => {
      const wPolu = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.key === 'F2' && wybrana && widok === 'aktywne') { e.preventDefault(); edytuj(wybrana) }
      else if (e.key === 'Escape' && sel && !wPolu) { e.preventDefault(); setSel(null) }
      else if (e.altKey && /^[1-3]$/.test(e.key) && wybrana) { e.preventDefault(); setZakladka(ZAKLADKI[Number(e.key) - 1].key) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, okno, wybrana, widok, sel, edytuj])

  const wierszDom = (id: string) => listRef.current?.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`)
  const wybierz = (id: string) => { setSel(id); requestAnimationFrame(() => wierszDom(id)?.scrollIntoView({ block: 'nearest' })) }
  const naLiscie = (e: React.KeyboardEvent) => {
    const i = widoczne.findIndex(r => r.id === sel)
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = widoczne[Math.min(widoczne.length - 1, i + 1)]; if (r) wybierz(r.id) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const r = widoczne[Math.max(0, i - 1)]; if (r) wybierz(r.id) }
    else if (e.key === 'Enter' && wybrana && widok === 'aktywne') { e.preventDefault(); edytuj(wybrana) }
  }
  const naSzukaniu = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && widoczne[0]) { e.preventDefault(); wybierz(widoczne[0].id); listRef.current?.focus() }
    else if (e.key === 'Enter' && widoczne.length === 1) { e.preventDefault(); wybierz(widoczne[0].id) }
    else if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ('') }
  }
  const th = (k: (typeof KOLUMNY)[number]) => {
    if (!k.kol) return <th key={k.label} className={k.cls}>{k.label}</th>
    const on = sort.kol === k.kol
    return <th key={k.label} className={`sortable ${k.cls ?? ''}`} data-tip={k.tip} aria-sort={on ? (sort.kier === 1 ? 'ascending' : 'descending') : undefined}
      onClick={() => setSort(s => s.kol === k.kol ? { kol: k.kol!, kier: s.kier === 1 ? -1 : 1 } : { kol: k.kol!, kier: k.kol === 'ostatnio' || k.kol === 'uzycie' ? -1 : 1 })}>
      {k.label}<span className="sort">{on ? (sort.kier === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</span></th>
  }

  const ladowanie = (widok === 'aktywne' ? listaRes : wycofaneRes).loading && !(widok === 'aktywne' ? listaRes : wycofaneRes).data
  const bladListy = (widok === 'aktywne' ? listaRes : wycofaneRes).error
  const filtry = !!(q || rodzaj)
  const COLS = KOLUMNY.length

  return (
    <>
      <CommandBar title="Receptury" count={widok === 'aktywne' ? 'masowania — dawki na 100 kg mięsa' : 'wycofane — do przywrócenia'} cmds={cmds} />
      <div className="toolbar" role="toolbar" aria-label="Widoki i filtry receptur">
        <div className="seg" role="group" aria-label="Widok receptur">
          <button type="button" aria-pressed={widok === 'aktywne'} onClick={() => { setWidok('aktywne'); setSel(null) }}>Aktywne<span className="count">{aktywne.length}</span></button>
          <button type="button" aria-pressed={widok === 'wycofane'} onClick={() => { setWidok('wycofane'); setSel(null) }}>Wycofane<span className="count">{wycofane.length}</span></button>
        </div>
        <span className="vsep" />
        <div className="field-wrap search">
          <Search size={15} />
          <input ref={searchRef} className="field" placeholder="Nazwa, kod albo składnik…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={naSzukaniu} aria-label="Szukaj receptury" />
          {!q && <span className="kbd">Ctrl F</span>}
        </div>
        <button className={`chip${rodzaj ? ' on' : ''}`} onClick={rodzajMenu.open}>
          Rodzaj{rodzaj ? `: ${rodzajeWUzyciu.find(x => x.id === rodzaj)?.nazwa ?? ''}` : ''}
          {rodzaj ? <span className="x" role="button" aria-label="Wyczyść filtr rodzaju" onClick={e => { e.stopPropagation(); setRodzaj('') }}><X size={13} /></span> : null}
        </button>
        {filtry && <button className="btn sm ghost" onClick={() => { setQ(''); setRodzaj('') }}>Wyczyść filtry</button>}
      </div>

      <div className={`workarea${dock.side ? ' side' : ''}`} ref={workRef}>
        <div className="list-pane" style={dock.listStyle(!!wybrana, maxed)}>
          <div className="tbl-wrap" ref={listRef} tabIndex={0} onKeyDown={naLiscie} aria-label="Lista receptur">
            <table className="tbl rc-lista" role="grid">
              <thead><tr>{KOLUMNY.map(th)}</tr></thead>
              <tbody>
                {ladowanie && <SzkieletWierszy kolumny={COLS} wiersze={6} />}
                {bladListy && !ladowanie && <tr><td colSpan={COLS}><Pusto ikona={<BookOpen size={20} />} tytul="Nie udało się pobrać receptur"
                  akcja={<button className="btn sm" onClick={odswiez}>Spróbuj ponownie</button>}>{bladListy}</Pusto></td></tr>}
                {!ladowanie && !bladListy && widoczne.length === 0 && <tr><td colSpan={COLS}>
                  {filtry ? <Pusto ikona={<Search size={20} />} tytul="Żadna receptura nie pasuje" akcja={<button className="btn sm" onClick={() => { setQ(''); setRodzaj('') }}>Wyczyść filtry</button>}>Szukamy w nazwie, kodzie, rodzaju i składnikach.</Pusto>
                    : widok === 'wycofane' ? <Pusto ikona={<Archive size={20} />} tytul="Brak wycofanych receptur">Wycofana receptura trafia tutaj i można ją przywrócić z tym samym składem.</Pusto>
                      : <Pusto ikona={<BookOpen size={20} />} tytul="Brak receptur" akcja={<button className="btn sm primary" onClick={nowa}><Plus size={14} />Nowa receptura</button>}>Receptura to dawki przypraw i dodatków na 100 kg mięsa.</Pusto>}
                </td></tr>}
                {widoczne.map((r, i) => {
                  const u = uzycie.get(r.id)
                  return (
                    <tr key={r.id} data-id={r.id} className={`row${i % 2 ? ' zebra' : ''}${sel === r.id ? ' sel' : ''}`} aria-selected={sel === r.id}
                      onClick={() => setSel(r.id)} onDoubleClick={() => widok === 'aktywne' && edytuj(r)}>
                      <td className="ell" style={{ maxWidth: 300 }}><b>{r.name}</b></td>
                      <td className="ell hide-s" style={{ maxWidth: 200 }}>{nazwaRodzaju(r) || <span className="faint">—</span>}</td>
                      <td className="num hide-m">{r.ingredients.length}</td>
                      <td className="num"><b>{dawka(r.totalOutputPer100kg)}</b> <span className="sub">kg</span></td>
                      <td className="num hide-m">{r.shelfLifeDays} <span className="sub">dni</span></td>
                      <td className="num hide-m">{r.mixingMinutes ? <>{r.mixingMinutes} <span className="sub">min</span></> : <span className="faint" data-tip="Standardowe 50 minut">50 <span className="sub">min</span></span>}</td>
                      <td><Uzycie u={u} /></td>
                      <td className="hide-s tnum">{kiedy(u?.lastMixedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {wybrana && <>
          <div className={`splitter${dock.drag ? ' drag' : ''}`} role="separator" aria-orientation={dock.side ? 'vertical' : 'horizontal'}
            onMouseDown={e => { setMaxed(false); dock.startDrag(e) }} onDoubleClick={() => { dock.reset(); setMaxed(false) }} data-tip="Przeciągnij, aby zmienić rozmiar. Dwuklik — domyślnie." />
          <div className="dock" aria-label="Szczegóły receptury">
            <Szczegoly r={wybrana} rodzaj={nazwaRodzaju(wybrana)} wycofana={widok === 'wycofane'} u={uzycie.get(wybrana.id)} stany={(stanyRes.data ?? null) as IngredientStock[] | null}
              skladniki={skladniki} zakladka={zakladka} onZakladka={setZakladka} maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setSel(null)}
              onEdytuj={() => edytuj(wybrana)} onPrzywroc={() => void przywroc(wybrana)} />
          </div>
        </>}
      </div>

      {rodzajMenu.anchor && <Menu anchor={rodzajMenu.anchor} onClose={rodzajMenu.close} items={[{ header: 'Rodzaj produktu' },
        { label: 'Wszystkie', checked: !rodzaj, onSelect: () => setRodzaj('') },
        ...rodzajeWUzyciu.map(x => ({ label: `${x.nazwa} (${x.n})`, checked: rodzaj === x.id, onSelect: () => setRodzaj(x.id) }))]} />}

      {okno?.rodzaj === 'edytor' && <EdytorReceptury start={okno.start} edytowana={okno.r} lista={aktywne} skladniki={skladniki} rodzaje={rodzaje} mieso={mieso}
        uzycie={okno.r ? uzycie.get(okno.r.id) : undefined} onClose={() => setOkno(null)}
        onZapisana={r => {
          app.toast({ kind: 'ok', title: okno.r ? `Zapisano „${r.name}”` : `Dodano recepturę „${r.name}”`, detail: `${ile(r.ingredients.length, 'składnik', 'składniki', 'składników')} · ${dawka(r.totalOutputPer100kg)} kg półproduktu na 100 kg mięsa` })
          setOkno(null); setWidok('aktywne'); setSel(r.id); odswiez()
        }} />}
      {okno?.rodzaj === 'wycofaj' && <WycofajDialog r={okno.r} onClose={() => setOkno(null)} onDone={() => {
        app.toast({ kind: 'ok', title: `Wycofano „${okno.r.name}”`, detail: 'Jest w widoku „Wycofane” — można ją przywrócić.' })
        setOkno(null); setSel(null); odswiez()
      }} />}
    </>
  )
}

function Uzycie({ u }: { u?: RecipeUsage }) {
  if (!u || (!u.openOrders && !u.plannedMixing && !u.seasonedKg)) return <span className="faint">—</span>
  return (
    <span className="rc-uzycie">
      {u.openOrders > 0 && <span className="tag" data-tip={`${kg2(u.openOrdersKg)} w otwartych zamówieniach`}>{ile(u.openOrders, 'zamówienie', 'zamówienia', 'zamówień')}</span>}
      {u.plannedMixing > 0 && <span className="tag warn" data-tip="Zaplanowane albo trwające masowania">{ile(u.plannedMixing, 'masowanie', 'masowania', 'masowań')}</span>}
      {u.seasonedKg > 0 && <span className="muted" data-tip="Półprodukt (mięso przyprawione) na stanie">{num(u.seasonedKg)} kg na stanie</span>}
    </span>
  )
}

function Szczegoly({ r, rodzaj, wycofana, u, stany, skladniki, zakladka, onZakladka, maxed, onMax, onClose, onEdytuj, onPrzywroc }: {
  r: Recipe; rodzaj: string; wycofana: boolean; u?: RecipeUsage; stany: IngredientStock[] | null; skladniki: Ingredient[]
  zakladka: Zakladka; onZakladka: (z: Zakladka) => void; maxed: boolean; onMax: () => void; onClose: () => void; onEdytuj: () => void; onPrzywroc: () => void
}) {
  const app = useApp()
  const zKomp = (r.components ?? []).length > 0
  return (
    <>
      <div className="dock-head">
        <div className="dock-id">
          <div className="l1"><h2>{r.name}</h2>{r.code && <span className="code muted" data-tip="Kod katalogowy receptury">{r.code}</span>}
            {wycofana && <span className="tag">Wycofana</span>}
            {wUzyciu(u) && <span className="tag info">W użyciu</span>}
          </div>
          <div className="l2">{rodzaj || 'bez rodzaju'}{zKomp && <> · {r.components!.map(c => `${c.pct}% ${c.materialName}`).join(' + ')}</>}</div>
        </div>
        <div className="dock-figs">
          <div className="f"><span className="k">Półprodukt / 100 kg</span><span className="v">{dawka(r.totalOutputPer100kg)} kg</span></div>
          <div className="f"><span className="k">Termin</span><span className="v">{r.shelfLifeDays} dni</span></div>
          <div className="f"><span className="k">Masowanie</span><span className="v">{r.mixingMinutes ?? 50} min<small>{r.mixingMinutes ? '' : 'standard'}</small></span></div>
        </div>
        <div className="dock-actions">
          {wycofana ? <button className="btn" onClick={onPrzywroc}><RotateCcw size={15} />Przywróć</button> : <button className="btn" onClick={onEdytuj}><Pencil size={15} />Edytuj</button>}
          <span style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />
          <button className="btn ghost icon" onClick={() => app.setPanel(app.panel === 'bok' ? 'dol' : 'bok')} aria-label={app.panel === 'bok' ? 'Panel na dole' : 'Panel z boku'} data-tip={app.panel === 'bok' ? 'Przenieś panel na dół' : 'Przenieś panel na bok'}>{app.panel === 'bok' ? <PanelBottom size={16} /> : <PanelRight size={16} />}</button>
          <button className="btn ghost icon" onClick={onMax} aria-label={maxed ? 'Przywróć panel' : 'Powiększ panel'} data-tip={maxed ? 'Przywróć' : 'Powiększ panel'}>{maxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn ghost icon" onClick={onClose} aria-label="Zamknij panel (Esc)" data-tip="Zamknij panel (Esc)"><X size={17} /></button>
        </div>
      </div>
      <div className="dock-tabs" role="tablist">
        {ZAKLADKI.map((t, i) => <button key={t.key} role="tab" className="dock-tab" aria-selected={zakladka === t.key} onClick={() => onZakladka(t.key)} data-tip={`Alt+${i + 1}`}>
          {t.label}{t.key === 'uzycie' && wUzyciu(u) && <span className="badge">{(u!.openOrders || 0) + (u!.plannedMixing || 0)}</span>}
        </button>)}
      </div>
      <div className="dock-body" role="tabpanel">
        <div className="dock-pad">
          {zakladka === 'sklad' && <Sklad r={r} stany={stany} skladniki={skladniki} />}
          {zakladka === 'kalkulator' && <Kalkulator key={r.id} r={r} stany={stany} />}
          {zakladka === 'uzycie' && <GdzieUzyta key={r.id} r={r} />}
        </div>
      </div>
    </>
  )
}

function Sklad({ r, stany, skladniki }: { r: Recipe; stany: IngredientStock[] | null; skladniki: Ingredient[] }) {
  const st = new Map((stany ?? []).map(s => [s.ingredientId, s]))
  const nieaktywne = new Set(skladniki.filter(i => !i.active).map(i => i.id))
  const polprodukt = r.totalOutputPer100kg || 100
  return (
    <div className="rc-szczegoly">
      <table className="tbl rc-sklad-tbl">
        <thead><tr><th className="c" style={{ width: 34 }}>Lp.</th><th>Składnik</th><th className="num">Na 100 kg mięsa</th><th className="num">Udział</th><th className="num">Na stanie</th></tr></thead>
        <tbody>
          {r.ingredients.map((i, n) => {
            const s = st.get(i.ingredientId)
            const zero = !i.isUnlimited && s && !s.isUnlimited && s.qtyAvailable <= 0
            return (
              <tr key={i.id} className="row">
                <td className="c muted tnum">{n + 1}</td>
                <td><b>{i.ingredientName}</b>{i.isUnlimited && <span className="sub"><Droplets size={12} aria-hidden /> bez stanu</span>}
                  {nieaktywne.has(i.ingredientId) && <span className="tag warn" style={{ marginLeft: 6 }} data-tip="Składnik wycofany z magazynu przypraw">wycofany</span>}</td>
                <td className="num"><b>{dawka(i.qtyPer100kg)}</b> <span className="sub">{i.unit}</span></td>
                <td className="num muted">{proc1((i.qtyPer100kg / polprodukt) * 100)}</td>
                <td className={`num${zero ? ' crit-ink' : ''}`}>{i.isUnlimited || s?.isUnlimited ? <span className="faint">—</span> : s ? <>{dawka(s.qtyAvailable)} <span className="sub">{s.unit}</span></> : stany ? <span className="crit-ink">brak</span> : '…'}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr><td /><td className="muted">Mięso (baza)</td><td className="num">100 <span className="sub">kg</span></td><td className="num muted">{proc1((100 / polprodukt) * 100)}</td><td /></tr>
          <tr className="rc-razem"><td /><td>Półprodukt łącznie</td><td className="num">{dawka(r.totalOutputPer100kg)} <span className="sub">kg</span></td><td className="num">100%</td><td /></tr>
        </tfoot>
      </table>
      {r.notes && <div className="note"><FlagIcon level="info" size={15} /><div><b>Uwagi:</b> {r.notes}</div></div>}
      {r.updatedAt && <p className="faint rc-stopka">Ostatnia zmiana {dataPl(r.updatedAt)}</p>}
    </div>
  )
}

function Kalkulator({ r, stany }: { r: Recipe; stany: IngredientStock[] | null }) {
  const [tryb, setTryb] = useState<'mieso' | 'polprodukt'>('mieso')
  const [wartosc, setWartosc] = useState('600')
  const v = liczba(wartosc)
  const miesoKg = v > 0 ? (tryb === 'mieso' ? v : miesoNaPolprodukt(v, r.totalOutputPer100kg)) : 0
  const k = kalkulator(r, miesoKg, stany)
  return (
    <div className="rc-szczegoly">
      <div className="rc-kalk-wejscie">
        <div className="seg" role="group" aria-label="Licz od">
          <button type="button" aria-pressed={tryb === 'mieso'} onClick={() => setTryb('mieso')}>Mam mięsa</button>
          <button type="button" aria-pressed={tryb === 'polprodukt'} onClick={() => setTryb('polprodukt')}>Potrzebuję półproduktu</button>
        </div>
        <span className="rc-jedn"><input className="field num rc-kalk-pole" inputMode="decimal" value={wartosc} autoFocus onFocus={e => e.target.select()}
          onChange={e => setWartosc(e.target.value.replace(/[^\d.,]/g, ''))} aria-label={tryb === 'mieso' ? 'Mięso (kg)' : 'Półprodukt (kg)'} /><span>kg</span></span>
        <div className="rc-kalk-szybkie" aria-label="Szybki wybór">{[200, 600, 800, 1000].map(x => <button key={x} type="button" className="chip" onClick={() => setWartosc(String(x))}>{x}</button>)}</div>
      </div>
      {miesoKg > 0 ? <>
        <div className="rc-kalk-wynik">
          <div><span className="k">Mięso</span><span className="v">{kg2(miesoKg)}</span></div>
          <div><span className="k">Składniki</span><span className="v">{kg2(k.polprodukt - miesoKg)}</span></div>
          <div className="rc-razem"><span className="k">Półprodukt</span><span className="v">{kg2(k.polprodukt)}</span></div>
        </div>
        {k.braki > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Za mało na stanie: {ile(k.braki, 'składnik', 'składniki', 'składników')}.</b> Zamów albo przyjmij przyprawy przed masowaniem.</div></div>}
        <table className="tbl rc-sklad-tbl">
          <thead><tr><th>Składnik</th><th className="num">Odważyć</th><th className="num">Na stanie</th><th>Stan</th></tr></thead>
          <tbody>{k.pozycje.map(p => (
            <tr key={p.id} className="row">
              <td><b>{p.nazwa}</b></td>
              <td className="num"><b>{dawka(p.ilosc)}</b> <span className="sub">{p.jedn}</span></td>
              <td className="num">{p.naStanie == null ? <span className="faint">—</span> : <>{dawka(p.naStanie)} <span className="sub">{p.jedn}</span></>}</td>
              <td>{p.stan === 'ok' ? <span className="tag ok">wystarczy</span> : p.stan === 'malo' ? <span className="tag warn" data-tip="Zostanie mniej niż połowa tej ilości">na styk</span>
                : p.stan === 'brak' ? <span className="tag crit">brakuje {p.naStanie != null ? `${dawka(Math.max(0, p.ilosc - p.naStanie))} ${p.jedn}` : ''}</span>
                  : p.stan === 'bez-stanu' ? <span className="faint">bez stanu</span> : <span className="faint">…</span>}</td>
            </tr>))}</tbody>
        </table>
        <p className="faint rc-stopka"><Calculator size={12} aria-hidden /> Stany przypraw z magazynu przypraw i dodatków; nie uwzględniają masowań już zaplanowanych.</p>
      </> : <p className="muted">Wpisz liczbę kilogramów.</p>}
    </div>
  )
}

function GdzieUzyta({ r }: { r: Recipe }) {
  const app = useApp()
  const res = useApi(() => recipesApi.usageOf(r.id), [r.id])
  const d = res.data as RecipeUsageDetail | null
  if (res.loading && !d) return <p className="muted">Sprawdzam, gdzie receptura jest używana…</p>
  if (res.error) return <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się sprawdzić użycia: {res.error} <button className="btn sm" onClick={() => void res.refetch()}>Ponów</button></div></div>
  if (!d) return null
  const nic = !d.orders.length && !d.mixing.length && !d.seasoned.length && !d.catalog.length
  return (
    <div className="rc-szczegoly">
      {nic && <Pusto ikona={<BookOpen size={20} />} tytul="Receptura nigdzie nie jest teraz używana">Brak otwartych zamówień, masowań w toku, półproduktu na stanie i pozycji w katalogu wyrobów.</Pusto>}
      {d.orders.length > 0 && <section><h3 className="rc-h">Otwarte zamówienia <span className="muted">{d.orders.length}</span></h3>
        <table className="tbl rc-sklad-tbl"><thead><tr><th>Zamówienie</th><th>Odbiorca</th><th>Wyjazd</th><th className="num">Sztuk</th><th className="num">kg</th></tr></thead>
          <tbody>{d.orders.map(o => <tr key={o.id} className="row">
            <td><button type="button" className="accent-ink rc-link" onClick={() => app.openOrder(o.id)}>{o.orderNo} <ExternalLink size={12} aria-hidden /></button></td>
            <td className="ell" style={{ maxWidth: 220 }}>{o.clientName || '—'}</td><td className="tnum">{dataPl(o.deliveryDate)}</td>
            <td className="num">{num(o.qty)}</td><td className="num">{num(o.kg)}</td></tr>)}</tbody></table></section>}
      {d.mixing.length > 0 && <section><h3 className="rc-h">Masowania w toku <span className="muted">{d.mixing.length}</span></h3>
        <table className="tbl rc-sklad-tbl"><thead><tr><th>Zlecenie</th><th>Stan</th><th className="num">Mięso</th><th className="num">Półprodukt</th><th>Zaplanowano</th></tr></thead>
          <tbody>{d.mixing.map(m => <tr key={m.id} className="row"><td className="code">{m.orderNo}</td><td><span className="tag warn">{ETYKIETA_MASOWANIA[m.status] ?? m.status}</span></td>
            <td className="num">{num(m.meatKg)} <span className="sub">kg</span></td><td className="num">{num(m.outputKg)} <span className="sub">kg</span></td><td className="tnum">{dataPl(m.createdAt)}</td></tr>)}</tbody></table></section>}
      {d.seasoned.length > 0 && <section><h3 className="rc-h">Półprodukt na stanie <span className="muted">{num(d.seasoned.reduce((s, p) => s + p.kgAvailable, 0))} kg</span></h3>
        <table className="tbl rc-sklad-tbl"><thead><tr><th>Partia</th><th className="num">Na stanie</th><th>Masowana</th><th>Przydatna do</th></tr></thead>
          <tbody>{d.seasoned.map(p => <tr key={p.id} className="row"><td className="code">{p.batchNo}</td><td className="num">{kg2(p.kgAvailable)}</td><td className="tnum">{dataPl(p.createdAt)}</td><td className="tnum">{dataPl(p.expiryDate)}</td></tr>)}</tbody></table></section>}
      {d.catalog.length > 0 && <section><h3 className="rc-h">Katalog wyrobów <span className="muted">{d.catalog.length}</span></h3>
        <table className="tbl rc-sklad-tbl"><thead><tr><th>Kod</th><th>Rodzaj</th><th>Opakowanie</th><th className="num">Gramatura</th></tr></thead>
          <tbody>{d.catalog.map(c => <tr key={c.id} className="row"><td className="code">{c.code}</td><td>{c.productTypeName}</td><td>{c.packagingName || '—'}</td><td className="num">{num(c.kgPerUnit)} <span className="sub">kg</span></td></tr>)}</tbody></table></section>}
    </div>
  )
}

function WycofajDialog({ r, onClose, onDone }: { r: Recipe; onClose: () => void; onDone: () => void }) {
  const res = useApi(() => recipesApi.usageOf(r.id), [r.id])
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const blokady = res.data?.blockers ?? []
  const wycofaj = async () => {
    if (busy) return
    setBusy(true); setBlad(null)
    try { await recipesApi.deactivate(r.id); onDone() } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się wycofać') } finally { setBusy(false) }
  }
  return (
    <Dialog title={`Wycofać recepturę „${r.name}”?`} icon={<Archive size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn danger" disabled={busy || res.loading || blokady.length > 0} data-tip={blokady.length ? 'Receptura jest w użyciu' : undefined} onClick={() => void wycofaj()}>{busy ? 'Wycofuję…' : 'Wycofaj recepturę'}</button></>}>
      <p className="muted" style={{ margin: 0 }}>Receptura zniknie z list wyboru w zamówieniach i planie masowania. Skład, historia partii i dokumenty zostają —
        w widoku „Wycofane” można ją przywrócić jednym kliknięciem.</p>
      {res.loading && <p className="muted">Sprawdzam, czy receptura nie jest w użyciu…</p>}
      {blokady.length > 0 && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Teraz nie można — receptura jest w użyciu:</b>
        <ul className="rc-lista-pow">{blokady.map(b => <li key={b}>{b}</li>)}</ul>Wycofaj ją po zamknięciu zamówień i masowań.</div></div>}
      {!blokady.length && (res.data?.seasoned.length ?? 0) > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Na stanie jest jeszcze półprodukt tej receptury ({num(res.data!.seasoned.reduce((s, p) => s + p.kgAvailable, 0))} kg) — produkcja nadal go zużyje.</div></div>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}
