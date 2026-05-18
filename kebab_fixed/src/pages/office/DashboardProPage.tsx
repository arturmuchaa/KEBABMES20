import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi,
  finishedGoodsApi, deboningApi,
} from '@/lib/apiClient'
import { fmtKg, fmtDatePl, getExpiryStatus, todayIso } from '@/lib/utils'
import { computeDisplayStatus } from '@/components/ui/badge'
import {
  Beef, Scissors, Soup, Factory, Truck, ArrowRight, Bell,
  AlertTriangle, Clock, Activity, Plus, FileText, Package,
  Boxes, Sparkles,
} from 'lucide-react'

const POLL_MS = 7000
const KG_PER_CONTAINER = 15
const SHIFT_DAY_START = 6     // 06:00
const SHIFT_NIGHT_START = 18  // 18:00

// ════════════════════════════════════════════════════════════════════════
// THEME — Industrial Premium · cream + granat
// ════════════════════════════════════════════════════════════════════════
const PRO_STYLES = `
  :root {
    --pro-bg: #F7F5EF;
    --pro-bg-soft: #F1EEE5;
    --pro-surface: #FFFFFF;
    --pro-surface-2: #FDFBF6;
    --pro-line: #E2DCC8;
    --pro-line-2: #C9C1A6;
    --pro-line-strong: #ADA68F;
    --pro-ink: #1A1813;
    --pro-ink-soft: #4D463A;
    --pro-ink-mute: #837C6C;
    --pro-ink-faint: #B5AF9D;
    --pro-granat: #1B3A5C;
    --pro-granat-deep: #102845;
    --pro-granat-soft: rgba(27, 58, 92, 0.07);
    --pro-granat-line: rgba(27, 58, 92, 0.22);
    --pro-emerald: #047857;
    --pro-emerald-soft: rgba(4, 120, 87, 0.10);
    --pro-amber: #B45309;
    --pro-amber-soft: rgba(180, 83, 9, 0.10);
    --pro-red: #B91C1C;
    --pro-red-soft: rgba(185, 28, 28, 0.10);
    --pro-font-serif: "Instrument Serif", serif;
    --pro-font-mono: "JetBrains Mono", "IBM Plex Mono", monospace;
  }
  .pro-page {
    background: var(--pro-bg);
    background-image:
      linear-gradient(transparent 95%, rgba(26, 24, 19, 0.025) 95%),
      linear-gradient(90deg, transparent 95%, rgba(26, 24, 19, 0.025) 95%);
    background-size: 44px 44px, 44px 44px;
    color: var(--pro-ink);
    min-height: calc(100vh - 56px);
    margin: -20px -20px -20px -20px;
    padding: 0;
  }
  @media (min-width: 768px) { .pro-page { margin: -24px -24px -24px -24px; } }
  .pro-page * { font-feature-settings: 'cv11', 'ss01'; }
  .pro-mono { font-family: var(--pro-font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .pro-serif-it { font-family: var(--pro-font-serif); font-style: italic; font-weight: 400; }

  .pro-flow-arrow {
    background: repeating-linear-gradient(90deg,
      var(--pro-granat) 0px, var(--pro-granat) 6px,
      transparent 6px, transparent 12px);
    background-size: 200% 100%;
    animation: pro-flow 1.6s linear infinite;
  }
  @keyframes pro-flow {
    from { background-position: 0% 0; }
    to   { background-position: -48px 0; }
  }
  @keyframes pro-ping {
    0%   { transform: scale(1);   opacity: 0.55; }
    100% { transform: scale(2.6); opacity: 0; }
  }
  @keyframes pro-blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.45; }
  }
  @keyframes pro-count-fade {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .pro-pulse { animation: pro-blink 1.6s ease-in-out infinite; }
  .pro-tick { animation: pro-count-fade 0.4s ease-out; }
  .pro-scroll::-webkit-scrollbar { height: 4px; width: 4px; }
  .pro-scroll::-webkit-scrollbar-track { background: transparent; }
  .pro-scroll::-webkit-scrollbar-thumb { background: var(--pro-line-2); border-radius: 2px; }
`

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════
function classNames(...arr: (string | false | null | undefined)[]) {
  return arr.filter(Boolean).join(' ')
}

function currentShift(now: Date): { name: 'DZIEŃ' | 'NOC'; ends: Date; pct: number } {
  const h = now.getHours()
  const isDay = h >= SHIFT_DAY_START && h < SHIFT_NIGHT_START
  const ends = new Date(now)
  if (isDay) {
    ends.setHours(SHIFT_NIGHT_START, 0, 0, 0)
  } else {
    if (h >= SHIFT_NIGHT_START) ends.setDate(ends.getDate() + 1)
    ends.setHours(SHIFT_DAY_START, 0, 0, 0)
  }
  const start = new Date(ends)
  start.setHours(start.getHours() - 12)
  const span = ends.getTime() - start.getTime()
  const passed = now.getTime() - start.getTime()
  const pct = Math.max(0, Math.min(100, (passed / span) * 100))
  return { name: isDay ? 'DZIEŃ' : 'NOC', ends, pct }
}

function fmtTimeLeft(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime()
  if (ms <= 0) return '0h 00m'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// ════════════════════════════════════════════════════════════════════════
// Small primitives
// ════════════════════════════════════════════════════════════════════════
function LiveDot({ color = 'var(--pro-emerald)', size = 8 }: { color?: string; size?: number }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        animation: 'pro-ping 1.6s infinite ease-out',
      }} />
      <span style={{
        position: 'relative', borderRadius: '50%', background: color,
        width: size, height: size,
      }} />
    </span>
  )
}

type StatusKind = 'idle' | 'active' | 'warn' | 'alarm' | 'done'
const STATUS_COLOR: Record<StatusKind, string> = {
  idle:   'var(--pro-ink-faint)',
  active: 'var(--pro-emerald)',
  warn:   'var(--pro-amber)',
  alarm:  'var(--pro-red)',
  done:   'var(--pro-granat)',
}
function StatusDot({ kind, label }: { kind: StatusKind; label?: string }) {
  const color = STATUS_COLOR[kind]
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === 'active' ? <LiveDot color={color} size={7} /> : (
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      )}
      {label && <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color }}>{label}</span>}
    </span>
  )
}

function Kicker({ children, color = 'var(--pro-ink-mute)' }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.20em]" style={{ color }}>
      {children}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 1. STATUS STRIP — sticky top, dark navy command bar
// ════════════════════════════════════════════════════════════════════════
function StatusStrip({ alerts }: { alerts: number }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const shift = currentShift(now)
  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div
      className="sticky top-0 z-30 flex items-stretch text-white"
      style={{ background: 'linear-gradient(180deg, var(--pro-granat) 0%, var(--pro-granat-deep) 100%)' }}
    >
      {/* Brand mark */}
      <div className="px-5 py-3 flex items-center gap-3 border-r border-white/10">
        <div className="w-7 h-7 grid place-items-center rounded-md bg-white/12 ring-1 ring-white/20">
          <Sparkles size={14} className="text-amber-200" />
        </div>
        <div className="leading-none">
          <div className="text-[10px] uppercase tracking-[0.20em] text-white/55 font-semibold">Kebab MES</div>
          <div className="text-[13px] font-semibold tracking-wide mt-0.5">Komenda <span className="pro-serif-it text-amber-200">centralna</span></div>
        </div>
      </div>

      {/* Shift */}
      <div className="px-5 py-3 flex items-center gap-4 border-r border-white/10 min-w-0">
        <div className="leading-none">
          <div className="text-[9px] uppercase tracking-[0.20em] text-white/55 font-semibold">Zmiana</div>
          <div className="text-[13px] font-bold mt-1 flex items-center gap-2">
            <LiveDot color="#FBBF24" size={6} />
            {shift.name}
          </div>
        </div>
        <div className="leading-none">
          <div className="text-[9px] uppercase tracking-[0.20em] text-white/55 font-semibold">Do końca</div>
          <div className="pro-mono text-[13px] font-bold mt-1 text-amber-200">{fmtTimeLeft(shift.ends, now)}</div>
        </div>
        <div className="w-24 hidden md:block">
          <div className="text-[9px] uppercase tracking-[0.20em] text-white/55 font-semibold">Postęp zmiany</div>
          <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-amber-300/80 rounded-full transition-all" style={{ width: `${shift.pct}%` }} />
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Alerts */}
      <div className="px-5 py-3 flex items-center gap-2 border-l border-white/10">
        <Bell size={14} className={alerts > 0 ? 'text-red-300' : 'text-white/40'} />
        <div className="leading-none">
          <div className="text-[9px] uppercase tracking-[0.20em] text-white/55 font-semibold">Alarmy</div>
          <div className={classNames(
            'pro-mono text-[13px] font-bold mt-1',
            alerts > 0 ? 'text-red-300 pro-pulse' : 'text-white/70',
          )}>
            {alerts > 0 ? `${alerts} aktywne` : 'Czysto'}
          </div>
        </div>
      </div>

      {/* Time / Date */}
      <div className="px-5 py-3 flex items-center gap-5 border-l border-white/10">
        <div className="leading-none text-right">
          <div className="text-[9px] uppercase tracking-[0.20em] text-white/55 font-semibold">Czas</div>
          <div className="pro-mono text-[15px] font-bold mt-1">{time}</div>
        </div>
        <div className="leading-none text-right hidden md:block">
          <div className="text-[9px] uppercase tracking-[0.20em] text-white/55 font-semibold">Data</div>
          <div className="pro-mono text-[13px] font-medium mt-1 capitalize">{date.replace(/\.$/, '')}</div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 2. PIPELINE — hero, 5 stations
// ════════════════════════════════════════════════════════════════════════
type PipelineStationData = {
  key: string
  kicker: string
  title: string
  icon: React.ReactNode
  value: string
  unit?: string
  status: StatusKind
  meta: { label: string; value: string; tone?: 'default' | 'warn' | 'alarm' | 'ok' }[]
  href?: string
}

function Pipeline({ stations }: { stations: PipelineStationData[] }) {
  return (
    <div className="rounded-xl bg-white" style={{ border: '1px solid var(--pro-line)' }}>
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--pro-line)' }}>
        <div className="flex items-center gap-2.5">
          <Activity size={14} style={{ color: 'var(--pro-granat)' }} />
          <Kicker color="var(--pro-granat)">Przepływ produkcji</Kicker>
          <span style={{ color: 'var(--pro-ink-faint)' }}>·</span>
          <span className="text-xs" style={{ color: 'var(--pro-ink-mute)' }}>Materiał płynie z lewa na prawo</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot kind="active" label="Idle" />
          <StatusDot kind="active" label="Aktywny" />
          <StatusDot kind="warn"   label="Czeka" />
          <StatusDot kind="alarm"  label="Alarm" />
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-stretch gap-0 overflow-x-auto pro-scroll">
          {stations.map((s, i) => (
            <div key={s.key} className="flex items-stretch flex-1 min-w-[180px]">
              <PipelineStation s={s} />
              {i < stations.length - 1 && <PipelineArrow active={s.status === 'active'} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PipelineStation({ s }: { s: PipelineStationData }) {
  const Content = (
    <div className="flex-1 group rounded-lg px-4 py-4 transition-all"
      style={{
        background: s.status === 'active' ? 'var(--pro-granat-soft)' : 'var(--pro-surface-2)',
        border: `1px solid ${s.status === 'active' ? 'var(--pro-granat-line)' : 'var(--pro-line)'}`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 grid place-items-center rounded-md"
            style={{
              background: s.status === 'active' ? 'var(--pro-granat)' : 'var(--pro-bg-soft)',
              color: s.status === 'active' ? '#fff' : 'var(--pro-ink-soft)',
            }}
          >
            {s.icon}
          </div>
          <div className="leading-none">
            <Kicker color="var(--pro-ink-mute)">{s.kicker}</Kicker>
            <div className="text-[12px] font-bold mt-1" style={{ color: 'var(--pro-ink)' }}>{s.title}</div>
          </div>
        </div>
        <StatusDot kind={s.status} />
      </div>

      <div className="flex items-baseline gap-1.5 pro-tick" key={s.value}>
        <span className="pro-mono font-bold leading-none" style={{ fontSize: 'clamp(22px, 2.4vw, 32px)', color: 'var(--pro-ink)' }}>
          {s.value}
        </span>
        {s.unit && <span className="text-[12px] font-semibold" style={{ color: 'var(--pro-ink-mute)' }}>{s.unit}</span>}
      </div>

      <div className="mt-3 space-y-1.5">
        {s.meta.map((m, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span style={{ color: 'var(--pro-ink-mute)' }}>{m.label}</span>
            <span className="pro-mono font-semibold" style={{
              color: m.tone === 'warn'  ? 'var(--pro-amber)'
                   : m.tone === 'alarm' ? 'var(--pro-red)'
                   : m.tone === 'ok'    ? 'var(--pro-emerald)'
                   : 'var(--pro-ink)',
            }}>
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  return s.href ? (
    <Link to={s.href} className="flex-1 flex no-underline hover:-translate-y-0.5 transition-transform">{Content}</Link>
  ) : Content
}

function PipelineArrow({ active }: { active: boolean }) {
  return (
    <div className="flex items-center px-2" style={{ width: 28 }} aria-hidden>
      <div className="relative w-full h-[2px]">
        <div className={classNames('absolute inset-0 rounded', active && 'pro-flow-arrow')}
          style={!active ? { background: 'var(--pro-line-2)' } : undefined}
        />
        <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-0 h-0"
          style={{
            borderTop: '4px solid transparent',
            borderBottom: '4px solid transparent',
            borderLeft: `6px solid ${active ? 'var(--pro-granat)' : 'var(--pro-line-strong)'}`,
          }}
        />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 3. TODAY METRICS — 4 tiles
// ════════════════════════════════════════════════════════════════════════
type TodayTileTone = 'default' | 'ok' | 'warn' | 'alarm'
function TodayTile({ label, value, unit, sub, tone = 'default', icon }: {
  label: string; value: React.ReactNode; unit?: string; sub?: string
  tone?: TodayTileTone; icon?: React.ReactNode
}) {
  const color =
    tone === 'ok'    ? 'var(--pro-emerald)' :
    tone === 'warn'  ? 'var(--pro-amber)' :
    tone === 'alarm' ? 'var(--pro-red)' :
    'var(--pro-ink)'
  return (
    <div className="rounded-lg bg-white p-4" style={{ border: '1px solid var(--pro-line)' }}>
      <div className="flex items-center justify-between mb-2.5">
        <Kicker>{label}</Kicker>
        {icon && <div style={{ color: 'var(--pro-ink-mute)' }}>{icon}</div>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="pro-mono font-bold leading-none" style={{ fontSize: 'clamp(20px, 2vw, 28px)', color }}>
          {value}
        </span>
        {unit && <span className="text-xs font-semibold" style={{ color: 'var(--pro-ink-mute)' }}>{unit}</span>}
      </div>
      {sub && <div className="text-[11px] mt-2" style={{ color: 'var(--pro-ink-mute)' }}>{sub}</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 4. DELIVERY QUEUE — horizontal scroll of today's deliveries
// ════════════════════════════════════════════════════════════════════════
type DeliveryItem = {
  id: string
  time: string
  client: string
  orderNo: string
  qtyDone: number
  qtyTotal: number
  status: 'done' | 'in_progress' | 'pending' | 'late'
}
function DeliveryQueue({ items }: { items: DeliveryItem[] }) {
  return (
    <div className="rounded-xl bg-white flex flex-col" style={{ border: '1px solid var(--pro-line)' }}>
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--pro-line)' }}>
        <div className="flex items-center gap-2.5">
          <Truck size={14} style={{ color: 'var(--pro-granat)' }} />
          <Kicker color="var(--pro-granat)">Harmonogram odbiorów</Kicker>
          <span style={{ color: 'var(--pro-ink-faint)' }}>·</span>
          <span className="text-xs" style={{ color: 'var(--pro-ink-mute)' }}>{items.length} dziś</span>
        </div>
        <Link to="/office/zamowienia" className="text-[11px] font-semibold flex items-center gap-1 hover:underline"
          style={{ color: 'var(--pro-granat)' }}>
          Wszystkie <ArrowRight size={11} />
        </Link>
      </div>

      <div className="p-3 flex-1">
        {items.length === 0 ? (
          <div className="py-10 text-center">
            <div className="pro-serif-it text-lg" style={{ color: 'var(--pro-ink-mute)' }}>brak odbiorów na dziś</div>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pro-scroll pb-1">
            {items.map(it => (
              <DeliveryTile key={it.id} {...it} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DeliveryTile({ time, client, orderNo, qtyDone, qtyTotal, status }: DeliveryItem) {
  const pct = qtyTotal > 0 ? Math.min(100, (qtyDone / qtyTotal) * 100) : 0
  const colorMap = {
    done:        { bar: 'var(--pro-emerald)',  tag: 'OK',          tagColor: 'var(--pro-emerald)', border: 'var(--pro-emerald)', bg: 'var(--pro-emerald-soft)' },
    in_progress: { bar: 'var(--pro-amber)',    tag: 'W PRODUKCJI', tagColor: 'var(--pro-amber)',   border: 'var(--pro-line-2)',  bg: 'var(--pro-surface)' },
    pending:     { bar: 'var(--pro-granat)',   tag: 'ZAPLANOWANE', tagColor: 'var(--pro-granat)',  border: 'var(--pro-line-2)',  bg: 'var(--pro-surface)' },
    late:        { bar: 'var(--pro-red)',      tag: 'OPÓŹNIONE',   tagColor: 'var(--pro-red)',     border: 'var(--pro-red)',     bg: 'var(--pro-red-soft)' },
  }
  const c = colorMap[status]

  return (
    <div className="flex-shrink-0 w-[200px] rounded-lg p-3"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="pro-mono text-[15px] font-bold" style={{ color: 'var(--pro-ink)' }}>{time}</span>
        <span className="text-[8px] font-bold uppercase tracking-[0.15em] px-1.5 py-0.5 rounded"
          style={{ color: c.tagColor, background: 'rgba(255,255,255,0.6)' }}>
          {c.tag}
        </span>
      </div>
      <div className="text-[12px] font-semibold truncate mb-0.5" style={{ color: 'var(--pro-ink)' }} title={client}>{client}</div>
      <div className="pro-mono text-[10px] mb-2.5" style={{ color: 'var(--pro-ink-mute)' }}>{orderNo}</div>
      <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--pro-bg-soft)' }}>
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: c.bar }} />
      </div>
      <div className="flex items-baseline justify-between pro-mono text-[10px]">
        <span style={{ color: 'var(--pro-ink-mute)' }}>{qtyDone}/{qtyTotal} szt</span>
        <span className="font-bold" style={{ color: c.bar }}>{pct.toFixed(0)}%</span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 5. ACTIVE STATIONS — live operator rows
// ════════════════════════════════════════════════════════════════════════
type ActiveStation = {
  id: string
  station: string
  kind: 'rozbior' | 'masowanie' | 'produkcja'
  task: string
  done: number
  total: number
  unit: string
  detail?: string
}
function ActiveStations({ items }: { items: ActiveStation[] }) {
  const kindColor = {
    rozbior:   { icon: <Scissors size={12} />, color: 'var(--pro-amber)',   bg: 'var(--pro-amber-soft)',   label: 'ROZBIÓR' },
    masowanie: { icon: <Soup size={12} />,     color: '#7C3AED',            bg: 'rgba(124, 58, 237, 0.10)', label: 'MASOWANIE' },
    produkcja: { icon: <Factory size={12} />,  color: 'var(--pro-granat)',  bg: 'var(--pro-granat-soft)',  label: 'PRODUKCJA' },
  } as const

  return (
    <div className="rounded-xl bg-white flex flex-col h-full" style={{ border: '1px solid var(--pro-line)' }}>
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--pro-line)' }}>
        <div className="flex items-center gap-2.5">
          <Activity size={14} style={{ color: 'var(--pro-granat)' }} />
          <Kicker color="var(--pro-granat)">Stanowiska na żywo</Kicker>
        </div>
        <div className="flex items-center gap-1.5">
          <LiveDot size={6} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--pro-emerald)' }}>{items.length} aktywnych</span>
        </div>
      </div>

      <div className="p-4 space-y-2.5 flex-1 overflow-y-auto pro-scroll" style={{ maxHeight: 380 }}>
        {items.length === 0 ? (
          <div className="py-10 text-center">
            <div className="pro-serif-it text-base" style={{ color: 'var(--pro-ink-mute)' }}>żadne stanowisko nie pracuje</div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--pro-ink-faint)' }}>Uruchom sesję rozbioru, zlecenie masowania albo linię produkcyjną</div>
          </div>
        ) : items.map(it => {
          const k = kindColor[it.kind]
          const pct = it.total > 0 ? Math.min(100, (it.done / it.total) * 100) : 0
          return (
            <div key={it.id} className="rounded-lg p-3" style={{ background: 'var(--pro-surface-2)', border: '1px solid var(--pro-line)' }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: k.color, background: k.bg, border: `1px solid ${k.color}33` }}>
                    {k.icon} {k.label}
                  </span>
                  <span className="text-[12px] font-bold truncate" style={{ color: 'var(--pro-ink)' }}>{it.station}</span>
                </div>
                <LiveDot color={k.color} size={6} />
              </div>
              <div className="text-[12px] font-semibold mb-0.5 truncate" style={{ color: 'var(--pro-ink-soft)' }}>{it.task}</div>
              {it.detail && <div className="text-[10px] mb-1.5" style={{ color: 'var(--pro-ink-mute)' }}>{it.detail}</div>}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--pro-bg-soft)' }}>
                  <div className="h-full transition-all" style={{ width: `${pct}%`, background: k.color }} />
                </div>
                <span className="pro-mono text-[11px] font-bold whitespace-nowrap" style={{ color: 'var(--pro-ink)' }}>
                  {it.done}/{it.total}
                  <span className="ml-1 text-[10px] font-semibold" style={{ color: k.color }}>{pct.toFixed(0)}%</span>
                  <span className="ml-1" style={{ color: 'var(--pro-ink-mute)' }}>{it.unit}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 6. ALERTS — conditional, expired batches
// ════════════════════════════════════════════════════════════════════════
function AlertsRow({ expired, critical, warnings }: {
  expired: any[]; critical: any[]; warnings: any[]
}) {
  const blocks = []
  if (expired.length + critical.length > 0) {
    blocks.push({
      tone: 'alarm' as const,
      title: 'Po terminie lub wygasa dziś/jutro',
      items: [...expired, ...critical],
    })
  }
  if (warnings.length > 0) {
    blocks.push({
      tone: 'warn' as const,
      title: 'Wygasa w 2–3 dni',
      items: warnings,
    })
  }
  if (blocks.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {blocks.map((b, idx) => {
        const color = b.tone === 'alarm' ? 'var(--pro-red)' : 'var(--pro-amber)'
        const bg = b.tone === 'alarm' ? 'var(--pro-red-soft)' : 'var(--pro-amber-soft)'
        return (
          <div key={idx} className="rounded-xl overflow-hidden"
            style={{ background: bg, border: `1px solid ${color}55` }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: `${color}33` }}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} style={{ color }} />
                <span className="text-[12px] font-bold" style={{ color }}>{b.title}</span>
              </div>
              <span className="pro-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color }}>
                {b.items.length} {b.items.length === 1 ? 'partia' : 'partii'}
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: `${color}22` }}>
              {b.items.slice(0, 4).map((it: any) => {
                const dl = getExpiryStatus(it.expiryDate).daysLeft
                return (
                  <div key={it.id} className="flex items-center justify-between px-4 py-2 text-[12px]">
                    <div className="flex items-center gap-3 min-w-0">
                      <code className="pro-mono font-bold text-[11px] px-1.5 py-0.5 rounded"
                        style={{ color, background: '#fff' }}>{it.internalBatchNo}</code>
                      <span style={{ color: 'var(--pro-ink-soft)' }}>
                        {dl < 0 ? 'Przeterminowana' : dl === 0 ? 'Wygasa dziś' : dl === 1 ? 'Wygasa jutro' : `Za ${dl} dni`}
                        <span className="ml-1" style={{ color: 'var(--pro-ink-mute)' }}>· {fmtDatePl(it.expiryDate)}</span>
                      </span>
                    </div>
                    <span className="pro-mono font-bold" style={{ color }}>{fmtKg(it.kgAvailable)} kg</span>
                  </div>
                )
              })}
              {b.items.length > 4 && (
                <div className="px-4 py-2 text-[11px]" style={{ color: 'var(--pro-ink-mute)' }}>
                  + {b.items.length - 4} {b.items.length - 4 === 1 ? 'kolejna partia' : 'kolejnych'}…
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 7. QUICK ACTIONS
// ════════════════════════════════════════════════════════════════════════
function QuickActions() {
  const items = [
    { to: '/office/raw-batches',           icon: <Beef size={16} />,    label: 'Nowa partia surowca' },
    { to: '/office/zamowienia',            icon: <Truck size={16} />,   label: 'Nowe zamówienie' },
    { to: '/office/planowanie-produkcji',  icon: <Factory size={16} />, label: 'Plan produkcji' },
    { to: '/office/planowanie-masowania',  icon: <Soup size={16} />,    label: 'Plan masowania' },
    { to: '/office/magazyn/gotowe',        icon: <Boxes size={16} />,   label: 'Magazyn wyrobu' },
    { to: '/office/haccp-report',          icon: <FileText size={16} />,label: 'Raport HACCP' },
  ]
  return (
    <div className="rounded-xl bg-white" style={{ border: '1px solid var(--pro-line)' }}>
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--pro-line)' }}>
        <div className="flex items-center gap-2.5">
          <Plus size={14} style={{ color: 'var(--pro-granat)' }} />
          <Kicker color="var(--pro-granat)">Szybkie akcje</Kicker>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 p-3">
        {items.map(it => (
          <Link key={it.to} to={it.to}
            className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors no-underline"
            style={{ background: 'var(--pro-surface-2)', border: '1px solid var(--pro-line)' }}
          >
            <div className="w-7 h-7 grid place-items-center rounded-md transition-colors"
              style={{ background: 'var(--pro-bg-soft)', color: 'var(--pro-granat)' }}>
              {it.icon}
            </div>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--pro-ink-soft)' }}>{it.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// MAIN — DashboardProPage
// ════════════════════════════════════════════════════════════════════════
export function DashboardProPage() {
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
    }, POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allBatches  = batchRes.data?.data    ?? []
  const allMeat     = meatRes.data?.data     ?? []
  const allSeasoned = seasonedRes.data       ?? []
  const allPlans    = plansRes.data          ?? []
  const allMixing   = mixingRes.data         ?? []
  const allOrders   = ordersRes.data         ?? []
  const allFinished = finishedRes.data       ?? []
  const allDeboning = deboningRes.data?.data ?? []

  // ── Today ─────────────────────────────────────────────────────
  const today = todayIso()
  const todayDeb = useMemo(
    () => allDeboning.filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today),
    [allDeboning, today],
  )
  const debKgQuarter = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)
  const debKgMeat    = todayDeb.reduce((s: number, d: any) => s + Number(d.kgMeat  ?? d.kg_meat  ?? 0), 0)
  const debYield     = debKgQuarter > 0 ? (debKgMeat / debKgQuarter) * 100 : 0

  // ── Stock ─────────────────────────────────────────────────────
  const activeBatches = allBatches.filter(b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const totalKgRaw = activeBatches.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const totalContainers = Math.ceil(totalKgRaw / KG_PER_CONTAINER)
  const availableMeat = allMeat.filter(m => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat = availableMeat.reduce((s, m) => s + Number(m.kgAvailable), 0)
  const meatByBatch = useMemo(() => {
    const set = new Set<string>()
    availableMeat.forEach(m => set.add(m.rawBatchNo ?? '—'))
    return set.size
  }, [availableMeat])
  const availableSeasoned = allSeasoned.filter(s => Number(s.kgAvailable) > 0)
  const totalKgSeasoned = availableSeasoned.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const seasonedRecipes = useMemo(() => new Set(availableSeasoned.map(s => s.recipeName || '—')).size, [availableSeasoned])

  // ── Expiry ────────────────────────────────────────────────────
  const expired  = activeBatches.filter(b => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter(b => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 0 && d <= 1 })
  const warnings = activeBatches.filter(b => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })
  const alertCount = expired.length + critical.length + warnings.length

  // ── Mixing ────────────────────────────────────────────────────
  const activeMixing = allMixing.filter(o => o.status !== 'done' && o.status !== 'cancelled')
  const mixPlanned = activeMixing.reduce((s, o) => s + Number(o.meatKg), 0)
  const mixDone    = activeMixing.reduce((s, o) => s + Number(o.kgDone), 0)

  // ── Production ────────────────────────────────────────────────
  const activePlans = allPlans.filter(p => p.status !== 'done' && p.status !== 'draft')
  const finishedKgByPlan = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => { const k = f.planNo ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + Number(f.totalKg ?? 0)) })
    return m
  }, [allFinished])
  const producedKgForPlan = (p: any) => {
    const finished = finishedKgByPlan.get(p.planNo) ?? 0
    const inProgress = (p.lines ?? []).reduce((s: number, l: any) => s + (Number(l.qtyDone) || 0) * (Number(l.kgPerUnit) || 0), 0)
    return finished + inProgress
  }
  const prodPlanned  = activePlans.reduce((s, p) => s + Number(p.totalKg), 0)
  const prodProduced = activePlans.reduce((s, p) => s + producedKgForPlan(p), 0)

  // Production buckets — current type production rate (sztuk/h approximation by qtyDone vs total elapsed)
  const productionBuckets = useMemo(() => {
    type B = { key: string; recipeName: string; kgPerUnit: number; packagingName: string
      qtyPlanned: number; qtyDone: number; inProgress: boolean }
    const m = new Map<string, B>()
    for (const p of activePlans) for (const l of (p.lines ?? [])) {
      const recipeName = l.recipeName || '—'; const kgPerUnit = Number(l.kgPerUnit) || 0
      const packagingName = (l as any).packagingName || ''
      const key = `${recipeName}|${kgPerUnit}|${packagingName}`
      const qty = Number(l.qty) || 0; const qtyDone = Number((l as any).qtyDone) || 0
      const status = ((l as any).lineStatus ?? 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE'
      const cur = m.get(key) ?? { key, recipeName, kgPerUnit, packagingName, qtyPlanned: 0, qtyDone: 0, inProgress: false }
      cur.qtyPlanned += qty; cur.qtyDone += qtyDone
      if (status === 'IN_PROGRESS') cur.inProgress = true
      m.set(key, cur)
    }
    return Array.from(m.values())
  }, [activePlans])
  const currentlyProducing = productionBuckets.filter(b => b.inProgress)

  // ── Orders (today) ────────────────────────────────────────────
  const finishedQtyByOrderNo = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => { const k = f.clientOrderNo ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + Number(f.qty ?? 0)) })
    return m
  }, [allFinished])
  const inProgressQtyByOrderId = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of activePlans) for (const l of (p.lines ?? [])) {
      const orderId = (l as any).clientOrderId || ''
      const qtyDone = Number((l as any).qtyDone) || 0
      if (qtyDone <= 0 || !orderId) continue
      m.set(orderId, (m.get(orderId) ?? 0) + qtyDone)
    }
    return m
  }, [activePlans])
  const todayDate = new Date(); const todayY = todayDate.getFullYear()
  const todayM = String(todayDate.getMonth() + 1).padStart(2, '0')
  const todayD = String(todayDate.getDate()).padStart(2, '0')
  const todayKey = `${todayY}-${todayM}-${todayD}`
  const todayDeliveries: DeliveryItem[] = useMemo(() => {
    return [...allOrders]
      .filter(o => o.deliveryDate?.slice(0, 10) === todayKey && o.status !== 'cancelled')
      .sort((a, b) => (a.deliveryDate ?? '').localeCompare(b.deliveryDate ?? ''))
      .map(o => {
        const finished = finishedQtyByOrderNo.get(o.orderNo) ?? 0
        const inProgress = inProgressQtyByOrderId.get(o.id) ?? 0
        const qtyDone = finished + inProgress
        const qtyTotal = Number(o.totalUnits ?? 0)
        const isDone = o.status === 'done' || (qtyTotal > 0 && qtyDone >= qtyTotal)
        const dt = o.deliveryDate ? new Date(o.deliveryDate) : null
        const isLate = dt && dt.getTime() < Date.now() && !isDone
        const status: DeliveryItem['status'] =
          isDone ? 'done' : isLate ? 'late' : inProgress > 0 ? 'in_progress' : 'pending'
        const time = dt ? dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—'
        return {
          id: o.id, time, client: o.clientName, orderNo: o.orderNo,
          qtyDone, qtyTotal, status,
        }
      })
  }, [allOrders, finishedQtyByOrderNo, inProgressQtyByOrderId, todayKey])

  // ── Active stations ───────────────────────────────────────────
  const activeStations: ActiveStation[] = useMemo(() => {
    const list: ActiveStation[] = []
    // deboning sessions today (latest first)
    todayDeb
      .filter((d: any) => !(d.completedAt ?? d.completed_at))
      .slice(0, 3)
      .forEach((d: any, i: number) => {
        const taken = Number(d.kgTaken ?? d.kg_taken ?? 0)
        const meat  = Number(d.kgMeat  ?? d.kg_meat  ?? 0)
        list.push({
          id: `deb-${d.id ?? i}`,
          station: `Rozbiór · sesja ${i + 1}`,
          kind: 'rozbior',
          task: d.rawBatchNo ?? d.raw_batch_no ?? 'Partia surowca',
          done: Math.round(meat), total: Math.round(taken || meat || 1),
          unit: 'kg z/s',
          detail: `pobrano ${fmtKg(taken, 0)} kg ćwiartki`,
        })
      })
    // mixing orders
    activeMixing.forEach((o, i) => {
      list.push({
        id: `mix-${o.id ?? i}`,
        station: `Mikser ${i + 1}`,
        kind: 'masowanie',
        task: o.recipeName || 'Receptura',
        done: Math.round(Number(o.kgDone)), total: Math.round(Number(o.meatKg)),
        unit: 'kg',
      })
    })
    // production lines (currently producing)
    currentlyProducing.forEach((b, i) => {
      list.push({
        id: `prod-${b.key}`,
        station: `Linia ${i + 1}`,
        kind: 'produkcja',
        task: `${b.recipeName} · ${b.kgPerUnit}kg`,
        done: b.qtyDone, total: b.qtyPlanned,
        unit: 'szt',
        detail: b.packagingName || undefined,
      })
    })
    return list
  }, [todayDeb, activeMixing, currentlyProducing])

  // ── Pipeline stations ─────────────────────────────────────────
  const pipeline: PipelineStationData[] = [
    {
      key: 'surowiec', kicker: 'Wejście', title: 'Surowiec',
      icon: <Beef size={14} />, value: fmtKg(totalKgRaw, 0), unit: 'kg',
      status: totalKgRaw > 0 ? 'idle' : 'warn',
      meta: [
        { label: 'Partie', value: `${activeBatches.length}` },
        { label: 'Pojemniki', value: `${totalContainers}` },
        { label: 'Alarmy', value: alertCount > 0 ? `${alertCount}` : '—', tone: alertCount > 0 ? 'alarm' : 'default' },
      ],
      href: '/office/magazyn/surowiec',
    },
    {
      key: 'rozbior', kicker: 'Etap 1', title: 'Rozbiór',
      icon: <Scissors size={14} />, value: fmtKg(debKgMeat, 0), unit: 'kg dziś',
      status: todayDeb.length > 0 ? 'active' : 'idle',
      meta: [
        { label: 'Sesje dziś', value: `${todayDeb.length}` },
        { label: 'Wydajność', value: debKgQuarter > 0 ? `${debYield.toFixed(0)}%` : '—',
          tone: debKgQuarter > 0 ? (debYield >= 65 ? 'ok' : debYield >= 55 ? 'warn' : 'alarm') : 'default' },
        { label: 'Ćwiartka', value: `${fmtKg(debKgQuarter, 0)} kg` },
      ],
      href: '/office/deboning',
    },
    {
      key: 'masowanie', kicker: 'Etap 2', title: 'Masowanie',
      icon: <Soup size={14} />, value: fmtKg(totalKgMeat, 0), unit: 'kg dost.',
      status: activeMixing.length > 0 ? 'active' : 'idle',
      meta: [
        { label: 'Aktywne', value: `${activeMixing.length}`, tone: activeMixing.length > 0 ? 'ok' : 'default' },
        { label: 'Postęp', value: mixPlanned > 0 ? `${fmtKg(mixDone, 0)}/${fmtKg(mixPlanned, 0)} kg` : '—' },
        { label: 'Partie z/s', value: `${meatByBatch}` },
      ],
      href: '/office/planowanie-masowania',
    },
    {
      key: 'produkcja', kicker: 'Etap 3', title: 'Produkcja',
      icon: <Factory size={14} />, value: fmtKg(totalKgSeasoned, 0), unit: 'kg dost.',
      status: currentlyProducing.length > 0 ? 'active' : activePlans.length > 0 ? 'warn' : 'idle',
      meta: [
        { label: 'Linie', value: `${currentlyProducing.length}`, tone: currentlyProducing.length > 0 ? 'ok' : 'default' },
        { label: 'Plan', value: prodPlanned > 0 ? `${fmtKg(prodProduced, 0)}/${fmtKg(prodPlanned, 0)} kg` : '—' },
        { label: 'Receptury', value: `${seasonedRecipes}` },
      ],
      href: '/office/planowanie-produkcji',
    },
    {
      key: 'wyjazd', kicker: 'Etap 4', title: 'Wyjazd',
      icon: <Truck size={14} />, value: `${todayDeliveries.length}`, unit: 'dziś',
      status: todayDeliveries.some(d => d.status === 'late') ? 'alarm'
            : todayDeliveries.some(d => d.status === 'in_progress') ? 'active'
            : todayDeliveries.length > 0 ? 'warn' : 'idle',
      meta: [
        { label: 'Gotowe', value: `${todayDeliveries.filter(d => d.status === 'done').length}`, tone: 'ok' },
        { label: 'W produkcji', value: `${todayDeliveries.filter(d => d.status === 'in_progress').length}` },
        { label: 'Opóźnione', value: `${todayDeliveries.filter(d => d.status === 'late').length}`,
          tone: todayDeliveries.some(d => d.status === 'late') ? 'alarm' : 'default' },
      ],
      href: '/office/zamowienia',
    },
  ]

  // ── Today metrics ─────────────────────────────────────────────
  const planPct = prodPlanned > 0 ? Math.min(100, (prodProduced / prodPlanned) * 100) : 0

  // ── Render ────────────────────────────────────────────────────
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRO_STYLES }} />
      <div className="pro-page">
        <StatusStrip alerts={alertCount} />

        <div className="px-5 py-5 md:px-7 md:py-6 space-y-5 max-w-[1680px] mx-auto">

          {/* Hero pipeline */}
          <Pipeline stations={pipeline} />

          {/* Today metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <TodayTile
              label="Wydajność rozbioru"
              value={debKgQuarter > 0 ? `${debYield.toFixed(0)}` : '—'}
              unit={debKgQuarter > 0 ? '%' : ''}
              sub={debKgQuarter > 0 ? `${fmtKg(debKgMeat, 0)} kg z ${fmtKg(debKgQuarter, 0)} kg ćwiartki` : 'Brak sesji dziś'}
              tone={debKgQuarter === 0 ? 'default' : debYield >= 65 ? 'ok' : debYield >= 55 ? 'warn' : 'alarm'}
              icon={<Scissors size={12} />}
            />
            <TodayTile
              label="Realizacja planu"
              value={prodPlanned > 0 ? `${planPct.toFixed(0)}` : '—'}
              unit={prodPlanned > 0 ? '%' : ''}
              sub={prodPlanned > 0 ? `${fmtKg(prodProduced, 0)} / ${fmtKg(prodPlanned, 0)} kg` : 'Brak planów aktywnych'}
              tone={prodPlanned === 0 ? 'default' : planPct >= 80 ? 'ok' : planPct >= 50 ? 'warn' : 'default'}
              icon={<Factory size={12} />}
            />
            <TodayTile
              label="Odbiory dziś"
              value={todayDeliveries.length}
              sub={todayDeliveries.length > 0
                ? `${todayDeliveries.filter(d => d.status === 'done').length} gotowe · ${todayDeliveries.filter(d => d.status === 'late').length} opóźnione`
                : 'Brak odbiorów na dziś'}
              tone={todayDeliveries.some(d => d.status === 'late') ? 'alarm' : 'default'}
              icon={<Truck size={12} />}
            />
            <TodayTile
              label="Krótki termin"
              value={alertCount}
              unit="partii"
              sub={
                expired.length > 0 ? `${expired.length} po terminie` :
                (critical.length + warnings.length) > 0 ? `${critical.length} dziś/jutro · ${warnings.length} 2–3 dni` :
                'Brak alarmów'
              }
              tone={expired.length > 0 ? 'alarm' : (critical.length + warnings.length) > 0 ? 'warn' : 'ok'}
              icon={<Clock size={12} />}
            />
          </div>

          {/* Alerts (conditional) */}
          {alertCount > 0 && <AlertsRow expired={expired} critical={critical} warnings={warnings} />}

          {/* Delivery queue + stations */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 min-h-[260px]">
              <DeliveryQueue items={todayDeliveries} />
            </div>
            <div>
              <ActiveStations items={activeStations} />
            </div>
          </div>

          {/* Quick actions */}
          <QuickActions />

          {/* Footer — switch links */}
          <div className="flex items-center gap-2 text-[11px] pt-2" style={{ color: 'var(--pro-ink-mute)' }}>
            <Package size={11} />
            <span>Inne widoki:</span>
            <Link to="/office/dashboard" className="font-semibold hover:underline" style={{ color: 'var(--pro-granat)' }}>klasyczny</Link>
            <span style={{ color: 'var(--pro-ink-faint)' }}>·</span>
            <Link to="/office/dashboard-mui" className="font-semibold hover:underline" style={{ color: 'var(--pro-granat)' }}>MUI</Link>
          </div>

        </div>
      </div>
    </>
  )
}
