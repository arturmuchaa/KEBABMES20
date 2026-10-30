import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PackagePlus, Link2, Unlink, MoveRight, Truck, Tag, ClipboardCheck, FileSpreadsheet, Search, ChevronDown, ChevronRight,
  X, Maximize2, Minimize2, ExternalLink, Rows3, Lock, Snowflake, Layers, ArrowUp, ArrowDown,
} from 'lucide-react'
import { useApp, Menu, useMenu, Dialog, CommandBar, type Cmd } from '../../shell/context'
import { useOrders } from '../../data/store'
import { computeMetrics, fmtDate, kg, num, relDay, isClosed, lineMissing, type Order } from '../../data/model'
import { posKg, daysLeft, STOCK_STATUS, type StockPos } from '../../data/stock'
import { FlagIcon } from '../../ui/Glyphs'

type View = 'all' | 'free' | 'allocated' | 'pallet' | 'blocked' | 'short'
type Tab = 'details' | 'alloc' | 'cartons' | 'moves' | 'trace'
type GroupBy = 'product' | 'location' | 'none'
type SortCol = 'product' | 'batch' | 'prod' | 'bb' | 'qty' | 'kg'

const SHORT_DAYS = 14
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'details', label: 'Szczegóły' }, { key: 'alloc', label: 'Przydział' }, { key: 'cartons', label: 'Kartony' },
  { key: 'moves', label: 'Ruchy magazynowe' }, { key: 'trace', label: 'Śledzenie partii' },
]

interface Row { p: StockPos; order?: Order; cands: number }

/**
 * Wyrób gotowy — ten sam szkielet co Zamówienia: pasek narzędzi, widoki,
 * tabela z grupami i sumami, dolny panel z zakładkami. Przydział działa na
 * wspólnym stanie — pokrycie zamówienia zmienia się od razu.
 */
export function FinishedGoods({ cmd, active, setCtx, setCmds }: { cmd: { n: number; select?: string }; active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { stock, orders, allocate, release } = useOrders()

  const openOrders = useMemo(() => orders.filter(o => !isClosed(o) && o.status !== 'draft'), [orders])
  const candidatesFor = useCallback((p: StockPos) => openOrders.flatMap(o => o.lines
    .filter(l => l.recipe === p.recipe && l.kgPerUnit === p.kgPerUnit && lineMissing(l) > 0)
    .map(l => ({ o, l, miss: lineMissing(l), m: computeMetrics(o) })))
    .sort((a, b) => (a.m.dueDays ?? 99) - (b.m.dueDays ?? 99)), [openOrders])

  const rows = useMemo<Row[]>(() => stock.map(p => ({ p, order: orders.find(o => o.id === p.orderId), cands: p.orderId || p.status === 'blocked' ? 0 : candidatesFor(p).length })), [stock, orders, candidatesFor])

  const [view, setView] = useState<View>('all')
  const [q, setQ] = useState('')
  const [recipes, setRecipes] = useState<string[]>([])
  const [groupBy, setGroupBy] = useState<GroupBy>('product')
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('details')
  const [maxed, setMaxed] = useState(false)
  const [ratio, setRatio] = useState(0.46)
  const [releaseId, setReleaseId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const recipeMenu = useMenu(), groupMenu = useMenu()

  useEffect(() => {
    if (!cmd.n) return
    const o = orders.find(x => x.id === cmd.select)
    if (o) { setView('allocated'); setQ(o.no); setRecipes([]); const first = stock.find(p => p.orderId === o.id); setSel(first?.id ?? null); setTab('alloc') }
  }, [cmd]) // eslint-disable-line react-hooks/exhaustive-deps

  const VIEWS: Array<{ key: View; label: string; tip: string; test: (r: Row) => boolean }> = [
    { key: 'all', label: 'Wszystko', tip: 'Cały wyrób gotowy na stanie', test: () => true },
    { key: 'free', label: 'Wolne', tip: 'Nieprzydzielone do żadnego zamówienia', test: r => !r.p.orderId && r.p.status !== 'blocked' },
    { key: 'allocated', label: 'Przydzielone', tip: 'Przydzielone do zamówień', test: r => !!r.p.orderId },
    { key: 'pallet', label: 'Na paletach', tip: 'Spakowane na palety wydania', test: r => r.p.status === 'pallet' },
    { key: 'blocked', label: 'Zablokowane', tip: 'Blokada jakościowa', test: r => r.p.status === 'blocked' },
    { key: 'short', label: 'Krótka data', tip: `Przydatność ≤ ${SHORT_DAYS} dni`, test: r => daysLeft(r.p) <= SHORT_DAYS },
  ]
  const counts = Object.fromEntries(VIEWS.map(v => [v.key, rows.filter(v.test).length])) as Record<View, number>

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    let list = rows.filter(VIEWS.find(v => v.key === view)!.test)
    if (recipes.length) list = list.filter(r => recipes.includes(r.p.recipe))
    if (t) list = list.filter(r => [r.p.recipe, r.p.product, r.p.batch, r.p.location, `${r.p.kgPerUnit} kg`, r.order?.no ?? '', r.order?.client.name ?? '', ...r.p.cartons].join(' ').toLowerCase().includes(t))
    const base = (a: Row, b: Row) => a.p.recipe.localeCompare(b.p.recipe) || a.p.kgPerUnit - b.p.kgPerUnit || a.p.prodDate.getTime() - b.p.prodDate.getTime()
    return [...list].sort((a, b) => {
      if (!sort) return base(a, b)
      const d = sort.dir
      switch (sort.col) {
        case 'product': return d * base(a, b)
        case 'batch': return d * a.p.batch.localeCompare(b.p.batch)
        case 'prod': return d * (a.p.prodDate.getTime() - b.p.prodDate.getTime())
        case 'bb': return d * (a.p.bestBefore.getTime() - b.p.bestBefore.getTime())
        case 'qty': return d * (a.p.qty - b.p.qty)
        case 'kg': return d * (posKg(a.p) - posKg(b.p))
      }
    })
  }, [rows, view, recipes, q, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', rows: visible }]
    const keyOf = (r: Row) => groupBy === 'product' ? `${r.p.recipe} ${r.p.kgPerUnit} kg` : r.p.location
    const m = new Map<string, Row[]>()
    visible.forEach(r => m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]))
    return [...m.entries()].map(([k, rs]) => ({ key: k, label: k, rows: rs }))
  }, [visible, groupBy])
  const flat = useMemo(() => groups.flatMap(g => collapsed.has(g.key) ? [] : g.rows), [groups, collapsed])
  const selRow = rows.find(r => r.p.id === sel) ?? null
  useEffect(() => { if (sel && !rows.some(r => r.p.id === sel)) setSel(null) }, [rows, sel])

  const select = (id: string | null) => {
    setSel(id)
    if (id) requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const toggleCheck = (id: string) => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ─── Polecenia ─────────────────────────────────────────────────────────
  const sp = selRow?.p
  const canAlloc = !!sp && !sp.orderId && sp.status !== 'blocked'
  const demo = (t: string, d = 'W demo ta operacja jest tylko zaznaczona w interfejsie.') => app.toast({ kind: 'info', title: t, detail: d })
  const cmds = useMemo<Cmd[]>(() => [
    { id: 'receive', group: 1, label: 'Przyjmij z produkcji', icon: <PackagePlus size={17} />, run: () => demo('Przyjęcie z produkcji', 'W KEBABMES20 przyjęcie tworzy partię P i ruch magazynowy — tutaj tylko pokazujemy miejsce.') },
    { id: 'alloc', group: 2, label: 'Przydziel do zamówienia', icon: <Link2 size={17} />, disabled: !canAlloc, tip: sp?.status === 'blocked' ? 'Pozycja zablokowana' : sp?.orderId ? 'Już przydzielona' : undefined, run: () => setTab('alloc') },
    { id: 'release', group: 2, label: 'Zwolnij przydział', icon: <Unlink size={17} />, opt: true, disabled: !sp?.orderId, tip: !sp?.orderId ? 'Pozycja nie jest przydzielona' : undefined, run: () => sp && setReleaseId(sp.id) },
    { id: 'move', group: 3, label: 'Przesuń', icon: <MoveRight size={17} />, opt: true, disabled: !sp, run: () => demo('Przesunięcie między lokalizacjami') },
    { id: 'issue', group: 3, label: 'Wydaj', icon: <Truck size={17} />, disabled: !sp, menu: [
      { label: 'Wydanie WZ z zamówienia', icon: <Truck size={15} />, disabled: !sp?.orderId, onSelect: () => sp?.orderId && app.gotoOrders({ select: sp.orderId, tab: 'shipping', view: 'active' }) },
      { label: 'Rozchód wewnętrzny…', icon: <MoveRight size={15} />, onSelect: () => demo('Rozchód wewnętrzny') },
    ] },
    { id: 'print', group: 4, label: 'Etykieta', icon: <Tag size={17} />, kbd: 'Ctrl+P', disabled: !sp, run: () => demo('Wydruk etykiety kartonu', 'W aplikacji — kolejka drukarki Zebra.') },
    { id: 'inv', group: 4, label: 'Inwentaryzacja', icon: <ClipboardCheck size={17} />, opt: true, run: () => demo('Inwentaryzacja') },
    { id: 'export', group: 5, label: 'Eksport do Excela', icon: <FileSpreadsheet size={15} />, menuOnly: true, run: () => demo('Eksport niedostępny w demo') },
  ], [canAlloc, sp, app]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])

  // ─── Pasek stanu i skróty ──────────────────────────────────────────────
  const tot = visible.reduce((a, r) => ({ qty: a.qty + r.p.qty, kg: a.kg + posKg(r.p), free: a.free + (!r.p.orderId && r.p.status !== 'blocked' ? posKg(r.p) : 0), alloc: a.alloc + (r.p.orderId ? posKg(r.p) : 0), cart: a.cart + r.p.cartons.length }), { qty: 0, kg: 0, free: 0, alloc: 0, cart: 0 })
  useEffect(() => {
    if (!active) return
    setCtx(<><span>Widoczne <b>{visible.length}</b> poz. · <b>{kg(tot.kg)}</b> · przydzielone <b>{kg(tot.alloc)}</b> · wolne <b>{kg(tot.free)}</b></span>
      <span className="hint hide-m"><span className="kbd">↑</span><span className="kbd">↓</span> wybór <span className="kbd">Alt+1…5</span> zakładki</span></>)
  }, [active, visible.length, tot.kg, tot.alloc, tot.free, setCtx])
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-wrap, .overlay')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.altKey && !e.ctrlKey && /^[1-5]$/.test(e.key) && sel) { e.preventDefault(); setTab(TABS[Number(e.key) - 1].key) }
      else if (e.key === 'Escape') { if (checked.size) setChecked(new Set()); else if (sel) setSel(null) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, sel, checked.size])

  const onListKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex(r => r.p.id === sel)
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = flat[Math.min(flat.length - 1, i + 1)]; if (r) select(r.p.id) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const r = flat[Math.max(0, i - 1)]; if (r) select(r.p.id) }
    else if (e.key === ' ' && sel) { e.preventDefault(); toggleCheck(sel) }
    else if (e.key === 'Enter' && selRow?.order) { e.preventDefault(); app.openOrder(selRow.order.id) }
  }

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault(); setMaxed(false)
    const box = workRef.current!.getBoundingClientRect()
    const move = (ev: MouseEvent) => setRatio(Math.max(0.22, Math.min(0.85, 1 - (ev.clientY - box.top) / box.height)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const thSort = (col: SortCol, label: string, cls = '') => {
    const on = sort?.col === col
    return <th className={`sortable ${cls}`} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
      onClick={() => setSort(s => s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 })}>
      {label}<span className="sort">{on ? (sort!.dir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : null}</span></th>
  }
  const recipeOpts = [...new Set(stock.map(p => p.recipe))].sort()
  const COLS = 12
  const effRatio = maxed ? 0.84 : ratio

  return (
    <>
      <CommandBar title="Wyrób gotowy" count={`${rows.length} pozycji · ${kg(rows.reduce((a, r) => a + posKg(r.p), 0))}`} cmds={cmds} />
      <div className="toolbar" role="toolbar" aria-label="Widoki i filtry">
        <div className="seg" role="group" aria-label="Widoki magazynu">
          {VIEWS.map(v => (
            <button key={v.key} aria-pressed={view === v.key} data-tip={v.tip} onClick={() => setView(v.key)}>
              {v.label}<span className={`count${(v.key === 'blocked' || v.key === 'short') && counts[v.key] ? ' crit' : ''}`}>{counts[v.key]}</span>
            </button>
          ))}
        </div>
        <span className="vsep" />
        <div className="field-wrap search">
          <Search size={15} />
          <input ref={searchRef} id="stock-search" className="field" placeholder="Partia, karton, receptura, zamówienie…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj w magazynie" />
          {!q && <span className="kbd">Ctrl F</span>}
        </div>
        <button className={`chip${recipes.length ? ' on' : ''}`} onClick={recipeMenu.open}>
          Receptura{recipes.length ? `: ${recipes.join(', ')}` : ''}
          {recipes.length ? <span className="x" role="button" aria-label="Wyczyść filtr receptury" onClick={e => { e.stopPropagation(); setRecipes([]) }}><X size={13} /></span> : <ChevronDown size={14} />}
        </button>
        {q && <button className="btn sm ghost" onClick={() => setQ('')}>Wyczyść</button>}
        <span className="grow" />
        <button className="btn sm ghost" onClick={groupMenu.open}><Rows3 size={15} />Grupuj: {groupBy === 'product' ? 'wyrób' : groupBy === 'location' ? 'lokalizacja' : 'brak'}<ChevronDown size={14} /></button>
      </div>

      <div className="workarea" ref={workRef}>
        <div className="list-pane" style={selRow ? { height: `calc((100% - 7px) * ${1 - effRatio})`, flex: 'none' } : { flex: 1 }}>
          <div className="tbl-wrap" ref={listRef} tabIndex={0} onKeyDown={onListKey} aria-label="Lista pozycji magazynowych">
            <table className="tbl" role="grid">
              <thead><tr>
                <th className="cb"><input type="checkbox" className="cbx" checked={flat.length > 0 && flat.every(r => checked.has(r.p.id))} onChange={() => setChecked(c => c.size ? new Set() : new Set(flat.map(r => r.p.id)))} aria-label="Zaznacz wszystkie" /></th>
                <th className="al"><span className="sr">Alert</span></th>
                {thSort('product', 'Wyrób')}
                {thSort('batch', 'Partia')}
                {thSort('prod', 'Produkcja', 'hide-s')}
                {thSort('bb', 'Przydatność')}
                <th className="hide-m">Lokalizacja</th>
                {thSort('qty', 'Ilość', 'num')}
                {thSort('kg', 'Masa', 'num')}
                <th className="num hide-m">Kartony</th>
                <th>Przydział</th>
                <th>Stan</th>
              </tr></thead>
              <tbody>
                {flat.length === 0 && <tr><td colSpan={COLS}><div className="empty"><h3>Brak pozycji w tym widoku</h3>Zmień widok albo wyczyść wyszukiwanie.</div></td></tr>}
                {groups.map(g => {
                  const isCol = collapsed.has(g.key)
                  const gq = g.rows.reduce((a, r) => ({ qty: a.qty + r.p.qty, kg: a.kg + posKg(r.p), free: a.free + (!r.p.orderId && r.p.status !== 'blocked' ? r.p.qty : 0), blk: a.blk + (r.p.status === 'blocked' ? r.p.qty : 0) }), { qty: 0, kg: 0, free: 0, blk: 0 })
                  return (
                    <React.Fragment key={g.key}>
                      {g.label && <tr className="grp"><td colSpan={COLS}><span className="gwrap">
                        <button onClick={() => setCollapsed(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })} aria-expanded={!isCol}>{isCol ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{g.label}</button>
                        <span className="gmeta">{g.rows.length} {g.rows.length === 1 ? 'partia' : 'partie'} · {num(gq.qty)} szt. · {kg(gq.kg)}</span>
                        {gq.free > 0 ? <span className="gmeta accent-ink">wolne {gq.free} szt.</span> : gq.blk ? null : <span className="gmeta">wszystko przydzielone</span>}
                        {gq.blk > 0 && <span className="gmeta crit-ink">zablokowane {gq.blk} szt.</span>}
                      </span></td></tr>}
                      {!isCol && g.rows.map((r, i) => <StockRow key={r.p.id} r={r} zebra={i % 2 === 1} sel={sel === r.p.id} checked={checked.has(r.p.id)}
                        onClick={() => select(r.p.id)} onCheck={() => toggleCheck(r.p.id)} onOrder={() => r.order && app.gotoOrders({ select: r.order.id, tab: 'coverage', view: 'active' })} />)}
                    </React.Fragment>
                  )
                })}
              </tbody>
              {visible.length > 0 && <tfoot><tr>
                <td className="cb" /><td className="al" /><td colSpan={2}>Razem — {visible.length} poz.</td><td className="hide-s" /><td /><td className="hide-m" />
                <td className="num">{num(tot.qty)} <span className="sub">szt.</span></td><td className="num">{kg(tot.kg)}</td><td className="num hide-m">{tot.cart}</td>
                <td colSpan={2}><span className="muted" style={{ fontWeight: 500 }}>przydzielone {kg(tot.alloc)} · wolne {kg(tot.free)}</span></td>
              </tr></tfoot>}
            </table>
          </div>
        </div>
        {selRow && <>
          <div className="splitter" role="separator" aria-orientation="horizontal" onMouseDown={startDrag} onDoubleClick={() => { setRatio(0.46); setMaxed(false) }} data-tip="Przeciągnij, aby zmienić wysokość" />
          <div className="dock" aria-label="Szczegóły pozycji magazynowej">
            <StockDetail r={selRow} tab={tab} onTab={setTab} maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setSel(null)}
              candidates={candidatesFor(selRow.p)} onAllocate={(o, lineId, qty) => {
                allocate(selRow.p.id, o.id, lineId, qty)
                app.toast({ title: `Przydzielono ${qty} szt. do ${o.no}`, detail: 'Pokrycie zamówienia zaktualizowane — tylko w tej sesji demo.' })
              }} onRelease={() => setReleaseId(selRow.p.id)} />
          </div>
        </>}
      </div>

      {recipeMenu.anchor && <Menu anchor={recipeMenu.anchor} onClose={recipeMenu.close} items={[{ header: 'Receptura' }, ...recipeOpts.map(r => ({ label: r, checked: recipes.includes(r), onSelect: () => setRecipes(a => a.includes(r) ? a.filter(x => x !== r) : [...a, r]) }))]} />}
      {groupMenu.anchor && <Menu anchor={groupMenu.anchor} align="right" onClose={groupMenu.close} items={[
        { header: 'Grupowanie listy' },
        { label: 'Według wyrobu (receptura × gramatura)', icon: <Layers size={15} />, checked: groupBy === 'product', onSelect: () => setGroupBy('product') },
        { label: 'Według lokalizacji', icon: <Snowflake size={15} />, checked: groupBy === 'location', onSelect: () => setGroupBy('location') },
        { label: 'Bez grupowania', icon: <Rows3 size={15} />, checked: groupBy === 'none', onSelect: () => setGroupBy('none') },
      ]} />}
      {releaseId && (() => {
        const r = rows.find(x => x.p.id === releaseId)!
        const m = r.order ? computeMetrics(r.order) : null
        return (
          <Dialog title="Zwolnić przydział?" icon={<Unlink size={20} color="var(--warn)" />} onClose={() => setReleaseId(null)}
            footer={<><button className="btn" onClick={() => setReleaseId(null)} data-autofocus>Wróć</button>
              <button className="btn primary" onClick={() => { release(r.p.id); setReleaseId(null); app.toast({ title: 'Zwolniono przydział', detail: `${r.p.qty} szt. wróciło do puli wolnej. Tylko w tej sesji demo.` }) }}>Zwolnij przydział</button></>}>
            <p><b>{r.p.recipe} {r.p.kgPerUnit} kg</b> · partia <span className="code">{r.p.batch}</span> · {r.p.qty} szt. ({kg(posKg(r.p))})</p>
            {r.order && m && <div className="note warn"><FlagIcon level="warn" size={16} /><div>
              <b>{r.order.no} ({r.order.client.name})</b> straci pokrycie {kg(posKg(r.p))}. Brak wyrobu wzrośnie z {kg(m.missingKg)} do {kg(m.missingKg + posKg(r.p))}, a termin dostawy to {relDay(r.order.delivery)}.
              {r.p.status === 'pallet' && <> Pozycja jest na palecie {r.p.palletNo} — paleta wróci do stanu „Pakowanie”.</>}
            </div></div>}
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Operacja zapisze ruch magazynowy „Zwolniono przydział”. Wyrób zostaje na stanie.</p>
          </Dialog>
        )
      })()}
    </>
  )
}

const StockRow = React.memo(function StockRow({ r, zebra, sel, checked, onClick, onCheck, onOrder }: { r: Row; zebra: boolean; sel: boolean; checked: boolean; onClick: () => void; onCheck: () => void; onOrder: () => void }) {
  const { p, order } = r
  const dl = daysLeft(p)
  const level = p.status === 'blocked' ? 'crit' : dl <= SHORT_DAYS ? 'warn' : r.cands ? 'info' : null
  const tip = p.status === 'blocked' ? `Zablokowane: ${p.blockReason}` : dl <= SHORT_DAYS ? `Krótka data: ${dl} dni do końca przydatności` : r.cands ? `Pasuje do braków w ${r.cands} ${r.cands === 1 ? 'zamówieniu' : 'zamówieniach'} — można przydzielić` : ''
  return (
    <tr data-id={p.id} className={`row${zebra ? ' zebra' : ''}${sel ? ' sel' : ''}${checked ? ' checked' : ''}`} aria-selected={sel} onClick={onClick}>
      <td className="cb" onClick={e => e.stopPropagation()}><input type="checkbox" className="cbx" checked={checked} onChange={onCheck} aria-label={`Zaznacz ${p.batch}`} /></td>
      <td className="al">{level && <span className={`alert-ico ${level}`} data-tip={tip}><FlagIcon level={level} /></span>}</td>
      <td className="ell" style={{ maxWidth: 260 }}><b>{p.recipe}</b> {p.kgPerUnit} kg<span className="sub hide-m">{p.product}</span></td>
      <td className="code">{p.batch}</td>
      <td className="num hide-s">{fmtDate(p.prodDate)}</td>
      <td><span className={`due${dl <= SHORT_DAYS ? ' over' : ''}`}><span className="rel num">{fmtDate(p.bestBefore)}</span><span className="abs">{dl} dni</span></span></td>
      <td className="hide-m ell" style={{ maxWidth: 200 }}>{p.location}</td>
      <td className="num"><b>{num(p.qty)}</b> <span className="sub">szt.</span></td>
      <td className="num">{kg(posKg(p))}</td>
      <td className="num hide-m">{p.cartons.length}</td>
      <td>{order ? <button className="accent-ink" style={{ fontWeight: 500 }} onClick={e => { e.stopPropagation(); onOrder() }} data-tip={`${order.no} · ${order.client.name}\ntermin ${relDay(order.delivery)}`}>{order.no}<span className="sub">{order.client.name.split(' ')[0]}</span></button>
        : p.status === 'blocked' ? <span className="faint">—</span> : <span className="muted">wolne</span>}</td>
      <td><span className={`pst ${p.status === 'pallet' ? 'packed' : p.status === 'blocked' ? 'created' : 'cold'}`}>{p.status === 'blocked' && <Lock size={13} />}{STOCK_STATUS[p.status]}{p.palletNo ? ` ${p.palletNo}` : ''}</span></td>
    </tr>
  )
})

function StockDetail({ r, tab, onTab, maxed, onMax, onClose, candidates, onAllocate, onRelease }: {
  r: Row; tab: Tab; onTab: (t: Tab) => void; maxed: boolean; onMax: () => void; onClose: () => void
  candidates: Array<{ o: Order; l: Order['lines'][number]; miss: number; m: ReturnType<typeof computeMetrics> }>
  onAllocate: (o: Order, lineId: string, qty: number) => void; onRelease: () => void
}) {
  const app = useApp()
  const { p, order } = r
  const dl = daysLeft(p)
  const line = order?.lines.find(l => l.id === p.lineId)
  const perCarton = Math.ceil(p.qty / p.cartons.length)
  let primary: React.ReactNode = null
  if (order) primary = <button className="btn" onClick={() => app.gotoOrders({ select: order.id, tab: 'coverage', view: 'active' })}><ExternalLink size={15} />Otwórz {order.no}</button>
  else if (p.status !== 'blocked' && candidates.length) primary = <button className="btn primary" onClick={() => onTab('alloc')}><Link2 size={16} />Przydziel do zamówienia</button>
  else if (p.status === 'blocked') primary = <button className="btn" onClick={() => app.toast({ kind: 'info', title: 'Decyzja jakościowa', detail: 'Zwolnienie blokady wymaga podpisu technologa — w demo niedostępne.' })}><Lock size={15} />Decyzja QC</button>

  return (
    <>
      <div className="dock-head">
        <div className="dock-id">
          <div className="l1"><h2>{p.recipe} {p.kgPerUnit} kg</h2><span className="code muted">{p.batch}</span>
            {p.status === 'blocked' && <span className="tag crit">Zablokowane</span>}
            {dl <= SHORT_DAYS && <span className="tag warn">Krótka data: {dl} dni</span>}
            {!order && p.status !== 'blocked' && <span className="tag info">Wolne</span>}
          </div>
          <div className="l2">{p.product} · {p.packaging} · {p.location}</div>
        </div>
        <div className="dock-figs">
          <div className="f"><span className="k">Ilość</span><span className="v">{num(p.qty)} szt.<small>{p.cartons.length} kart.</small></span></div>
          <div className="f"><span className="k">Masa</span><span className="v">{kg(posKg(p))}</span></div>
          <div className="f"><span className="k">Przydatność</span><span className={`v${dl <= SHORT_DAYS ? ' crit-ink' : ''}`}>{dl} dni<small>{fmtDate(p.bestBefore)}</small></span></div>
          <div className="f"><span className="k">Przydział</span><span className="v">{order ? order.no : '—'}<small>{order ? order.client.name.split(' ')[0] : 'wolne'}</small></span></div>
        </div>
        <div className="dock-actions">
          {primary}
          <span style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />
          <button className="btn ghost icon" onClick={onMax} aria-label={maxed ? 'Przywróć panel' : 'Powiększ panel'} data-tip={maxed ? 'Przywróć' : 'Powiększ panel'}>{maxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn ghost icon" onClick={onClose} aria-label="Zamknij panel (Esc)" data-tip="Zamknij panel (Esc)"><X size={17} /></button>
        </div>
      </div>
      <div className="dock-tabs" role="tablist">
        {TABS.map((t, i) => <button key={t.key} role="tab" className="dock-tab" aria-selected={tab === t.key} onClick={() => onTab(t.key)} data-tip={`Alt+${i + 1}`}>
          {t.label}{t.key === 'alloc' && !order && candidates.length > 0 && p.status !== 'blocked' && <span className="badge warn">{candidates.length}</span>}{t.key === 'moves' && <span className="badge">{p.movements.length}</span>}{t.key === 'cartons' && <span className="badge">{p.cartons.length}</span>}
        </button>)}
      </div>
      <div className="dock-body" role="tabpanel">
        <div className="dock-pad">
          {tab === 'details' && <>
            {p.status === 'blocked' && <div className="note crit"><Lock size={15} /><div><b>Blokada jakościowa.</b> {p.blockReason}. Pozycji nie można przydzielać ani wydawać.</div></div>}
            {dl <= SHORT_DAYS && p.status !== 'blocked' && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Krótka data.</b> Zostało {dl} dni przydatności — przydziel w pierwszej kolejności (FEFO).</div></div>}
            <div className="ov-grid">
              <div className="box ov-card"><h4>Wyrób</h4><dl className="kv">
                <dt>Rodzaj</dt><dd>{p.product}</dd><dt>Receptura</dt><dd className="strong">{p.recipe}</dd><dt>Gramatura</dt><dd>{p.kgPerUnit} kg / szt.</dd><dt>Opakowanie</dt><dd>{p.packaging}</dd>
              </dl></div>
              <div className="box ov-card"><h4>Partia</h4><dl className="kv">
                <dt>Numer</dt><dd className="code">{p.batch}</dd><dt>Produkcja</dt><dd className="num">{fmtDate(p.prodDate)}</dd><dt>Przydatność</dt><dd className="num">{fmtDate(p.bestBefore)} · {dl} dni</dd><dt>Lokalizacja</dt><dd>{p.location}</dd>
              </dl></div>
              <div className="box ov-card ov-notes"><h4>Przydział</h4>
                {order && line ? <dl className="kv"><dt>Zamówienie</dt><dd className="strong">{order.no}</dd><dt>Klient</dt><dd>{order.client.name}</dd><dt>Pozycja</dt><dd>poz. {line.lp} · {line.qty} szt. zamówione</dd><dt>Termin</dt><dd>{relDay(order.delivery)}</dd></dl>
                  : <p className="muted">{p.status === 'blocked' ? 'Zablokowane — bez przydziału.' : candidates.length ? `Wolne. Pasuje do braków w ${candidates.length} ${candidates.length === 1 ? 'zamówieniu' : 'zamówieniach'} — zakładka Przydział.` : 'Wolne. Żadne otwarte zamówienie nie ma braku tego wyrobu.'}</p>}
              </div>
            </div>
          </>}

          {tab === 'alloc' && <>
            {order && line ? (
              <div className="box" style={{ padding: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
                <Link2 size={22} color="var(--accent)" />
                <div style={{ flex: 1 }}>
                  <div className="strong">Przydzielone do {order.no} · {order.client.name}</div>
                  <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Poz. {line.lp}: {line.recipe} {line.kgPerUnit} kg · zamówiono {line.qty} szt. · w magazynie {line.stock} · brak {lineMissing(line)} · termin {relDay(order.delivery)}</div>
                </div>
                <button className="btn" onClick={() => app.gotoOrders({ select: order.id, tab: 'coverage', view: 'active' })}>Pokrycie zamówienia</button>
                <button className="btn danger" onClick={onRelease}><Unlink size={15} />Zwolnij przydział…</button>
              </div>
            ) : p.status === 'blocked' ? (
              <div className="note crit"><Lock size={15} /><div>Pozycja zablokowana — przydział możliwy po decyzji kontroli jakości.</div></div>
            ) : (<>
              <div className="sect-h"><h3>Zamówienia z brakiem {p.recipe} {p.kgPerUnit} kg</h3><span className="sub">od najbliższego terminu · dostępne {p.qty} szt.</span></div>
              {candidates.length === 0 ? <div className="note">Żadne otwarte zamówienie nie ma braku tego wyrobu. Pozycja zostaje w puli wolnej.</div> : (
                <div className="box"><table className="tbl">
                  <thead><tr><th>Zamówienie</th><th>Klient</th><th>Termin</th><th className="num">Pozycja</th><th className="num">Brakuje</th><th className="r">Przydział</th></tr></thead>
                  <tbody>{candidates.map((c, i) => {
                    const take = Math.min(c.miss, p.qty)
                    return <tr key={c.l.id} className={`row${i % 2 ? ' zebra' : ''}`}>
                      <td className="strong">{c.o.no}</td><td>{c.o.client.name}</td>
                      <td><span className={`due${(c.m.dueDays ?? 9) < 0 ? ' over' : ''}`}><span className="rel">{(c.m.dueDays ?? 9) < 0 ? `${-(c.m.dueDays ?? 0)} ${c.m.dueDays === -1 ? 'dzień' : 'dni'} po terminie` : relDay(c.o.delivery)}</span></span></td>
                      <td className="num">poz. {c.l.lp}</td><td className="num crit-ink strong">{c.miss} szt.</td>
                      <td className="r"><button className={`btn sm${i === 0 ? ' primary' : ''}`} onClick={() => onAllocate(c.o, c.l.id, take)}><Link2 size={14} />Przydziel {take} szt.</button></td>
                    </tr>
                  })}</tbody>
                </table></div>
              )}
              <div className="note info"><FlagIcon level="info" size={15} /><div>Przydział tworzy ruch magazynowy i od razu zwiększa pokrycie zamówienia. Gdy przydzielasz część, partia dzieli się na dwie pozycje.</div></div>
            </>)}
          </>}

          {tab === 'cartons' && <div className="box"><table className="tbl">
            <thead><tr><th>Karton</th><th className="num">Sztuk</th><th className="num">Masa</th><th>Lokalizacja</th><th>Stan</th></tr></thead>
            <tbody>{p.cartons.map((c, i) => {
              const q = i === p.cartons.length - 1 ? p.qty - perCarton * (p.cartons.length - 1) : perCarton
              return <tr key={c} className={`row${i % 2 ? ' zebra' : ''}`}><td className="code strong">{c}</td><td className="num">{Math.max(0, q)}</td><td className="num">{kg(Math.max(0, q) * p.kgPerUnit)}</td><td>{p.location}</td><td>{STOCK_STATUS[p.status]}</td></tr>
            })}</tbody>
          </table></div>}

          {tab === 'moves' && <>
            <div className="box"><table className="tbl">
              <thead><tr><th>Data</th><th>Ruch</th><th className="num">Ilość</th><th>Kto</th><th>Dokument</th></tr></thead>
              <tbody>{p.movements.map((mv, i) => <tr key={i} className={`row${i % 2 ? ' zebra' : ''}`}><td className="num">{mv.at}</td><td>{mv.type}</td><td className={`num${mv.qty < 0 ? ' crit-ink' : ''}`}>{mv.qty > 0 ? '+' : ''}{mv.qty} szt.</td><td>{mv.who}</td><td className="code muted">{mv.doc ?? '—'}</td></tr>)}</tbody>
            </table></div>
            <div className="note"><FlagIcon level="info" size={15} /><div>Każda zmiana stanu ma swój ruch magazynowy — bez ruchu nie ma zmiany.</div></div>
          </>}

          {tab === 'trace' && <div className="box" style={{ padding: 14 }}>
            <div className="sect-h" style={{ marginBottom: 10 }}><h3>Od surowca do wyrobu</h3><span className="sub">śledzenie w obie strony</span></div>
            <div className="pline mini">
              {[
                { n: 'Surowiec', v: `R-${p.batch.slice(2, 8).replace(/(\d\d)$/, m => String(Number(m) - 2).padStart(2, '0'))}-01`, s: 'Ćwiartka z kurczaka · dostawca D-03' },
                { n: 'Rozbiór', v: 'Palety mięsa 3', s: 'udo bez kości' },
                { n: 'Masowanie', v: `M-${p.batch.slice(2, 8).replace(/(\d\d)$/, m => String(Number(m) - 1).padStart(2, '0'))}-02`, s: `${p.recipe}` },
                { n: 'Produkcja', v: p.batch, s: `${fmtDate(p.prodDate)} · Linia 1` },
                { n: 'Magazyn', v: `${p.qty} szt.`, s: p.location },
                { n: 'Wydanie', v: order ? order.no : '—', s: order ? order.client.name : 'wolne' },
              ].map((st, i) => (
                <div key={i} className={`pstage ${i < 5 ? 'ok' : order ? 'ok' : 'idle'}`}>
                  <span className="rail" />
                  <span className="ph"><span className="node"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r={i < 5 || order ? 4.5 : 4} fill={i < 5 || order ? 'var(--ok)' : 'var(--surface)'} stroke={i < 5 || order ? 'none' : 'var(--ink-4)'} strokeWidth="1.75" /></svg></span><span className="pn">{st.n}</span></span>
                  <span className="pv code" style={{ fontSize: 'var(--fs-md)' }}>{st.v}</span>
                  <span className="ps">{st.s}</span>
                </div>
              ))}
            </div>
          </div>}
        </div>
      </div>
    </>
  )
}

