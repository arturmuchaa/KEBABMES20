import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  Line, LineChart,
} from 'recharts'
import {
  LayoutDashboard, Factory, ShieldAlert, BadgeCheck, ClipboardList, Layers,
  Beef, Package, Boxes, PackageCheck, Users, BarChart3, GitBranch, Settings,
  Search, Bell, Maximize2, ChevronRight, AlertTriangle, Check, Activity,
  Cpu, Pause, Play, Zap, Gauge, ArrowUp, ArrowDown, Clock, MoreHorizontal,
  CircleDot, Sparkles, FileText, Menu, X, Sun, Moon,
} from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi, finishedGoodsApi,
  deboningApi,
} from '@/lib/apiClient'
import { fmtKg, fmtPct, fmtDatePl, getExpiryStatus, todayIso } from '@/lib/utils'
import { computeDisplayStatus } from '@/components/ui/badge'

// ════════════════════════════════════════════════════════════════════════
// THEME — Dark Industrial SCADA · Siemens/Tesla/Vercel/Linear
// ════════════════════════════════════════════════════════════════════════
const NEWUI_CSS = `
  .newui-root {
    --bg:        #07090F;
    --bg-2:      #0D1117;
    --surface:   rgba(19, 24, 38, 0.7);
    --surface-2: rgba(26, 32, 50, 0.85);
    --surface-3: rgba(35, 43, 64, 0.6);
    --line:      #232B40;
    --line-2:    #3A4359;
    --ink:       #F0F4FA;
    --ink-2:     #A3ADBF;
    --ink-3:     #6C7587;
    --ink-faint: #4A5267;
    --cyan:      #06B6D4;
    --cyan-glow: rgba(6, 182, 212, 0.45);
    --cyan-bg:   rgba(6, 182, 212, 0.10);
    --lime:      #84CC16;
    --amber:     #F59E0B;
    --red:       #EF4444;
    --green:     #10B981;
    --purple:    #A78BFA;
    --blue:      #3B82F6;

    min-height: 100vh;
    background-color: var(--bg);
    background-image:
      radial-gradient(ellipse 50% 35% at 8% 5%, rgba(6, 182, 212, 0.08), transparent 60%),
      radial-gradient(ellipse 55% 40% at 95% 95%, rgba(167, 139, 250, 0.06), transparent 65%),
      linear-gradient(transparent 97.5%, rgba(6, 182, 212, 0.04) 97.5%),
      linear-gradient(90deg, transparent 97.5%, rgba(6, 182, 212, 0.04) 97.5%);
    background-size: auto, auto, 40px 40px, 40px 40px;
    background-attachment: fixed;
    color: var(--ink);
    font-family: 'Inter', system-ui, sans-serif;
    font-feature-settings: 'ss01' on, 'cv11' on;
    -webkit-font-smoothing: antialiased;
    font-size: 14px;
    line-height: 1.4;
    display: flex;
    overflow: hidden;
  }
  .newui-root *, .newui-root *::before, .newui-root *::after { box-sizing: border-box; }
  .newui-root a { color: inherit; text-decoration: none; }
  .nu-mono {
    font-family: 'JetBrains Mono', monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .nu-serif {
    font-family: 'Instrument Serif', serif;
    font-style: italic;
    font-weight: 400;
  }
  .nu-kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .nu-card {
    background: var(--surface);
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .nu-card-elevated {
    background: var(--surface);
    backdrop-filter: blur(14px) saturate(140%);
    border: 1px solid var(--line-2);
    border-radius: 12px;
    box-shadow: 0 0 0 1px var(--cyan-glow) inset, 0 0 28px var(--cyan-glow);
  }
  .nu-glow-cyan { box-shadow: 0 0 24px var(--cyan-glow); }
  .nu-divider { height: 1px; background: var(--line); }

  @keyframes nu-ping {
    0%   { transform: scale(1);   opacity: 0.55; }
    100% { transform: scale(2.6); opacity: 0; }
  }
  @keyframes nu-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.50; }
  }
  @keyframes nu-shimmer {
    from { transform: translateX(-100%); }
    to   { transform: translateX(200%); }
  }
  @keyframes nu-tick {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes nu-flow {
    from { background-position: 0% 0; }
    to   { background-position: 48px 0; }
  }
  .nu-pulse-anim { animation: nu-pulse 1.6s ease-in-out infinite; }
  .nu-tick-anim  { animation: nu-tick 0.35s ease-out; }
  .nu-shimmer-bar { position: relative; overflow: hidden; }
  .nu-shimmer-bar::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
    animation: nu-shimmer 2.4s linear infinite;
  }

  .nu-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
  .nu-scroll::-webkit-scrollbar-track { background: transparent; }
  .nu-scroll::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 3px; }
  .nu-scroll::-webkit-scrollbar-thumb:hover { background: var(--ink-faint); }

  .nu-search input {
    background: transparent; border: 0; outline: 0;
    color: var(--ink); font-family: inherit; font-size: 12.5px; width: 100%;
  }
  .nu-search input::placeholder { color: var(--ink-faint); }

  .nu-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    background: var(--surface-3);
    font-size: 11px; font-weight: 500; color: var(--ink-2);
  }
  .nu-chip-cyan {
    border-color: rgba(6, 182, 212, 0.30);
    background: var(--cyan-bg);
    color: var(--cyan);
  }
  .nu-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 10px;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    background: var(--surface-3);
    color: var(--ink-2);
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .nu-btn:hover { color: var(--ink); border-color: var(--cyan); box-shadow: 0 0 12px var(--cyan-glow); }

  /* ── Mobile overlay ── */
  .nu-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(3px);
    z-index: 49;
  }
  .nu-overlay.open { display: block; }

  /* ── Sidebar slide transition ── */
  .nu-sidebar { transition: transform 0.22s ease, box-shadow 0.22s ease; }

  /* ── Hamburger button — hidden on desktop ── */
  .nu-hamburger {
    display: none;
    align-items: center;
    justify-content: center;
    width: 34px; height: 34px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface-3);
    color: var(--ink-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .nu-hamburger:hover { color: var(--ink); border-color: var(--cyan); }

  /* ─── TABLET 769 – 1024px ─── */
  @media (max-width: 1024px) {
    .nu-main-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) !important;
    }
    .nu-main-grid > :nth-child(3) {
      grid-column: 1 / -1;
    }
  }

  /* ═══════════════════════ LIGHT MODE ══════════════════════════ */
  .newui-root.light {
    --bg:        #F1F5F9;
    --bg-2:      #FFFFFF;
    --surface:   rgba(255, 255, 255, 0.92);
    --surface-2: rgba(248, 250, 252, 0.98);
    --surface-3: rgba(241, 245, 249, 0.90);
    --line:      #E2E8F0;
    --line-2:    #CBD5E1;
    --ink:       #0F172A;
    --ink-2:     #334155;
    --ink-3:     #64748B;
    --ink-faint: #94A3B8;
    --cyan:      #0891B2;
    --cyan-glow: rgba(8, 145, 178, 0.18);
    --cyan-bg:   rgba(8, 145, 178, 0.07);
    --lime:      #15803D;
    --amber:     #B45309;
    --red:       #DC2626;
    --green:     #15803D;
    --purple:    #7C3AED;
    --blue:      #2563EB;
    background-color: var(--bg);
    background-image:
      radial-gradient(ellipse 50% 35% at 8% 5%, rgba(8, 145, 178, 0.06), transparent 60%),
      radial-gradient(ellipse 55% 40% at 95% 95%, rgba(124, 58, 237, 0.04), transparent 65%);
  }
  .newui-root.light aside {
    background: rgba(255, 255, 255, 0.98) !important;
    border-right-color: var(--line) !important;
    box-shadow: 2px 0 16px rgba(0, 0, 0, 0.06);
  }
  .newui-root.light header {
    background: rgba(255, 255, 255, 0.92) !important;
    border-bottom-color: var(--line) !important;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
  }
  .newui-root.light .nu-card {
    background: rgba(255, 255, 255, 0.96);
    border-color: var(--line);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04);
    backdrop-filter: none;
  }
  .newui-root.light .nu-card-elevated {
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 0 0 1px rgba(8,145,178,0.22) inset, 0 4px 20px rgba(8,145,178,0.10);
  }
  .newui-root.light .nu-oee-track { stroke: #E2E8F0 !important; }
  .newui-root.light .nu-oee-label { fill: #94A3B8 !important; }
  .newui-root.light .nu-recharts-grid line { stroke: #E2E8F0 !important; }
  .newui-root.light .recharts-cartesian-grid-horizontal line,
  .newui-root.light .recharts-cartesian-grid-vertical  line { stroke: #E2E8F0 !important; }
  .newui-root.light .recharts-default-tooltip {
    background: #FFFFFF !important;
    border-color: rgba(8,145,178,0.4) !important;
    color: #0F172A !important;
  }
  .newui-root.light .nu-scroll::-webkit-scrollbar-thumb { background: var(--line-2); }

  /* ─── MOBILE ≤ 768px ─── */
  @media (max-width: 768px) {
    .nu-sidebar {
      position: fixed !important;
      left: 0; top: 0;
      height: 100vh;
      z-index: 50;
      transform: translateX(-100%);
    }
    .nu-sidebar.open {
      transform: translateX(0);
      box-shadow: 6px 0 40px rgba(0, 0, 0, 0.7);
    }
    .nu-hamburger { display: flex !important; }
    .nu-search-bar { width: auto !important; max-width: 180px !important; flex: 1 1 0; }
    .nu-search-bar input { font-size: 11.5px; }
    .nu-shift-chip { display: none !important; }
    .nu-time-block { display: none !important; }
    .nu-main-padding { padding: 14px 14px 36px !important; }
    .nu-page-header { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
    .nu-page-actions { width: 100%; overflow-x: auto; padding-bottom: 4px; flex-wrap: nowrap; }
    .nu-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .nu-main-grid { grid-template-columns: minmax(0, 1fr) !important; }
    .nu-main-grid > :nth-child(3) { grid-column: auto; }
    .nu-lines-grid { grid-template-columns: minmax(0, 1fr) !important; }
    .nu-bottom-grid { grid-template-columns: minmax(0, 1fr) !important; }
    .nu-footer-links { display: none !important; }
    .nu-footer { justify-content: center !important; }
  }
`

// ════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ════════════════════════════════════════════════════════════════════════
type LineStatus = 'running' | 'setup' | 'warning' | 'alarm' | 'idle'
type Line = {
  id: string
  product: string
  recipe: string
  operator: string
  status: LineStatus
  throughput: number
  target: number
  oee: number
  avail: number
  perf: number
  qual: number
}
const INITIAL_LINES: Line[] = [
  { id: 'A', product: 'Adler 1.2kg', recipe: 'R-22 Adler',  operator: 'Janusz K.', status: 'running', throughput: 72, target: 80, oee: 92, avail: 96, perf: 94, qual: 97 },
  { id: 'B', product: 'BMS 0.5kg',   recipe: 'R-08 BMS',    operator: 'Marek W.',  status: 'running', throughput: 64, target: 70, oee: 78, avail: 88, perf: 82, qual: 96 },
  { id: 'C', product: '— setup —',   recipe: 'R-15 Lite',   operator: 'Adam P.',   status: 'setup',   throughput: 0,  target: 60, oee: 0,  avail: 0,  perf: 0,  qual: 0  },
  { id: 'D', product: 'Premium 2kg', recipe: 'R-31 Premium',operator: 'Tomasz L.', status: 'warning', throughput: 38, target: 50, oee: 65, avail: 78, perf: 72, qual: 92 },
]

type AlarmSeverity = 'high' | 'med' | 'low'
type Alarm = { id: string; time: string; severity: AlarmSeverity; line: string; message: string; acked: boolean }
const ALARMS: Alarm[] = [
  { id:'a1', time:'14:23', severity:'high', line:'Linia D', message:'Temperatura komory chłodniczej > -2°C', acked:false },
  { id:'a2', time:'14:08', severity:'high', line:'Linia D', message:'Wibracja nadziewarki przekracza próg', acked:false },
  { id:'a3', time:'13:55', severity:'med',  line:'Linia B', message:'Ciśnienie nadziewarki spadło o 12%', acked:false },
  { id:'a4', time:'13:42', severity:'med',  line:'Linia A', message:'Czas cyklu powyżej normy o 18%', acked:false },
  { id:'a5', time:'13:15', severity:'low',  line:'Linia C', message:'Pozostało 25min do końca setup', acked:false },
  { id:'a6', time:'12:48', severity:'med',  line:'Linia D', message:'Korekta receptury R-31 wymagana', acked:false },
  { id:'a7', time:'12:18', severity:'low',  line:'Linia A', message:'Niski poziom przyprawy #4 (15%)', acked:true },
  { id:'a8', time:'11:52', severity:'low',  line:'Linia B', message:'Zmiana folii w 30min', acked:true },
]

type EventItem = { time: string; kind: 'pack'|'session'|'plan'|'login'|'recipe'|'shift'|'batch'|'qa'|'ack'; text: string }
const EVENTS: EventItem[] = [
  { time:'14:32', kind:'pack',    text:'Pakiet zamknięty · Linia A · 24 szt Adler 1.2kg · Janusz K.' },
  { time:'14:18', kind:'session', text:'Sesja rozbioru zakończona · Janusz K. · 142kg z 210kg (68%)' },
  { time:'14:05', kind:'plan',    text:'Plan produkcji #PP-118 aktywowany · 3 linie' },
  { time:'13:50', kind:'login',   text:'Operator zalogowany · Tomasz L. → Linia D' },
  { time:'13:45', kind:'recipe',  text:'Receptura R-08 BMS załadowana · Linia B' },
  { time:'13:30', kind:'shift',   text:'Zmiana DZIEŃ rozpoczęta · 12 operatorów' },
  { time:'13:12', kind:'batch',   text:'Partia surowca #2401-12 przyjęta · 280kg ćwiartki' },
  { time:'12:55', kind:'qa',      text:'QA inspekcja Linia A · wynik OK' },
  { time:'12:20', kind:'ack',     text:'Alarm Linia A potwierdzony · Janusz K.' },
]

type Recipe = { no: string; recipe: string; qty: number; line: string; eta: string; status: 'next'|'wait'|'skipped' }
const RECIPES: Recipe[] = [
  { no:'ZL-2611', recipe:'R-22 Adler 1.2kg',  qty:240, line:'Linia A', eta:'15:30', status:'next' },
  { no:'ZL-2612', recipe:'R-08 BMS 0.5kg',    qty:400, line:'Linia B', eta:'16:15', status:'wait' },
  { no:'ZL-2613', recipe:'R-15 Lite 0.8kg',   qty:180, line:'Linia C', eta:'16:00', status:'wait' },
  { no:'ZL-2614', recipe:'R-31 Premium 2kg',  qty:90,  line:'Linia D', eta:'17:30', status:'wait' },
  { no:'ZL-2615', recipe:'R-22 Adler 1.2kg',  qty:160, line:'Linia A', eta:'18:00', status:'wait' },
  { no:'ZL-2616', recipe:'R-08 BMS 0.5kg',    qty:320, line:'Linia B', eta:'18:45', status:'wait' },
]

const TREND_DATA = [
  { h:'06:00', target:180, actual:0,   planned:180 },
  { h:'07:00', target:180, actual:165, planned:180 },
  { h:'08:00', target:200, actual:195, planned:200 },
  { h:'09:00', target:200, actual:210, planned:200 },
  { h:'10:00', target:200, actual:182, planned:200 },
  { h:'11:00', target:180, actual:178, planned:180 },
  { h:'12:00', target:160, actual:155, planned:160 },
  { h:'13:00', target:200, actual:188, planned:200 },
  { h:'14:00', target:200, actual:142, planned:200 },
  { h:'15:00', target:200, actual:null, planned:200 },
  { h:'16:00', target:180, actual:null, planned:180 },
  { h:'17:00', target:180, actual:null, planned:180 },
]

function generateSparkline(base: number, variance: number, n = 24): { v: number }[] {
  const arr: { v: number }[] = []
  let v = base
  for (let i = 0; i < n; i++) {
    v = Math.max(base * 0.6, Math.min(base * 1.15, v + (Math.random() - 0.45) * variance))
    arr.push({ v: Math.round(v * 10) / 10 })
  }
  return arr
}

// ════════════════════════════════════════════════════════════════════════
// PRIMITIVES
// ════════════════════════════════════════════════════════════════════════
function LiveDot({ color = 'var(--cyan)', size = 8 }: { color?: string; size?: number }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        animation: 'nu-ping 1.6s infinite ease-out',
      }} />
      <span style={{
        position: 'relative', borderRadius: '50%', background: color,
        width: size, height: size,
        boxShadow: `0 0 8px ${color}`,
      }} />
    </span>
  )
}

function StatusDot({ status, size = 7 }: { status: LineStatus; size?: number }) {
  const colorMap = { running:'var(--lime)', setup:'var(--amber)', warning:'var(--amber)', alarm:'var(--red)', idle:'var(--ink-faint)' }
  const color = colorMap[status]
  if (status === 'running' || status === 'alarm') {
    return <LiveDot color={color} size={size} />
  }
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: color, boxShadow: status !== 'idle' ? `0 0 6px ${color}` : undefined,
      flexShrink: 0,
    }} />
  )
}

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const positive = value >= 0
  const Icon = positive ? ArrowUp : ArrowDown
  const color = positive ? 'var(--green)' : 'var(--red)'
  return (
    <span className="nu-mono inline-flex items-center gap-0.5" style={{ color, fontSize: '11px', fontWeight: 700 }}>
      <Icon size={10} />
      {positive ? '+' : ''}{value}{suffix}
    </span>
  )
}

function Sparkline({ data, color = 'var(--cyan)', height = 40 }: { data: { v: number }[]; color?: string; height?: number }) {
  const id = useMemo(() => `nuspark-${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════════════
function Sidebar({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const sections: { title: string; items: { label: string; icon: React.ReactNode; to: string; badge?: number; active?: boolean }[] }[] = [
    {
      title: 'Monitoring',
      items: [
        { label: 'Pulpit',             icon: <LayoutDashboard size={15} />, to: '/newui', active: true },
        { label: 'Linie produkcyjne',  icon: <Factory size={15} />,         to: '#' },
        { label: 'Alarmy',             icon: <ShieldAlert size={15} />,     to: '#', badge: 6 },
        { label: 'Jakość · HACCP',     icon: <BadgeCheck size={15} />,      to: '#' },
      ],
    },
    {
      title: 'Operacje',
      items: [
        { label: 'Zlecenia',            icon: <ClipboardList size={15} />, to: '#' },
        { label: 'Receptury',           icon: <Layers size={15} />,        to: '#' },
        { label: 'Surowiec',            icon: <Beef size={15} />,          to: '#' },
        { label: 'Mięso z/s',           icon: <Package size={15} />,       to: '#' },
        { label: 'Mięso przyprawione',  icon: <Boxes size={15} />,         to: '#' },
        { label: 'Wyrób gotowy',        icon: <PackageCheck size={15} />,  to: '#' },
        { label: 'Operatorzy',          icon: <Users size={15} />,         to: '#' },
      ],
    },
    {
      title: 'Raporty',
      items: [
        { label: 'Raporty',         icon: <BarChart3 size={15} />, to: '#' },
        { label: 'Traceability',    icon: <GitBranch size={15} />, to: '#' },
        { label: 'Ustawienia',      icon: <Settings size={15} />,  to: '#' },
      ],
    },
  ]

  return (
    <aside
      className={`nu-sidebar flex flex-col${isOpen ? ' open' : ''}`}
      style={{
        width: 248,
        background: 'rgba(7, 9, 15, 0.85)',
        backdropFilter: 'blur(14px)',
        borderRight: '1px solid var(--line)',
        height: '100vh',
        flexShrink: 0,
      }}
    >
      {/* Brand mark */}
      <div className="px-5 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-3">
          <div
            className="grid place-items-center rounded-lg flex-shrink-0"
            style={{
              width: 36, height: 36,
              background: 'linear-gradient(135deg, var(--cyan), #0891B2)',
              boxShadow: '0 0 16px var(--cyan-glow)',
            }}
          >
            <Cpu size={18} className="text-white" />
          </div>
          <div className="leading-none min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] font-bold" style={{ color: 'var(--ink-3)' }}>Kebab MES</div>
            <div className="text-[15px] font-semibold mt-1.5" style={{ color: 'var(--ink)' }}>
              Hala <span className="nu-serif" style={{ color: 'var(--cyan)' }}>produkcji</span>
            </div>
          </div>
        </div>
        {/* Close button — mobile only */}
        <button className="nu-hamburger" onClick={onClose} aria-label="Zamknij menu">
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto nu-scroll py-3">
        {sections.map(section => (
          <div key={section.title} className="mb-2">
            <div className="px-5 py-2 nu-kicker">{section.title}</div>
            {section.items.map(item => (
              <Link
                key={item.label}
                to={item.to}
                className="flex items-center gap-3 mx-2 px-3 py-2 rounded-md transition-colors group"
                style={{
                  color: item.active ? 'var(--cyan)' : 'var(--ink-2)',
                  background: item.active ? 'var(--cyan-bg)' : 'transparent',
                  borderLeft: item.active ? '2px solid var(--cyan)' : '2px solid transparent',
                  position: 'relative',
                }}
                onMouseEnter={e => { if (!item.active) (e.currentTarget as HTMLElement).style.background = 'rgba(35, 43, 64, 0.4)' }}
                onMouseLeave={e => { if (!item.active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span style={{ color: item.active ? 'var(--cyan)' : 'var(--ink-3)' }}>{item.icon}</span>
                <span className="text-[13px] font-medium flex-1 truncate">{item.label}</span>
                {item.badge ? (
                  <span
                    className="nu-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--red)', color: 'white', boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)' }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* User pill */}
      <div className="p-3" style={{ borderTop: '1px solid var(--line)' }}>
        <div
          className="flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer"
          style={{ background: 'var(--surface-3)' }}
        >
          <div
            className="grid place-items-center rounded-full flex-shrink-0 text-white font-bold text-[11px]"
            style={{ width: 30, height: 30, background: 'linear-gradient(135deg, var(--purple), var(--blue))' }}
          >
            AM
          </div>
          <div className="leading-none flex-1 min-w-0">
            <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Admin MES</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--ink-3)' }}>Kierownik · Zmiana DZIEŃ</div>
          </div>
          <MoreHorizontal size={14} style={{ color: 'var(--ink-3)' }} />
        </div>
      </div>
    </aside>
  )
}

// ════════════════════════════════════════════════════════════════════════
// TOP BAR
// ════════════════════════════════════════════════════════════════════════
function TopBar({ alertCount, onMenuClick, isDark, onThemeToggle }: {
  alertCount: number; onMenuClick?: () => void; isDark?: boolean; onThemeToggle?: () => void
}) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'short' })

  // shift countdown
  const h = now.getHours()
  const isDay = h >= 6 && h < 18
  const shiftEnd = new Date(now)
  shiftEnd.setHours(isDay ? 18 : (h >= 18 ? 30 : 6), 0, 0, 0)
  const msLeft = shiftEnd.getTime() - now.getTime()
  const shiftLeft = msLeft > 0
    ? `${Math.floor(msLeft / 3600000)}h ${String(Math.floor((msLeft % 3600000) / 60000)).padStart(2, '0')}m`
    : '0h 00m'

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-4 px-6"
      style={{
        height: 56,
        background: 'rgba(7, 9, 15, 0.78)',
        backdropFilter: 'blur(14px) saturate(140%)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      {/* Hamburger — mobile only */}
      <button className="nu-hamburger" onClick={onMenuClick} aria-label="Menu">
        <Menu size={16} />
      </button>

      {/* Search */}
      <div
        className="nu-search-bar nu-search flex items-center gap-2 px-3 py-1.5 rounded-md"
        style={{
          background: 'var(--surface-3)', border: '1px solid var(--line)',
          width: 320, maxWidth: '40%',
        }}
      >
        <Search size={13} style={{ color: 'var(--ink-3)' }} />
        <input placeholder="Szukaj zlecenia, partii, operatora…" />
        <kbd
          className="nu-mono text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-2)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}
        >⌘K</kbd>
      </div>

      {/* Shift indicator */}
      <div
        className="nu-shift-chip hidden md:flex items-center gap-3 px-3 py-1.5 rounded-md"
        style={{ background: 'var(--surface-3)', border: '1px solid var(--line)' }}
      >
        <LiveDot color="#FBBF24" size={6} />
        <div className="leading-none">
          <div className="nu-kicker" style={{ fontSize: '8px' }}>Zmiana</div>
          <div className="text-[11px] font-bold mt-1" style={{ color: 'var(--ink)' }}>
            {isDay ? 'DZIEŃ' : 'NOC'}
            <span className="ml-2 nu-mono font-medium" style={{ color: '#FBBF24' }}>↓ {shiftLeft}</span>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {/* Classic view toggle */}
      <Link
        to="/office/dashboard-classic"
        className="nu-btn hidden sm:inline-flex"
        style={{ fontSize: 11, padding: '6px 10px', borderColor: 'rgba(255,255,255,0.1)', color: 'var(--ink-2)' }}
        title="Przełącz na klasyczny widok"
      >
        <LayoutDashboard size={12} />
        Klasyczny
      </Link>

      {/* Notifications */}
      <button
        className="relative grid place-items-center rounded-md transition-colors"
        style={{
          width: 34, height: 34, background: 'var(--surface-3)',
          border: '1px solid var(--line)', color: 'var(--ink-2)',
        }}
      >
        <Bell size={15} />
        {alertCount > 0 && (
          <span
            className="absolute -top-1 -right-1 nu-mono font-bold grid place-items-center"
            style={{
              minWidth: 16, height: 16, padding: '0 4px', fontSize: '9px',
              borderRadius: 8, background: 'var(--red)', color: 'white',
              boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
            }}
          >
            {alertCount}
          </span>
        )}
      </button>

      {/* Fullscreen */}
      <button
        className="grid place-items-center rounded-md transition-colors"
        style={{
          width: 34, height: 34, background: 'var(--surface-3)',
          border: '1px solid var(--line)', color: 'var(--ink-2)',
        }}
      >
        <Maximize2 size={14} />
      </button>

      {/* Dark / light toggle */}
      <button
        className="grid place-items-center rounded-md transition-colors"
        style={{
          width: 34, height: 34,
          background: isDark ? 'var(--surface-3)' : 'var(--cyan-bg)',
          border: isDark ? '1px solid var(--line)' : '1px solid rgba(8,145,178,0.3)',
          color: isDark ? 'var(--ink-2)' : 'var(--cyan)',
        }}
        onClick={onThemeToggle}
        title={isDark ? 'Tryb jasny' : 'Tryb ciemny'}
      >
        {isDark ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      {/* Time */}
      <div className="nu-time-block hidden sm:flex items-center gap-3 pl-3" style={{ borderLeft: '1px solid var(--line)' }}>
        <div className="text-right leading-none">
          <div className="nu-mono text-[14px] font-bold" style={{ color: 'var(--ink)' }}>{time}</div>
          <div className="nu-mono text-[10px] mt-1 capitalize" style={{ color: 'var(--ink-3)' }}>{date.replace(/\.$/, '')}</div>
        </div>
      </div>
    </header>
  )
}

// ════════════════════════════════════════════════════════════════════════
// KPI TILE
// ════════════════════════════════════════════════════════════════════════
function KpiTile({ kicker, value, unit, delta, sparkData, sparkColor = 'var(--cyan)', icon }: {
  kicker: string
  value: React.ReactNode
  unit?: string
  delta: number
  sparkData: { v: number }[]
  sparkColor?: string
  icon: React.ReactNode
}) {
  return (
    <div className="nu-card relative overflow-hidden flex flex-col" style={{ height: 152 }}>
      <div className="flex-1 px-4 pt-3.5 pb-1 flex flex-col">
        <div className="flex items-start justify-between mb-2">
          <span className="nu-kicker">{kicker}</span>
          <span style={{ color: 'var(--ink-3)' }}>{icon}</span>
        </div>
        <div className="flex items-baseline gap-1.5 nu-tick-anim" key={String(value)}>
          <span className="nu-mono font-bold leading-none" style={{ fontSize: 30, color: 'var(--ink)' }}>{value}</span>
          {unit && <span className="text-[12px] font-semibold" style={{ color: 'var(--ink-3)' }}>{unit}</span>}
        </div>
        <div className="mt-2">
          <Delta value={delta} suffix={unit === '%' ? 'pp' : ''} />
          <span className="text-[10px] ml-1.5" style={{ color: 'var(--ink-3)' }}>vs wczoraj</span>
        </div>
      </div>
      <div style={{ height: 52, marginLeft: -1, marginRight: -1, marginBottom: -1 }}>
        <Sparkline data={sparkData} color={sparkColor} height={52} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// OEE GAUGE — semicircle SVG with cyan glow
// ════════════════════════════════════════════════════════════════════════
function OeeGauge({ value, avail, perf, qual }: { value: number; avail: number; perf: number; qual: number }) {
  // Semicircle path math
  const radius = 80
  const cx = 110
  const cy = 100
  const startA = Math.PI
  const endA = 0
  const angle = startA + (endA - startA) * (value / 100)
  const x = cx + radius * Math.cos(angle)
  const y = cy + radius * Math.sin(angle)
  const largeArc = (startA - angle) > Math.PI ? 1 : 0

  return (
    <div className="nu-card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Gauge size={14} style={{ color: 'var(--cyan)' }} />
          <span className="nu-kicker" style={{ color: 'var(--cyan)' }}>Postęp produkcji · aktywne plany</span>
        </div>
        <span className="nu-chip nu-chip-cyan">
          <LiveDot color="var(--cyan)" size={5} />
          live
        </span>
      </div>

      <div className="flex-1 relative grid place-items-center">
        <svg viewBox="0 0 220 130" className="w-full" style={{ maxWidth: 320 }}>
          <defs>
            <linearGradient id="oee-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06B6D4" />
              <stop offset="50%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#67E8F9" />
            </linearGradient>
            <filter id="oee-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* tick marks */}
          {[0, 25, 50, 75, 100].map(t => {
            const a = startA + (endA - startA) * (t / 100)
            const x1 = cx + (radius + 4) * Math.cos(a)
            const y1 = cy + (radius + 4) * Math.sin(a)
            const x2 = cx + (radius + 10) * Math.cos(a)
            const y2 = cy + (radius + 10) * Math.sin(a)
            const xt = cx + (radius + 20) * Math.cos(a)
            const yt = cy + (radius + 20) * Math.sin(a)
            return (
              <g key={t}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3A4359" strokeWidth="1" className="nu-oee-label" />
                <text x={xt} y={yt} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#6C7587" fontFamily="JetBrains Mono" className="nu-oee-label">{t}</text>
              </g>
            )
          })}
          {/* background arc */}
          <path
            className="nu-oee-track"
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none" stroke="#1F2738" strokeWidth="12" strokeLinecap="round"
          />
          {/* value arc */}
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 ${largeArc} 1 ${x} ${y}`}
            fill="none" stroke="url(#oee-grad)" strokeWidth="12" strokeLinecap="round"
            filter="url(#oee-glow)"
          />
        </svg>
        <div className="absolute" style={{ top: '46%', left: 0, right: 0, textAlign: 'center' }}>
          <div className="nu-mono font-bold leading-none" style={{ fontSize: 44, color: 'var(--ink)', textShadow: '0 0 18px var(--cyan-glow)' }}>
            {value.toFixed(1)}<span className="text-[20px]" style={{ color: 'var(--cyan)' }}>%</span>
          </div>
          <div className="nu-kicker mt-2" style={{ color: 'var(--ink-2)' }}>PROD%</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        {[
          { label: 'Masowanie',    value: avail, color: 'var(--cyan)' },
          { label: 'Rozb. yield', value: perf,  color: 'var(--purple)' },
          { label: 'Jakość',      value: qual,  color: 'var(--lime)' },
        ].map(s => (
          <div key={s.label}>
            <div className="nu-kicker mb-1.5" style={{ fontSize: 9 }}>{s.label}</div>
            <div className="nu-mono font-bold" style={{ fontSize: 16, color: s.color }}>
              {s.value.toFixed(1)}<span className="text-[10px] ml-0.5" style={{ color: 'var(--ink-3)' }}>%</span>
            </div>
            <div className="mt-1 h-0.5 rounded-full overflow-hidden" style={{ background: '#1F2738' }}>
              <div className="h-full transition-all" style={{ width: `${s.value}%`, background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// LINE CARD
// ════════════════════════════════════════════════════════════════════════
function LineCard({ line }: { line: Line }) {
  const pct = line.target > 0 ? Math.min(100, (line.throughput / line.target) * 100) : 0
  const statusColors = {
    running: { border: 'rgba(132, 204, 22, 0.30)', glow: 'rgba(132, 204, 22, 0.20)', label: 'RUNNING', color: 'var(--lime)' },
    setup:   { border: 'rgba(245, 158, 11, 0.30)', glow: 'rgba(245, 158, 11, 0.18)', label: 'SETUP',   color: 'var(--amber)' },
    warning: { border: 'rgba(245, 158, 11, 0.50)', glow: 'rgba(245, 158, 11, 0.28)', label: 'WARNING', color: 'var(--amber)' },
    alarm:   { border: 'rgba(239, 68, 68, 0.55)',  glow: 'rgba(239, 68, 68, 0.32)',  label: 'ALARM',   color: 'var(--red)' },
    idle:    { border: 'var(--line)',              glow: 'transparent',              label: 'IDLE',    color: 'var(--ink-faint)' },
  }
  const s = statusColors[line.status]

  return (
    <div
      className="nu-card flex flex-col"
      style={{
        border: `1px solid ${s.border}`,
        boxShadow: line.status === 'running' || line.status === 'warning' || line.status === 'alarm'
          ? `0 0 24px ${s.glow}` : undefined,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="grid place-items-center rounded-md"
            style={{
              width: 28, height: 28,
              background: line.status === 'running' ? 'var(--cyan-bg)' : 'var(--surface-3)',
              color: line.status === 'running' ? 'var(--cyan)' : 'var(--ink-2)',
              border: '1px solid var(--line-2)',
            }}
          >
            <Factory size={14} />
          </div>
          <div className="leading-none">
            <div className="text-[14px] font-bold" style={{ color: 'var(--ink)' }}>Linia {line.id}</div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>{line.product}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot status={line.status} size={8} />
          <span
            className="nu-kicker px-1.5 py-0.5 rounded"
            style={{ color: s.color, background: 'var(--surface-3)', border: `1px solid ${s.border}`, fontSize: 9 }}
          >
            {s.label}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex-1 flex flex-col gap-3">
        {/* Throughput big */}
        <div>
          <div className="nu-kicker mb-1.5">Postęp zlecenia</div>
          <div className="flex items-baseline gap-1.5">
            <span className="nu-mono font-bold leading-none" style={{ fontSize: 26, color: 'var(--ink)' }}>{line.throughput}</span>
            <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>/ {line.target} szt</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden nu-shimmer-bar" style={{ background: '#1F2738' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                background: line.status === 'running'
                  ? 'linear-gradient(90deg, var(--cyan), #22D3EE)'
                  : line.status === 'warning'
                  ? 'var(--amber)'
                  : line.status === 'alarm'
                  ? 'var(--red)'
                  : 'var(--line-2)',
                boxShadow: line.status === 'running' ? '0 0 8px var(--cyan-glow)' : undefined,
              }}
            />
          </div>
        </div>

        {/* OEE mini */}
        <div className="grid grid-cols-2 gap-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
          <div>
            <div className="nu-kicker" style={{ fontSize: 9 }}>OEE</div>
            <div className="nu-mono font-bold mt-1" style={{ fontSize: 15, color: line.oee >= 80 ? 'var(--lime)' : line.oee >= 60 ? 'var(--amber)' : 'var(--red)' }}>
              {line.oee}<span className="text-[10px] ml-0.5" style={{ color: 'var(--ink-3)' }}>%</span>
            </div>
          </div>
          <div>
            <div className="nu-kicker" style={{ fontSize: 9 }}>Receptura</div>
            <div className="nu-mono font-semibold mt-1 truncate" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{line.recipe}</div>
          </div>
        </div>

        {/* Operator footer */}
        <div className="flex items-center justify-between mt-auto pt-2" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="grid place-items-center rounded-full flex-shrink-0 text-[9px] font-bold text-white"
              style={{ width: 20, height: 20, background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
            >
              {line.operator.split(' ').map(s => s[0]).join('')}
            </div>
            <span className="text-[11px] truncate" style={{ color: 'var(--ink-2)' }}>{line.operator}</span>
          </div>
          <button
            className="nu-btn"
            style={{ padding: '4px 8px', fontSize: 10 }}
            title="Szczegóły linii"
          >
            <ChevronRight size={10} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// ACTIVE ALARMS
// ════════════════════════════════════════════════════════════════════════
function AlarmsPanel({ alarms, onAck }: { alarms: Alarm[]; onAck: (id: string) => void }) {
  const sevColor = (s: AlarmSeverity) =>
    s === 'high' ? 'var(--red)' : s === 'med' ? 'var(--amber)' : 'var(--cyan)'
  const active = alarms.filter(a => !a.acked)

  return (
    <div className="nu-card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} style={{ color: 'var(--red)' }} />
          <span className="nu-kicker" style={{ color: 'var(--ink-2)' }}>Aktywne alarmy</span>
          {active.length > 0 && (
            <span
              className="nu-mono text-[10px] font-bold px-1.5 py-0.5 rounded nu-pulse-anim"
              style={{ background: 'var(--red)', color: 'white' }}
            >
              {active.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="nu-btn" style={{ padding: '3px 8px', fontSize: 10 }}>Krytyczne</button>
          <button className="nu-btn" style={{ padding: '3px 8px', fontSize: 10 }}>Wszystkie</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nu-scroll">
        {alarms.length === 0 ? (
          <div className="py-12 text-center">
            <div className="nu-serif text-[18px]" style={{ color: 'var(--ink-3)' }}>brak alarmów</div>
          </div>
        ) : (
          alarms.map(a => (
            <div
              key={a.id}
              className="flex items-start gap-3 px-4 py-3"
              style={{
                borderBottom: '1px solid var(--line)',
                opacity: a.acked ? 0.5 : 1,
                background: !a.acked && a.severity === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
              }}
            >
              <div className="mt-0.5 flex-shrink-0">
                {a.acked
                  ? <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'var(--ink-faint)' }} />
                  : <LiveDot color={sevColor(a.severity)} size={8} />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="nu-mono text-[11px] font-bold" style={{ color: 'var(--ink)' }}>{a.time}</span>
                  <span
                    className="nu-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                    style={{ color: sevColor(a.severity), background: 'var(--surface-3)', border: `1px solid ${sevColor(a.severity)}40` }}
                  >
                    {a.severity}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>{a.line}</span>
                </div>
                <div className="text-[12px]" style={{ color: a.acked ? 'var(--ink-3)' : 'var(--ink)' }}>{a.message}</div>
              </div>
              {!a.acked && (
                <button
                  className="nu-btn flex-shrink-0"
                  style={{ padding: '4px 8px', fontSize: 9 }}
                  onClick={() => onAck(a.id)}
                  title="Potwierdź alarm"
                >
                  <Check size={10} /> ACK
                </button>
              )}
              {a.acked && (
                <span className="text-[9px] font-bold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--green)' }}>
                  ACK ✓
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Quick stats footer */}
      <div className="grid grid-cols-3 px-4 py-3" style={{ borderTop: '1px solid var(--line)', background: 'var(--surface-3)' }}>
        <div>
          <div className="nu-kicker" style={{ fontSize: 9 }}>Cykl</div>
          <div className="nu-mono font-bold mt-1" style={{ fontSize: 13, color: 'var(--ink)' }}>7m 12s</div>
        </div>
        <div>
          <div className="nu-kicker" style={{ fontSize: 9 }}>Przestoje</div>
          <div className="nu-mono font-bold mt-1" style={{ fontSize: 13, color: 'var(--amber)' }}>23m</div>
        </div>
        <div>
          <div className="nu-kicker" style={{ fontSize: 9 }}>Gotowość</div>
          <div className="nu-mono font-bold mt-1" style={{ fontSize: 13, color: 'var(--lime)' }}>91%</div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// PRODUCTION TREND CHART
// ════════════════════════════════════════════════════════════════════════
function TrendChart() {
  return (
    <div className="nu-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="nu-kicker mb-1" style={{ color: 'var(--cyan)' }}>Wyprodukowane vs plan</div>
          <div className="text-[15px] font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            Ostatnie 12 godzin
            <span className="nu-chip nu-chip-cyan" style={{ fontSize: 10 }}>
              <LiveDot color="var(--cyan)" size={5} />
              live
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--ink-2)' }}>
          <div className="flex items-center gap-1.5">
            <span style={{ display:'inline-block', width:12, height:2, background:'var(--cyan)' }} />
            <span>Wyprodukowano</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ display:'inline-block', width:12, height:2, background:'var(--ink-3)', borderTop:'1px dashed var(--ink-3)' }} />
            <span>Plan</span>
          </div>
        </div>
      </div>

      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={TREND_DATA} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
            <defs>
              <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#06B6D4" stopOpacity={0.40} />
                <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2738" vertical={false} />
            <XAxis dataKey="h" stroke="#6C7587" fontSize={10} tickLine={false} axisLine={{ stroke: '#1F2738' }} />
            <YAxis stroke="#6C7587" fontSize={10} tickLine={false} axisLine={{ stroke: '#1F2738' }} width={36} />
            <Tooltip
              contentStyle={{
                background: '#0D1117', border: '1px solid #06B6D4',
                borderRadius: 8, padding: '8px 12px', fontSize: 12,
                boxShadow: '0 0 24px rgba(6,182,212,0.3)',
              }}
              labelStyle={{ color: '#F0F4FA', fontWeight: 700, marginBottom: 4 }}
              itemStyle={{ color: '#A3ADBF' }}
              cursor={{ stroke: '#06B6D4', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            <Area type="monotone" dataKey="actual"  stroke="#06B6D4" strokeWidth={2}   fill="url(#trend-grad)" name="Wyprodukowano" connectNulls={false} />
            <Area type="monotone" dataKey="planned" stroke="#6C7587" strokeWidth={1.5} fill="none" strokeDasharray="4 4" name="Plan" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// EVENTS LOG
// ════════════════════════════════════════════════════════════════════════
function EventLog({ events }: { events: EventItem[] }) {
  const kindIcon: Record<EventItem['kind'], { icon: React.ReactNode; color: string }> = {
    pack:    { icon: <PackageCheck size={12} />, color: 'var(--lime)' },
    session: { icon: <Activity size={12} />,     color: 'var(--cyan)' },
    plan:    { icon: <Layers size={12} />,       color: 'var(--purple)' },
    login:   { icon: <Users size={12} />,        color: 'var(--blue)' },
    recipe:  { icon: <Sparkles size={12} />,     color: 'var(--purple)' },
    shift:   { icon: <Clock size={12} />,        color: 'var(--amber)' },
    batch:   { icon: <Beef size={12} />,         color: 'var(--lime)' },
    qa:      { icon: <BadgeCheck size={12} />,   color: 'var(--green)' },
    ack:     { icon: <Check size={12} />,        color: 'var(--green)' },
  }

  return (
    <div className="nu-card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: 'var(--cyan)' }} />
          <span className="nu-kicker">Zdarzenia · log operatorski</span>
        </div>
        <button className="nu-btn" style={{ padding: '3px 8px', fontSize: 10 }}>Eksport</button>
      </div>
      <div className="flex-1 overflow-y-auto nu-scroll">
        {events.map((e, i) => {
          const k = kindIcon[e.kind]
          return (
            <div
              key={i}
              className="flex items-start gap-3 px-4 py-2.5"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <span className="nu-mono text-[11px] font-bold flex-shrink-0 mt-0.5" style={{ color: 'var(--ink-2)', minWidth: 40 }}>{e.time}</span>
              <div
                className="grid place-items-center rounded-md flex-shrink-0 mt-0.5"
                style={{ width: 22, height: 22, background: 'var(--surface-3)', border: '1px solid var(--line)', color: k.color }}
              >
                {k.icon}
              </div>
              <div className="text-[12px] leading-snug flex-1" style={{ color: 'var(--ink-2)' }}>{e.text}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// RECIPE QUEUE
// ════════════════════════════════════════════════════════════════════════
function RecipeQueue({ items }: { items: Recipe[] }) {
  const statusInfo = {
    next:    { label: 'NASTĘPNE', color: 'var(--cyan)', bg: 'var(--cyan-bg)', border: 'rgba(6,182,212,0.4)' },
    wait:    { label: 'CZEKA',    color: 'var(--ink-2)', bg: 'var(--surface-3)', border: 'var(--line-2)' },
    skipped: { label: 'SKIP',     color: 'var(--red)', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)' },
  }

  return (
    <div className="nu-card flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <ClipboardList size={14} style={{ color: 'var(--purple)' }} />
          <span className="nu-kicker">Kolejka receptur</span>
        </div>
        <button className="nu-btn" style={{ padding: '3px 8px', fontSize: 10 }}>+ Dodaj</button>
      </div>
      <div className="flex-1 overflow-y-auto nu-scroll p-3">
        {items.map((r, i) => {
          const s = statusInfo[r.status]
          return (
            <div
              key={r.no}
              className="mb-2 rounded-lg p-3"
              style={{
                background: r.status === 'next' ? 'var(--cyan-bg)' : 'var(--surface-3)',
                border: `1px solid ${r.status === 'next' ? s.border : 'var(--line)'}`,
                boxShadow: r.status === 'next' ? '0 0 16px rgba(6, 182, 212, 0.15)' : undefined,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="nu-mono text-[10px] font-bold" style={{ color: 'var(--ink)' }}>{r.no}</span>
                    {r.status === 'next' && (
                      <span className="nu-pulse-anim text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--cyan)' }}>
                        ↓ {(i+1)*8 + 12}m
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--ink)' }}>{r.recipe}</div>
                </div>
                <span
                  className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
                >
                  {s.label}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--ink-3)' }}>
                <span>{r.line}</span>
                <span className="nu-mono font-bold" style={{ color: 'var(--ink-2)' }}>{r.qty} szt</span>
                <span className="nu-mono">ETA {r.eta}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════
export function NewUiDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set())

  // ── API hooks ──────────────────────────────────────────────────────────
  const batchRes    = useApi(() => rawBatchesApi.list({ active_only: true, limit: 500 }))
  const meatRes     = useApi(() => meatStockApi.list())
  const seasonedRes = useApi(() => seasonedMeatApi.list())
  const plansRes    = useApi(() => productionPlansApi.list())
  const mixingRes   = useApi(() => mixingOrdersApi.list())
  const ordersRes   = useApi(() => clientOrdersApi.list())
  const finishedRes = useApi(() => finishedGoodsApi.list())
  const deboningRes = useApi(() => deboningApi.list())

  // Live polling every 7s
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

  // ── Deboning today ────────────────────────────────────────────────────
  const today = todayIso()
  const todayDeb = useMemo(() =>
    [...allDeboning]
      .filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today)
      .sort((a: any, b: any) =>
        (b.createdAt ?? b.created_at ?? '') > (a.createdAt ?? a.created_at ?? '') ? 1 : -1
      ),
    [allDeboning, today],
  )
  const debKgQuarter = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)
  const debKgMeat    = todayDeb.reduce((s: number, d: any) => s + Number(d.kgMeat  ?? d.kg_meat  ?? 0), 0)
  const debYield     = debKgQuarter > 0 ? (debKgMeat / debKgQuarter) * 100 : 0

  // ── Raw batches + expiry alerts ───────────────────────────────────────
  const activeBatches = allBatches.filter(
    (b: any) => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used'
  )
  const totalKgRaw = activeBatches.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)

  const expired  = activeBatches.filter((b: any) => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 0 && d <= 1 })
  const warnings = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })

  // ── Meat stock ────────────────────────────────────────────────────────
  const availableMeat = allMeat.filter((m: any) => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat   = availableMeat.reduce((s: number, m: any) => s + Number(m.kgAvailable), 0)

  // ── Seasoned meat ─────────────────────────────────────────────────────
  const availableSeasoned = allSeasoned.filter((s: any) => Number(s.kgAvailable) > 0)
  const totalKgSeasoned   = availableSeasoned.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)

  // ── Production plans ──────────────────────────────────────────────────
  const activePlans = allPlans.filter((p: any) => p.status !== 'done' && p.status !== 'draft')

  const finishedKgByPlan = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => {
      const k = f.planNo ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + Number(f.totalKg ?? 0))
    })
    return m
  }, [allFinished])

  const producedKgForPlan = (p: any) => {
    const finished    = finishedKgByPlan.get(p.planNo) ?? 0
    const inProgress  = (p.lines ?? []).reduce(
      (s: number, l: any) => s + (Number(l.qtyDone) || 0) * (Number(l.kgPerUnit) || 0), 0
    )
    return finished + inProgress
  }
  const prodPlanned  = activePlans.reduce((s: number, p: any) => s + Number(p.totalKg), 0)
  const prodProduced = activePlans.reduce((s: number, p: any) => s + producedKgForPlan(p), 0)
  const prodPct      = prodPlanned > 0 ? Math.min(100, (prodProduced / prodPlanned) * 100) : 0

  // ── Production types (aggregated by recipe) ───────────────────────────
  const productionTypes = useMemo(() => {
    type Bucket = {
      key: string; recipeName: string; kgPerUnit: number; packagingName: string
      qtyPlanned: number; qtyDone: number; kgPlanned: number; kgDone: number
      inProgress: boolean; done: boolean; clientNames: Set<string>
    }
    const m = new Map<string, Bucket>()
    for (const p of activePlans) {
      for (const l of (p.lines ?? [])) {
        const recipeName    = l.recipeName || '—'
        const kgPerUnit     = Number(l.kgPerUnit) || 0
        const packagingName = (l as any).packagingName || ''
        const clientName    = ((l as any).clientName || '').trim()
        const key           = `${recipeName}|${kgPerUnit}|${packagingName}`
        const qty           = Number(l.qty) || 0
        const qtyDone       = Number((l as any).qtyDone) || 0
        const status        = ((l as any).lineStatus ?? 'PLANNED') as string
        const cur = m.get(key) ?? {
          key, recipeName, kgPerUnit, packagingName,
          qtyPlanned: 0, qtyDone: 0, kgPlanned: 0, kgDone: 0,
          inProgress: false, done: true, clientNames: new Set<string>(),
        }
        cur.qtyPlanned += qty
        cur.qtyDone   += qtyDone
        cur.kgPlanned += qty * kgPerUnit
        cur.kgDone    += qtyDone * kgPerUnit
        if (status === 'IN_PROGRESS') cur.inProgress = true
        if (status !== 'DONE')        cur.done = false
        if (clientName) cur.clientNames.add(clientName)
        m.set(key, cur)
      }
    }
    return Array.from(m.values()).sort((a, b) => {
      const aw = a.inProgress ? 0 : a.qtyDone > 0 ? 1 : 2
      const bw = b.inProgress ? 0 : b.qtyDone > 0 ? 1 : 2
      return aw !== bw ? aw - bw : b.kgPlanned - a.kgPlanned
    })
  }, [activePlans])

  // ── Mixing ────────────────────────────────────────────────────────────
  const activeMixing = allMixing.filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
  const mixPlanned   = activeMixing.reduce((s: number, o: any) => s + Number(o.meatKg), 0)
  const mixDone      = activeMixing.reduce((s: number, o: any) => s + Number(o.kgDone), 0)
  const mixPct       = mixPlanned > 0 ? Math.min(100, (mixDone / mixPlanned) * 100) : 0

  // ── Client orders ─────────────────────────────────────────────────────
  const visibleOrders = useMemo(() =>
    [...allOrders]
      .filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
      .sort((a: any, b: any) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999')),
    [allOrders],
  )

  // ── Derived display objects ───────────────────────────────────────────

  // Map production types → Line cards
  const displayLines: Line[] = useMemo(() =>
    productionTypes.slice(0, 4).map((t, i) => {
      const pct    = t.qtyPlanned > 0 ? (t.qtyDone / t.qtyPlanned) * 100 : 0
      const status: LineStatus =
        t.inProgress ? 'running' :
        t.done       ? 'idle'    :
        t.qtyDone > 0 ? 'warning' : 'setup'
      return {
        id: String(i + 1),
        product: `${t.recipeName}${t.kgPerUnit ? ' · ' + t.kgPerUnit + 'kg' : ''}`,
        recipe:  t.packagingName || t.recipeName,
        operator: Array.from(t.clientNames).join(', ') || '—',
        status, throughput: t.qtyDone, target: t.qtyPlanned,
        oee: Math.round(pct), avail: Math.round(pct), perf: Math.round(pct), qual: 100,
      }
    }),
    [productionTypes],
  )

  // Map expiry batches → Alarms
  const displayAlarms: Alarm[] = useMemo(() => {
    const out: Alarm[] = []
    ;[...expired].forEach((b: any) => out.push({
      id: `exp-${b.id}`, time: fmtDatePl(b.expiryDate), severity: 'high',
      line: b.internalBatchNo,
      message: `Partia przeterminowana · ${fmtKg(b.kgAvailable)} kg ćwiartki`,
      acked: ackedIds.has(`exp-${b.id}`),
    }))
    ;[...critical].forEach((b: any) => out.push({
      id: `crit-${b.id}`, time: fmtDatePl(b.expiryDate), severity: 'high',
      line: b.internalBatchNo,
      message: `Wygasa dziś lub jutro · ${fmtKg(b.kgAvailable)} kg`,
      acked: ackedIds.has(`crit-${b.id}`),
    }))
    ;[...warnings].forEach((b: any) => {
      const d = getExpiryStatus(b.expiryDate).daysLeft
      out.push({
        id: `warn-${b.id}`, time: fmtDatePl(b.expiryDate), severity: 'med',
        line: b.internalBatchNo,
        message: `Wygasa za ${d} ${d === 1 ? 'dzień' : 'dni'} · ${fmtKg(b.kgAvailable)} kg`,
        acked: ackedIds.has(`warn-${b.id}`),
      })
    })
    if (out.length === 0 && activeMixing.length > 0) {
      activeMixing.slice(0, 4).forEach((o: any) => out.push({
        id: `mix-${o.id}`, time: '—', severity: 'low',
        line: o.recipeName ?? '—',
        message: `Masowanie aktywne · ${fmtKg(o.meatKg)} kg zaplanowanych`,
        acked: ackedIds.has(`mix-${o.id}`),
      }))
    }
    return out
  }, [expired, critical, warnings, activeMixing, ackedIds])

  // Deboning sessions → EventLog
  const displayEvents: EventItem[] = useMemo(() => {
    const debEv: EventItem[] = todayDeb.slice(0, 6).map((d: any) => {
      const kgQ     = Number(d.kgTaken ?? d.kg_taken ?? 0)
      const kgM     = Number(d.kgMeat  ?? d.kg_meat  ?? 0)
      const op      = d.operatorName ?? d.operator_name ?? '—'
      const batch   = d.rawBatchNo ?? d.raw_batch_no ?? (d.rawBatch?.internalBatchNo) ?? '—'
      const t       = d.createdAt ?? d.created_at ?? ''
      const time    = t ? new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—'
      return { time, kind: 'session' as const, text: `Rozbiór · ${batch} · ${fmtKg(kgQ)} kg → ${fmtKg(kgM)} kg mięsa · ${op}` }
    })
    const mixEv: EventItem[] = activeMixing.slice(0, 3).map((o: any) => ({
      time: '—', kind: 'plan' as const,
      text: `Masowanie · ${o.recipeName ?? '—'} · ${fmtKg(o.meatKg)} kg · ${fmtPct(mixPct)}`,
    }))
    return [...debEv, ...mixEv]
  }, [todayDeb, activeMixing, mixPct])

  // Client orders → RecipeQueue
  const displayRecipes: Recipe[] = useMemo(() =>
    visibleOrders.slice(0, 6).map((o: any, i) => ({
      no:     o.orderNo,
      recipe: o.clientName,
      qty:    Number(o.totalUnits ?? 0),
      line:   o.deliveryDate
        ? new Date(o.deliveryDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
        : '—',
      eta:    o.deliveryDate
        ? new Date(o.deliveryDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
        : '—',
      status: (i === 0 ? 'next' : 'wait') as Recipe['status'],
    })),
    [visibleOrders],
  )

  const ackAlarm       = (id: string) => setAckedIds(prev => new Set([...prev, id]))
  const activeAlarmCount = displayAlarms.filter(a => !a.acked).length
  const loading        = (batchRes.loading && !batchRes.data) || (plansRes.loading && !plansRes.data)

  // Sparklines — regenerate when key values change
  const sparks = useMemo(() => ({
    raw:      generateSparkline(Math.max(10, totalKgRaw),       totalKgRaw      * 0.05 + 1),
    meat:     generateSparkline(Math.max(10, totalKgMeat),      totalKgMeat     * 0.05 + 1),
    seasoned: generateSparkline(Math.max(10, totalKgSeasoned),  totalKgSeasoned * 0.05 + 1),
    prod:     generateSparkline(Math.max(5,  prodPct),          5),
  }), [totalKgRaw, totalKgMeat, totalKgSeasoned, prodPct])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NEWUI_CSS }} />
      <div className={`newui-root${isDark ? '' : ' light'}`}>
        {/* Mobile overlay */}
        <div
          className={`nu-overlay${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />

        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex-1 flex flex-col min-w-0" style={{ height: '100vh', overflow: 'hidden' }}>
          <TopBar
            alertCount={activeAlarmCount}
            onMenuClick={() => setSidebarOpen(v => !v)}
            isDark={isDark}
            onThemeToggle={() => setIsDark(v => !v)}
          />

          <main className="nu-main-padding flex-1 overflow-y-auto nu-scroll" style={{ padding: '24px 28px 40px' }}>

            {/* Page header */}
            <div className="nu-page-header flex items-end justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-2 mb-2 nu-kicker" style={{ color: 'var(--ink-3)' }}>
                  Kebab MES <ChevronRight size={11} /> <span style={{ color: 'var(--cyan)' }}>Pulpit operacyjny</span>
                </div>
                <h1 className="text-[26px] font-semibold leading-none flex items-baseline gap-2" style={{ color: 'var(--ink)' }}>
                  Pulpit <span className="nu-serif text-[32px]" style={{ color: 'var(--cyan)' }}>operacyjny</span>
                </h1>
                <p className="text-[12px] mt-2" style={{ color: 'var(--ink-3)' }}>
                  Dane na żywo · {activePlans.length} aktywnych planów · {activeMixing.length} zleceń masowania
                  {debKgMeat > 0 && ` · rozbiór ${fmtKg(debKgMeat, 0)} kg`}
                </p>
              </div>
              <div className="nu-page-actions flex items-center gap-2 flex-shrink-0">
                <span className="nu-chip nu-chip-cyan">
                  <LiveDot color="var(--cyan)" size={5} />
                  Na żywo · 7s
                </span>
                <span className="nu-chip">{activePlans.length} planów</span>
                <Link to="/office/dashboard-classic" className="nu-btn">
                  <LayoutDashboard size={11} /> Klasyczny
                </Link>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="nu-kicker" style={{ color: 'var(--ink-3)' }}>
                  Ładowanie danych…
                </div>
              </div>
            ) : (
              <>
                {/* KPI STRIP */}
                <div className="nu-kpi-grid grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  <KpiTile
                    kicker="Ćwiartka · magazyn"
                    value={fmtKg(totalKgRaw, 0)}
                    unit="kg"
                    delta={0}
                    sparkData={sparks.raw}
                    sparkColor="var(--cyan)"
                    icon={<Beef size={14} />}
                  />
                  <KpiTile
                    kicker="Mięso z/s · po rozbiorze"
                    value={fmtKg(totalKgMeat, 0)}
                    unit="kg"
                    delta={0}
                    sparkData={sparks.meat}
                    sparkColor="var(--lime)"
                    icon={<Package size={14} />}
                  />
                  <KpiTile
                    kicker="Mięso przyprawione"
                    value={fmtKg(totalKgSeasoned, 0)}
                    unit="kg"
                    delta={0}
                    sparkData={sparks.seasoned}
                    sparkColor="var(--purple)"
                    icon={<Boxes size={14} />}
                  />
                  <KpiTile
                    kicker="Produkcja · postęp"
                    value={prodPct.toFixed(1)}
                    unit="%"
                    delta={0}
                    sparkData={sparks.prod}
                    sparkColor="var(--amber)"
                    icon={<Zap size={14} />}
                  />
                </div>

                {/* MAIN GRID */}
                <div className="nu-main-grid grid gap-4 mb-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1.1fr)' }}>
                  {/* Production gauge */}
                  <OeeGauge
                    value={prodPct}
                    avail={mixPct}
                    perf={debYield > 0 ? debYield : 100}
                    qual={100}
                  />

                  {/* Production types grid */}
                  <div className="nu-lines-grid grid grid-cols-2 gap-3">
                    {displayLines.length === 0 ? (
                      <div className="nu-card col-span-2 flex items-center justify-center py-16">
                        <div className="text-center">
                          <Factory size={32} style={{ color: 'var(--ink-faint)', margin: '0 auto 12px' }} />
                          <div className="nu-serif text-[16px]" style={{ color: 'var(--ink-3)' }}>brak aktywnych planów</div>
                          <div className="text-[11px] mt-2" style={{ color: 'var(--ink-faint)' }}>Aktywuj plan produkcji</div>
                        </div>
                      </div>
                    ) : (
                      displayLines.map(l => <LineCard key={l.id} line={l} />)
                    )}
                  </div>

                  {/* Alerts from expiry */}
                  <AlarmsPanel alarms={displayAlarms} onAck={ackAlarm} />
                </div>

                {/* Trend chart (mock — brak API hourly) */}
                <div className="mb-5">
                  <TrendChart />
                </div>

                {/* Bottom row */}
                <div className="nu-bottom-grid grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
                  <EventLog events={displayEvents.length > 0 ? displayEvents : EVENTS} />
                  <RecipeQueue items={displayRecipes.length > 0 ? displayRecipes : RECIPES} />
                </div>

                {/* Footer */}
                <div className="nu-footer flex items-center justify-between mt-6 pt-4 text-[11px]" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-3)' }}>
                  <div className="flex items-center gap-2">
                    <Cpu size={11} style={{ color: 'var(--cyan)' }} />
                    <span>Kebab MES · polling 7s · {activePlans.length} planów · {activeMixing.length} masowań · {todayDeb.length} sesji rozbioru</span>
                  </div>
                  <div className="nu-footer-links flex items-center gap-3">
                    <span>Inne widoki:</span>
                    <Link to="/office/dashboard-classic" style={{ color: 'var(--cyan)' }} className="hover:underline">klasyczny</Link>
                    <span style={{ color: 'var(--ink-faint)' }}>·</span>
                    <Link to="/office/dashboard-mui" style={{ color: 'var(--cyan)' }} className="hover:underline">MUI</Link>
                    <span style={{ color: 'var(--ink-faint)' }}>·</span>
                    <Link to="/office/dashboard-pro" style={{ color: 'var(--cyan)' }} className="hover:underline">Komenda centralna</Link>
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
