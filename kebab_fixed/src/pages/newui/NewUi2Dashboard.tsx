// ════════════════════════════════════════════════════════════════════════
// NewUi2Dashboard — "Command Center Light"
// My take: Linear/Vercel precision meets industrial MES clarity
// Light mode · Real data · shadcn/ui aesthetic
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import {
  LayoutDashboard, Factory, ShieldAlert, BadgeCheck, ClipboardList,
  Beef, Package, Boxes, PackageCheck, Users, Settings, ChevronRight,
  Activity, Cpu, Zap, AlertTriangle, Clock, Truck, Check,
  BarChart3, GitBranch, Layers, Bell, MoreHorizontal,
  Scissors, Soup, Menu, X, TrendingUp, TrendingDown,
  ArrowRight, Monitor,
} from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi,
  finishedGoodsApi, deboningApi,
} from '@/lib/apiClient'
import { fmtKg, fmtDatePl, getExpiryStatus, todayIso } from '@/lib/utils'
import { computeDisplayStatus } from '@/components/ui/badge'

// ════════════════════════════════════════════════════════════════════════
// STYLES — scoped, light, precise
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
    --bg:        #F8FAFC;
    --surface:   #FFFFFF;
    --ink:       #0F172A;
    --ink-2:     #475569;
    --ink-3:     #94A3B8;
    --ink-4:     #CBD5E1;

    font-family: 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: 'cv11' on;
    background: var(--bg);
    color: var(--ink);
    font-size: 13.5px;
    line-height: 1.5;
    display: flex;
    min-height: 100vh;
    overflow: hidden;
  }
  .n2 *, .n2 *::before, .n2 *::after { box-sizing: border-box; }
  .n2 a { color: inherit; text-decoration: none; }

  /* Typography */
  .n2-mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .n2-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }

  /* Cards */
  .n2-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  .n2-card-lift { transition: box-shadow 0.15s ease; }
  .n2-card-lift:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); }

  /* Badges */
  .n2-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 600; }
  .n2-badge-green { background: var(--green-lt); color: var(--green); border: 1px solid var(--green-bd); }
  .n2-badge-amber { background: var(--amber-lt); color: var(--amber); border: 1px solid var(--amber-bd); }
  .n2-badge-red   { background: var(--red-lt);   color: var(--red);   border: 1px solid var(--red-bd);   }
  .n2-badge-blue  { background: var(--accent-lt); color: var(--accent); border: 1px solid var(--accent-bd); }
  .n2-badge-gray  { background: #F1F5F9; color: var(--slate); border: 1px solid var(--border); }

  /* Progress bar */
  .n2-bar { height: 4px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
  .n2-bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; }

  /* Sidebar */
  .n2-sidebar {
    width: 220px; flex-shrink: 0;
    background: var(--surface); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; height: 100vh;
    transition: transform 0.22s ease;
  }
  .n2-nav-item {
    display: flex; align-items: center; gap: 9px;
    padding: 6px 10px; border-radius: 6px;
    font-size: 13px; font-weight: 500; color: var(--ink-2);
    transition: all 0.1s ease; cursor: pointer;
    border-left: 2px solid transparent; margin: 1px 6px;
  }
  .n2-nav-item:hover { background: var(--bg); color: var(--ink); }
  .n2-nav-item.active { background: var(--accent-lt); color: var(--accent); border-left-color: var(--accent); font-weight: 600; }
  .n2-nav-badge {
    margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px;
    background: var(--red); color: white; border-radius: 9px;
    font-size: 10px; font-weight: 700; display: grid; place-items: center;
  }

  /* Pipeline */
  .n2-pipeline { display: flex; align-items: stretch; gap: 0; overflow-x: auto; }
  .n2-pipe-stage {
    flex: 1; min-width: 110px; padding: 10px 14px;
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

  /* Table */
  .n2-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .n2-table th { padding: 7px 12px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); background: #FAFBFD; border-bottom: 1px solid var(--border); }
  .n2-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-2); vertical-align: middle; }
  .n2-table tbody tr:last-child td { border-bottom: none; }
  .n2-table tbody tr:hover td { background: #FAFBFD; }
  .n2-table .row-live td { border-left: 2px solid var(--green); }
  .n2-table .row-live td:first-child { padding-left: 10px; }

  /* Scrollbar */
  .n2-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
  .n2-scroll::-webkit-scrollbar-track { background: transparent; }
  .n2-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  /* Animations */
  @keyframes n2-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes n2-tick  { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
  .n2-live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: n2-pulse 1.8s ease-in-out infinite; flex-shrink: 0; }
  .n2-tick { animation: n2-tick 0.3s ease-out; }

  /* Metric accent lines */
  .n2-metric::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--m-color, var(--accent)); border-radius: 10px 10px 0 0; }

  /* Mobile */
  .n2-hamburger { display: none; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; color: var(--ink-2); }
  .n2-overlay   { display: none; position: fixed; inset: 0; background: rgba(15,23,42,0.45); backdrop-filter: blur(2px); z-index: 49; }
  .n2-overlay.open { display: block; }
  @media (max-width: 768px) {
    .n2-sidebar { position: fixed; left: 0; top: 0; height: 100vh; z-index: 50; transform: translateX(-100%); }
    .n2-sidebar.open { transform: translateX(0); box-shadow: 4px 0 24px rgba(0,0,0,0.12); }
    .n2-hamburger { display: flex; }
    .n2-hide-sm { display: none !important; }
  }
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

function LiveDot() {
  return <span className="n2-live-dot" />
}

function Pct({ value, color = 'var(--accent)' }: { value: number; color?: string }) {
  return (
    <div>
      <div className="n2-bar">
        <div className="n2-bar-fill" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════════════
function Sidebar2({ isOpen, onClose, alertCount }: { isOpen?: boolean; onClose?: () => void; alertCount: number }) {
  const NAV = [
    { section: 'Monitoring', items: [
      { label: 'Pulpit',           icon: <LayoutDashboard size={14} />, to: '/newui2', active: true },
      { label: 'Linie prod.',      icon: <Factory size={14} />,         to: '#' },
      { label: 'Alarmy',           icon: <ShieldAlert size={14} />,    to: '#', badge: alertCount },
      { label: 'HACCP · Jakość',   icon: <BadgeCheck size={14} />,     to: '#' },
    ]},
    { section: 'Operacje', items: [
      { label: 'Zlecenia',         icon: <ClipboardList size={14} />,  to: '/office/zamowienia' },
      { label: 'Receptury',        icon: <Layers size={14} />,         to: '/office/receptury' },
      { label: 'Surowiec',         icon: <Beef size={14} />,           to: '/office/magazyn/surowiec' },
      { label: 'Mięso z/s',        icon: <Package size={14} />,        to: '/office/magazyn/surowiec' },
      { label: 'Mięso przyp.',     icon: <Boxes size={14} />,          to: '/office/magazyn/mieso-przyp' },
      { label: 'Wyrób gotowy',     icon: <PackageCheck size={14} />,   to: '/office/magazyn/gotowe' },
    ]},
    { section: 'Raporty', items: [
      { label: 'Raporty',          icon: <BarChart3 size={14} />,      to: '/office/deboning' },
      { label: 'Traceability',     icon: <GitBranch size={14} />,      to: '#' },
      { label: 'Ustawienia',       icon: <Settings size={14} />,       to: '/office/ustawienia' },
    ]},
  ]

  return (
    <aside className={`n2-sidebar${isOpen ? ' open' : ''}`}>
      {/* Brand */}
      <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #1E40AF, #3B82F6)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Cpu size={16} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Kebab MES</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>Produkcja</div>
          </div>
        </div>
        <button className="n2-hamburger" onClick={onClose} style={{ flexShrink: 0 }}><X size={14} /></button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }} className="n2-scroll">
        {NAV.map(s => (
          <div key={s.section} style={{ marginBottom: 4 }}>
            <div className="n2-kicker" style={{ padding: '8px 16px 4px' }}>{s.section}</div>
            {s.items.map(item => (
              <Link
                key={item.label}
                to={item.to}
                className={`n2-nav-item${item.active ? ' active' : ''}`}
              >
                <span style={{ color: item.active ? 'var(--accent)' : 'var(--ink-3)', flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {(item as any).badge > 0 && (
                  <span className="n2-nav-badge">{(item as any).badge}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer links */}
      <div style={{ padding: '8px 8px 12px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, color: 'var(--ink-3)', padding: '4px 8px 8px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>Inne widoki</div>
        <Link to="/newui"            className="n2-nav-item" style={{ fontSize: 12 }}><Monitor size={13} /> Dark SCADA</Link>
        <Link to="/office/dashboard-classic" className="n2-nav-item" style={{ fontSize: 12 }}><LayoutDashboard size={13} /> Klasyczny</Link>
      </div>

      {/* User */}
      <div style={{ padding: '10px 10px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: 'var(--bg)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #7C3AED, #2563EB)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>AM</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Admin MES</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Kierownik</div>
          </div>
          <MoreHorizontal size={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
        </div>
      </div>
    </aside>
  )
}

// ════════════════════════════════════════════════════════════════════════
// TOPBAR
// ════════════════════════════════════════════════════════════════════════
function TopBar2({ alertCount, onMenuClick }: { alertCount: number; onMenuClick?: () => void }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'short' })

  return (
    <header style={{
      height: 52, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', flexShrink: 0,
    }}>
      <button className="n2-hamburger" onClick={onMenuClick}><Menu size={15} /></button>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
        <Link to="/office/dashboard" style={{ color: 'var(--ink-3)' }}><LayoutDashboard size={13} /></Link>
        <ChevronRight size={12} style={{ color: 'var(--ink-4)' }} />
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Pulpit operacyjny</span>
        <span className="n2-badge n2-badge-blue n2-hide-sm" style={{ marginLeft: 4 }}>v2 Light</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Live indicator */}
      <div className="n2-hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
        <LiveDot />
        <span style={{ fontWeight: 600 }}>Na żywo</span>
        <span style={{ color: 'var(--ink-3)' }}>· 7s</span>
      </div>

      {/* Alerts */}
      {alertCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'var(--red-lt)', border: '1px solid var(--red-bd)', fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>
          <AlertTriangle size={12} />
          <span>{alertCount} alertów</span>
        </div>
      )}

      {/* Bell */}
      <div style={{ position: 'relative' }}>
        <button style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', cursor: 'pointer' }}>
          <Bell size={14} />
        </button>
      </div>

      {/* Time */}
      <div className="n2-hide-sm" style={{ paddingLeft: 12, borderLeft: '1px solid var(--border)', textAlign: 'right' }}>
        <div className="n2-mono" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{time}</div>
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>{date}</div>
      </div>
    </header>
  )
}

// ════════════════════════════════════════════════════════════════════════
// PIPELINE STRIP — production flow visualization
// ════════════════════════════════════════════════════════════════════════
function PipelineStrip({ stages }: { stages: { label: string; icon: React.ReactNode; value: string; unit: string; state: 'live' | 'active' | 'alert' | 'idle' }[] }) {
  const stateColors: Record<string, string> = {
    live:   'var(--green)',
    active: 'var(--accent)',
    alert:  'var(--red)',
    idle:   'var(--ink-3)',
  }
  return (
    <div style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {stages.map((s, i) => (
        <div key={s.label} className={`n2-pipe-stage ${s.state}`} style={{ flex: 1, minWidth: 100, borderRight: i < stages.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <span style={{ color: stateColors[s.state], flexShrink: 0 }}>{s.icon}</span>
            <span className="n2-kicker" style={{ fontSize: 9 }}>{s.label}</span>
            {s.state === 'live' && <LiveDot />}
          </div>
          <div className="n2-mono" style={{ fontSize: 18, fontWeight: 700, color: s.state === 'idle' ? 'var(--ink-3)' : 'var(--ink)', lineHeight: 1 }}>
            {s.value}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>{s.unit}</div>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// METRIC CARD
// ════════════════════════════════════════════════════════════════════════
function MetricCard({ label, value, unit, sub, color, sparkData, icon }: {
  label: string; value: React.ReactNode; unit?: string; sub?: string
  color: string; sparkData: { v: number }[]; icon: React.ReactNode
}) {
  return (
    <div className="n2-card n2-card-lift n2-metric" style={{ position: 'relative', overflow: 'hidden', '--m-color': color } as React.CSSProperties}>
      <div style={{ padding: '14px 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="n2-kicker">{label}</span>
          <span style={{ color, opacity: 0.7 }}>{icon}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span className="n2-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{value}</span>
          {unit && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{unit}</span>}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
      </div>
      <Sparkline data={sparkData} color={color} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// STOCK WIDGET — warehouse summary cards
// ════════════════════════════════════════════════════════════════════════
function StockRow({ label, kg, pct, color }: { label: string; kg: number; pct: number; color: string }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-2)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span>
        <span className="n2-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{fmtKg(kg, 0)} kg</span>
      </div>
      <Pct value={pct} color={color} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// ORDERS WIDGET
// ════════════════════════════════════════════════════════════════════════
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set())

  // ── API ───────────────────────────────────────────────────────────────
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

  // ── Deboning ──────────────────────────────────────────────────────────
  const today      = todayIso()
  const todayDeb   = useMemo(() =>
    [...allDeboning].filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today)
      .sort((a: any, b: any) => (b.createdAt ?? b.created_at ?? '') > (a.createdAt ?? a.created_at ?? '') ? 1 : -1),
    [allDeboning, today])
  const debKgQ     = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)
  const debKgMeat  = todayDeb.reduce((s: number, d: any) => s + Number(d.kgMeat  ?? d.kg_meat  ?? 0), 0)
  const debYield   = debKgQ > 0 ? (debKgMeat / debKgQ) * 100 : 0

  // ── Stock ─────────────────────────────────────────────────────────────
  const activeBatches     = allBatches.filter((b: any) => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const totalKgRaw        = activeBatches.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)
  const availableMeat     = allMeat.filter((m: any) => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat       = availableMeat.reduce((s: number, m: any) => s + Number(m.kgAvailable), 0)
  const availableSeasoned = allSeasoned.filter((s: any) => Number(s.kgAvailable) > 0)
  const totalKgSeasoned   = availableSeasoned.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)

  // ── Expiry alerts ─────────────────────────────────────────────────────
  const expired  = activeBatches.filter((b: any) => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 0 && d <= 1 })
  const warnings = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })
  const alertCount = expired.length + critical.length + warnings.length

  // ── Plans ─────────────────────────────────────────────────────────────
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

  // ── Production types table rows ───────────────────────────────────────
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
    return rows.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.kgPlan - a.kgPlan)
  }, [activePlans])

  // ── Mixing ────────────────────────────────────────────────────────────
  const activeMixing = allMixing.filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
  const mixPct       = activeMixing.length > 0
    ? Math.min(100, activeMixing.reduce((s: number, o: any) => s + Number(o.kgDone), 0) / activeMixing.reduce((s: number, o: any) => s + Number(o.meatKg), 0) * 100)
    : 0

  // ── Client orders ─────────────────────────────────────────────────────
  const visibleOrders = useMemo(() =>
    [...allOrders].filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
      .sort((a: any, b: any) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999')),
    [allOrders])

  // ── Sparklines ────────────────────────────────────────────────────────
  const sparks = useMemo(() => ({
    raw:      spark(Math.max(10, totalKgRaw),       totalKgRaw      * 0.04 + 1),
    meat:     spark(Math.max(10, totalKgMeat),      totalKgMeat     * 0.04 + 1),
    seasoned: spark(Math.max(10, totalKgSeasoned),  totalKgSeasoned * 0.04 + 1),
    prod:     spark(Math.max(5,  prodPct),          4),
    mix:      spark(Math.max(5,  mixPct),           4),
  }), [totalKgRaw, totalKgMeat, totalKgSeasoned, prodPct, mixPct])

  const loading = (batchRes.loading && !batchRes.data) || (plansRes.loading && !plansRes.data)

  // ── Pipeline stages ───────────────────────────────────────────────────
  const pipeStages = [
    { label: 'Ćwiartka',    icon: <Beef size={13} />,        value: fmtKg(totalKgRaw, 0),      unit: 'kg magazyn',  state: (totalKgRaw > 0 ? 'active' : 'idle') as any },
    { label: 'Rozbiór',     icon: <Scissors size={13} />,    value: String(todayDeb.length),    unit: 'sesji dziś',  state: (todayDeb.length > 0 ? 'live' : 'idle') as any },
    { label: 'Mięso z/s',   icon: <Package size={13} />,     value: fmtKg(totalKgMeat, 0),     unit: 'kg dostępne', state: (totalKgMeat > 0 ? 'active' : 'idle') as any },
    { label: 'Masowanie',   icon: <Soup size={13} />,        value: activeMixing.length > 0 ? `${mixPct.toFixed(0)}%` : '—', unit: `${activeMixing.length} aktywnych`, state: (activeMixing.length > 0 ? 'live' : 'idle') as any },
    { label: 'Mięso przyp.',icon: <Boxes size={13} />,       value: fmtKg(totalKgSeasoned, 0), unit: 'kg gotowe',   state: (totalKgSeasoned > 0 ? 'active' : 'idle') as any },
    { label: 'Produkcja',   icon: <Factory size={13} />,     value: activePlans.length > 0 ? `${prodPct.toFixed(0)}%` : '—', unit: `${activePlans.length} planów`,   state: (activePlans.length > 0 ? 'live' : 'idle') as any },
    { label: 'Wyrób gotowy',icon: <PackageCheck size={13} />, value: String(allFinished.length), unit: 'partii',     state: (allFinished.length > 0 ? 'active' : 'idle') as any },
  ]

  // ── Expiry alert items ────────────────────────────────────────────────
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
    <>
      <style dangerouslySetInnerHTML={{ __html: N2_CSS }} />
      <div className="n2">
        {/* Mobile overlay */}
        <div className={`n2-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />

        <Sidebar2 isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} alertCount={alertCount} />

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100vh', overflow: 'hidden' }}>
          <TopBar2 alertCount={alertCount} onMenuClick={() => setSidebarOpen(v => !v)} />

          <main style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }} className="n2-scroll">

            {/* Page title */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, margin: 0 }}>
                  Pulpit operacyjny
                </h1>
                <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 5, marginBottom: 0 }}>
                  {activePlans.length} aktywnych planów · {activeMixing.length} masowań · rozbiór {todayDeb.length} sesji · odśwież co 7s
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: 'var(--green-lt)', border: '1px solid var(--green-bd)', fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
                  <LiveDot /> Na żywo
                </div>
                <Link to="/newui" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: '#0F172A', color: 'white', fontSize: 12, fontWeight: 600 }}>
                  <Monitor size={12} /> Dark mode
                </Link>
              </div>
            </div>

            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <div className="n2-kicker">Ładowanie danych…</div>
              </div>
            ) : (
              <>
                {/* ── Pipeline ── */}
                <div style={{ marginBottom: 20 }}>
                  <PipelineStrip stages={pipeStages} />
                </div>

                {/* ── KPI row ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                  <MetricCard label="Ćwiartka · magazyn"   value={fmtKg(totalKgRaw, 0)}      unit="kg"  sub={`${activeBatches.length} partii · ${alertCount > 0 ? alertCount + ' alertów' : 'OK'}`} color="#1D4ED8" sparkData={sparks.raw}      icon={<Beef size={14} />} />
                  <MetricCard label="Mięso z/s"            value={fmtKg(totalKgMeat, 0)}     unit="kg"  sub={`${availableMeat.length} pozycji`}   color="#15803D" sparkData={sparks.meat}     icon={<Package size={14} />} />
                  <MetricCard label="Mięso przyprawione"   value={fmtKg(totalKgSeasoned, 0)} unit="kg"  sub={`${availableSeasoned.length} szarż`}  color="#7C3AED" sparkData={sparks.seasoned} icon={<Boxes size={14} />} />
                  <MetricCard label="Produkcja · postęp"   value={`${prodPct.toFixed(1)}`}   unit="%"   sub={`${fmtKg(prodProduced,0)} / ${fmtKg(prodPlanned,0)} kg`} color="#D97706" sparkData={sparks.prod} icon={<Factory size={14} />} />
                  <MetricCard label="Masowanie · postęp"   value={`${mixPct.toFixed(1)}`}    unit="%"   sub={`${activeMixing.length} aktywnych zleceń`} color="#0891B2" sparkData={sparks.mix} icon={<Soup size={14} />} />
                </div>

                {/* ── Main grid: table + alerts ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>

                  {/* Production table */}
                  <div className="n2-card" style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Factory size={14} style={{ color: 'var(--accent)' }} />
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Aktywna produkcja</span>
                        <span className="n2-badge n2-badge-blue">{prodRows.length} pozycji</span>
                      </div>
                      <Link to="/office/planowanie-produkcji" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                        Plany <ArrowRight size={12} />
                      </Link>
                    </div>
                    {prodRows.length === 0 ? (
                      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                        <Factory size={28} style={{ color: 'var(--ink-4)', margin: '0 auto 10px' }} />
                        <div style={{ fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>Brak aktywnych planów produkcji</div>
                        <Link to="/office/planowanie-produkcji" style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>Aktywuj plan →</Link>
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }} className="n2-scroll">
                        <table className="n2-table">
                          <thead>
                            <tr>
                              <th>Status</th>
                              <th>Receptura</th>
                              <th style={{ textAlign: 'right' }}>kg/szt</th>
                              <th>Postęp</th>
                              <th style={{ textAlign: 'right' }}>Wyk./Plan</th>
                              <th>Klient</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prodRows.map(r => (
                              <tr key={r.key} className={r.live ? 'row-live' : ''}>
                                <td>
                                  {r.live
                                    ? <span className="n2-badge n2-badge-green"><LiveDot /> Running</span>
                                    : r.pct >= 100
                                    ? <span className="n2-badge n2-badge-gray"><Check size={9} /> Done</span>
                                    : r.qtyDone > 0
                                    ? <span className="n2-badge n2-badge-amber">W toku</span>
                                    : <span className="n2-badge n2-badge-gray">Plan</span>
                                  }
                                </td>
                                <td>
                                  <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--ink)' }}>{r.recipe}</div>
                                  {r.pkg && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.pkg}</div>}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <span className="n2-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.kg} kg</span>
                                </td>
                                <td style={{ width: 120 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1 }}><Pct value={r.pct} color={r.live ? 'var(--green)' : r.pct > 0 ? 'var(--amber)' : 'var(--border)'} /></div>
                                    <span className="n2-mono" style={{ fontSize: 11, color: r.live ? 'var(--green)' : 'var(--ink-3)', fontWeight: 600, minWidth: 30 }}>{r.pct.toFixed(0)}%</span>
                                  </div>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <span className="n2-mono" style={{ fontSize: 12 }}>
                                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.qtyDone}</span>
                                    <span style={{ color: 'var(--ink-3)' }}> / {r.qtyPlan} szt</span>
                                  </span>
                                </td>
                                <td style={{ fontSize: 12, color: 'var(--ink-2)', maxWidth: 120 }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.clients || '—'}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Alerts + mixing */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* Expiry alerts */}
                    <div className="n2-card" style={{ overflow: 'hidden', flex: allAlerts.length > 0 ? 1 : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                        <AlertTriangle size={14} style={{ color: allAlerts.length > 0 ? 'var(--red)' : 'var(--ink-3)' }} />
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Alerty terminu</span>
                        {allAlerts.length > 0 && <span className="n2-badge n2-badge-red">{allAlerts.length}</span>}
                      </div>
                      {allAlerts.length === 0 ? (
                        <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Check size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />
                          <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>Brak alertów — wszystkie partie OK</span>
                        </div>
                      ) : (
                        <div className="n2-scroll" style={{ maxHeight: 260, overflowY: 'auto' }}>
                          {allAlerts.map(a => (
                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: '1px solid var(--border-2)' }}>
                              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: a.sev === 'high' ? 'var(--red)' : 'var(--amber)' }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="n2-mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{a.batch}</div>
                                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{a.msg}</div>
                              </div>
                              <button
                                style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 4, background: 'var(--border-2)', border: '1px solid var(--border)', fontSize: 10, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer' }}
                                onClick={() => setAckedIds(prev => new Set([...prev, a.id]))}
                              >
                                ACK
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Mixing orders */}
                    <div className="n2-card" style={{ overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                        <Soup size={14} style={{ color: '#7C3AED' }} />
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Masowanie</span>
                        <span className="n2-badge n2-badge-gray">{activeMixing.length} aktywnych</span>
                      </div>
                      {activeMixing.length === 0 ? (
                        <div style={{ padding: '16px', fontSize: 12.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>Brak aktywnych zleceń</div>
                      ) : (
                        <div style={{ padding: '8px 16px 12px' }}>
                          {activeMixing.slice(0, 4).map((o: any) => {
                            const pct = Number(o.meatKg) > 0 ? Math.min(100, Number(o.kgDone) / Number(o.meatKg) * 100) : 0
                            return (
                              <div key={o.id} style={{ marginBottom: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{o.recipeName ?? '—'}</span>
                                  <span className="n2-mono" style={{ fontSize: 11, color: 'var(--ink-2)', flexShrink: 0 }}>{fmtKg(o.kgDone, 0)} / {fmtKg(o.meatKg, 0)} kg</span>
                                </div>
                                <Pct value={pct} color="#7C3AED" />
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Bottom row: stock + orders ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 16 }}>

                  {/* Stock summary */}
                  <div className="n2-card" style={{ padding: '16px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <BarChart3 size={14} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>Stan magazynów</span>
                    </div>

                    {/* Deboning summary */}
                    <div style={{ marginBottom: 4, paddingBottom: 10, borderBottom: '1px solid var(--border-2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}>Rozbiór dziś · yield</span>
                        <span className="n2-mono" style={{ fontSize: 13, fontWeight: 700, color: debYield > 65 ? 'var(--green)' : debYield > 0 ? 'var(--amber)' : 'var(--ink-3)' }}>
                          {debYield > 0 ? `${debYield.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      {debKgQ > 0 && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>{fmtKg(debKgQ, 0)} kg ćwiartki → {fmtKg(debKgMeat, 0)} kg mięsa</div>}
                      <Pct value={debYield > 0 ? debYield : 0} color="var(--amber)" />
                    </div>

                    <StockRow label="Ćwiartka (surowiec)"    kg={totalKgRaw}       pct={Math.min(100, totalKgRaw / 10)} color="var(--accent)" />
                    <StockRow label="Mięso z/s po rozbiorze" kg={totalKgMeat}      pct={Math.min(100, totalKgMeat / 5)} color="var(--green)" />
                    <StockRow label="Mięso przyprawione"     kg={totalKgSeasoned}  pct={Math.min(100, totalKgSeasoned / 5)} color="#7C3AED" />
                    <div style={{ paddingTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link to="/office/magazyn/surowiec"   style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 500 }}>Surowiec →</Link>
                      <Link to="/office/magazyn/surowiec"   style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 500 }}>Mięso z/s →</Link>
                      <Link to="/office/magazyn/mieso-przyp" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 500 }}>Mięso przyp. →</Link>
                    </div>
                  </div>

                  {/* Orders */}
                  <div className="n2-card" style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Truck size={14} style={{ color: 'var(--amber)' }} />
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Zamówienia</span>
                        <span className="n2-badge n2-badge-gray">{visibleOrders.length} aktywnych</span>
                      </div>
                      <Link to="/office/zamowienia" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                        Wszystkie <ArrowRight size={12} />
                      </Link>
                    </div>
                    {visibleOrders.length === 0 ? (
                      <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>Brak aktywnych zamówień</div>
                    ) : (
                      <div className="n2-scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
                        <table className="n2-table">
                          <thead>
                            <tr>
                              <th>Nr / Klient</th>
                              <th>Status</th>
                              <th style={{ textAlign: 'right' }}>Dostawa</th>
                              <th style={{ textAlign: 'right' }}>Szt</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleOrders.slice(0, 12).map((o: any) => {
                              const daysLeft = o.deliveryDate
                                ? Math.round((new Date(o.deliveryDate).getTime() - Date.now()) / 86400000)
                                : null
                              const urgent = daysLeft !== null && daysLeft <= 2
                              return (
                                <tr key={o.id}>
                                  <td>
                                    <div className="n2-mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>{o.orderNo}</div>
                                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 1 }}>{o.clientName}</div>
                                  </td>
                                  <td>
                                    <span className={`n2-badge ${STATUS_BADGE[o.status] ?? 'n2-badge-gray'}`}>
                                      {STATUS_LABEL[o.status] ?? o.status}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {o.deliveryDate ? (
                                      <div>
                                        <div className="n2-mono" style={{ fontSize: 12, color: urgent ? 'var(--red)' : 'var(--ink)', fontWeight: urgent ? 700 : 500 }}>
                                          {new Date(o.deliveryDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}
                                        </div>
                                        {daysLeft !== null && (
                                          <div style={{ fontSize: 10, color: urgent ? 'var(--red)' : 'var(--ink-3)' }}>
                                            {daysLeft < 0 ? 'po terminie' : daysLeft === 0 ? 'dziś' : `za ${daysLeft}d`}
                                          </div>
                                        )}
                                      </div>
                                    ) : '—'}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <span className="n2-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{o.totalUnits ?? '—'}</span>
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

                {/* Footer */}
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Cpu size={11} style={{ color: 'var(--accent)' }} />
                    <span>Kebab MES · newui2 · polling 7s · {activePlans.length} planów · {activeMixing.length} masowań · {todayDeb.length} sesji rozbioru</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Link to="/newui"              style={{ color: 'var(--accent)', fontWeight: 500 }}>Dark SCADA</Link>
                    <Link to="/office/dashboard-classic"   style={{ color: 'var(--accent)', fontWeight: 500 }}>Klasyczny</Link>
                    <Link to="/office/dashboard-pro" style={{ color: 'var(--accent)', fontWeight: 500 }}>Komenda centralna</Link>
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </>
  )
}
