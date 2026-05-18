// ════════════════════════════════════════════════════════════════════════
// NewUi2Dashboard — Pulpit operacyjny
// Renderowany WEWNĄTRZ OfficeLayout (jeden sidebar, jeden topbar — z layoutu).
// Komponent zwraca tylko zawartość dashboardu (KPI, pipeline, tabele).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import {
  Factory, Beef, Package, Boxes,
  AlertTriangle, Truck, Check,
  Scissors, Soup, ArrowRight, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi,
  finishedGoodsApi, deboningApi,
} from '@/lib/apiClient'
import { fmtKg, getExpiryStatus, todayIso } from '@/lib/utils'
import { computeDisplayStatus } from '@/components/ui/badge'

// ════════════════════════════════════════════════════════════════════════
// STYLES — scoped do .n2 (komponent renderuje się w OfficeLayout)
// ════════════════════════════════════════════════════════════════════════
const N2_CSS = `
  .n2 {
    --accent:    #1E40AF;
    --accent-lt: rgba(30, 64, 175, 0.07);
    --accent-bd: rgba(30, 64, 175, 0.20);
    --green:     #15803D;
    --green-lt:  rgba(21, 128, 61, 0.07);
    --green-bd:  rgba(21, 128, 61, 0.22);
    --amber:     #B45309;
    --amber-lt:  rgba(180, 83, 9, 0.07);
    --amber-bd:  rgba(180, 83, 9, 0.22);
    --red:       #B91C1C;
    --red-lt:    rgba(185, 28, 28, 0.07);
    --red-bd:    rgba(185, 28, 28, 0.22);
    --slate:     #64748B;
    --border:    #E2E8F0;
    --border-2:  #F1F5F9;
    --surface:   #FFFFFF;
    --ink:       #0F172A;
    --ink-2:     #475569;
    --ink-3:     #94A3B8;
    --ink-4:     #CBD5E1;
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-feature-settings: 'cv11' on, 'ss01' on;
    color: var(--ink);
    font-size: 15px;
    line-height: 1.55;
    letter-spacing: -0.005em;
  }
  .n2 *, .n2 *::before, .n2 *::after { box-sizing: border-box; }
  .n2 a { color: inherit; text-decoration: none; }
  .n2-mono { font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; font-weight: 600; }
  .n2-kicker { font-size: 11.5px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: var(--ink-2); }
  .n2-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  .n2-card-lift { transition: box-shadow 0.15s ease; }
  .n2-card-lift:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); }
  .n2-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 5px; font-size: 12px; font-weight: 600; }
  .n2-badge-green { background: var(--green-lt); color: var(--green); border: 1px solid var(--green-bd); }
  .n2-badge-amber { background: var(--amber-lt); color: var(--amber); border: 1px solid var(--amber-bd); }
  .n2-badge-red   { background: var(--red-lt);   color: var(--red);   border: 1px solid var(--red-bd);   }
  .n2-badge-blue  { background: var(--accent-lt); color: var(--accent); border: 1px solid var(--accent-bd); }
  .n2-badge-gray  { background: #F1F5F9; color: var(--slate); border: 1px solid var(--border); }
  .n2-bar { height: 4px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
  .n2-bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; }
  .n2-pipeline { display: flex; align-items: stretch; gap: 0; overflow-x: auto; }
  .n2-pipe-stage {
    flex: 1; min-width: 130px; padding: 12px 16px;
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    background: var(--surface); transition: background 0.15s;
    position: relative;
  }
  .n2-pipe-stage:first-child { border-left: 1px solid var(--border); border-radius: 8px 0 0 8px; }
  .n2-pipe-stage:last-child  { border-radius: 0 8px 8px 0; }
  .n2-pipe-stage.live  { background: rgba(21,128,61,0.04); border-top-color: var(--green); border-top-width: 2px; }
  .n2-pipe-stage.alert { background: rgba(185,28,28,0.04); border-top-color: var(--red);   border-top-width: 2px; }
  .n2-pipe-stage.idle  { opacity: 0.55; }
  .n2-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .n2-table th { padding: 10px 14px; text-align: left; font-size: 11.5px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-2); background: #FAFBFD; border-bottom: 1px solid var(--border); }
  .n2-table td { padding: 11px 14px; border-bottom: 1px solid var(--border-2); vertical-align: middle; }
  .n2-table tbody tr:last-child td { border-bottom: none; }
  .n2-table tbody tr:hover td { background: #FAFBFD; }
  .n2-table .row-live td { border-left: 2px solid var(--green); }
  .n2-table .row-live td:first-child { padding-left: 10px; }
  .n2-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
  .n2-scroll::-webkit-scrollbar-track { background: transparent; }
  .n2-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  @keyframes n2-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  .n2-live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: n2-pulse 1.8s ease-in-out infinite; flex-shrink: 0; }
  .n2-metric::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--m-color, var(--accent)); border-radius: 10px 10px 0 0; }
`

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════
function spark(base: number, variance: number, n = 20): { v: number }[] {
  let v = base
  return Array.from({ length: n }, () => {
    v = Math.max(base * 0.5, Math.min(base * 1.3, v + (Math.random() - 0.45) * variance))
    return { v: Math.round(v * 10) / 10 }
  })
}

function Sparkline({ data, color }: { data: { v: number }[]; color: string }) {
  const id = useMemo(() => `s${Math.random().toString(36).slice(2, 7)}`, [])
  return (
    <div style={{ width: '100%', height: 36 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function LiveDot() { return <span className="n2-live-dot" /> }

function Pct({ value, color = 'var(--accent)' }: { value: number; color?: string }) {
  return (
    <div className="n2-bar">
      <div className="n2-bar-fill" style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  )
}

const STATUS_BADGE: Record<string, string> = {
  confirmed:     'n2-badge-blue',
  in_production: 'n2-badge-amber',
  done:          'n2-badge-green',
  draft:         'n2-badge-gray',
  cancelled:     'n2-badge-gray',
}
const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Potwierdzone', in_production: 'W produkcji',
  done: 'Gotowe', draft: 'Szkic', cancelled: 'Anulowane',
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════
export function NewUi2Dashboard() {
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set())
  const [prodExpanded, setProdExpanded] = useState(false)

  const batchRes    = useApi(() => rawBatchesApi.list({ active_only: true, limit: 500 }))
  const meatRes     = useApi(() => meatStockApi.list())
  const seasonedRes = useApi(() => seasonedMeatApi.list())
  const plansRes    = useApi(() => productionPlansApi.list())
  const mixingRes   = useApi(() => mixingOrdersApi.list())
  const ordersRes   = useApi(() => clientOrdersApi.list())
  const finishedRes = useApi(() => finishedGoodsApi.list())
  const deboningRes = useApi(() => deboningApi.list())

  useEffect(() => {
    const t = setInterval(() => {
      batchRes.refetch(); meatRes.refetch(); seasonedRes.refetch()
      plansRes.refetch(); mixingRes.refetch(); ordersRes.refetch()
      finishedRes.refetch(); deboningRes.refetch()
    }, 7000)
    return () => clearInterval(t)
  }, [batchRes.refetch, meatRes.refetch, seasonedRes.refetch,
      plansRes.refetch, mixingRes.refetch, ordersRes.refetch,
      finishedRes.refetch, deboningRes.refetch])

  const allBatches  = batchRes.data?.data    ?? []
  const allMeat     = meatRes.data?.data     ?? []
  const allSeasoned = seasonedRes.data       ?? []
  const allPlans    = plansRes.data          ?? []
  const allMixing   = mixingRes.data         ?? []
  const allOrders   = ordersRes.data         ?? []
  const allFinished = finishedRes.data       ?? []
  const allDeboning = deboningRes.data?.data ?? []

  // ── Deboning ──
  const today    = todayIso()
  const todayDeb = useMemo(() =>
    [...allDeboning].filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today)
      .sort((a: any, b: any) => (b.createdAt ?? b.created_at ?? '') > (a.createdAt ?? a.created_at ?? '') ? 1 : -1),
    [allDeboning, today])
  const debKgQ    = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)
  const debKgMeat = todayDeb.reduce((s: number, d: any) => s + Number(d.kgMeat  ?? d.kg_meat  ?? 0), 0)
  const debYield  = debKgQ > 0 ? (debKgMeat / debKgQ) * 100 : 0

  // ── Stock ──
  const activeBatches     = allBatches.filter((b: any) => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const totalKgRaw        = activeBatches.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)
  const availableMeat     = allMeat.filter((m: any) => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat       = availableMeat.reduce((s: number, m: any) => s + Number(m.kgAvailable), 0)
  const availableSeasoned = allSeasoned.filter((s: any) => Number(s.kgAvailable) > 0)
  const totalKgSeasoned   = availableSeasoned.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)

  // ── Expiry alerts ──
  const expired  = activeBatches.filter((b: any) => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 0 && d <= 1 })
  const warnings = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })

  // ── Plans ──
  const activePlans  = allPlans.filter((p: any) => p.status !== 'done' && p.status !== 'draft')
  const finishedKgByPlan = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => { const k = f.planNo ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + Number(f.totalKg ?? 0)) })
    return m
  }, [allFinished])
  const producedKg = (p: any) => {
    const fin = finishedKgByPlan.get(p.planNo) ?? 0
    const wip = (p.lines ?? []).reduce((s: number, l: any) => s + (Number(l.qtyDone) || 0) * (Number(l.kgPerUnit) || 0), 0)
    return fin + wip
  }
  const prodPlanned  = activePlans.reduce((s: number, p: any) => s + Number(p.totalKg), 0)
  const prodProduced = activePlans.reduce((s: number, p: any) => s + producedKg(p), 0)
  const prodPct      = prodPlanned > 0 ? Math.min(100, (prodProduced / prodPlanned) * 100) : 0

  // ── Production rows ──
  const prodRows = useMemo(() => {
    type Row = { key: string; recipe: string; kg: number; pkg: string; clients: string; qtyDone: number; qtyPlan: number; kgDone: number; kgPlan: number; pct: number; live: boolean }
    const m = new Map<string, Row>()
    for (const p of activePlans) {
      for (const l of (p.lines ?? [])) {
        const recipe = l.recipeName || '—'
        const kg     = Number(l.kgPerUnit) || 0
        const pkg    = (l as any).packagingName || ''
        const client = ((l as any).clientName || '').trim()
        const key    = `${recipe}|${kg}|${pkg}`
        const qty    = Number(l.qty) || 0
        const done   = Number((l as any).qtyDone) || 0
        const status = ((l as any).lineStatus ?? 'PLANNED') as string
        const cur = m.get(key) ?? { key, recipe, kg, pkg, clients: '', qtyDone: 0, qtyPlan: 0, kgDone: 0, kgPlan: 0, pct: 0, live: false }
        cur.qtyDone += done; cur.qtyPlan += qty
        cur.kgDone  += done * kg; cur.kgPlan += qty * kg
        if (status === 'IN_PROGRESS') cur.live = true
        if (client && !cur.clients.includes(client)) cur.clients = cur.clients ? `${cur.clients}, ${client}` : client
        m.set(key, cur)
      }
    }
    const rows = Array.from(m.values()).map(r => ({ ...r, pct: r.qtyPlan > 0 ? (r.qtyDone / r.qtyPlan) * 100 : 0 }))
    // Sort: live (IN_PROGRESS) → partial (qtyDone > 0 ale nie done) → planned (qtyDone === 0) → done (pct >= 100)
    function bucket(r: any): number {
      if (r.live) return 0
      if (r.pct >= 100) return 3
      if (r.qtyDone > 0) return 1
      return 2
    }
    return rows.sort((a, b) => bucket(a) - bucket(b) || b.kgPlan - a.kgPlan)
  }, [activePlans])

  // ── Mixing ──
  const activeMixing = allMixing.filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
  const mixPct = activeMixing.length > 0
    ? Math.min(100, activeMixing.reduce((s: number, o: any) => s + Number(o.kgDone), 0) / activeMixing.reduce((s: number, o: any) => s + Number(o.meatKg), 0) * 100)
    : 0

  // ── Client orders ──
  const visibleOrders = useMemo(() =>
    [...allOrders].filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
      .sort((a: any, b: any) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999')),
    [allOrders])

  // ── Sparklines ──
  const sparks = useMemo(() => ({
    raw:      spark(Math.max(10, totalKgRaw),       totalKgRaw      * 0.04 + 1),
    meat:     spark(Math.max(10, totalKgMeat),      totalKgMeat     * 0.04 + 1),
    seasoned: spark(Math.max(10, totalKgSeasoned),  totalKgSeasoned * 0.04 + 1),
    prod:     spark(Math.max(5,  prodPct),          4),
    mix:      spark(Math.max(5,  mixPct),           4),
  }), [totalKgRaw, totalKgMeat, totalKgSeasoned, prodPct, mixPct])

  const loading = (batchRes.loading && !batchRes.data) || (plansRes.loading && !plansRes.data)

  // ── Live process detection ──
  const rozbiorLive   = todayDeb.some((d: any) => !(d.endedAt ?? d.ended_at ?? d.finishedAt ?? d.finished_at))
  const masowanieLive = activeMixing.some((o: any) => o.status === 'in_progress')
  const produkcjaLive = activePlans.some((p: any) =>
    (p.lines ?? []).some((l: any) => (l.lineStatus ?? '') === 'IN_PROGRESS'))

  // ── Match orders ↔ active production lines ──
  // Set of `clientName|recipeName` pairs currently being produced (IN_PROGRESS).
  const liveRecipeClientPairs = useMemo(() => {
    const s = new Set<string>()
    activePlans.forEach((p: any) => {
      (p.lines ?? []).forEach((l: any) => {
        if ((l.lineStatus ?? '') !== 'IN_PROGRESS') return
        const c = ((l as any).clientName ?? '').trim().toLowerCase()
        const r = (l.recipeName ?? '').toLowerCase()
        if (r) s.add(`${c}|${r}`)
      })
    })
    return s
  }, [activePlans])

  function isOrderLive(o: any): boolean {
    const c = (o.clientName ?? '').trim().toLowerCase()
    return (o.lines ?? []).some((ol: any) => {
      const r = (ol.recipeName ?? '').toLowerCase()
      return liveRecipeClientPairs.has(`${c}|${r}`) || liveRecipeClientPairs.has(`|${r}`)
    })
  }

  function orderProgress(o: any): { pct: number; qtyDone: number; qtyTotal: number; kgDone: number; kgTotal: number } {
    const t = (o.lines ?? []).reduce((acc: any, l: any) => {
      const q   = Number(l.qty) || 0
      const qd  = Number((l as any).qtyDone) || 0
      const kpu = Number(l.kgPerUnit) || 0
      acc.qty     += q
      acc.qtyDone += qd
      acc.kg      += q  * kpu
      acc.kgDone  += qd * kpu
      return acc
    }, { qty: 0, qtyDone: 0, kg: 0, kgDone: 0 })
    return {
      pct:      t.qty > 0 ? Math.min(100, (t.qtyDone / t.qty) * 100) : 0,
      qtyDone:  t.qtyDone,
      qtyTotal: t.qty,
      kgDone:   t.kgDone,
      kgTotal:  t.kg,
    }
  }

  // ── Expiry alert items ──
  const allAlerts = useMemo(() => {
    const out: { id: string; batch: string; msg: string; sev: 'high' | 'mid' | 'low' }[] = []
    expired.forEach( (b: any) => out.push({ id: b.id, batch: b.internalBatchNo, msg: `Przeterminowana · ${fmtKg(b.kgAvailable)} kg`, sev: 'high' }))
    critical.forEach((b: any) => out.push({ id: b.id, batch: b.internalBatchNo, msg: `Wygasa dziś/jutro · ${fmtKg(b.kgAvailable)} kg`, sev: 'high' }))
    warnings.forEach((b: any) => {
      const d = getExpiryStatus(b.expiryDate).daysLeft
      out.push({ id: b.id, batch: b.internalBatchNo, msg: `Za ${d} ${d === 1 ? 'dzień' : 'dni'} · ${fmtKg(b.kgAvailable)} kg`, sev: 'low' })
    })
    return out.filter(a => !ackedIds.has(a.id))
  }, [expired, critical, warnings, ackedIds])

  return (
    <div className="n2">
      <style dangerouslySetInnerHTML={{ __html: N2_CSS }} />

      {/* Page title (slim — OfficeLayout daje breadcrumb i topbar) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, margin: 0, letterSpacing: '-0.015em' }}>
            Pulpit operacyjny
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 8, marginBottom: 0 }}>
            {activePlans.length} aktywnych planów · {activeMixing.length} masowań · {todayDeb.length} sesji rozbioru · odśwież co 7s
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 7, background: 'var(--green-lt)', border: '1px solid var(--green-bd)', fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
          <LiveDot /> Na żywo
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
          <div className="n2-kicker">Ładowanie danych…</div>
        </div>
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 1 — Stany magazynów (3 karty)                          */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 16 }}>

            {/* Ćwiartka */}
            <div className="n2-card n2-card-lift n2-metric" style={{ position: 'relative', overflow: 'hidden', '--m-color': '#1D4ED8' } as React.CSSProperties}>
              <div style={{ padding: '18px 20px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <span className="n2-kicker">Ćwiartka — surowiec</span>
                  <Beef size={20} style={{ color: '#1D4ED8', opacity: 0.65 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span className="n2-mono" style={{ fontSize: 36, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{fmtKg(totalKgRaw, 0)}</span>
                  <span style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600 }}>kg na magazynie</span>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{activeBatches.length} {activeBatches.length === 1 ? 'partia' : 'partii'}</span>
                  {allAlerts.length > 0 ? (
                    <span className="n2-badge n2-badge-red"><AlertTriangle size={11} /> {allAlerts.length} alertów</span>
                  ) : totalKgRaw > 0 ? (
                    <span className="n2-badge n2-badge-green"><Check size={11} /> OK</span>
                  ) : null}
                </div>
                {/* Dziś — live counter zużycia ćwiartki przez rozbiór */}
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg, #F8FAFC)', borderRadius: 7, border: '1px solid var(--border-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="n2-kicker" style={{ fontSize: 10.5 }}>Dziś · rozbiór</span>
                    {rozbiorLive && <span className="n2-badge n2-badge-green" style={{ fontSize: 10, padding: '1px 6px' }}><LiveDot /> LIVE</span>}
                  </div>
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span className="n2-mono" style={{ fontSize: 20, fontWeight: 700, color: rozbiorLive ? 'var(--green)' : 'var(--ink)' }}>{fmtKg(debKgQ, 0)}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600 }}>kg użyto</span>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-3)', marginLeft: 'auto' }}>{todayDeb.length} {todayDeb.length === 1 ? 'sesja' : 'sesji'}</span>
                  </div>
                </div>
              </div>
              <Sparkline data={sparks.raw} color="#1D4ED8" />
              <Link to="/office/magazyn/surowiec" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 20px', borderTop: '1px solid var(--border-2)', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                Otwórz magazyn ćwiartki <ArrowRight size={14} />
              </Link>
            </div>

            {/* Mięso z/s */}
            <div className="n2-card n2-card-lift n2-metric" style={{ position: 'relative', overflow: 'hidden', '--m-color': '#15803D' } as React.CSSProperties}>
              <div style={{ padding: '18px 20px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <span className="n2-kicker">Mięso z/s — po rozbiorze</span>
                  <Package size={20} style={{ color: '#15803D', opacity: 0.65 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span className="n2-mono" style={{ fontSize: 36, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{fmtKg(totalKgMeat, 0)}</span>
                  <span style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600 }}>kg</span>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{availableMeat.length} {availableMeat.length === 1 ? 'pozycja' : 'pozycji'}</span>
                  {totalKgMeat > 0 && <span className="n2-badge n2-badge-green"><Check size={11} /> dostępne</span>}
                </div>
              </div>
              <Sparkline data={sparks.meat} color="#15803D" />
              <Link to="/office/magazyn/surowiec" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 20px', borderTop: '1px solid var(--border-2)', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                Otwórz magazyn mięsa z/s <ArrowRight size={14} />
              </Link>
            </div>

            {/* Mięso przyprawione */}
            <div className="n2-card n2-card-lift n2-metric" style={{ position: 'relative', overflow: 'hidden', '--m-color': '#7C3AED' } as React.CSSProperties}>
              <div style={{ padding: '18px 20px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <span className="n2-kicker">Mięso przyprawione</span>
                  <Boxes size={20} style={{ color: '#7C3AED', opacity: 0.65 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span className="n2-mono" style={{ fontSize: 36, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{fmtKg(totalKgSeasoned, 0)}</span>
                  <span style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600 }}>kg</span>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{availableSeasoned.length} {availableSeasoned.length === 1 ? 'szarża' : 'szarż'}</span>
                  {totalKgSeasoned > 0 && <span className="n2-badge n2-badge-green"><Check size={11} /> gotowe do produkcji</span>}
                </div>
              </div>
              <Sparkline data={sparks.seasoned} color="#7C3AED" />
              <Link to="/office/magazyn/mieso-przyp" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 20px', borderTop: '1px solid var(--border-2)', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                Otwórz magazyn mięsa przyp. <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 2 — Postęp live 3 procesów (Rozbiór · Masowanie · Produkcja) */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>

            {/* Rozbiór */}
            <div className="n2-card n2-card-lift" style={{ position: 'relative', overflow: 'hidden', borderTop: `3px solid ${rozbiorLive ? 'var(--green)' : 'var(--border)'}` }}>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Scissors size={18} style={{ color: '#0E7490' }} />
                    <span style={{ fontWeight: 600, fontSize: 16 }}>Rozbiór</span>
                    {rozbiorLive && <span className="n2-badge n2-badge-green"><LiveDot /> LIVE</span>}
                  </div>
                  <Link to="/office/deboning" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    Sesje <ArrowRight size={13} />
                  </Link>
                </div>
                <div className="n2-mono" style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
                  {fmtKg(debKgMeat, 0)} <span style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 500 }}>kg mięsa</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
                  z {fmtKg(debKgQ, 0)} kg ćwiartki · {todayDeb.length} {todayDeb.length === 1 ? 'sesja' : 'sesji'} dziś
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span className="n2-kicker" style={{ fontSize: 10.5 }}>Yield · mięso / ćwiartka</span>
                    <span className="n2-mono" style={{ fontSize: 14, fontWeight: 700, color: debYield > 65 ? 'var(--green)' : debYield > 0 ? 'var(--amber)' : 'var(--ink-3)' }}>
                      {debYield > 0 ? `${debYield.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  <Pct value={debYield} color={debYield > 65 ? 'var(--green)' : 'var(--amber)'} />
                </div>
              </div>
            </div>

            {/* Masowanie */}
            <div className="n2-card n2-card-lift" style={{ position: 'relative', overflow: 'hidden', borderTop: `3px solid ${masowanieLive ? 'var(--green)' : 'var(--border)'}` }}>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Soup size={18} style={{ color: '#7C3AED' }} />
                    <span style={{ fontWeight: 600, fontSize: 16 }}>Masowanie</span>
                    {masowanieLive && <span className="n2-badge n2-badge-green"><LiveDot /> LIVE</span>}
                  </div>
                  <Link to="/office/planowanie-masowania" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    Plan <ArrowRight size={13} />
                  </Link>
                </div>
                <div className="n2-mono" style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
                  {activeMixing.length > 0 ? `${mixPct.toFixed(0)}%` : '—'}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
                  {activeMixing.length} {activeMixing.length === 1 ? 'aktywne zlecenie' : 'aktywnych zleceń'}
                </div>
                {activeMixing.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeMixing.slice(0, 3).map((o: any) => {
                      const pct = Number(o.meatKg) > 0 ? Math.min(100, Number(o.kgDone) / Number(o.meatKg) * 100) : 0
                      return (
                        <div key={o.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{o.recipeName ?? '—'}</span>
                            <span className="n2-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{fmtKg(o.kgDone, 0)} / {fmtKg(o.meatKg, 0)} kg</span>
                          </div>
                          <Pct value={pct} color="#7C3AED" />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Produkcja — z rozwijanym pełnym widokiem wszystkich pozycji */}
            <div className="n2-card n2-card-lift" style={{ position: 'relative', overflow: 'hidden', borderTop: `3px solid ${produkcjaLive ? 'var(--green)' : 'var(--border)'}` }}>
              <div style={{ padding: '16px 20px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Factory size={18} style={{ color: '#D97706' }} />
                    <span style={{ fontWeight: 600, fontSize: 16 }}>Produkcja</span>
                    {produkcjaLive && <span className="n2-badge n2-badge-green"><LiveDot /> LIVE</span>}
                  </div>
                  <Link to="/office/planowanie-produkcji" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    Plany <ArrowRight size={13} />
                  </Link>
                </div>

                {/* Total — %  +  planowane kg */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="n2-mono" style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
                    {activePlans.length > 0 ? `${prodPct.toFixed(0)}%` : '—'}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>postęp total</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-2)' }}>
                  <span className="n2-mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtKg(prodProduced, 0)}</span>
                  <span> / </span>
                  <span className="n2-mono" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>{fmtKg(prodPlanned, 0)} kg</span>
                  <span> · {activePlans.length} {activePlans.length === 1 ? 'plan' : 'planów'}</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Pct value={prodPct} color={produkcjaLive ? 'var(--green)' : '#D97706'} />
                </div>

                {/* Aktualnie produkowany rodzaj (pierwszy live row) */}
                {prodRows.filter(r => r.live).slice(0, 1).map(r => (
                  <div key={r.key} style={{ marginTop: 12, padding: '10px 12px', background: 'var(--green-lt)', borderRadius: 7, border: '1px solid var(--green-bd)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span className="n2-kicker" style={{ fontSize: 10.5, color: 'var(--green)' }}>
                        <LiveDot /> Aktualnie produkowane
                      </span>
                      <span className="n2-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>{r.pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{r.recipe}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                      <span className="n2-mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.qtyDone}</span>
                      <span> / </span>
                      <span className="n2-mono" style={{ fontWeight: 700 }}>{r.qtyPlan} szt</span>
                      <span style={{ color: 'var(--ink-3)' }}> × {r.kg} kg </span>
                      <span> = </span>
                      <span className="n2-mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtKg(r.kgPlan, 0)} kg</span>
                    </div>
                    {r.clients && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>dla: {r.clients}</div>}
                  </div>
                ))}

                {/* Najbliższe 2 pozycje (nie-live, partial / planned, NIE done) */}
                {(() => {
                  const next = prodRows.filter(r => !r.live && r.pct < 100).slice(0, 2)
                  return next.length > 0 ? (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <span className="n2-kicker" style={{ fontSize: 10 }}>Następne</span>
                      {next.map(r => (
                        <div key={r.key}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{r.recipe}</span>
                            <span className="n2-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.qtyDone} / {r.qtyPlan} szt</span>
                          </div>
                          <Pct value={r.pct} color={r.pct > 0 ? '#D97706' : 'var(--border)'} />
                        </div>
                      ))}
                    </div>
                  ) : null
                })()}
              </div>

              {/* Rozwiń pełną listę */}
              {prodRows.length > 0 && (
                <button
                  onClick={() => setProdExpanded(v => !v)}
                  style={{ width: '100%', padding: '10px 20px', borderTop: '1px solid var(--border-2)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}
                >
                  <span>
                    {prodExpanded ? 'Zwiń' : `Pokaż wszystkie pozycje (${prodRows.length})`}
                  </span>
                  {prodExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}

              {/* Rozwinięta lista wszystkich pozycji */}
              {prodExpanded && prodRows.length > 0 && (
                <div className="n2-scroll" style={{ maxHeight: 400, overflowY: 'auto', borderTop: '1px solid var(--border-2)' }}>
                  <table className="n2-table">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th>Status</th>
                        <th>Receptura</th>
                        <th>Postęp</th>
                        <th style={{ textAlign: 'right' }}>szt</th>
                        <th style={{ textAlign: 'right' }}>kg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodRows.map(r => {
                        const done    = r.pct >= 100
                        const partial = !r.live && !done && r.qtyDone > 0
                        const planned = !r.live && !done && r.qtyDone === 0
                        return (
                          <tr key={r.key} className={r.live ? 'row-live' : ''}>
                            <td>
                              {r.live   ? <span className="n2-badge n2-badge-green"><LiveDot /> LIVE</span>
                              : done    ? <span className="n2-badge n2-badge-gray"><Check size={10} /> Zakończone</span>
                              : partial ? <span className="n2-badge n2-badge-amber">W toku</span>
                              : planned ? <span className="n2-badge n2-badge-blue">Następne</span>
                              : null}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13.5, color: done ? 'var(--ink-3)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none' }}>{r.recipe}</div>
                              {r.pkg && <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 2 }}>{r.pkg}</div>}
                              {r.clients && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{r.clients}</div>}
                            </td>
                            <td style={{ width: 140 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <Pct value={r.pct} color={done ? 'var(--green)' : r.live ? 'var(--green)' : partial ? '#D97706' : 'var(--border)'} />
                                </div>
                                <span className="n2-mono" style={{ fontSize: 12, fontWeight: 700, minWidth: 36, color: done ? 'var(--green)' : r.live ? 'var(--green)' : 'var(--ink-2)' }}>{r.pct.toFixed(0)}%</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className="n2-mono" style={{ fontSize: 13 }}>
                                <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.qtyDone}</span>
                                <span style={{ color: 'var(--ink-3)' }}> / {r.qtyPlan}</span>
                              </span>
                              <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>× {r.kg} kg</div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className="n2-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{fmtKg(r.kgPlan, 0)}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 3 — Pełna lista zamówień z postępem live              */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className="n2-card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Truck size={16} style={{ color: 'var(--amber)' }} />
                <span style={{ fontWeight: 600, fontSize: 15 }}>Zamówienia · postęp produkcji</span>
                <span className="n2-badge n2-badge-gray">{visibleOrders.length} aktywnych</span>
                {visibleOrders.filter(isOrderLive).length > 0 && (
                  <span className="n2-badge n2-badge-green"><LiveDot /> {visibleOrders.filter(isOrderLive).length} live</span>
                )}
              </div>
              <Link to="/office/zamowienia" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                Otwórz pełną listę <ArrowRight size={13} />
              </Link>
            </div>
            {visibleOrders.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 14, color: 'var(--ink-2)', fontStyle: 'italic' }}>Brak aktywnych zamówień</div>
            ) : (
              <div className="n2-scroll" style={{ maxHeight: 560, overflowY: 'auto' }}>
                <table className="n2-table">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      <th>Nr / Klient</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Dostawa</th>
                      <th>Postęp produkcji</th>
                      <th style={{ textAlign: 'right' }}>Szt</th>
                      <th style={{ textAlign: 'right' }}>kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((o: any) => {
                      const daysLeft = o.deliveryDate
                        ? Math.round((new Date(o.deliveryDate).getTime() - Date.now()) / 86400000)
                        : null
                      const urgent = daysLeft !== null && daysLeft <= 2
                      const live   = isOrderLive(o)
                      const prog   = orderProgress(o)
                      const progDone = prog.pct >= 100
                      return (
                        <tr key={o.id} className={live ? 'row-live' : ''}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <span className="n2-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{o.orderNo}</span>
                              {live && <span className="n2-badge n2-badge-green" style={{ fontSize: 10.5, padding: '1px 6px' }}><LiveDot /> LIVE</span>}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{o.clientName}</div>
                          </td>
                          <td>
                            <span className={`n2-badge ${STATUS_BADGE[o.status] ?? 'n2-badge-gray'}`}>
                              {STATUS_LABEL[o.status] ?? o.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {o.deliveryDate ? (
                              <div>
                                <div className="n2-mono" style={{ fontSize: 14, color: urgent ? 'var(--red)' : 'var(--ink)', fontWeight: urgent ? 700 : 600 }}>
                                  {new Date(o.deliveryDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}
                                </div>
                                {daysLeft !== null && (
                                  <div style={{ fontSize: 11.5, color: urgent ? 'var(--red)' : 'var(--ink-2)' }}>
                                    {daysLeft < 0 ? 'po terminie' : daysLeft === 0 ? 'dziś' : `za ${daysLeft}d`}
                                  </div>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          <td style={{ width: 200, minWidth: 180 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ flex: 1 }}>
                                <Pct value={prog.pct} color={progDone ? 'var(--green)' : live ? 'var(--green)' : prog.pct > 0 ? '#D97706' : 'var(--border)'} />
                              </div>
                              <span className="n2-mono" style={{ fontSize: 13, fontWeight: 700, minWidth: 42, color: progDone ? 'var(--green)' : live ? 'var(--green)' : 'var(--ink-2)' }}>
                                {prog.pct.toFixed(0)}%
                              </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 3 }}>
                              {prog.qtyDone} / {prog.qtyTotal} szt
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="n2-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{o.totalUnits ?? '—'}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="n2-mono" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{fmtKg(o.totalKg ?? 0, 0)}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Alerty (jeżeli są) — kompaktowy banner na dole */}
          {allAlerts.length > 0 && (
            <div className="n2-card" style={{ marginTop: 16, overflow: 'hidden', borderColor: 'var(--red-bd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--red-lt)' }}>
                <AlertTriangle size={16} style={{ color: 'var(--red)' }} />
                <span style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--red)' }}>Alerty terminu — {allAlerts.length}</span>
              </div>
              <div className="n2-scroll" style={{ maxHeight: 200, overflowY: 'auto' }}>
                {allAlerts.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--border-2)' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: a.sev === 'high' ? 'var(--red)' : 'var(--amber)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="n2-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{a.batch}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2 }}>{a.msg}</div>
                    </div>
                    <button
                      style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 5, background: 'var(--border-2)', border: '1px solid var(--border)', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer' }}
                      onClick={() => setAckedIds(prev => new Set([...prev, a.id]))}
                    >
                      ACK
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
