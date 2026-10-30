import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Upload, Search, ChevronDown, ChevronRight, ArrowUp, ArrowDown, MoreHorizontal, X, Layers, Printer, FileSpreadsheet,
  ClipboardList, ExternalLink, Pencil, Boxes, FileText, Copy, Ban, Split, Rows3, Calculator,
} from 'lucide-react'
import { useApp, Menu, useMenu, Dialog, CommandBar, type Cmd, type ViewKey, type DetailTab, type OrdersCmd, type MenuItem } from '../../shell/context'
import { useOrders } from '../../data/store'
import {
  computeMetrics, isClosed, kg, num, relDay, fmtDay, BUCKET_LABEL, mixingByRecipe, weekday, DOC_NAME,
  type Bucket, type Metrics, type Order,
} from '../../data/model'
import { FlagIcon, OrderStatusLabel } from '../../ui/Glyphs'
import { CoverMeter, ProdMeter } from '../../ui/Meters'
import { OrderDetail, orderCommands, useConfirmOrder } from './OrderDetail'
import { FAZA_ZAPISU } from '../../proba'
import { useDock } from '../../shell/useDock'

type Row = { o: Order; m: Metrics }
type SortCol = 'no' | 'client' | 'due' | 'status' | 'kg' | 'prod' | 'cover' | 'missing' | 'pallets'
type GroupBy = 'due' | 'client' | 'none'

const VIEWS: Array<{ key: ViewKey; label: string; tip: string; test: (r: Row) => boolean }> = [
  { key: 'active', label: 'Aktywne', tip: 'Wszystkie niezamknięte zamówienia', test: r => !isClosed(r.o) },
  { key: 'urgent', label: 'Pilne', tip: 'Zaległe oraz z terminem dziś i jutro', test: r => !isClosed(r.o) && ['overdue', 'today', 'tomorrow'].includes(r.m.bucket) },
  { key: 'risk', label: 'Z problemem', tip: 'Zaległe, zagrożone terminem, brak surowca lub nierozpisane palety', test: r => !isClosed(r.o) && (r.m.level === 'crit' || r.m.level === 'warn') },
  { key: 'ready', label: 'Gotowe do wysyłki', tip: 'Cały wyrób jest w magazynie lub wydany — brak 0 kg', test: r => !isClosed(r.o) && r.o.status !== 'draft' && r.m.missingKg === 0 },
  { key: 'drafts', label: 'Szkice', tip: 'Niepotwierdzone — nie trafiają do planowania', test: r => r.o.status === 'draft' },
  { key: 'closed', label: 'Zamknięte', tip: 'Zrealizowane i anulowane', test: r => isClosed(r.o) },
]
const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate', 'closed']
const ALL_TABS: DetailTab[] = ['overview', 'lines', 'production', 'coverage', 'pallets', 'shipping', 'documents', 'history']


export function OrdersModule({ cmd, active, setCtx, setCmds }: { cmd: OrdersCmd; active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { orders } = useOrders()
  const confirmOrder = useConfirmOrder()
  const rows = useMemo<Row[]>(() => orders.map(o => ({ o, m: computeMetrics(o) })), [orders])

  const [view, setView] = useState<ViewKey>('active')
  const [bucket, setBucket] = useState<Bucket | null>(null)
  const [q, setQ] = useState('')
  const [clients, setClients] = useState<string[]>([])
  const [recipes, setRecipes] = useState<string[]>([])
  // Domyślnie płaska lista (uwaga właściciela 30.10.2026); grupowanie z przycisku „Grupuj”.
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<DetailTab>('overview')
  const [maxed, setMaxed] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<string | null>(null)

  // Polecenia z Pulpitu i palety poleceń
  useEffect(() => {
    if (!cmd.n) return
    if (cmd.view) setView(cmd.view)
    setBucket((cmd.bucket as Bucket) ?? null)
    if (cmd.bucket) { setQ(''); setClients([]); setRecipes([]) }
    if (cmd.select) { setSel(cmd.select); setQ(''); setClients([]); setRecipes([]); setBucket(null) }
    if (cmd.tab) setTab(cmd.tab)
  }, [cmd])

  const counts = useMemo(() => Object.fromEntries(VIEWS.map(v => [v.key, rows.filter(v.test).length])), [rows])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    const vt = VIEWS.find(v => v.key === view)!.test
    let list = rows.filter(vt)
    if (bucket) list = list.filter(r => r.m.bucket === bucket)
    if (clients.length) list = list.filter(r => clients.includes(r.o.client.id))
    if (recipes.length) list = list.filter(r => r.o.lines.some(l => recipes.includes(l.recipe)))
    if (t) list = list.filter(r => [r.o.no, r.o.client.name, r.o.client.city, r.o.notes ?? '', ...r.o.lines.map(l => `${l.recipe} ${l.product} ${l.kgPerUnit} kg`)].join(' ').toLowerCase().includes(t))
    const dueKey = (r: Row) => (r.o.delivery?.getTime() ?? 9e15) + (r.o.deliveryTime ? Number(r.o.deliveryTime.replace(':', '')) : 0)
    const cmp = (a: Row, b: Row) => {
      if (!sort) return view === 'closed' ? dueKey(b) - dueKey(a) : dueKey(a) - dueKey(b) || a.o.no.localeCompare(b.o.no)
      const d = sort.dir
      switch (sort.col) {
        case 'no': return d * a.o.no.localeCompare(b.o.no)
        case 'client': return d * a.o.client.name.localeCompare(b.o.client.name)
        case 'due': return d * (dueKey(a) - dueKey(b))
        case 'status': return d * a.o.status.localeCompare(b.o.status)
        case 'kg': return d * (a.m.orderedKg - b.m.orderedKg)
        case 'prod': return d * (a.m.prodPct - b.m.prodPct)
        case 'cover': return d * (a.m.coverPct - b.m.coverPct)
        case 'missing': return d * (a.m.missingKg - b.m.missingKg)
        case 'pallets': return d * (a.m.palletsTotal - b.m.palletsTotal)
      }
    }
    return [...list].sort(cmp)
  }, [rows, view, bucket, clients, recipes, q, sort])

  const groups = useMemo(() => {
    if (groupBy === 'none' || view === 'closed') return [{ key: 'all', label: '', rows: visible }]
    if (groupBy === 'client') {
      const m = new Map<string, Row[]>()
      visible.forEach(r => m.set(r.o.client.name, [...(m.get(r.o.client.name) ?? []), r]))
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => ({ key: k, label: k, rows: rs }))
    }
    return BUCKET_ORDER.map(b => ({ key: b, label: BUCKET_LABEL[b], rows: visible.filter(r => r.m.bucket === b) })).filter(g => g.rows.length)
  }, [visible, groupBy, view])

  const flat = useMemo(() => groups.flatMap(g => collapsed.has(g.key) ? [] : g.rows), [groups, collapsed])
  const selRow = rows.find(r => r.o.id === sel) ?? null

  // Zaznaczenie poza widokiem nie znika, ale panel pokazuje tylko istniejące
  useEffect(() => { if (sel && !rows.some(r => r.o.id === sel)) setSel(null) }, [rows, sel])

  // Pasek stanu
  const checkedRows = rows.filter(r => checked.has(r.o.id))
  useEffect(() => {
    if (!active) return
    const sum = (xs: Row[], f: (m: Metrics) => number) => xs.reduce((a, r) => a + f(r.m), 0)
    setCtx(<>
      {checkedRows.length > 0
        ? <span>Zaznaczono <b>{checkedRows.length}</b> · <b>{kg(sum(checkedRows, m => m.orderedKg))}</b> · brak <b className="crit-ink">{kg(sum(checkedRows, m => m.missingKg))}</b></span>
        : <span>Widoczne <b>{visible.length}</b> z {rows.length} · <b>{kg(sum(visible, m => m.orderedKg))}</b> · brak <b>{kg(sum(visible, m => m.missingKg))}</b></span>}
      <span className="hint hide-m"><span className="kbd">↑</span><span className="kbd">↓</span> wybór <span className="kbd">Spacja</span> zaznacz <span className="kbd">Enter</span> otwórz w karcie <span className="kbd">Alt+1…8</span> zakładki</span>
    </>)
  }, [active, checkedRows.length, visible, rows.length, setCtx]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Wybór i zaznaczanie ────────────────────────────────────────────────
  const select = useCallback((id: string | null) => {
    setSel(id)
    if (id) requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }, [])
  const toggleCheck = (id: string) => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchorRef.current) {
      const a = flat.findIndex(r => r.o.id === anchorRef.current), b = flat.findIndex(r => r.o.id === id)
      const [x, y] = a < b ? [a, b] : [b, a]
      setChecked(s => { const n = new Set(s); flat.slice(x, y + 1).forEach(r => n.add(r.o.id)); return n })
    } else if (e.ctrlKey || e.metaKey) {
      toggleCheck(id); anchorRef.current = id
    } else { anchorRef.current = id }
    select(id)
  }
  const allChecked = flat.length > 0 && flat.every(r => checked.has(r.o.id))
  const someChecked = flat.some(r => checked.has(r.o.id))

  const onListKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex(r => r.o.id === sel)
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = flat[Math.min(flat.length - 1, i + 1)]; if (r) select(r.o.id) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const r = flat[Math.max(0, i - 1)]; if (r) select(r.o.id) }
    else if (e.key === 'Home') { e.preventDefault(); if (flat[0]) select(flat[0].o.id) }
    else if (e.key === 'End') { e.preventDefault(); if (flat.length) select(flat[flat.length - 1].o.id) }
    else if (e.key === ' ' && sel) { e.preventDefault(); toggleCheck(sel) }
    else if (e.key === 'Enter' && sel) { e.preventDefault(); app.openOrder(sel) }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setChecked(new Set(flat.map(r => r.o.id))) }
    else if (e.key === 'F2' && sel) { e.preventDefault(); setTab('lines') }
  }

  // Skróty modułu
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-wrap, .overlay')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.altKey && /^[1-8]$/.test(e.key) && sel) { e.preventDefault(); setTab(ALL_TABS[Number(e.key) - 1]) }
      else if (e.key === 'Escape') {
        if (document.activeElement === searchRef.current && q) { setQ(''); return }
        if (checked.size) setChecked(new Set())
        else if (sel) setSel(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, sel, q, checked.size])

  // ─── Rozdzielacz listy i panelu (na dole albo z boku) ───────────────────
  const dock = useDock(workRef, 'zamowienia')
  const startDrag = (e: React.MouseEvent) => { setMaxed(false); dock.startDrag(e) }

  // ─── Filtry: menu ───────────────────────────────────────────────────────
  const clientMenu = useMenu(), recipeMenu = useMenu(), groupMenu = useMenu(), rowMenu = useMenu()
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const clientOpts = useMemo(() => [...new Map(rows.map(r => [r.o.client.id, r.o.client])).values()].sort((a, b) => a.name.localeCompare(b.name)), [rows])
  const recipeOpts = useMemo(() => [...new Set(rows.flatMap(r => r.o.lines.map(l => l.recipe)))].sort(), [rows])
  const toggleIn = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
  const anyFilter = !!(q || clients.length || recipes.length || bucket)

  const rowActions = (id: string): MenuItem[] => {
    const r = rows.find(x => x.o.id === id)!
    return [
      { header: r.o.no },
      { label: 'Otwórz w osobnej karcie', icon: <ExternalLink size={15} />, kbd: 'Enter', onSelect: () => app.openOrder(id) },
      { label: 'Edytuj pozycje', icon: <Pencil size={15} />, kbd: 'F2', onSelect: () => { select(id); setTab('lines') } },
      { label: 'Palety i kartony', icon: <Boxes size={15} />, onSelect: () => { select(id); setTab('pallets') } },
      { label: 'Dokumenty', icon: <FileText size={15} />, onSelect: () => { select(id); setTab('documents') } },
      { sep: true },
      { label: 'Podziel wysyłkę na fakturę i WZ', icon: <Split size={15} />, onSelect: () => app.toast({ kind: 'info', title: 'Podział wysyłki', detail: FAZA_ZAPISU }) },
      { label: 'Duplikuj jako nowe zamówienie', icon: <Copy size={15} />, onSelect: () => app.newOrder() },
      { sep: true },
      { label: 'Anuluj zamówienie…', icon: <Ban size={15} />, danger: true, onSelect: () => setCancelId(id) },
    ]
  }

  const thSort = (col: SortCol, label: React.ReactNode, cls = '', tip?: string) => {
    const on = sort?.col === col
    return (
      <th className={`sortable ${cls}`} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined} data-tip={tip}
        onClick={() => setSort(s => s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 })}>
        {label}<span className="sort">{on ? (sort!.dir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</span>
      </th>
    )
  }

  const COLS = 14
  const hasDock = !!selRow

  // ─── Pasek narzędzi: te same polecenia trafiają do menu „Zamówienia" ────
  const selOrder = selRow?.o ?? null
  const cmds = useMemo<Cmd[]>(() => [
    { id: 'new', group: 1, label: 'Nowe zamówienie', icon: <Plus size={15} />, kbd: 'Ctrl+N', menuOnly: true, run: app.newOrder },
    { id: 'import', group: 1, label: 'Importuj z pliku CSV…', icon: <Upload size={15} />, menuOnly: true, run: () => app.toast({ kind: 'info', title: 'Import zamówień z pliku CSV', detail: FAZA_ZAPISU }) },
    ...orderCommands(selOrder, app, t => setTab(t), confirmOrder, selOrder ? () => setCancelId(selOrder.id) : undefined),
    { id: 'req', group: 5, label: 'Zapotrzebowanie', icon: <Calculator size={17} />, opt: true, tip: 'Zapotrzebowanie na masowanie — dla zaznaczonych albo wybranego', disabled: !checked.size && !selOrder, run: () => setReqOpen(true) },
    { id: 'export', group: 5, label: 'Eksport do Excela', icon: <FileSpreadsheet size={15} />, menuOnly: true, tip: 'Eksport widocznych wierszy do Excela', run: () => app.toast({ kind: 'info', title: 'Eksport do Excela', detail: 'Eksport dojdzie po próbie wyglądu. Teraz: stary MES.' }) },
  ], [app, selOrder, checked.size, confirmOrder])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])

  const tot = visible.reduce((a, r) => ({ kg: a.kg + r.m.orderedKg, prod: a.prod + r.m.producedKg, cov: a.cov + r.m.coveredKg, ship: a.ship + r.m.deliveredKg, miss: a.miss + (isClosed(r.o) ? 0 : r.m.missingKg), lines: a.lines + r.o.lines.length, pr: a.pr + r.m.palletsReady, pt: a.pt + r.m.palletsTotal }), { kg: 0, prod: 0, cov: 0, ship: 0, miss: 0, lines: 0, pr: 0, pt: 0 })

  return (
    <>
      <CommandBar title="Zamówienia" count={`${counts.active} aktywnych`} cmds={cmds} />

      {checked.size > 0 ? (
        <div className="bulkbar" role="toolbar" aria-label="Działania dla zaznaczonych">
          <input type="checkbox" className="cbx" checked readOnly onClick={() => setChecked(new Set())} aria-label="Odznacz wszystkie" />
          <span className="cnt">Zaznaczono {checked.size} {checked.size === 1 ? 'zamówienie' : checked.size < 5 ? 'zamówienia' : 'zamówień'}<span>{kg(checkedRows.reduce((a, r) => a + r.m.orderedKg, 0))}</span></span>
          <button className="btn" onClick={() => setReqOpen(true)}><Calculator size={15} />Zapotrzebowanie na masowanie</button>
          <button className="btn" onClick={() => app.toast({ kind: 'info', title: 'Lista kompletacji', detail: FAZA_ZAPISU })}><ClipboardList size={15} />Lista kompletacji</button>
          <button className="btn" onClick={() => app.toast({ kind: 'info', title: 'Druk zaznaczonych', detail: FAZA_ZAPISU })}><Printer size={15} />Drukuj</button>
          <button className="btn hide-s" onClick={() => app.toast({ kind: 'info', title: 'Eksport do Excela', detail: 'Eksport dojdzie po próbie wyglądu. Teraz: stary MES.' })}><FileSpreadsheet size={15} />Eksportuj</button>
          <span className="grow" style={{ flex: 1 }} />
          <button className="btn ghost" onClick={() => setChecked(new Set())}>Odznacz<span className="kbd">Esc</span></button>
        </div>
      ) : (
        <div className="toolbar" role="toolbar" aria-label="Widoki i filtry">
          <div className="seg" role="group" aria-label="Widoki zamówień">
            {VIEWS.map(v => (
              <button key={v.key} aria-pressed={view === v.key} data-tip={v.tip} onClick={() => { setView(v.key); setBucket(null) }}>
                {v.label}<span className={`count${v.key === 'risk' && counts[v.key] ? ' crit' : ''}`}>{counts[v.key]}</span>
              </button>
            ))}
          </div>
          <span className="vsep" />
          <div className="field-wrap search">
            <Search size={15} />
            <input ref={searchRef} id="orders-search" className="field" placeholder="Numer, klient, receptura, gramatura…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj zamówień" />
            {!q && <span className="kbd">Ctrl F</span>}
          </div>
          <button className={`chip${clients.length ? ' on' : ''}`} onClick={clientMenu.open}>
            Klient{clients.length ? `: ${clients.length === 1 ? clientOpts.find(c => c.id === clients[0])?.name.split(' ')[0] : clients.length}` : ''}
            {clients.length ? <span className="x" role="button" aria-label="Wyczyść filtr klienta" onClick={e => { e.stopPropagation(); setClients([]) }}><X size={13} /></span> : <ChevronDown size={14} />}
          </button>
          <button className={`chip${recipes.length ? ' on' : ''}`} onClick={recipeMenu.open}>
            Receptura{recipes.length ? `: ${recipes.join(', ')}` : ''}
            {recipes.length ? <span className="x" role="button" aria-label="Wyczyść filtr receptury" onClick={e => { e.stopPropagation(); setRecipes([]) }}><X size={13} /></span> : <ChevronDown size={14} />}
          </button>
          {bucket && <span className="chip on">Termin: {BUCKET_LABEL[bucket]}<span className="x" role="button" aria-label="Wyczyść filtr terminu" onClick={() => setBucket(null)}><X size={13} /></span></span>}
          {anyFilter && <button className="btn sm ghost" onClick={() => { setQ(''); setClients([]); setRecipes([]); setBucket(null) }}>Wyczyść filtry</button>}
          <span className="grow" />
          <button className="btn sm ghost" onClick={groupMenu.open} disabled={view === 'closed'}><Rows3 size={15} />Grupuj: {groupBy === 'due' ? 'termin' : groupBy === 'client' ? 'klient' : 'brak'}<ChevronDown size={14} /></button>
        </div>
      )}

      <div className={`workarea${dock.side ? ' side' : ''}`} ref={workRef}>
        <div className="list-pane" style={dock.listStyle(hasDock, maxed)}>
          <div className="tbl-wrap" ref={listRef} tabIndex={0} onKeyDown={onListKey} aria-label="Lista zamówień">
            <table className="tbl" role="grid" aria-rowcount={flat.length}>
              <thead>
                <tr>
                  <th className="cb"><input type="checkbox" className="cbx" checked={allChecked} ref={el => { if (el) el.indeterminate = !allChecked && someChecked }}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(flat.map(r => r.o.id)))} aria-label="Zaznacz wszystkie widoczne" /></th>
                  <th className="al"><span className="sr">Alert</span></th>
                  {thSort('client', 'Klient')}
                  {thSort('no', 'Numer')}
                  {thSort('due', 'Termin')}
                  {thSort('status', 'Status', 'side-hide')}
                  <th className="hide-m">Pozycje</th>
                  {thSort('kg', 'Zamówiono', 'num')}
                  {thSort('prod', 'Produkcja', 'opt-col', 'Zgłoszono z tabletów produkcyjnych ÷ zamówiono (kg).\nŹródło diagnostyczne — nie zmienia pokrycia.')}
                  {thSort('cover', 'Pokrycie', '', 'Wydano (ciemny) + w magazynie (jasny) ÷ zamówiono (kg).\nTylko wyrób fizycznie przydzielony temu zamówieniu.')}
                  {thSort('missing', 'Brak', 'num', 'Zamówiono − wydano − w magazynie (kg)')}
                  {thSort('pallets', 'Palety', 'r', 'Gotowe (spakowane lub dalej) / rozpisane')}
                  <th className="hide-m" data-tip={'Wystawione (pełne) i gotowe do wystawienia (obrys).\nDokumenty jeszcze niedostępne nie są pokazywane.'}>Dokumenty</th>
                  <th style={{ width: 40 }}><span className="sr">Działania</span></th>
                </tr>
              </thead>
              <tbody>
                {flat.length === 0 && (
                  <tr><td colSpan={COLS}><div className="empty"><h3>Brak zamówień w tym widoku</h3>{anyFilter ? 'Zmień lub wyczyść filtry, aby zobaczyć więcej.' : 'Nowe zamówienie dodasz przyciskiem „Nowe zamówienie" (Ctrl+N).'}</div></td></tr>
                )}
                {groups.map(g => {
                  const isCol = collapsed.has(g.key)
                  const gm = g.rows.reduce((a, r) => ({ kg: a.kg + r.m.orderedKg, miss: a.miss + r.m.missingKg }), { kg: 0, miss: 0 })
                  return (
                    <React.Fragment key={g.key}>
                      {g.label && (
                        <tr className={`grp ${g.key}`}>
                          <td colSpan={COLS}>
                            <span className="gwrap">
                              <button onClick={() => setCollapsed(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })} aria-expanded={!isCol}>
                                {isCol ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{g.label}
                              </button>
                              <span className="gmeta">{g.rows.length} zam. · {kg(gm.kg)}</span>
                              {gm.miss > 0 ? <span className={`gmeta ${g.key === 'overdue' || g.key === 'today' ? 'crit-ink' : ''}`}>brak {kg(gm.miss)}</span> : <span className="gmeta ok-ink">komplet</span>}
                            </span>
                          </td>
                        </tr>
                      )}
                      {!isCol && g.rows.map((r, i) => <OrderRow key={r.o.id} r={r} zebra={i % 2 === 1} sel={sel === r.o.id} checked={checked.has(r.o.id)}
                        onClick={e => onRowClick(e, r.o.id)} onDouble={() => app.openOrder(r.o.id)} onCheck={() => toggleCheck(r.o.id)}
                        onMenu={(e) => { setRowMenuId(r.o.id); rowMenu.open(e) }} />)}
                    </React.Fragment>
                  )
                })}
              </tbody>
              {visible.length > 0 && (
                <tfoot><tr>
                  <td className="cb" /><td className="al" />
                  <td colSpan={2}>Razem — {visible.length} {visible.length === 1 ? 'zamówienie' : visible.length < 5 ? 'zamówienia' : 'zamówień'}</td>
                  <td /><td className="side-hide" />
                  <td className="num hide-m" style={{ textAlign: 'left' }}>{tot.lines} poz.</td>
                  <td className="num">{kg(tot.kg)}</td>
                  <td className="opt-col">{view !== 'closed' && <ProdMeter value={tot.kg ? tot.prod / tot.kg * 100 : 0} />}</td>
                  <td>{view !== 'closed' && <CoverMeter ship={tot.kg ? tot.ship / tot.kg * 100 : 0} stock={tot.kg ? (tot.cov - tot.ship) / tot.kg * 100 : 0} />}</td>
                  <td className="num crit-ink">{tot.miss ? num(tot.miss) : '0'}</td>
                  <td className="num">{tot.pr}<span className="faint"> / {tot.pt}</span></td>
                  <td className="hide-m" /><td />
                </tr></tfoot>
              )}
            </table>
          </div>
        </div>

        {hasDock && <>
          <div className={`splitter${dock.drag ? ' drag' : ''}`} role="separator" aria-orientation={dock.side ? 'vertical' : 'horizontal'} aria-label="Zmień rozmiar panelu szczegółów"
            onMouseDown={startDrag} onDoubleClick={() => { dock.reset(); setMaxed(false) }} data-tip="Przeciągnij, aby zmienić rozmiar. Dwuklik — domyślnie." />
          <div className="dock" aria-label="Szczegóły zamówienia">
            <OrderDetail order={selRow!.o} tab={tab} onTab={setTab} mode="dock" maxed={maxed} onMax={() => setMaxed(m => !m)}
              onClose={() => setSel(null)} onConfirm={confirmOrder} />
          </div>
        </>}
      </div>

      {clientMenu.anchor && <Menu anchor={clientMenu.anchor} onClose={clientMenu.close} items={[
        { header: 'Klient' },
        ...clientOpts.map(c => ({ label: `${clients.includes(c.id) ? '✓  ' : '    '}${c.name}`, onSelect: () => setClients(a => toggleIn(a, c.id)) })),
      ]} />}
      {recipeMenu.anchor && <Menu anchor={recipeMenu.anchor} onClose={recipeMenu.close} items={[
        { header: 'Receptura w pozycjach' },
        ...recipeOpts.map(r => ({ label: `${recipes.includes(r) ? '✓  ' : '    '}${r}`, onSelect: () => setRecipes(a => toggleIn(a, r)) })),
      ]} />}
      {groupMenu.anchor && <Menu anchor={groupMenu.anchor} align="right" onClose={groupMenu.close} items={[
        { header: 'Grupowanie listy' },
        { label: 'Według terminu dostawy', icon: <Layers size={15} />, onSelect: () => setGroupBy('due') },
        { label: 'Według klienta', icon: <Layers size={15} />, onSelect: () => setGroupBy('client') },
        { label: 'Bez grupowania', icon: <Rows3 size={15} />, onSelect: () => setGroupBy('none') },
      ]} />}
      {rowMenu.anchor && rowMenuId && <Menu anchor={rowMenu.anchor} align="right" onClose={rowMenu.close} items={rowActions(rowMenuId)} />}

      {reqOpen && <RequirementsDialog rows={checkedRows.length ? checkedRows : selRow ? [selRow] : []} onClose={() => setReqOpen(false)} />}
      {cancelId && <CancelDialog order={rows.find(r => r.o.id === cancelId)!} onClose={() => setCancelId(null)} onConfirm={(reason) => {
        void reason
        app.toast({ kind: 'info', title: 'Anulowanie zamówienia', detail: FAZA_ZAPISU })
        setCancelId(null)
      }} />}
    </>
  )
}

// ─── Wiersz ───────────────────────────────────────────────────────────────
const OrderRow = React.memo(function OrderRow({ r, zebra, sel, checked, onClick, onDouble, onCheck, onMenu }: {
  r: Row; zebra: boolean; sel: boolean; checked: boolean
  onClick: (e: React.MouseEvent) => void; onDouble: () => void; onCheck: () => void; onMenu: (e: React.MouseEvent) => void
}) {
  const { o, m } = r
  const closed = isClosed(o)
  const due = m.dueDays
  const flagTip = m.flags.map(f => `${f.label}: ${f.detail}`).join('\n')
  // Tylko dokumenty wystawione albo te, które można wystawić teraz — reszta to szum.
  const docs = o.docs.filter(d => (d.kind === 'WZ' || d.kind === 'CMR' || d.kind === 'HDI') && (d.state === 'issued' || d.state === 'partial' || d.state === 'frozen' || d.state === 'todo'))
  const docCls = (s: string) => s === 'issued' || s === 'frozen' ? 'issued' : s === 'partial' ? 'partial' : 'todo'
  const docWord = (s: string) => s === 'issued' ? 'wystawiony' : s === 'frozen' ? 'zamrożony' : s === 'partial' ? 'częściowo' : 'do wystawienia'
  return (
    <tr data-id={o.id} className={`row${zebra ? ' zebra' : ''}${sel ? ' sel' : ''}${checked ? ' checked' : ''}${closed ? ' closed' : ''}`}
      aria-selected={sel} onClick={onClick} onDoubleClick={onDouble}>
      <td className="cb" onClick={e => e.stopPropagation()}><input type="checkbox" className="cbx" checked={checked} onChange={onCheck} aria-label={`Zaznacz ${o.no}`} /></td>
      <td className="al">{m.level && <span className={`alert-ico ${m.level}`} data-tip={flagTip}><FlagIcon level={m.level} /></span>}</td>
      <td className="ell" style={{ maxWidth: 250 }} title={o.client.name}><b>{o.client.name}</b>{o.client.country && o.client.country !== 'PL' && <span className="cc">{o.client.country}</span>}</td>
      <td className="num" style={{ fontWeight: 400 }}>{o.no}</td>
      <td>
        {o.delivery ? (
          <span className={`due${!closed && due !== null && due < 0 ? ' over' : !closed && due === 0 ? ' today' : ''}`}>
            <span className="rel">{closed ? fmtDay(o.delivery) : due !== null && due < 0 ? `${-due} ${-due === 1 ? 'dzień' : 'dni'} po terminie` : due !== null && due <= 1 ? relDay(o.delivery) : fmtDay(o.delivery)}</span>
            {!closed && due !== null && due <= 1 && due >= 0 && <span className="abs">{o.deliveryTime ?? ''}</span>}
            {!closed && due !== null && due > 1 && <span className="abs">{weekday(o.delivery)}</span>}
          </span>
        ) : <span className="faint">bez terminu</span>}
      </td>
      <td className="side-hide"><OrderStatusLabel status={o.status} /></td>
      <td className="ell hide-m" style={{ maxWidth: 230 }}>
        <span className="num">{o.lines.length} poz.</span><span className="sub hide-m">{m.recipes.slice(0, 2).join(', ')}{m.recipes.length > 2 ? ` +${m.recipes.length - 2}` : ''}</span>
      </td>
      <td className="num">{kg(m.orderedKg)}</td>
      <td className="opt-col">{o.status === 'draft' || o.status === 'cancelled' ? <span className="faint">—</span> : <ProdMeter value={m.prodPct} />}</td>
      <td>{o.status === 'draft' || o.status === 'cancelled' ? <span className="faint">—</span> : <CoverMeter ship={m.shipPct} stock={m.stockPct} />}</td>
      <td className="num">{closed ? <span className="faint">—</span> : m.missingKg > 0 ? <span className={`crit-ink${due !== null && due <= 1 ? ' strong' : ''}`}>{num(m.missingKg)}</span> : <span className="ok-ink">0</span>}</td>
      <td className="num">
        {m.palletsTotal > 0 ? <span><b>{m.palletsReady}</b><span className="faint"> / {m.palletsTotal}</span>{m.unassignedQty > 0 && <span className="warn-ink" data-tip={`${m.unassignedQty} szt. bez palety`}> +</span>}</span>
          : o.status === 'draft' || closed ? <span className="faint">—</span>
          : <span className={m.dueDays !== null && m.dueDays <= 1 ? 'warn-ink strong' : 'faint'} data-tip="Palety nierozpisane">0</span>}
      </td>
      <td className="hide-m">{docs.length ? <span className="docs">{docs.map(d => <span key={d.kind} className={`doc ${docCls(d.state)}`} data-tip={`${DOC_NAME[d.kind]} — ${docWord(d.state)}${d.number ? `\n${d.number}` : ''}${d.note ? `\n${d.note}` : ''}`}>{d.kind}</span>)}</span> : <span className="faint">—</span>}</td>
      <td onClick={e => e.stopPropagation()}><button className="btn ghost icon sm" style={{ width: 28, height: 26 }} aria-label={`Działania dla ${o.no}`} onClick={onMenu}><MoreHorizontal size={16} /></button></td>
    </tr>
  )
})

// ─── Zapotrzebowanie na masowanie (zaznaczone) ────────────────────────────
function RequirementsDialog({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const app = useApp()
  const open = rows.filter(r => !isClosed(r.o) && r.o.status !== 'draft')
  // Liczby z backendu (line.mixing) — ta sama zasada co w starym MES: zaokrąglenie po recepturze.
  const list = mixingByRecipe(open.flatMap(r => r.o.lines.map(line => ({ line, orderNo: r.o.no }))))
  const unknown = list.filter(r => !r.known)
  const total = list.reduce((a, r) => a + (r.meatKg ?? 0), 0)
  const remaining = list.reduce((a, r) => a + r.remainingKg, 0)
  const skipped = rows.length - open.length
  return (
    <Dialog wide title="Zapotrzebowanie na masowanie" icon={<Calculator size={20} color="var(--accent)" />} onClose={onClose}
      footer={<><span className="left">Dla {open.length} zamówień · brakującego wyrobu</span><button className="btn" onClick={onClose}>Zamknij</button>
        <button className="btn primary" onClick={() => { onClose(); app.toast({ kind: 'info', title: 'Przekazanie do planu masowania', detail: FAZA_ZAPISU }) }} disabled={!list.length}>Przekaż do planu masowania</button></>}>
      <div className="req-sum">
        <div className="f"><span className="k">Mięso do masowania</span><span className="v">{kg(total)}{unknown.length > 0 && <small className="warn-ink"> + nieznane</small>}</span></div>
        <div className="f"><span className="k">Wyrób do zmasowania</span><span className="v">{kg(remaining)}</span></div>
        <div className="f"><span className="k">Receptury</span><span className="v">{list.length}</span></div>
      </div>
      <div className="box">
        <table className="tbl">
          <thead><tr><th>Receptura</th><th className="num">Wyrób do zmasowania</th><th className="num">Mięso (zaokr. w górę)</th><th className="num">Dodatki i przyrost</th><th>Zamówienia</th></tr></thead>
          <tbody>
            {list.map(r => <tr key={r.recipe} className="row"><td className="strong">{r.recipe}</td><td className="num">{r.known ? kg(r.remainingKg) : '—'}</td>
              <td className="num strong" data-tip={r.known ? `Dokładnie ${r.exactMeatKg.toFixed(2).replace('.', ',')} kg — z receptury (backend)` : 'Backend nie umie policzyć tej receptury (brak składu na 100 kg)'}>{r.meatKg === null ? <span className="warn-ink">nieznane</span> : kg(r.meatKg)}</td>
              <td className="num">{r.meatKg === null ? '—' : kg(Math.max(0, r.remainingKg - r.exactMeatKg))}</td><td className="ell muted" style={{ maxWidth: 220 }}>{r.orders.join(', ')}</td></tr>)}
            {!list.length && <tr><td colSpan={5}><div className="empty">Zaznaczone zamówienia mają komplet wyrobu.</div></td></tr>}
          </tbody>
          {list.length > 0 && <tfoot><tr><td>Razem</td><td className="num">{kg(remaining)}</td><td className="num">{kg(total)}</td><td className="num">—</td><td /></tr></tfoot>}
        </table>
      </div>
      <div className="note info">Mięso zaokrąglamy w górę po zsumowaniu pozycji każdej receptury. Suma to suma zaokrąglonych receptur — jak w obecnym KEBABMES20.{skipped > 0 && ` Pominięto ${skipped} szkice lub zamknięte zamówienia.`}</div>
    </Dialog>
  )
}

// ─── Anulowanie: skutki widoczne przed potwierdzeniem ─────────────────────
function CancelDialog({ order, onClose, onConfirm }: { order: Row; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const { o, m } = order
  const err = touched && !reason
  return (
    <Dialog title={`Anulować ${o.no}?`} icon={<Ban size={20} color="var(--crit)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} data-autofocus>Wróć</button>
        <button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => { setTouched(true); if (reason) onConfirm(reason) }}>Anuluj zamówienie</button></>}>
      <p>{o.client.name} · {kg(m.orderedKg)} · {o.lines.length} poz.</p>
      <div className="note warn"><FlagIcon level="warn" size={16} /><div>
        <b>Co się stanie:</b> zamówienie zniknie z planowania i z listy aktywnych.
        {m.stockKg > 0 && <> Przydzielony wyrób ({kg(m.stockKg)}) wróci do puli wolnej w magazynie.</>}
        {m.palletsTotal > 0 && <> Palety ({m.palletsTotal}) i numery kartonów zostaną zablokowane — nie będą użyte ponownie.</>}
        {m.deliveredKg > 0 && <> Wydane już {kg(m.deliveredKg)} zostaje na WZ.</>}
        {' '}Historia zamówienia zostaje zachowana.
      </div></div>
      <label className="label" htmlFor="cancel-reason">Powód anulowania</label>
      <select id="cancel-reason" className={`field${err ? ' invalid' : ''}`} value={reason} onChange={e => setReason(e.target.value)} aria-invalid={err} aria-describedby={err ? 'cancel-err' : undefined}>
        <option value="">Wybierz powód…</option>
        <option>Rezygnacja klienta</option>
        <option>Zamówienie zdublowane</option>
        <option>Zmiana na inne zamówienie</option>
        <option>Brak możliwości realizacji w terminie</option>
      </select>
      {err && <span id="cancel-err" className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>Wybierz powód — trafi do historii zamówienia.</span>}
    </Dialog>
  )
}
