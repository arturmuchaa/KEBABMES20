/**
 * DeboningHmiV10Page — HMI v10 „Rzemiosło" (rzeźnicza księga / wiszące etykiety).
 *
 * Szkielet 3-kolumnowy zatwierdzony jako produkcyjny (pracownicy | wpis ①②③ | sterownia),
 * język wizualny wybrany po porównaniu trzech niezależnych kierunków mockupu — zamiast
 * kolejnej rekombinacji v5/v8/v9. Zero pól HACCP, jeden stały jasny motyw. Logika sesji/
 * wpisów/alarmów przeniesiona 1:1 z HMI v9 (docs/superpowers/specs/2026-07-03-rozbior-hmi-v10-design.md).
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Play, Lock, Save, Flag, LogOut, Delete, X, BarChart3, Bell, BellOff, ListOrdered } from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'
import './DeboningHmiV10Page.css'

const KG_PER_CONTAINER = 15
const YIELD_BAND_LO = 65   // % — dolna granica pasma celu
const YIELD_BAND_HI = 80   // % — górna granica pasma celu
const TEMPO_TARGET  = 800  // kg/h — cel linii

type ActiveField = 'taken' | 'meat'
type StatsSort = 'taken' | 'meat' | 'yield' | 'count'

/** Paleta „Rzemiosło" — wszystkie pary zweryfikowane WCAG (patrz spec, tabela kontrastu). */
const VARS: CSSProperties = {
  ['--paper' as string]:      '#EFEAE1',
  ['--panel' as string]:      '#F8F5EF',
  ['--ink' as string]:        '#241F1A',
  ['--mut' as string]:        '#6E665A',
  ['--line' as string]:       '#8C7D60',
  ['--accent' as string]:     '#9C3B1E',
  ['--accentSoft' as string]: '#F0DCCF',
  ['--stamp' as string]:      '#3D6B49',
  ['--stampSoft' as string]:  '#DEE8DD',
  ['--amb' as string]:        '#8A5A12',
  ['--ambSoft' as string]:    '#F0E1C4',
  ['--red' as string]:        '#9C2020',
  ['--redSoft' as string]:    '#F0D9D6',
}

function yieldInk(pct: number): string {
  if (pct <= 0) return 'var(--mut)'
  if (pct < 60) return 'var(--red)'
  if (pct < YIELD_BAND_LO) return 'var(--amb)'
  return 'var(--ink)'
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

// ─── Zegar (izolowany) ──────────────────────────────────────────────
const TopClock = memo(function TopClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="hmi-v10-mono text-2xl font-bold" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

// ─── Wskaźnik łukowy z pasmem celu ──────────────────────────────────
const ArcGauge = memo(function ArcGauge({ value, min, max, bandLo, bandHi }: {
  value: number; min: number; max: number; bandLo: number; bandHi: number
}) {
  const cx = 100, cy = 100, r = 82, needleR = 74
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const frac = (v: number) => (clamp(v) - min) / (max - min)
  const angleFor = (v: number) => 180 * (1 - frac(v))
  const start = polar(cx, cy, r, 180)
  const end = polar(cx, cy, r, 0)
  const trackPath = `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`
  const inBand = value >= bandLo && value <= bandHi
  const needleAngle = angleFor(value)
  const needleEnd = polar(cx, cy, needleR, needleAngle)
  const bandLoPt = polar(cx, cy, r + 7, angleFor(bandLo))
  const bandLoPt2 = polar(cx, cy, r, angleFor(bandLo))
  const bandHiPt = polar(cx, cy, r + 7, angleFor(bandHi))
  const bandHiPt2 = polar(cx, cy, r, angleFor(bandHi))
  const needleColor = value <= 0 ? 'var(--mut)' : inBand ? 'var(--ink)' : value < bandLo ? 'var(--amb)' : 'var(--ink)'
  return (
    <svg viewBox="0 0 200 108" style={{ width: '100%', height: 78 }}>
      <path d={trackPath} fill="none" stroke="var(--line)" strokeWidth={9} strokeLinecap="round" opacity={0.5} />
      <path d={trackPath} fill="none" stroke="var(--stamp)" strokeWidth={9} strokeLinecap="round"
        pathLength={100} strokeDasharray={100} strokeDashoffset={100 - frac(value) * 100} />
      <line x1={bandLoPt2.x} y1={bandLoPt2.y} x2={bandLoPt.x} y2={bandLoPt.y} stroke="var(--mut)" strokeWidth={2} />
      <line x1={bandHiPt2.x} y1={bandHiPt2.y} x2={bandHiPt.x} y2={bandHiPt.y} stroke="var(--mut)" strokeWidth={2} />
      <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke={needleColor} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5.5} fill={needleColor} />
    </svg>
  )
})

// ─── Krok ①②③ ────────────────────────────────────────────────────────
function StepDot({ no, done }: { no: number; done: boolean }) {
  return (
    <span className="hmi-v10-mono w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
      style={done
        ? { border: '1.5px solid var(--stamp)', color: 'var(--stamp)', transform: 'rotate(-6deg)' }
        : { border: '1.5px solid var(--line)', color: 'var(--mut)' }}>
      {done ? 'OK' : no}
    </span>
  )
}
function SectionLabel({ no, done, children }: { no: number; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-2 flex-shrink-0">
      <StepDot no={no} done={done} />
      <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.12em' }}>
        {children}
      </span>
    </div>
  )
}

// ─── Kafel partii (etykieta z „uszkiem", FEFO) ──────────────────────
const BatchTileV10 = memo(function BatchTileV10({ batch, selected, first, onSelect }: {
  batch: RawBatch; selected: boolean; first: boolean; onSelect: (b: RawBatch) => void
}) {
  const { daysLeft } = getExpiryStatus(batch.expiryDate)
  const kg = Number(batch.kgAvailable)
  const expired = daysLeft < 0
  const daysColor = expired || daysLeft === 0 ? 'var(--red)' : daysLeft <= 3 ? 'var(--amb)' : 'var(--mut)'
  return (
    <button type="button" onClick={() => onSelect(batch)} disabled={expired}
      className={cn('relative flex flex-col justify-between text-left h-full flex-shrink-0 select-none active:translate-y-px transition-colors', expired && 'opacity-50')}
      style={{
        width: 208, padding: '10px 14px 10px 20px', borderRadius: '2px 10px 2px 2px',
        background: selected ? 'var(--accentSoft)' : 'var(--panel)',
        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
      }}>
      <span aria-hidden style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 7, height: 7, borderRadius: '50%', background: 'var(--paper)', border: '1.5px solid var(--line)' }} />
      <div className="flex items-start justify-between gap-2">
        <span className="hmi-v10-mono font-bold text-xl leading-none" style={{ color: selected ? 'var(--accent)' : 'var(--ink)' }}>
          {batch.internalBatchNo}
        </span>
        {first && !selected && (
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm" style={{ letterSpacing: '.08em', background: 'var(--stampSoft)', color: 'var(--stamp)' }}>
            najpierw
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="hmi-v10-mono text-sm font-bold" style={{ color: 'var(--ink)' }}>{fmtKg(kg, 0)} kg</span>
        <span className="text-[11px] font-bold uppercase" style={{ color: daysColor }}>
          {expired ? 'przeterm.' : daysLeft === 0 ? 'dziś!' : `${daysLeft}d`}
        </span>
      </div>
      <div className="text-[11px] font-medium truncate mt-0.5" style={{ color: 'var(--mut)' }}>
        {batch.supplierDisplayName ?? batch.supplierName ?? '—'} · {Math.floor(kg / KG_PER_CONTAINER)} poj.
      </div>
    </button>
  )
})

// ─── Kafel pracownika (przerywana ramka, pieczątka licznika) ────────
const WorkerTileV10 = memo(function WorkerTileV10({ worker, selected, entryCount, kgToday, onSelect }: {
  worker: User; selected: boolean; entryCount: number; kgToday: number; onSelect: (w: User) => void
}) {
  const initials = worker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className="relative flex flex-col items-center justify-center gap-1 select-none active:scale-[0.98] transition-all px-2"
      style={{
        borderRadius: 6, minHeight: 92,
        background: selected ? 'var(--accentSoft)' : 'var(--panel)',
        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
      }}>
      <span aria-hidden style={{ position: 'absolute', inset: 4, border: '1px dashed var(--line)', borderRadius: 3, opacity: 0.6, pointerEvents: 'none' }} />
      <span className="hmi-v10-display font-bold text-3xl leading-none" style={{ color: selected ? 'var(--accent)' : 'var(--ink)' }}>{initials}</span>
      <span className="text-[12px] font-semibold leading-tight text-center truncate w-full" style={{ color: 'var(--ink)' }}>{worker.name}</span>
      {kgToday > 0 && (
        <span className="hmi-v10-mono text-[10px] font-bold" style={{ color: 'var(--mut)' }}>{fmtKg(kgToday, 0)} kg</span>
      )}
      {entryCount > 0 && (
        <span className="hmi-v10-mono absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
          style={{ border: '1.5px solid var(--stamp)', color: 'var(--stamp)', background: 'var(--panel)', transform: 'rotate(-8deg)' }}>
          {entryCount}
        </span>
      )}
    </button>
  )
})

// ─── Pole odczytu ────────────────────────────────────────────────────
function ReadoutV10({ label, value, unit, active, error, sub, onActivate, extraHeader }: {
  label: string; value: string; unit: string; active: boolean; error?: boolean
  sub?: string; onActivate: () => void; extraHeader?: React.ReactNode
}) {
  return (
    <button type="button" onClick={onActivate}
      className="flex-1 text-left transition-colors flex flex-col justify-between min-w-0"
      style={{
        borderRadius: 4, padding: '10px 14px', background: 'var(--panel)',
        border: `1.5px solid ${error ? 'var(--red)' : active ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: active && !error ? '0 0 0 3px var(--accentSoft)' : undefined,
      }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: '.12em', color: error ? 'var(--red)' : active ? 'var(--accent)' : 'var(--mut)' }}>
          {label}
        </span>
        {extraHeader}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="hmi-v10-mono font-bold leading-none" style={{ fontSize: 'clamp(34px, 3vw, 46px)', color: error ? 'var(--red)' : value ? 'var(--ink)' : 'var(--line)' }}>
          {value || '0'}
        </span>
        <span className="text-base font-bold" style={{ color: 'var(--mut)' }}>{unit}</span>
      </div>
      <div className="text-[11px] font-semibold truncate" style={{ color: error ? 'var(--red)' : 'var(--mut)', minHeight: 14 }}>{sub || ''}</div>
    </button>
  )
}

// ─── Numpad ────────────────────────────────────────────────────────
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const
const NumpadV10 = memo(function NumpadV10({ onKey, onBackStart, onBackEnd, disabled }: {
  onKey: (k: string) => void; onBackStart: () => void; onBackEnd: () => void; disabled: boolean
}) {
  return (
    <div className={cn('grid grid-cols-3 gap-2 flex-1 min-h-0', disabled && 'opacity-40 pointer-events-none')}>
      {KEYS.map(k => (
        <button key={k} type="button" onClick={() => onKey(k)}
          onPointerDown={k === '⌫' ? onBackStart : undefined}
          onPointerUp={k === '⌫' ? onBackEnd : undefined}
          onPointerLeave={k === '⌫' ? onBackEnd : undefined}
          className="hmi-v10-mono flex items-center justify-center font-bold select-none active:translate-y-px transition-transform"
          style={{
            borderRadius: 4, fontSize: 'clamp(22px,2vw,30px)',
            background: k === '⌫' ? 'var(--redSoft)' : 'var(--panel)',
            border: `1.5px solid ${k === '⌫' ? 'var(--red)' : 'var(--line)'}`,
            color: k === '⌫' ? 'var(--red)' : 'var(--ink)',
          }}>
          {k === '⌫' ? <Delete size={26} /> : k}
        </button>
      ))}
    </div>
  )
})

interface HmiAlarm { id: string; level: 'red' | 'amb'; text: string }

export function DeboningHmiV10Page() {
  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())
  const { session, timeWindow, loading: sessionLoading, startDay, startLoading, closeDay, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<ActiveField>('taken')
  const [takenMode, setTakenMode] = useState<'kg' | 'poj'>('kg')
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal, setFinishModal] = useState(false)
  const [shiftModal,  setShiftModal]  = useState(false)
  const [statsModal,  setStatsModal]  = useState(false)
  const [statsSort,   setStatsSort]   = useState<StatsSort>('meat')
  const [statsDir,    setStatsDir]    = useState<'asc' | 'desc'>('desc')
  const [inputBacks, setInputBacks] = useState('')
  const [inputBones, setInputBones] = useState('')
  const [toastMsg,  setToastMsg]  = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [toastVis,  setToastVis]  = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg(msg); setToastType(type); setToastVis(true)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastVis(false), 3000)
  }, [])

  useEffect(() => () => {
    if (toastRef.current) clearTimeout(toastRef.current)
    if (longPressRef.current) clearTimeout(longPressRef.current)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
  }, [])

  const allActiveBatches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)),
    [batchData.data])
  const batches = useMemo(() => allActiveBatches.slice(0, 6), [allActiveBatches])
  const totalKgMagazyn = useMemo(() => allActiveBatches.reduce((s, b) => s + Number(b.kgAvailable), 0), [allActiveBatches])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  const perWorker = useMemo(() => {
    const m = new Map<string, { name: string; taken: number; meat: number; count: number; lastAt: number }>()
    for (const e of entries) {
      const cur = m.get(e.workerId) ?? { name: e.workerName, taken: 0, meat: 0, count: 0, lastAt: 0 }
      cur.taken += e.kgTaken; cur.meat += e.kgMeat; cur.count += 1
      cur.lastAt = Math.max(cur.lastAt, new Date(e.createdAt).getTime())
      m.set(e.workerId, cur)
    }
    return m
  }, [entries])

  const shift = useMemo(() => {
    const totTaken = entries.reduce((s, e) => s + e.kgTaken, 0)
    const totMeat  = entries.reduce((s, e) => s + e.kgMeat, 0)
    const totBacks = entries.reduce((s, e) => s + (e.kgBacks ?? 0), 0)
    const totBones = entries.reduce((s, e) => s + (e.kgBones ?? 0), 0)
    const yieldPct = totTaken > 0 ? (totMeat / totTaken) * 100 : 0
    const hours = session ? Math.max(0.25, (Date.now() - new Date(session.startedAt).getTime()) / 3_600_000) : 0
    const tempo = hours > 0 ? totTaken / hours : 0
    const now = Date.now()
    const activeWorkers = Array.from(perWorker.values()).filter(w => now - w.lastAt < 3_600_000).length
    const prognoza = timeWindow.minutesToClose != null && timeWindow.minutesToClose > 0
      ? totTaken + tempo * (timeWindow.minutesToClose / 60)
      : null
    return { totTaken, totMeat, totBacks, totBones, yieldPct, tempo, activeWorkers, prognoza }
  }, [entries, session, perWorker, timeWindow.minutesToClose])

  const alarms = useMemo<HmiAlarm[]>(() => {
    const out: HmiAlarm[] = []
    for (const b of allActiveBatches) {
      const { daysLeft } = getExpiryStatus(b.expiryDate)
      if (daysLeft < 0) out.push({ id: `exp-${b.id}`, level: 'red', text: `Partia ${b.internalBatchNo} przeterminowana — blokada HACCP` })
      else if (daysLeft === 0) out.push({ id: `fefo0-${b.id}`, level: 'red', text: `Partia ${b.internalBatchNo} — termin upływa DZIŚ` })
      else if (daysLeft <= 3) out.push({ id: `fefo-${b.id}`, level: 'amb', text: `Partia ${b.internalBatchNo} — termin za ${daysLeft} dni` })
    }
    const last3 = entries.slice(-3)
    if (last3.length === 3) {
      const avg = last3.reduce((s, e) => s + e.yieldPct, 0) / 3
      if (avg < 60) out.push({ id: 'low-yield', level: 'amb', text: `Niska wydajność ostatnich wpisów (śr. ${fmtPct(avg, 1)})` })
    }
    if (timeWindow.minutesToClose != null && timeWindow.minutesToClose > 0 && timeWindow.minutesToClose <= 30)
      out.push({ id: 'window', level: 'amb', text: `Okno zapisu zamyka się za ${timeWindow.minutesToClose} min` })
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))
  }, [allActiveBatches, entries, timeWindow.minutesToClose])

  const workerStats = useMemo(() => {
    const rows = Array.from(perWorker.values())
      .map(s => ({ ...s, yieldPct: s.taken > 0 ? (s.meat / s.taken) * 100 : 0 }))
    const key = statsSort === 'taken' ? 'taken' : statsSort === 'meat' ? 'meat' : statsSort === 'count' ? 'count' : 'yieldPct'
    return rows.sort((a, b) => statsDir === 'asc' ? (a as any)[key] - (b as any)[key] : (b as any)[key] - (a as any)[key])
  }, [perWorker, statsSort, statsDir])

  const toggleStatsSort = useCallback((key: StatsSort) => {
    setStatsSort(prev => {
      if (prev === key) { setStatsDir(d => d === 'asc' ? 'desc' : 'asc'); return prev }
      setStatsDir('desc'); return key
    })
  }, [])

  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)

  const takenRaw = parseFloat(kgTaken) || 0
  const taken = takenMode === 'poj' ? takenRaw * KG_PER_CONTAINER : takenRaw
  const meat  = parseFloat(kgMeat)  || 0
  const meatTooBig = taken > 0 && meat > taken
  const yieldPct = taken > 0 && meat > 0 && !meatTooBig ? (meat / taken) * 100 : 0
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && !meatTooBig

  const saveHint = !selBatch ? 'WYBIERZ PARTIĘ'
    : !selWorker ? 'WYBIERZ PRACOWNIKA'
    : taken <= 0 ? 'PODAJ WAGĘ ZABRANĄ'
    : meat <= 0 ? 'PODAJ WAGĘ MIĘSA'
    : meatTooBig ? 'MIĘSO > ZABRANE!'
    : 'ZAPISZ WPIS'

  const pressKey = useCallback((k: string) => {
    const apply = (prev: string): string => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev === '' ? '0.' : prev + '.')
      const next = prev + k
      if (next.replace('.', '').length > 6) return prev
      const dot = next.indexOf('.')
      if (dot >= 0 && next.length - dot - 1 > 2) return prev
      return next
    }
    if (active === 'taken') setKgTaken(apply)
    else setKgMeat(apply)
  }, [active])

  const clearActiveField = useCallback(() => {
    if (active === 'taken') setKgTaken(''); else setKgMeat('')
  }, [active])
  const handleBackStart = useCallback(() => { longPressRef.current = setTimeout(clearActiveField, 600) }, [clearActiveField])
  const handleBackEnd = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }, [])

  const switchTakenMode = useCallback((mode: 'kg' | 'poj') => {
    setTakenMode(mode); setKgTaken(''); setActive('taken')
  }, [])
  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [])
  const pickWorker = useCallback((w: User) => { setSelWorker(w); setActive('taken') }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'err'); else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (addLoading || !canSave || !selBatch || !selWorker || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 350)
    setKgTaken(''); setKgMeat(''); setActive('taken')
    showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

  async function handleFinishBatchConfirm() {
    if (!session) return
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', 'err'); return }
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', 'err'); return }
    const sumTaken = finalizeTotalTaken || 1
    let rb = 0, rn = 0
    for (let i = 0; i < pendingFinalize.length; i++) {
      const e = pendingFinalize[i]
      const isLast = i === pendingFinalize.length - 1
      const share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - rb) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - rn) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      rb += kb; rn += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }
    setFinishModal(false)
    setInputBacks(''); setInputBones('')
    showToast(`Zakończono ${pendingFinalize.length} wpisów`)
  }

  async function handleCloseShift() {
    const err = await closeDay()
    if (err) showToast(err, 'err')
    else { setShiftModal(false); showToast('Zmiana zakończona') }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="h-full w-full overflow-hidden flex flex-col" style={{ ...VARS, background: 'var(--paper)', color: 'var(--ink)' }}>
      {children}
    </div>
  )

  if (sessionLoading) return wrap(<div className="flex items-center justify-center flex-1"><Spinner size={48} /></div>)

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-8">
      <div className="text-center">
        <div className="hmi-v10-mono text-[13px] font-bold uppercase mb-3" style={{ color: 'var(--mut)', letterSpacing: '.3em' }}>
          Rozbiór · {timeWindow.productionDate}
        </div>
        <h2 className="hmi-v10-display font-bold text-5xl">Rozpocznij dzień</h2>
      </div>
      <button type="button" onClick={handleStartDay} disabled={startLoading}
        className="h-20 px-16 text-2xl font-bold flex items-center gap-4"
        style={{ borderRadius: 6, background: 'var(--accent)', color: '#fff' }}>
        {startLoading ? <span className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={32} />}
        Rozpocznij dzień
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="w-28 h-28 flex items-center justify-center" style={{ borderRadius: 12, background: 'var(--panel)', border: '2px solid var(--amb)', color: 'var(--amb)' }}>
        <Lock size={56} />
      </div>
      <h2 className="hmi-v10-display font-bold text-4xl">{session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}</h2>
      <p className="text-xl max-w-lg text-center" style={{ color: 'var(--mut)' }}>
        {session.status === 'approved' ? `Dane z dnia ${session.sessionDate} są zablokowane.` : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'}
      </p>
    </div>
  )

  const redCount = alarms.filter(a => a.level === 'red').length
  const recent = entries.slice(-8).reverse()

  return wrap(
    <>
      <div className={cn('fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 text-base font-bold flex items-center gap-3 transition-opacity duration-150',
        toastVis ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        style={{ borderRadius: 6, background: 'var(--panel)', border: `2px solid ${toastType === 'ok' ? 'var(--stamp)' : 'var(--red)'}`, color: toastType === 'ok' ? 'var(--stamp)' : 'var(--red)' }}>
        {toastMsg}
      </div>

      <header className="flex-shrink-0 h-[68px] flex items-center gap-5 px-6" style={{ background: 'var(--panel)', borderBottom: '3px double var(--line)' }}>
        <div>
          <div className="hmi-v10-display font-bold italic text-2xl leading-none">Rozbiór</div>
          <div className="hmi-v10-mono text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.16em' }}>
            {session.sessionDate} · HMI v10
          </div>
        </div>
        {([
          { label: 'Magazyn',  val: `${fmtKg(totalKgMagazyn, 0)} kg` },
          { label: 'Partie',   val: String(allActiveBatches.length) },
          { label: 'Operator', val: selWorker?.name.split(' ')[0] ?? '—', color: selWorker ? 'var(--accent)' : 'var(--mut)' },
        ] as const).map(c => (
          <div key={c.label} className="flex flex-col justify-center pl-5 flex-shrink-0" style={{ borderLeft: '1.5px solid var(--line)' }}>
            <span className="text-[10px] font-bold uppercase leading-none mb-1" style={{ color: 'var(--mut)', letterSpacing: '.16em' }}>{c.label}</span>
            <span className="hmi-v10-mono text-base font-bold leading-none truncate max-w-[140px]" style={{ color: (c as any).color ?? 'var(--ink)' }}>{c.val}</span>
          </div>
        ))}
        <div className="flex-1" />
        <span className="flex items-center gap-2 px-3 h-11 text-sm font-bold flex-shrink-0"
          style={alarms.length === 0
            ? { color: 'var(--mut)', border: '1.5px solid var(--line)', borderRadius: 4 }
            : { color: redCount > 0 ? 'var(--red)' : 'var(--amb)', background: redCount > 0 ? 'var(--redSoft)' : 'var(--ambSoft)', border: `1.5px solid ${redCount > 0 ? 'var(--red)' : 'var(--amb)'}`, borderRadius: 4 }}>
          {alarms.length === 0 ? <BellOff size={18} /> : <Bell size={18} />}
          {alarms.length === 0 ? 'BRAK ALARMÓW' : `ALARMY: ${alarms.length}`}
        </span>
        <TopClock />
        <button type="button" onClick={() => setShiftModal(true)}
          className="h-11 px-4 text-sm font-bold flex items-center gap-2 flex-shrink-0"
          style={{ border: '1.5px solid var(--line)', color: 'var(--mut)', borderRadius: 4 }}>
          <LogOut size={16} /> Zakończ zmianę
        </button>
        <button type="button" onClick={() => setFinishModal(true)}
          className="h-11 px-4 text-sm font-bold flex items-center gap-2 flex-shrink-0"
          style={{ border: '1.5px solid var(--amb)', color: 'var(--amb)', borderRadius: 4 }}>
          <Flag size={16} /> Zakończ partię
        </button>
      </header>

      <div className="flex-shrink-0 h-[96px] px-3 py-2 flex items-center gap-2 overflow-x-auto">
        {batchData.loading
          ? <div className="flex items-center justify-center w-full"><Spinner size={24} /></div>
          : batches.length === 0
            ? <div className="flex items-center justify-center w-full text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak aktywnych partii</div>
            : batches.map((b, i) => (
                <BatchTileV10 key={b.id} batch={b} first={i === 0} selected={selBatch?.id === b.id} onSelect={pickBatch} />
              ))
        }
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-shrink-0 w-[30%] p-3 min-h-0 flex flex-col" style={{ borderRight: '1.5px solid var(--line)' }}>
          {workerData.loading
            ? <div className="flex items-center justify-center h-full"><Spinner size={32} /></div>
            : (
              <div className="flex-1 min-h-0 overflow-y-auto"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gridAutoRows: 'minmax(92px, 1fr)', gap: 8, alignContent: 'start' }}>
                {workers.map(w => {
                  const ws = perWorker.get(w.id)
                  return (
                    <WorkerTileV10 key={w.id} worker={w} selected={selWorker?.id === w.id}
                      entryCount={ws?.count ?? 0} kgToday={ws?.taken ?? 0} onSelect={pickWorker} />
                  )
                })}
                {workers.length === 0 && (
                  <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak pracowników rozbioru</span>
                )}
              </div>
            )
          }
        </div>

        <div className="flex-shrink-0 w-[35%] flex flex-col gap-2.5 p-3 min-h-0" style={{ borderRight: '1.5px solid var(--line)' }}>
          <div>
            <SectionLabel no={1} done={!!selBatch}>Partia{selBatch ? ` — ${selBatch.internalBatchNo}` : ''}</SectionLabel>
            <SectionLabel no={2} done={!!selWorker}>Pracownik{selWorker ? ` — ${selWorker.name}` : ''}</SectionLabel>
            <SectionLabel no={3} done={taken > 0 && meat > 0 && !meatTooBig}>Waga</SectionLabel>
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <ReadoutV10
              label={takenMode === 'poj' ? 'Zabrano · poj.' : 'Zabrano z partii'} unit={takenMode === 'poj' ? 'poj' : 'kg'}
              value={kgTaken} active={active === 'taken'}
              onActivate={() => setActive('taken')}
              sub={takenMode === 'poj' && takenRaw > 0 ? `= ${fmtKg(taken, 0)} kg` : ''}
              extraHeader={
                <span className="flex overflow-hidden" style={{ border: '1.5px solid var(--line)', borderRadius: 3 }}>
                  {(['kg', 'poj'] as const).map(m => (
                    <span key={m} role="button" onClick={e => { e.stopPropagation(); switchTakenMode(m) }}
                      className="px-2 py-0.5 text-[11px] font-bold uppercase cursor-pointer"
                      style={takenMode === m ? { background: 'var(--ink)', color: 'var(--panel)' } : { color: 'var(--mut)' }}>
                      {m}
                    </span>
                  ))}
                </span>
              }
            />
            <ReadoutV10 label="Mięso Z/S" unit="kg" value={kgMeat} active={active === 'meat'} error={meatTooBig}
              onActivate={() => setActive('meat')}
              sub={meatTooBig ? `Mięso nie może przekraczać ${fmtKg(taken, 0)} kg!` : yieldPct > 0 ? `${fmtPct(yieldPct, 1)} wydajność` : ''} />
          </div>

          <NumpadV10 onKey={pressKey} onBackStart={handleBackStart} onBackEnd={handleBackEnd} disabled={!selBatch || !selWorker} />

          <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
            className={cn('flex-shrink-0 h-[64px] w-full text-xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98]', saveFlash && 'scale-[1.01]')}
            style={{
              borderRadius: 5,
              background: canSave ? 'var(--stamp)' : meatTooBig ? 'var(--redSoft)' : 'var(--panel)',
              color: canSave ? '#fff' : meatTooBig ? 'var(--red)' : 'var(--mut)',
              border: `1.5px solid ${canSave ? 'var(--stamp)' : meatTooBig ? 'var(--red)' : 'var(--line)'}`,
            }}>
            {addLoading ? <span className="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : canSave ? <Save size={26} /> : null}
            {saveHint}
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-shrink-0 p-3 flex flex-col gap-3" style={{ borderBottom: '1.5px solid var(--line)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3" style={{ borderRadius: 5, background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>
                  Wydajność · cel {YIELD_BAND_LO}–{YIELD_BAND_HI}%
                </div>
                <div className="hmi-v10-mono font-bold text-3xl leading-none mb-1" style={{ color: yieldInk(shift.yieldPct) }}>
                  {shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—'}
                </div>
                <ArcGauge value={shift.yieldPct} min={40} max={100} bandLo={YIELD_BAND_LO} bandHi={YIELD_BAND_HI} />
              </div>
              <div className="p-3" style={{ borderRadius: 5, background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>
                  Tempo · cel {TEMPO_TARGET} kg/h
                </div>
                <div className="hmi-v10-mono font-bold text-3xl leading-none mb-1">
                  {fmtKg(shift.tempo, 0)}<span className="text-sm font-bold" style={{ color: 'var(--mut)' }}> kg/h</span>
                </div>
                <ArcGauge value={shift.tempo} min={0} max={TEMPO_TARGET * 1.5} bandLo={TEMPO_TARGET * 0.85} bandHi={TEMPO_TARGET * 1.15} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="px-3 py-2 flex items-baseline justify-between" style={{ borderRadius: 5, background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Prognoza dnia</span>
                <span className="hmi-v10-mono text-lg font-bold">{shift.prognoza != null ? `${fmtKg(shift.prognoza, 0)} kg` : '—'}</span>
              </div>
              <div className="px-3 py-2 flex items-baseline justify-between" style={{ borderRadius: 5, background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Aktywni (60 min)</span>
                <span className="hmi-v10-mono text-lg font-bold">{shift.activeWorkers}<span style={{ color: 'var(--mut)' }}> / {perWorker.size}</span></span>
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 p-3" style={{ borderBottom: '1.5px solid var(--line)' }}>
            <div className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>Alarmy</div>
            {alarms.length === 0 ? (
              <div className="px-3 py-2 text-sm font-bold" style={{ borderRadius: 4, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--mut)' }}>
                Brak aktywnych alarmów — stan normalny
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[110px] overflow-y-auto">
                {alarms.map(a => (
                  <div key={a.id} className="px-3 py-2 text-sm font-bold" style={{
                    borderRadius: 4,
                    background: a.level === 'red' ? 'var(--redSoft)' : 'var(--ambSoft)',
                    border: `1.5px solid ${a.level === 'red' ? 'var(--red)' : 'var(--amb)'}`,
                    color: a.level === 'red' ? 'var(--red)' : 'var(--amb)',
                  }}>
                    {a.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 p-3 flex flex-col">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <ListOrdered size={15} style={{ color: 'var(--mut)' }} />
              <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>Ostatnie wpisy</span>
              <span className="hmi-v10-mono ml-auto text-xs font-bold" style={{ color: 'var(--mut)' }}>{entries.length} dziś</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ borderRadius: 5, background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
              {recent.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : recent.map((e: DeboningEntry, i) => (
                <div key={e.id} className={cn('grid grid-cols-[52px_1fr_64px_110px_60px] items-center gap-2 px-3 py-2.5', i > 0 && 'border-t')}
                  style={{ borderColor: 'var(--line)', borderTopStyle: 'dashed' }}>
                  <span className="hmi-v10-mono text-xs" style={{ color: 'var(--mut)' }}>
                    {new Date(e.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-sm font-semibold truncate">{e.workerName}</span>
                  <span className="hmi-v10-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.rawBatchNo}</span>
                  <span className="hmi-v10-mono text-sm text-right">{fmtKg(e.kgTaken, 1)} → {fmtKg(e.kgMeat, 1)}</span>
                  <span className="hmi-v10-mono text-sm font-bold text-right" style={{ color: yieldInk(e.yieldPct) }}>{fmtPct(e.yieldPct, 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 h-[64px] grid grid-cols-8" style={{ background: 'var(--panel)', borderTop: '3px double var(--line)' }}>
        {[
          { label: 'Ćwiartka dziś', val: `${fmtKg(shift.totTaken, 0)} kg` },
          { label: 'Mięso',         val: `${fmtKg(shift.totMeat, 0)} kg` },
          { label: 'Wydajność',     val: shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—', color: yieldInk(shift.yieldPct) },
          { label: 'Grzbiety',      val: `${fmtKg(shift.totBacks, 0)} kg` },
          { label: 'Kości',         val: `${fmtKg(shift.totBones, 0)} kg` },
          { label: 'Wpisy',         val: String(entries.length) },
          { label: 'Tempo',         val: `${fmtKg(shift.tempo, 0)} kg/h` },
        ].map(c => (
          <div key={c.label} className="flex flex-col items-center justify-center" style={{ borderRight: '1.5px solid var(--line)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none" style={{ color: c.color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1" style={{ color: 'var(--mut)' }}>{c.label}</span>
          </div>
        ))}
        <button type="button" onClick={() => setStatsModal(true)}
          className="flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform" style={{ color: 'var(--accent)' }}>
          <BarChart3 size={20} />
          <span className="text-[10px] font-bold uppercase">Statystyki</span>
        </button>
      </div>

      {statsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={VARS}>
          <div className="w-[720px] max-h-[80vh] flex flex-col" style={{ borderRadius: 6, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: '3px double var(--line)' }}>
              <BarChart3 size={24} style={{ color: 'var(--accent)' }} />
              <h3 className="hmi-v10-display font-bold text-2xl flex-1">Statystyki zmiany</h3>
              <button type="button" onClick={() => setStatsModal(false)} className="w-10 h-10 flex items-center justify-center" style={{ borderRadius: 5, border: '1.5px solid var(--line)', color: 'var(--mut)' }}><X size={20} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-4 sticky top-0" style={{ background: 'var(--accentSoft)' }}>
                <div className="px-4 py-3 text-[11px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Pracownik</div>
                {([['taken', 'Ćwiartka'], ['meat', 'Mięso'], ['yield', 'Procent'], ['count', 'Wpisy']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => toggleStatsSort(key)}
                    className="px-4 py-3 text-right text-[11px] font-bold uppercase flex items-center justify-end gap-1"
                    style={{ color: statsSort === key ? 'var(--accent)' : 'var(--mut)' }}>
                    {label}<span className="text-[10px]">{statsSort === key ? (statsDir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                ))}
              </div>
              {workerStats.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : workerStats.map(s => (
                <div key={s.name} className="grid grid-cols-4 px-4 py-4 items-center" style={{ borderTop: '1px dashed var(--line)' }}>
                  <span className="font-semibold text-base">{s.name}</span>
                  <span className="hmi-v10-mono text-right font-bold text-base">{fmtKg(s.taken, 1)} kg</span>
                  <span className="hmi-v10-mono text-right font-bold text-base">{fmtKg(s.meat, 1)} kg</span>
                  <span className="hmi-v10-mono text-right font-bold text-xl" style={{ color: yieldInk(s.yieldPct) }}>{fmtPct(s.yieldPct, 1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {finishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={VARS}>
          <div className="w-[480px] p-8 flex flex-col gap-6" style={{ borderRadius: 6, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: 8, border: '1.5px solid var(--amb)', color: 'var(--amb)' }}><Flag size={28} /></div>
              <div>
                <h3 className="hmi-v10-display font-bold text-2xl">Zakończenie partii</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>{pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {([['Grzbiety (kg)', inputBacks, setInputBacks], ['Kości (kg)', inputBones, setInputBones]] as const).map(([label, val, set]) => (
                <label key={label} className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase" style={{ color: 'var(--mut)' }}>{label}</span>
                  <input type="number" min="0" step="0.01" value={val} onChange={e => set(e.target.value)}
                    className="hmi-v10-mono h-14 px-4 text-xl font-bold bg-transparent outline-none"
                    style={{ borderRadius: 4, border: '1.5px solid var(--line)', color: 'var(--ink)' }} />
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)} className="flex-1 h-14 text-lg font-bold" style={{ borderRadius: 5, border: '1.5px solid var(--line)', color: 'var(--mut)' }}>Anuluj</button>
              <button type="button" onClick={handleFinishBatchConfirm} className="flex-[2] h-14 text-lg font-bold" style={{ borderRadius: 5, background: 'var(--amb)', color: '#fff' }}>Zatwierdź zakończenie</button>
            </div>
          </div>
        </div>
      )}

      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={VARS}>
          <div className="w-[400px] p-8 flex flex-col gap-6" style={{ borderRadius: 6, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: 8, border: '1.5px solid var(--red)', color: 'var(--red)' }}><LogOut size={28} /></div>
              <div>
                <h3 className="hmi-v10-display font-bold text-2xl">Zakończyć zmianę?</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>Sesja zostanie zamknięta.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)} className="flex-1 h-14 text-lg font-bold" style={{ borderRadius: 5, border: '1.5px solid var(--line)', color: 'var(--mut)' }}>Anuluj</button>
              <button type="button" onClick={handleCloseShift} disabled={closeLoading}
                className="flex-[2] h-14 text-lg font-bold flex items-center justify-center gap-3" style={{ borderRadius: 5, background: 'var(--red)', color: '#fff' }}>
                {closeLoading ? <span className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <LogOut size={20} />}
                Zakończ zmianę
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
