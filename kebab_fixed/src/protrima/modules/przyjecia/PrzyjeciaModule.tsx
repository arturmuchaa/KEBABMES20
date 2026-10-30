import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  PackagePlus, Pencil, ClipboardCheck, Tag, Ban, Search, ChevronDown, ChevronRight, X, Maximize2, Minimize2,
  PanelRight, PanelBottom, Rows3, ArrowUp, ArrowDown, Thermometer, FileText, Layers,
} from 'lucide-react'
import { useApp, Menu, useMenu, CommandBar, type Cmd } from '../../shell/context'
import { useDock } from '../../shell/useDock'
import { kg, num, fmtDate } from '../../data/model'
import { dataZApi } from '../../data/mapuj'
import {
  getSurowe, mapaMiesa, mapujPrzyjecie, mapujRodzaje, roznicaKg, stanHaccp, dniDo,
  type Przyjecie, type StanHaccp,
} from '../../data/przyjecia'
import { FlagIcon } from '../../ui/Glyphs'
import { BEZ_DRUKU_ETYKIET, FAZA_ZAPISU } from '../../proba'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { receptionChecksApi, suppliersApi, wzApi } from '@/lib/api'
import type { ReceptionCheck } from '@/features/raw-batches/receptionCheck'
import { progPrzyjecia } from '@/features/raw-batches/storageState'

type View = 'live' | 'today' | 'week' | 'nohaccp' | 'all' | 'cancelled'
type Tab = 'overview' | 'numbers' | 'supplier' | 'haccp'
type GroupBy = 'day' | 'month' | 'supplier' | 'none'
type SortCol = 'no' | 'date' | 'supplier' | 'kg' | 'left' | 'expiry'
type Termin = '' | 'soon' | 'over'

/** Kontrole HACCP pobieramy za tyle dni wstecz — starsze dostawy pokazują „—”, nie „brak”. */
const DNI_HACCP = 180
/** Od tego dnia kontrolę przyjęcia wypełnia się w MES (wdrożenie 02.09.2026). */
const HACCP_W_SYSTEMIE_OD = '2026-09-02'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Przegląd' }, { key: 'numbers', label: 'Numery porządkowe' },
  { key: 'supplier', label: 'Partie dostawcy' }, { key: 'haccp', label: 'Kontrola HACCP' },
]
const isoDni = (d: number) => { const t = new Date(); t.setDate(t.getDate() - d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
const MIESIAC = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
const nazwaMiesiaca = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MIESIAC[m - 1] ?? ym} ${y}` }

interface Row { p: Przyjecie; h: StanHaccp | null; supplier: string; level: 'crit' | 'warn' | 'info' | null; flags: string[] }

/**
 * Przyjęcia surowca — dokumenty dostaw (numer przyjęcia → numery porządkowe →
 * partie dostawcy). Tylko odczyt; nowe przyjęcie, edycja, HACCP i zawieszki — faza 3.
 */
export function PrzyjeciaModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const recRes = useApi(() => getSurowe<Array<Record<string, unknown>>>('/receptions?from=&to=&limit=2000'))
  const typesRes = useApi(() => getSurowe<unknown[]>('/raw-batches/material-types'))
  const stockRes = useApi(() => wzApi.stockRaw())
  const supRes = useApi(() => suppliersApi.list())
  const checksRes = useApi(() => receptionChecksApi.forRange(isoDni(DNI_HACCP), isoDni(-1)) as Promise<ReceptionCheck[]>)
  useLiveRefresh({ recRes, stockRes }, 30_000)
  useLiveRefresh({ checksRes }, 120_000)

  const rodzaje = useMemo(() => mapujRodzaje(typesRes.data ?? []), [typesRes.data])
  const meat = useMemo(() => mapaMiesa(stockRes.data ?? []), [stockRes.data])
  const checks = useMemo(() => new Map((checksRes.data ?? []).map(c => [c.receptionId, c])), [checksRes.data])
  // Kontrola HACCP przyjęcia jest w systemie od 02.09.2026 — wcześniejsze dostawy mają kartę papierową, nie „brak”.
  const haccpOd = [isoDni(DNI_HACCP), HACCP_W_SYSTEMIE_OD].sort().reverse()[0]
  const supName = useMemo(() => new Map((supRes.data ?? []).map(s => [s.id, s.displayName || s.name])), [supRes.data])

  const rows = useMemo<Row[]>(() => (recRes.data ?? []).map(r => {
    const p = mapujPrzyjecie(r, rodzaje, meat)
    const h = p.date >= haccpOd || checks.has(p.id) ? stanHaccp(p, checks.get(p.id)) : null
    const flags: string[] = []
    let level: Row['level'] = null
    const dd = dniDo(p.nearestExpiry)
    if (p.stan === 'w_obiegu' && dd !== null && dd < 0) { flags.push(`Po terminie ${-dd} dni — ${kg(p.kgLeft)} nadal na stanie`); level = 'crit' }
    else if (p.stan === 'w_obiegu' && dd !== null && dd <= 2) { flags.push(`Termin ${dd === 0 ? 'dziś' : `za ${dd} ${dd === 1 ? 'dzień' : 'dni'}`}`); level = 'warn' }
    if (h?.ponadProg) { flags.push('Temperatura ponad próg'); level = 'crit' }
    if (h?.niezgodnosc) { flags.push('Niezgodność w kontroli HACCP'); level = level ?? 'warn' }
    if (!p.cancelled && h && h.status !== 'komplet') { flags.push(h.status === 'brak' ? 'Brak kontroli HACCP' : 'Kontrola HACCP niepełna'); level = level ?? 'warn' }
    const rk = roznicaKg(p)
    if (rk !== null && Math.abs(rk) >= 1) { flags.push(`Różnica z HDI: ${rk > 0 ? '+' : ''}${num(rk)} kg`); level = level ?? 'info' }
    return { p, h, supplier: supName.get(p.supplierId) || p.supplierName || '—', level, flags }
  }), [recRes.data, rodzaje, meat, checks, haccpOd, supName])

  // ─── Widoki i filtry ───────────────────────────────────────────────────
  const [view, setView] = useState<View>('live')
  const [q, setQ] = useState('')
  const [dostawca, setDostawca] = useState('')
  const [mats, setMats] = useState<string[]>([])
  const [miesiac, setMiesiac] = useState('')
  const [termin, setTermin] = useState<Termin>('')
  const [groupBy, setGroupBy] = useState<GroupBy>('day')
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('overview')
  const [maxed, setMaxed] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const matMenu = useMenu(), monthMenu = useMenu(), terminMenu = useMenu(), groupMenu = useMenu()
  const dock = useDock(workRef, 'przyjecia')

  const dzis = isoDni(0), tydzien = isoDni(7)
  const VIEWS: Array<{ key: View; label: string; tip: string; test: (r: Row) => boolean }> = [
    { key: 'live', label: 'W obiegu', tip: 'Dostawy, z których coś jeszcze leży', test: r => r.p.stan === 'w_obiegu' },
    { key: 'today', label: 'Dziś', tip: 'Przyjęte dzisiaj', test: r => r.p.date === dzis && !r.p.cancelled },
    { key: 'week', label: '7 dni', tip: 'Przyjęte w ostatnim tygodniu', test: r => r.p.date >= tydzien && !r.p.cancelled },
    { key: 'nohaccp', label: 'Bez HACCP', tip: 'Kontrola HACCP brak lub niepełna (dostawy od 02.09.2026, gdy kontrola weszła do MES)', test: r => !r.p.cancelled && !!r.h && r.h.status !== 'komplet' },
    { key: 'all', label: 'Wszystkie', tip: 'Cała historia przyjęć (bez anulowanych)', test: r => !r.p.cancelled },
    { key: 'cancelled', label: 'Anulowane', tip: 'Dostawy anulowane — numery wróciły do puli', test: r => r.p.cancelled },
  ]
  const counts = Object.fromEntries(VIEWS.map(v => [v.key, rows.filter(v.test).length])) as Record<View, number>

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    let list = rows.filter(VIEWS.find(v => v.key === view)!.test)
    if (dostawca) list = list.filter(r => r.supplier === dostawca)
    if (mats.length) list = list.filter(r => r.p.materials.some(m => mats.includes(m)))
    if (miesiac) list = list.filter(r => r.p.date.startsWith(miesiac))
    if (termin) list = list.filter(r => { const d = dniDo(r.p.nearestExpiry); return d !== null && r.p.stan === 'w_obiegu' && (termin === 'over' ? d < 0 : d >= 0 && d <= 2) })
    if (t) list = list.filter(r => [r.p.no, r.supplier, r.p.hdiNo, r.p.documentNo, r.p.notes, ...r.p.numery.flatMap(x => [x.no, x.material, x.supplierBatchNo, ...x.supplierBatches.map(b => b.no)])].join(' ').toLowerCase().includes(t))
    const byDate = (a: Row, b: Row) => b.p.date.localeCompare(a.p.date) || b.p.seq - a.p.seq
    if (!sort) return [...list].sort(byDate)
    const d = sort.dir
    return [...list].sort((a, b) => {
      switch (sort.col) {
        case 'no': return d * (a.p.period.localeCompare(b.p.period) || a.p.seq - b.p.seq)
        case 'date': return -d * byDate(a, b)
        case 'supplier': return d * a.supplier.localeCompare(b.supplier, 'pl')
        case 'kg': return d * (a.p.kgReceived - b.p.kgReceived)
        case 'left': return d * (a.p.kgLeft - b.p.kgLeft)
        case 'expiry': return d * ((a.p.nearestExpiry || '9').localeCompare(b.p.nearestExpiry || '9'))
      }
    })
  }, [rows, view, q, dostawca, mats, miesiac, termin, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', rows: visible }]
    const keyOf = (r: Row) => groupBy === 'day' ? r.p.date : groupBy === 'month' ? r.p.date.slice(0, 7) : r.supplier
    const labelOf = (k: string) => groupBy === 'day' ? (k === dzis ? `Dziś · ${fmtDate(dataZApi(k))}` : fmtDate(dataZApi(k))) : groupBy === 'month' ? nazwaMiesiaca(k) : k
    const m = new Map<string, Row[]>()
    visible.forEach(r => m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]))
    return [...m.entries()].map(([k, rs]) => ({ key: k, label: labelOf(k), rows: rs }))
  }, [visible, groupBy, dzis])
  const flat = useMemo(() => groups.flatMap(g => collapsed.has(g.key) ? [] : g.rows), [groups, collapsed])
  const selRow = rows.find(r => r.p.id === sel) ?? null
  useEffect(() => { if (sel && recRes.data && !rows.some(r => r.p.id === sel)) setSel(null) }, [rows, sel, recRes.data])

  const select = (id: string | null) => {
    setSel(id)
    if (id) requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const onListKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex(r => r.p.id === sel)
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = flat[Math.min(flat.length - 1, i + 1)]; if (r) select(r.p.id) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const r = flat[Math.max(0, i - 1)]; if (r) select(r.p.id) }
  }
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-wrap, .overlay')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.altKey && !e.ctrlKey && /^[1-4]$/.test(e.key) && sel) { e.preventDefault(); setTab(TABS[Number(e.key) - 1].key) }
      else if (e.key === 'Escape' && sel) setSel(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, sel])

  const tot = visible.reduce((a, r) => ({ kg: a.kg + r.p.kgReceived, left: a.left + r.p.kgLeft, cont: a.cont + r.p.containers }), { kg: 0, left: 0, cont: 0 })
  useEffect(() => {
    if (!active) return
    setCtx(<><span>Widoczne <b>{visible.length}</b> dostaw · przyjęto <b>{kg(tot.kg)}</b> · na stanie <b>{kg(tot.left)}</b></span>
      {recRes.error && <span className="crit-ink">Błąd pobierania: {recRes.error}</span>}</>)
  }, [active, visible.length, tot.kg, tot.left, recRes.error, setCtx])

  const sp = selRow?.p
  const faza = (t: string) => app.toast({ kind: 'info', title: t, detail: FAZA_ZAPISU })
  const cmds = useMemo<Cmd[]>(() => [
    { id: 'new', group: 1, label: 'Nowe przyjęcie', icon: <PackagePlus size={17} />, kbd: 'Ctrl+N', primary: true, run: () => faza('Nowe przyjęcie') },
    { id: 'edit', group: 2, label: 'Edytuj', icon: <Pencil size={17} />, kbd: 'F2', disabled: !sp || sp.cancelled, run: () => faza('Edycja przyjęcia') },
    { id: 'haccp', group: 2, label: 'Kontrola HACCP', icon: <ClipboardCheck size={17} />, disabled: !sp || sp.cancelled, run: () => setTab('haccp') },
    { id: 'tags', group: 3, label: 'Zawieszki palet', icon: <Tag size={17} />, opt: true, disabled: !sp, run: () => app.toast({ kind: 'warn', title: 'Zawieszki palet', detail: BEZ_DRUKU_ETYKIET }) },
    { id: 'cancel', group: 9, label: 'Anuluj przyjęcie…', icon: <Ban size={15} />, menuOnly: true, danger: true, disabled: !sp || sp.cancelled, run: () => faza('Anulowanie przyjęcia') },
  ], [sp, app]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])

  const thSort = (col: SortCol, label: string, cls = '') => {
    const on = sort?.col === col
    return <th className={`sortable ${cls}`} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
      onClick={() => setSort(s => s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 })}>
      {label}<span className="sort">{on ? (sort!.dir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</span></th>
  }
  const supOpts = useMemo(() => { const m = new Map<string, number>(); rows.forEach(r => m.set(r.supplier, (m.get(r.supplier) ?? 0) + 1)); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl')) }, [rows])
  const matOpts = useMemo(() => [...new Set(rows.flatMap(r => r.p.materials))].sort((a, b) => a.localeCompare(b, 'pl')), [rows])
  const monthOpts = useMemo(() => [...new Set(rows.map(r => r.p.date.slice(0, 7)).filter(Boolean))].sort().reverse(), [rows])
  const anyFilter = !!(q || dostawca || mats.length || miesiac || termin)
  const COLS = 12

  return (
    <>
      <CommandBar title="Przyjęcia surowca" count={`${counts.live} w obiegu · ${kg(rows.reduce((a, r) => a + r.p.kgLeft, 0))} na stanie`} cmds={cmds} />
      <div className="toolbar" role="toolbar" aria-label="Widoki i filtry">
        <div className="seg" role="group" aria-label="Widoki przyjęć">
          {VIEWS.map(v => (
            <button key={v.key} aria-pressed={view === v.key} data-tip={v.tip} onClick={() => setView(v.key)}>
              {v.label}<span className={`count${v.key === 'nohaccp' && counts[v.key] ? ' crit' : ''}`}>{counts[v.key]}</span>
            </button>
          ))}
        </div>
        <span className="vsep" />
        <div className="field-wrap search">
          <Search size={15} />
          <input ref={searchRef} className="field" placeholder="Nr przyjęcia, nr porządkowy, partia dostawcy, HDI…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj przyjęć" />
          {!q && <span className="kbd">Ctrl F</span>}
        </div>
        <select className={`field chip-select${dostawca ? ' on' : ''}`} value={dostawca} onChange={e => setDostawca(e.target.value)} aria-label="Dostawca">
          <option value="">Dostawca: wszyscy</option>
          {supOpts.map(([k, c]) => <option key={k} value={k}>{k} ({c})</option>)}
        </select>
        <button className={`chip${mats.length ? ' on' : ''}`} onClick={matMenu.open}>
          Surowiec{mats.length ? `: ${mats.length === 1 ? mats[0] : mats.length}` : ''}
          {mats.length ? <span className="x" role="button" aria-label="Wyczyść filtr surowca" onClick={e => { e.stopPropagation(); setMats([]) }}><X size={13} /></span> : <ChevronDown size={14} />}
        </button>
        <button className={`chip${miesiac ? ' on' : ''}`} onClick={monthMenu.open}>
          Miesiąc{miesiac ? `: ${nazwaMiesiaca(miesiac)}` : ''}
          {miesiac ? <span className="x" role="button" aria-label="Wyczyść filtr miesiąca" onClick={e => { e.stopPropagation(); setMiesiac('') }}><X size={13} /></span> : <ChevronDown size={14} />}
        </button>
        <button className={`chip${termin ? ' on' : ''}`} onClick={terminMenu.open}>
          Termin{termin ? `: ${termin === 'over' ? 'po terminie' : '≤ 2 dni'}` : ''}
          {termin ? <span className="x" role="button" aria-label="Wyczyść filtr terminu" onClick={e => { e.stopPropagation(); setTermin('') }}><X size={13} /></span> : <ChevronDown size={14} />}
        </button>
        {anyFilter && <button className="btn sm ghost" onClick={() => { setQ(''); setDostawca(''); setMats([]); setMiesiac(''); setTermin('') }}>Wyczyść filtry</button>}
        <span className="grow" />
        <button className="btn sm ghost" onClick={groupMenu.open}><Rows3 size={15} />Grupuj: {{ day: 'dzień', month: 'miesiąc', supplier: 'dostawca', none: 'brak' }[groupBy]}<ChevronDown size={14} /></button>
      </div>

      <div className={`workarea${dock.side ? ' side' : ''}`} ref={workRef}>
        <div className="list-pane" style={dock.listStyle(!!selRow, maxed)}>
          <div className="tbl-wrap" ref={listRef} tabIndex={0} onKeyDown={onListKey} aria-label="Lista przyjęć">
            <table className="tbl" role="grid">
              <thead><tr>
                <th className="al"><span className="sr">Alert</span></th>
                {thSort('no', 'Przyjęcie')}
                {thSort('date', 'Data')}
                {thSort('supplier', 'Dostawca')}
                <th className="side-hide">Surowiec</th>
                <th className="hide-m">Numery</th>
                {thSort('kg', 'Przyjęto', 'num')}
                <th className="num hide-m opt-col" data-tip="Przyjęto − masa netto z dokumentu HDI">Różnica HDI</th>
                {thSort('left', 'Na stanie', 'num')}
                {thSort('expiry', 'Termin')}
                <th>HACCP</th>
                <th className="side-hide">Stan</th>
              </tr></thead>
              <tbody>
                {recRes.loading && !recRes.data && <tr><td colSpan={COLS}><div className="empty">Pobieranie przyjęć…</div></td></tr>}
                {recRes.data && flat.length === 0 && <tr><td colSpan={COLS}><div className="empty"><h3>Brak przyjęć w tym widoku</h3>{anyFilter ? 'Zmień lub wyczyść filtry.' : 'Zmień widok, np. „Wszystkie”.'}</div></td></tr>}
                {groups.map(g => {
                  const isCol = collapsed.has(g.key)
                  const gs = g.rows.reduce((a, r) => ({ kg: a.kg + r.p.kgReceived, left: a.left + r.p.kgLeft }), { kg: 0, left: 0 })
                  return (
                    <React.Fragment key={g.key}>
                      {g.label && <tr className="grp"><td colSpan={COLS}><span className="gwrap">
                        <button onClick={() => setCollapsed(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })} aria-expanded={!isCol}>{isCol ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{g.label}</button>
                        <span className="gmeta">{g.rows.length} {g.rows.length === 1 ? 'dostawa' : g.rows.length < 5 ? 'dostawy' : 'dostaw'} · przyjęto {kg(gs.kg)}</span>
                        {gs.left > 0 && <span className="gmeta accent-ink">na stanie {kg(gs.left)}</span>}
                      </span></td></tr>}
                      {!isCol && g.rows.map((r, i) => <PrzyjecieRow key={r.p.id} r={r} zebra={i % 2 === 1} sel={sel === r.p.id} onClick={() => select(r.p.id)} />)}
                    </React.Fragment>
                  )
                })}
              </tbody>
              {visible.length > 0 && <tfoot><tr>
                <td className="al" /><td colSpan={3}>Razem — {visible.length} {visible.length === 1 ? 'dostawa' : 'dostaw'}</td>
                <td className="side-hide" /><td className="hide-m" />
                <td className="num">{kg(tot.kg)}</td><td className="hide-m opt-col" /><td className="num">{kg(tot.left)}</td><td /><td /><td className="side-hide" />
              </tr></tfoot>}
            </table>
          </div>
        </div>
        {selRow && <>
          <div className={`splitter${dock.drag ? ' drag' : ''}`} role="separator" aria-orientation={dock.side ? 'vertical' : 'horizontal'}
            onMouseDown={e => { setMaxed(false); dock.startDrag(e) }} onDoubleClick={() => { dock.reset(); setMaxed(false) }} data-tip="Przeciągnij, aby zmienić rozmiar. Dwuklik — domyślnie." />
          <div className="dock" aria-label="Szczegóły przyjęcia">
            <PrzyjecieDetail r={selRow} tab={tab} onTab={setTab} maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setSel(null)} />
          </div>
        </>}
      </div>

      {matMenu.anchor && <Menu anchor={matMenu.anchor} onClose={matMenu.close} items={[{ header: 'Rodzaj surowca' }, ...matOpts.map(m => ({ label: m, checked: mats.includes(m), onSelect: () => setMats(a => a.includes(m) ? a.filter(x => x !== m) : [...a, m]) }))]} />}
      {monthMenu.anchor && <Menu anchor={monthMenu.anchor} onClose={monthMenu.close} items={[{ header: 'Miesiąc przyjęcia' }, ...monthOpts.map(m => ({ label: nazwaMiesiaca(m), checked: miesiac === m, onSelect: () => setMiesiac(miesiac === m ? '' : m) }))]} />}
      {terminMenu.anchor && <Menu anchor={terminMenu.anchor} onClose={terminMenu.close} items={[{ header: 'Termin przydatności (na stanie)' },
        { label: 'Kończy się (≤ 2 dni)', checked: termin === 'soon', onSelect: () => setTermin('soon') },
        { label: 'Po terminie', checked: termin === 'over', onSelect: () => setTermin('over') }]} />}
      {groupMenu.anchor && <Menu anchor={groupMenu.anchor} align="right" onClose={groupMenu.close} items={[{ header: 'Grupowanie listy' },
        { label: 'Według dnia', icon: <Layers size={15} />, checked: groupBy === 'day', onSelect: () => setGroupBy('day') },
        { label: 'Według miesiąca', icon: <Layers size={15} />, checked: groupBy === 'month', onSelect: () => setGroupBy('month') },
        { label: 'Według dostawcy', icon: <Layers size={15} />, checked: groupBy === 'supplier', onSelect: () => setGroupBy('supplier') },
        { label: 'Bez grupowania', icon: <Rows3 size={15} />, checked: groupBy === 'none', onSelect: () => setGroupBy('none') }]} />}
    </>
  )
}

function HaccpTag({ h }: { h: StanHaccp | null }) {
  if (!h) return <span className="faint" data-tip="Dostawa sprzed kontroli HACCP w systemie albo starsza niż 180 dni — karta papierowa">—</span>
  if (h.ponadProg) return <span className="tag crit">Temp.!</span>
  if (h.status === 'komplet') return <span className={`tag ${h.niezgodnosc ? 'warn' : 'ok'}`}>{h.niezgodnosc ? 'Niezgodność' : 'Komplet'}</span>
  return <span className="tag warn">{h.status === 'brak' ? 'Brak' : 'Niepełne'}</span>
}

const PrzyjecieRow = React.memo(function PrzyjecieRow({ r, zebra, sel, onClick }: { r: Row; zebra: boolean; sel: boolean; onClick: () => void }) {
  const { p } = r
  const dd = dniDo(p.nearestExpiry)
  const rk = roznicaKg(p)
  const usedPct = p.kgReceived > 0 ? Math.min(100, (1 - p.kgLeft / p.kgReceived) * 100) : 100
  return (
    <tr data-id={p.id} className={`row${zebra ? ' zebra' : ''}${sel ? ' sel' : ''}${p.cancelled ? ' closed' : ''}`} aria-selected={sel} onClick={onClick}>
      <td className="al">{r.level && <span className={`alert-ico ${r.level}`} data-tip={r.flags.join('\n')}><FlagIcon level={r.level} /></span>}</td>
      <td><span className="no">{p.no || '—'}</span>{p.isService && <span className="tag outline" style={{ marginLeft: 6 }}>usługa</span>}</td>
      <td className="num">{fmtDate(dataZApi(p.date))}</td>
      <td className="ell" style={{ maxWidth: 200 }} title={p.supplierName}>{r.supplier}</td>
      <td className="ell side-hide" style={{ maxWidth: 220 }}>{p.materials.join(', ')}</td>
      <td className="code hide-m ell" style={{ maxWidth: 160 }}>{p.numery.map(x => x.no).join(', ')}</td>
      <td className="num strong">{kg(p.kgReceived)}</td>
      <td className="num hide-m opt-col">{rk === null ? <span className="faint">—</span> : Math.abs(rk) < 1 ? <span className="ok-ink">zgodne</span> : <span className="warn-ink strong">{rk > 0 ? '+' : ''}{num(rk)}</span>}</td>
      <td className="num">{p.stan === 'w_obiegu'
        ? <span className="meter cov-part" style={{ justifyContent: 'flex-end' }} data-tip={`Zużyto ${Math.round(usedPct)}% dostawy`}><b>{kg(p.kgLeft)}</b></span>
        : <span className="faint">{p.cancelled ? 'anulowana' : '0 kg'}</span>}</td>
      <td>{p.stan === 'w_obiegu' && p.nearestExpiry
        ? <span className={`due${dd !== null && dd < 0 ? ' over' : dd !== null && dd <= 2 ? ' today' : ''}`}><span className="rel num">{fmtDate(dataZApi(p.nearestExpiry)).slice(0, 5)}</span><span className="abs">{dd === null ? '' : dd < 0 ? `${-dd} dni po` : dd === 0 ? 'dziś' : `za ${dd} d.`}</span></span>
        : <span className="faint">—</span>}</td>
      <td><HaccpTag h={r.h} /></td>
      <td className="side-hide">{p.cancelled ? <span className="tag outline">Anulowana</span> : p.stan === 'w_obiegu' ? <span className="tag info">W obiegu</span> : <span className="tag ok">Rozliczona</span>}</td>
    </tr>
  )
})

const STAN_NUMERU: Record<string, string> = { awaiting: 'Czeka', in_progress: 'W toku', processed: 'Zużyta', cancelled: 'Anulowana' }

function PrzyjecieDetail({ r, tab, onTab, maxed, onMax, onClose }: { r: Row; tab: Tab; onTab: (t: Tab) => void; maxed: boolean; onMax: () => void; onClose: () => void }) {
  const app = useApp()
  const { p, h } = r
  const rk = roznicaKg(p)
  const c = h?.check
  const progi = [...new Set(p.numery.map(x => progPrzyjecia(x.category, x.storage).opis))]
  const sbAll = p.numery.flatMap(x => x.supplierBatches.map(b => ({ ...b, numer: x.no })))
  return (
    <>
      <div className="dock-head">
        <div className="dock-id">
          <div className="l1"><h2>Przyjęcie {p.no || '—'}</h2>
            {p.cancelled ? <span className="tag outline">Anulowana</span> : p.stan === 'w_obiegu' ? <span className="tag info">W obiegu</span> : <span className="tag ok">Rozliczona</span>}
            {r.flags.slice(0, 2).map(f => <span key={f} className={`tag ${r.level === 'crit' ? 'crit' : 'warn'}`}>{f}</span>)}
          </div>
          <div className="l2"><b style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{r.supplier}</b> · {fmtDate(dataZApi(p.date))}{p.hdiNo && <> · HDI {p.hdiNo}</>}{p.documentNo && <> · dok. {p.documentNo}</>}</div>
        </div>
        <div className="dock-figs" aria-label="Kluczowe liczby">
          <div className="f"><span className="k">Przyjęto</span><span className="v">{kg(p.kgReceived)}<small>{num(p.containers)} poj.</small></span></div>
          <div className="f"><span className="k">Wg HDI</span><span className="v">{p.docKg ? kg(p.docKg) : '—'}{rk !== null && <small className={Math.abs(rk) < 1 ? 'ok-ink' : 'warn-ink'}>{Math.abs(rk) < 1 ? 'zgodne' : `${rk > 0 ? '+' : ''}${num(rk)} kg`}</small>}</span></div>
          <div className="f"><span className="k">Na stanie</span><span className="v">{kg(p.kgLeft)}</span></div>
          <div className="f"><span className="k">HACCP</span><span className="v"><HaccpTag h={h} /></span></div>
        </div>
        <div className="dock-actions">
          <button className="btn ghost icon" onClick={() => app.setPanel(app.panel === 'bok' ? 'dol' : 'bok')} aria-label={app.panel === 'bok' ? 'Panel na dole' : 'Panel z boku'} data-tip={app.panel === 'bok' ? 'Przenieś panel na dół' : 'Przenieś panel na bok'}>{app.panel === 'bok' ? <PanelBottom size={16} /> : <PanelRight size={16} />}</button>
          <button className="btn ghost icon" onClick={onMax} aria-label={maxed ? 'Przywróć panel' : 'Powiększ panel'} data-tip={maxed ? 'Przywróć' : 'Powiększ panel'}>{maxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn ghost icon" onClick={onClose} aria-label="Zamknij panel (Esc)" data-tip="Zamknij panel (Esc)"><X size={17} /></button>
        </div>
      </div>
      <div className="dock-tabs" role="tablist">
        {TABS.map((t, i) => <button key={t.key} role="tab" className="dock-tab" aria-selected={tab === t.key} onClick={() => onTab(t.key)} data-tip={`Alt+${i + 1}`}>
          {t.label}{t.key === 'numbers' && <span className="badge">{p.numery.length}</span>}{t.key === 'supplier' && <span className="badge">{sbAll.length}</span>}
          {t.key === 'haccp' && h && h.status !== 'komplet' && <span className="badge warn">!</span>}
        </button>)}
      </div>
      <div className="dock-body" role="tabpanel">
        <div className="dock-pad">
          {tab === 'overview' && <>
            {r.flags.map(f => <div key={f} className={`note ${r.level === 'crit' && /termin|Temp/i.test(f) ? 'crit' : 'warn'}`}><FlagIcon level={r.level === 'crit' && /termin|Temp/i.test(f) ? 'crit' : 'warn'} size={15} /><div>{f}</div></div>)}
            <div className="ov-grid">
              <div className="box ov-card"><h4><FileText size={16} />Dokument</h4><dl className="kv">
                <dt>Numer przyjęcia</dt><dd className="strong">{p.no || '—'}</dd>
                <dt>Data</dt><dd className="num">{fmtDate(dataZApi(p.date))}</dd>
                <dt>Dostawca</dt><dd>{p.supplierName}</dd>
                <dt>HDI</dt><dd className="num">{p.hdiNo || '—'}{p.docKg ? ` · ${kg(p.docKg)}` : ''}{p.docContainers ? ` · ${num(p.docContainers)} poj.` : ''}</dd>
                <dt>Dokument</dt><dd>{p.documentNo || '—'}</dd>
              </dl></div>
              <div className="box ov-card"><h4><Layers size={16} />Surowiec</h4><dl className="kv">
                {p.numery.map(x => <React.Fragment key={x.id}><dt className="code">nr {x.no}</dt><dd>{x.material} · {kg(x.kgReceived)} · {STAN_NUMERU[x.stan] ?? x.stan}</dd></React.Fragment>)}
              </dl></div>
              <div className="box ov-card ov-notes"><h4><Thermometer size={16} />Kontrola przy aucie</h4>
                {c ? <dl className="kv">
                  <dt>Temp. mięsa</dt><dd className={h?.ponadProg ? 'crit-ink strong' : ''}>{c.tempMeat ?? '—'} °C</dd>
                  <dt>Temp. komory</dt><dd>{c.tempChamber ?? '—'} °C</dd>
                  <dt>Próg</dt><dd>{progi.join(', ')}</dd>
                  <dt>Kwalifikacja</dt><dd>{c.verdict === 'K' ? 'przyjęta' : c.verdict === 'N' ? 'odmowa' : '—'}</dd>
                </dl> : <p className="muted">{h ? 'Brak wpisu kontroli HACCP dla tej dostawy.' : `Kontrola starsza niż ${DNI_HACCP} dni — sprawdź kartę 1.1.1 w starym MES.`}</p>}
                {p.notes && <p style={{ marginTop: 8 }}>{p.notes}</p>}
              </div>
            </div>
          </>}

          {tab === 'numbers' && <div className="box"><table className="tbl">
            <thead><tr><th>Nr</th><th>Surowiec</th><th className="num">Przyjęto</th><th className="num">Na stanie</th><th className="num hide-s">Rezerwacja</th><th>Stan</th><th className="num hide-m">Pojemniki</th><th className="num hide-m">Palety</th><th>Ubój</th><th>Ważność</th></tr></thead>
            <tbody>{p.numery.map((x, i) => {
              const dd = dniDo(x.expiryDate)
              return <tr key={x.id} className={`row${i % 2 ? ' zebra' : ''}`}>
                <td className="code strong">{x.no}</td>
                <td>{x.material}<span className="sub">{x.requiresDeboning ? 'na rozbiór' : 'magazyn mięsa'}{x.storage === 'mrozony' ? ' · mrożony' : ''}</span></td>
                <td className="num">{kg(x.kgReceived)}</td>
                <td className="num strong">{x.stan === 'cancelled' ? '—' : kg(x.kgLeft)}</td>
                <td className="num hide-s">{x.kgReserved > 0 ? kg(x.kgReserved) : <span className="faint">—</span>}</td>
                <td>{STAN_NUMERU[x.stan] ?? x.stan}</td>
                <td className="num hide-m">{x.containers ? `${num(x.containers)}${x.containerKg ? ` × ${num(x.containerKg)} kg` : ''}` : '—'}</td>
                <td className="num hide-m">{x.palletsH1 + x.palletsOther || '—'}</td>
                <td className="num">{fmtDate(dataZApi(x.slaughterDate))}</td>
                <td className={`num${(x.stan === 'awaiting' || x.stan === 'in_progress') && dd !== null && dd < 0 ? ' crit-ink strong' : ''}`}>{fmtDate(dataZApi(x.expiryDate))}</td>
              </tr>
            })}</tbody>
          </table></div>}

          {tab === 'supplier' && (sbAll.length === 0 ? <div className="note">Dostawa bez rozpisanych partii dostawcy.</div> : <div className="box"><table className="tbl">
            <thead><tr><th>Partia dostawcy</th><th>Nr porządkowy</th><th className="num">Masa</th><th>Ubój</th><th>Ważność</th></tr></thead>
            <tbody>{sbAll.map((b, i) => <tr key={`${b.numer}-${b.no}-${i}`} className={`row${i % 2 ? ' zebra' : ''}`}>
              <td className="code strong">{b.no}</td><td className="code">{b.numer}</td>
              <td className="num">{b.kg === null ? <span className="faint" data-tip="Partia odtworzona z dawnych danych — kg nie zapisywano">—</span> : kg(b.kg)}</td>
              <td className="num">{fmtDate(dataZApi(b.slaughter))}</td><td className="num">{fmtDate(dataZApi(b.expiry))}</td>
            </tr>)}</tbody>
          </table></div>)}

          {tab === 'haccp' && <>
            {!c ? <div className="note warn"><FlagIcon level="warn" size={15} /><div>{h ? 'Brak wpisu kontroli HACCP (karta 1.1.1). Uzupełnienie — w starym MES; w PROTRIMA w fazie 3.' : `Dostawa starsza niż ${DNI_HACCP} dni — kontrola nie jest tu pobierana.`}</div></div> : <div className="box"><dl className="kv" style={{ padding: 14 }}>
              <dt>Ocena wizualna, mycie pojazdu</dt><dd>{c.visual === 'bz' ? 'bez zastrzeżeń' : c.visual === 'N' ? <b className="crit-ink">niezgodność</b> : '—'}</dd>
              <dt>Temperatura komory</dt><dd>{c.tempChamber ?? '—'} °C</dd>
              <dt>Temperatura mięsa</dt><dd className={h?.ponadProg ? 'crit-ink strong' : ''}>{c.tempMeat ?? '—'} °C <span className="muted">(próg {progi.join(', ')})</span></dd>
              <dt>Zgodność kg z dokumentami</dt><dd>{c.kgMatch === 'bz' ? 'zgodne' : c.kgMatch === 'N' ? <b className="crit-ink">niezgodne</b> : '—'}</dd>
              <dt>Kwalifikacja</dt><dd>{c.verdict === 'K' ? 'dostawa przyjęta' : c.verdict === 'N' ? <b className="crit-ink">odmowa przyjęcia</b> : '—'}</dd>
              {c.notes && <><dt>Uwagi</dt><dd>{c.notes}</dd></>}
              {(c.ncDescription || c.ncAction) && <><dt>Niezgodność</dt><dd>{c.ncDescription}{c.ncAction && <> — działanie: {c.ncAction}</>}</dd></>}
            </dl></div>}
            <div className="row-wrap"><button className="btn" disabled={p.cancelled} onClick={() => app.toast({ kind: 'info', title: 'Kontrola HACCP', detail: FAZA_ZAPISU })}><ClipboardCheck size={15} />{c ? 'Popraw kontrolę' : 'Wypełnij kontrolę'}</button></div>
          </>}
        </div>
      </div>
    </>
  )
}
