/**
 * DeboningHmiV9Page — HMI v9 „Sterownia" (ISA-101 High Performance HMI).
 *
 * Projekt pod komputer panelowy 21" (1920×1080, dotyk, landscape, bez scrolla):
 *   - tło szare, niskonasycone — KOLOR oznacza wyłącznie stan nienormalny
 *     (czerwony = alarm, bursztyn = ostrzeżenie, niebieski = wybór/fokus),
 *   - wartości normalne w atramencie (--ink), bez „choinki",
 *   - analogowe wskaźniki z pasmem celu (wydajność, tempo) — odchylenie
 *     widoczne z 3 metrów zanim operator przeczyta liczbę,
 *   - stała kolumna sterowni: wskaźniki zmiany, lista alarmów, feed wpisów
 *     (na 21" nie chowamy tego w modalach jak na tablecie),
 *   - opcjonalna rejestracja temperatur HACCP (surowiec / sala) przy wpisie.
 *
 * Domyślny motyw: jasny (preferencja operatorów z v5 light).
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  Sun, Moon, Play, Lock, Save, Flag, LogOut, Delete, X,
  BarChart3, Bell, BellOff, Thermometer, Gauge, ListOrdered,
} from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const THEME_KEY = 'rozbior_hmi_v9_theme'
const KG_PER_CONTAINER = 15

// ── Cele zmiany (do strojenia pod linię) ───────────────────────────
const YIELD_BAND_LO = 65   // % — dolna granica pasma normalnego
const YIELD_BAND_HI = 80   // % — górna granica pasma normalnego
const TEMPO_TARGET  = 800  // kg/h ćwiartki — cel linii
const TEMP_WARN     = 4    // °C — surowiec powyżej = ostrzeżenie
const TEMP_ALARM    = 7    // °C — surowiec powyżej = alarm

type Theme = 'light' | 'dark'
type ActiveField = 'taken' | 'meat' | 'tempIn' | 'tempRoom'

// ISA-101: szarości o niskim nasyceniu; kolory zarezerwowane dla odchyleń.
const VARS: Record<Theme, CSSProperties> = {
  light: {
    ['--app' as string]:        '#DDE1E4',
    ['--panel' as string]:      '#F5F7F8',
    ['--panel2' as string]:     '#E9EDEF',
    ['--bd' as string]:         '#C2CAD0',
    ['--ink' as string]:        '#16212A',
    ['--mut' as string]:        '#5B6770',
    ['--accent' as string]:     '#145A9E',
    ['--accentSoft' as string]: '#DCE9F5',
    ['--grn' as string]:        '#1A7F4B',
    ['--amb' as string]:        '#B96E00',
    ['--ambSoft' as string]:    '#F7ECDA',
    ['--red' as string]:        '#C42B2B',
    ['--redSoft' as string]:    '#F8E3E3',
  },
  dark: {
    ['--app' as string]:        '#11161B',
    ['--panel' as string]:      '#1A2128',
    ['--panel2' as string]:     '#232C34',
    ['--bd' as string]:         '#2E3942',
    ['--ink' as string]:        '#E8EDF1',
    ['--mut' as string]:        '#7C8A95',
    ['--accent' as string]:     '#4A9EE8',
    ['--accentSoft' as string]: '#16293B',
    ['--grn' as string]:        '#34B36F',
    ['--amb' as string]:        '#E8A33D',
    ['--ambSoft' as string]:    '#33270F',
    ['--red' as string]:        '#E25656',
    ['--redSoft' as string]:    '#3A1818',
  },
}

// Kolor wydajności wg dyscypliny ISA: norma = atrament, tylko odchylenie świeci.
function yieldInk(pct: number): string {
  if (pct <= 0) return 'var(--mut)'
  if (pct < 60) return 'var(--red)'
  if (pct < YIELD_BAND_LO) return 'var(--amb)'
  return 'var(--ink)'
}

// ─── Zegar (izolowany — nie re-renderuje reszty) ───────────────────
const TopClock = memo(function TopClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

// ─── Analogowy wskaźnik z pasmem celu (ISA-101) ────────────────────
const TargetBand = memo(function TargetBand({ value, min, max, bandLo, bandHi }: {
  value: number; min: number; max: number; bandLo: number; bandHi: number
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const pct = (v: number) => ((clamp(v) - min) / (max - min)) * 100
  const inBand = value >= bandLo && value <= bandHi
  const pointerColor = value <= 0 ? 'var(--mut)' : inBand ? 'var(--ink)' : value < bandLo ? 'var(--amb)' : 'var(--ink)'
  return (
    <div className="relative h-3 rounded-full" style={{ background: 'var(--panel2)', border: '1px solid var(--bd)' }}>
      <div className="absolute top-0 bottom-0 rounded-full"
        style={{ left: `${pct(bandLo)}%`, width: `${pct(bandHi) - pct(bandLo)}%`, background: 'var(--bd)' }} />
      <div className="absolute -top-1 w-[3px] h-5 rounded-full transition-[left] duration-300"
        style={{ left: `calc(${pct(value)}% - 1px)`, background: pointerColor }} />
    </div>
  )
})

// ─── Kafel partii (FEFO) ───────────────────────────────────────────
const BatchTileV9 = memo(function BatchTileV9({ batch, selected, onSelect }: {
  batch: RawBatch; selected: boolean; onSelect: (b: RawBatch) => void
}) {
  const { daysLeft } = getExpiryStatus(batch.expiryDate)
  const kg = Number(batch.kgAvailable)
  const expired = daysLeft < 0
  const daysColor = expired || daysLeft === 0 ? 'var(--red)' : daysLeft <= 3 ? 'var(--amb)' : 'var(--mut)'
  return (
    <button
      type="button"
      onClick={() => onSelect(batch)}
      disabled={expired}
      className={cn(
        'flex flex-col justify-between px-3 py-2 rounded-lg text-left select-none active:translate-y-px transition-colors h-full',
        expired && 'opacity-50'
      )}
      style={{
        background: selected ? 'var(--accentSoft)' : 'var(--panel)',
        border: `3px solid ${selected ? 'var(--accent)' : 'var(--bd)'}`,
      }}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xl font-black leading-none" style={{ color: selected ? 'var(--accent)' : 'var(--ink)' }}>
          {batch.internalBatchNo}
        </span>
        <span className="text-xs font-black tabular-nums" style={{ color: daysColor }}>
          {expired ? 'PRZETERM.' : daysLeft === 0 ? 'DZIŚ!' : `${daysLeft}d`}
        </span>
      </div>
      <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--mut)' }}>
        {batch.supplierDisplayName ?? batch.supplierName ?? '—'}
      </span>
      <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
        {fmtKg(kg, 0)} kg <span style={{ color: 'var(--mut)' }}>· {Math.floor(kg / KG_PER_CONTAINER)} poj.</span>
      </span>
    </button>
  )
})

// ─── Kafel pracownika ──────────────────────────────────────────────
const WorkerTileV9 = memo(function WorkerTileV9({ worker, selected, entryCount, kgToday, onSelect }: {
  worker: User; selected: boolean; entryCount: number; kgToday: number; onSelect: (w: User) => void
}) {
  const initials = worker.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button
      type="button"
      onClick={() => onSelect(worker)}
      className="relative flex flex-col items-center justify-center gap-1 rounded-lg select-none active:scale-[0.98] transition-all px-2"
      style={{
        background: selected ? 'var(--accentSoft)' : 'var(--panel)',
        border: `3px solid ${selected ? 'var(--accent)' : 'var(--bd)'}`,
      }}>
      <span className="text-4xl font-black leading-none" style={{ color: selected ? 'var(--accent)' : 'var(--ink)' }}>
        {initials}
      </span>
      <span className="text-sm font-bold leading-tight text-center truncate w-full" style={{ color: 'var(--ink)' }}>
        {worker.name}
      </span>
      {entryCount > 0 && (
        <span className="font-mono text-xs font-bold tabular-nums" style={{ color: 'var(--mut)' }}>
          {fmtKg(kgToday, 0)} kg · {entryCount}×
        </span>
      )}
    </button>
  )
})

// ─── Pole odczytu (readout) ────────────────────────────────────────
function ReadoutV9({ label, value, unit, active, size = 52, valueColor, extra, onActivate }: {
  label: string; value: string; unit: string; active: boolean
  size?: number; valueColor?: string; extra?: React.ReactNode
  onActivate: () => void
}) {
  return (
    <button type="button" onClick={onActivate}
      className="flex-1 rounded-lg p-3 text-left transition-colors min-w-0"
      style={{ background: 'var(--panel)', border: `3px solid ${active ? 'var(--accent)' : 'var(--bd)'}` }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-black uppercase tracking-[.16em]"
          style={{ color: active ? 'var(--accent)' : 'var(--mut)' }}>
          {label}
        </span>
        {extra}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-black tabular-nums leading-none"
          style={{ fontSize: size, color: valueColor ?? (value ? 'var(--ink)' : 'var(--mut)') }}>
          {value || '0'}
        </span>
        <span className="text-lg font-bold" style={{ color: 'var(--mut)' }}>{unit}</span>
        {active && <span className="ml-auto w-2 h-7 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />}
      </div>
    </button>
  )
}

// ─── Numpad ────────────────────────────────────────────────────────
const NumpadV9 = memo(function NumpadV9({ onKey, onBackspaceStart, onBackspaceEnd, disabled }: {
  onKey: (k: string) => void
  onBackspaceStart: () => void
  onBackspaceEnd: () => void
  disabled: boolean
}) {
  const rows = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']]
  const keyCls = 'flex-1 rounded-lg font-mono text-4xl font-black flex items-center justify-center select-none active:scale-[0.96] transition-transform'
  const keyStyle: CSSProperties = { background: 'var(--panel)', border: '3px solid var(--bd)', color: 'var(--ink)' }
  return (
    <div className={cn('flex flex-col gap-2 flex-1 min-h-0', disabled && 'opacity-40 pointer-events-none')}>
      {rows.map(row => (
        <div key={row[0]} className="flex gap-2 flex-1">
          {row.map(k => (
            <button key={k} type="button" onClick={() => onKey(k)} className={keyCls} style={keyStyle}>{k}</button>
          ))}
        </div>
      ))}
      <div className="flex gap-2 flex-1">
        <button type="button" onClick={() => onKey('0')} className={cn(keyCls, 'flex-[2]')} style={keyStyle}>0</button>
        <button type="button" onClick={() => onKey('.')} className={keyCls} style={{ ...keyStyle, color: 'var(--mut)' }}>.</button>
        <button type="button"
          onClick={() => onKey('⌫')}
          onPointerDown={onBackspaceStart}
          onPointerUp={onBackspaceEnd}
          onPointerLeave={onBackspaceEnd}
          className={keyCls} style={{ ...keyStyle, color: 'var(--amb)' }}>
          <Delete size={32} />
        </button>
      </div>
    </div>
  )
})

// ─── Model alarmu ──────────────────────────────────────────────────
interface HmiAlarm { id: string; level: 'red' | 'amb'; text: string }

export function DeboningHmiV9Page() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const n = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(THEME_KEY, n) } catch { /**/ }
      return n
    })
  }, [])

  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())
  const { session, timeWindow, loading: sessionLoading, startDay, startLoading, closeDay, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [tempIn,    setTempIn]    = useState('')
  const [tempRoom,  setTempRoom]  = useState('')
  const [active,    setActive]    = useState<ActiveField>('taken')
  const [takenMode, setTakenMode] = useState<'kg' | 'poj'>('kg')
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal, setFinishModal] = useState(false)
  const [shiftModal,  setShiftModal]  = useState(false)
  const [statsModal,  setStatsModal]  = useState(false)
  const [statsSort,   setStatsSort]   = useState<'taken' | 'meat' | 'yield'>('taken')
  const [statsDir,    setStatsDir]    = useState<'asc' | 'desc'>('desc')
  const [inputBacks,  setInputBacks]  = useState('')
  const [inputBones,  setInputBones]  = useState('')
  const [toastMsg,    setToastMsg]    = useState('')
  const [toastType,   setToastType]   = useState<'ok' | 'err'>('ok')
  const [toastVis,    setToastVis]    = useState(false)
  const toastRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg(msg); setToastType(type); setToastVis(true)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastVis(false), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastRef.current) clearTimeout(toastRef.current)
      if (longPressRef.current) clearTimeout(longPressRef.current)
      if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    }
  }, [])

  // ── Partie — FEFO, max 6 na szynie ──────────────────────────────
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

  // ── Agregaty zmiany ──────────────────────────────────────────────
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

  // ── Alarmy (ISA: czerwony = działanie wymagane, bursztyn = uwaga) ─
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
    for (const e of entries.slice(-5)) {
      if (e.tempInput != null && e.tempInput > TEMP_ALARM)
        out.push({ id: `temp-${e.id}`, level: 'red', text: `Temp. surowca ${e.tempInput}°C > ${TEMP_ALARM}°C (${e.workerName})` })
      else if (e.tempInput != null && e.tempInput > TEMP_WARN)
        out.push({ id: `temp-${e.id}`, level: 'amb', text: `Temp. surowca ${e.tempInput}°C > ${TEMP_WARN}°C (${e.workerName})` })
    }
    if (timeWindow.minutesToClose != null && timeWindow.minutesToClose > 0 && timeWindow.minutesToClose <= 30)
      out.push({ id: 'window', level: 'amb', text: `Okno zapisu zamyka się za ${timeWindow.minutesToClose} min` })
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))
  }, [allActiveBatches, entries, timeWindow.minutesToClose])

  const workerStats = useMemo(() => {
    const rows = Array.from(perWorker.values())
      .map(s => ({ ...s, yieldPct: s.taken > 0 ? (s.meat / s.taken) * 100 : 0 }))
    const key = statsSort === 'taken' ? 'taken' : statsSort === 'meat' ? 'meat' : 'yieldPct'
    return rows.sort((a, b) => statsDir === 'asc' ? a[key] - b[key] : b[key] - a[key])
  }, [perWorker, statsSort, statsDir])

  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)

  // ── Wartości wpisu ───────────────────────────────────────────────
  const takenRaw = parseFloat(kgTaken) || 0
  const taken = takenMode === 'poj' ? takenRaw * KG_PER_CONTAINER : takenRaw
  const meat  = parseFloat(kgMeat) || 0
  const tIn   = parseFloat(tempIn)
  const tRoom = parseFloat(tempRoom)
  const entryYield = taken > 0 && meat > 0 && meat <= taken ? (meat / taken) * 100 : 0
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && meat <= taken
  const tempInColor = !tempIn ? undefined : tIn > TEMP_ALARM ? 'var(--red)' : tIn > TEMP_WARN ? 'var(--amb)' : 'var(--ink)'

  const pressKey = useCallback((k: string) => {
    const isTemp = active === 'tempIn' || active === 'tempRoom'
    const apply = (prev: string): string => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev === '' ? '0.' : prev + '.')
      const next = prev + k
      if (next.replace('.', '').length > (isTemp ? 3 : 6)) return prev
      const dot = next.indexOf('.')
      if (dot >= 0 && next.length - dot - 1 > (isTemp ? 1 : 2)) return prev
      return next
    }
    if (active === 'taken') setKgTaken(apply)
    else if (active === 'meat') setKgMeat(apply)
    else if (active === 'tempIn') setTempIn(apply)
    else setTempRoom(apply)
  }, [active])

  const clearActiveField = useCallback(() => {
    if (active === 'taken') setKgTaken('')
    else if (active === 'meat') setKgMeat('')
    else if (active === 'tempIn') setTempIn('')
    else setTempRoom('')
  }, [active])

  const handleStartBackspaceHold = useCallback(() => {
    longPressRef.current = setTimeout(clearActiveField, 600)
  }, [clearActiveField])
  const handleEndBackspaceHold = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }, [])

  const switchTakenMode = useCallback((mode: 'kg' | 'poj') => {
    setTakenMode(mode); setKgTaken(''); setActive('taken')
  }, [])
  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [])
  const pickWorker = useCallback((w: User) => {
    setSelWorker(w); setActive('taken')
  }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'err'); else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (addLoading) return
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      {
        sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id,
        kgTaken: taken, kgMeat: meat,
        ...(Number.isFinite(tIn)   ? { tempInput: tIn }  : {}),
        ...(Number.isFinite(tRoom) ? { tempRoom: tRoom } : {}),
      },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 300)
    setKgTaken(''); setKgMeat(''); setTempIn(''); setActive('taken')
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
    <div className="h-full w-full overflow-hidden flex flex-col bg-[var(--app)] text-[var(--ink)]" style={VARS[theme]}>
      {children}
    </div>
  )

  if (sessionLoading) return wrap(
    <div className="flex items-center justify-center flex-1"><Spinner size={48} /></div>
  )

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-8 relative">
      <div className="w-28 h-28 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--panel)', border: '3px solid var(--grn)', color: 'var(--grn)' }}>
        <Play size={56} />
      </div>
      <div className="text-center">
        <h2 className="text-4xl font-black mb-2">Rozpocznij dzień</h2>
        <p className="text-xl" style={{ color: 'var(--mut)' }}>Data produkcyjna: {timeWindow.productionDate}</p>
      </div>
      <button type="button" onClick={handleStartDay} disabled={startLoading}
        className="h-20 px-16 rounded-xl text-2xl font-black flex items-center gap-4"
        style={{ background: 'var(--grn)', color: '#fff' }}>
        {startLoading
          ? <span className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          : <Play size={32} />}
        Rozpocznij dzień
      </button>
      <button type="button" onClick={toggleTheme} aria-label="Motyw"
        className="absolute top-4 right-4 w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ border: '3px solid var(--bd)', color: 'var(--mut)' }}>
        {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="w-28 h-28 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--panel)', border: '3px solid var(--amb)', color: 'var(--amb)' }}>
        <Lock size={56} />
      </div>
      <h2 className="text-4xl font-black">
        {session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}
      </h2>
      <p className="text-xl max-w-lg text-center" style={{ color: 'var(--mut)' }}>
        {session.status === 'approved'
          ? `Dane z dnia ${session.sessionDate} są zablokowane.`
          : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'}
      </p>
    </div>
  )

  const redCount = alarms.filter(a => a.level === 'red').length
  const recent = entries.slice(-8).reverse()

  return wrap(
    <>
      {/* ─── TOAST ─── */}
      <div className={cn(
        'fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-xl text-base font-bold flex items-center gap-3 transition-opacity duration-150',
        toastVis ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )} style={{
        background: 'var(--panel)',
        border: `3px solid ${toastType === 'ok' ? 'var(--grn)' : 'var(--red)'}`,
        color: toastType === 'ok' ? 'var(--grn)' : 'var(--red)',
      }}>
        {toastMsg}
      </div>

      {/* ─── NAGŁÓWEK (64px) ─── */}
      <header className="flex-shrink-0 h-[64px] flex items-center gap-5 px-5 border-b-[3px]"
        style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
        <div className="flex-shrink-0">
          <div className="font-black text-2xl tracking-tight leading-none">ROZBIÓR</div>
          <div className="text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: 'var(--mut)' }}>
            {session.sessionDate} · HMI v9
          </div>
        </div>
        {([
          { label: 'Magazyn',  val: `${fmtKg(totalKgMagazyn, 0)} kg`, color: 'var(--ink)' },
          { label: 'Partie',   val: String(allActiveBatches.length),  color: 'var(--ink)' },
          { label: 'Operator', val: selWorker?.name.split(' ')[0] ?? '—', color: selWorker ? 'var(--accent)' : 'var(--mut)' },
        ] as const).map(c => (
          <div key={c.label} className="flex flex-col justify-center pl-5 border-l-[3px] flex-shrink-0" style={{ borderColor: 'var(--bd)' }}>
            <span className="text-[10px] font-black uppercase tracking-[.16em] leading-none mb-1" style={{ color: 'var(--mut)' }}>{c.label}</span>
            <span className="text-base font-black leading-none truncate max-w-[140px]" style={{ color: c.color }}>{c.val}</span>
          </div>
        ))}
        <div className="flex-1" />
        {/* Skrót alarmowy — pełna lista w kolumnie sterowni */}
        <span className="flex items-center gap-2 px-3 h-11 rounded-lg text-sm font-black flex-shrink-0"
          style={alarms.length === 0
            ? { color: 'var(--mut)', border: '3px solid var(--bd)' }
            : { color: redCount > 0 ? 'var(--red)' : 'var(--amb)', background: redCount > 0 ? 'var(--redSoft)' : 'var(--ambSoft)', border: `3px solid ${redCount > 0 ? 'var(--red)' : 'var(--amb)'}` }}>
          {alarms.length === 0 ? <BellOff size={18} /> : <Bell size={18} />}
          {alarms.length === 0 ? 'BRAK ALARMÓW' : `ALARMY: ${alarms.length}`}
        </span>
        <TopClock />
        <button type="button" onClick={toggleTheme} aria-label="Motyw"
          className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ border: '3px solid var(--bd)', color: 'var(--mut)' }}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button type="button" onClick={() => setShiftModal(true)}
          className="h-11 px-4 rounded-lg text-sm font-bold flex items-center gap-2 flex-shrink-0"
          style={{ border: '3px solid var(--bd)', color: 'var(--mut)' }}>
          <LogOut size={16} /> Zakończ zmianę
        </button>
        <button type="button" onClick={() => setFinishModal(true)}
          className="h-11 px-4 rounded-lg text-sm font-bold flex items-center gap-2 flex-shrink-0"
          style={{ border: '3px solid var(--amb)', color: 'var(--amb)' }}>
          <Flag size={16} /> Zakończ partię
        </button>
      </header>

      {/* ─── SZYNA PARTII (96px) ─── */}
      <div className="flex-shrink-0 h-[96px] px-3 py-2 grid gap-2 border-b-[3px]"
        style={{ gridTemplateColumns: `repeat(${Math.max(batches.length, 1)}, 1fr)`, borderColor: 'var(--bd)' }}>
        {batchData.loading
          ? <div className="flex items-center justify-center"><Spinner size={24} /></div>
          : batches.length === 0
            ? <div className="flex items-center justify-center text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak aktywnych partii</div>
            : batches.map(b => (
                <BatchTileV9 key={b.id} batch={b} selected={selBatch?.id === b.id} onSelect={pickBatch} />
              ))
        }
      </div>

      {/* ─── OBSZAR GŁÓWNY ─── */}
      <div className="flex-1 flex min-h-0">

        {/* LEWA: operatorzy (30%) */}
        <div className="flex-shrink-0 w-[30%] p-3 border-r-[3px]" style={{ borderColor: 'var(--bd)' }}>
          {workerData.loading
            ? <div className="flex items-center justify-center h-full"><Spinner size={32} /></div>
            : (
              <div className="grid grid-cols-3 grid-rows-6 gap-2 h-full">
                {Array.from({ length: 18 }, (_, i) => {
                  const w = workers[i]
                  if (!w) return <div key={`empty-${i}`} />
                  const ws = perWorker.get(w.id)
                  return (
                    <WorkerTileV9
                      key={w.id}
                      worker={w}
                      selected={selWorker?.id === w.id}
                      entryCount={ws?.count ?? 0}
                      kgToday={ws?.taken ?? 0}
                      onSelect={pickWorker}
                    />
                  )
                })}
              </div>
            )
          }
        </div>

        {/* ŚRODEK: panel wpisu (37%) */}
        <div className="flex-shrink-0 w-[37%] flex flex-col gap-2.5 p-3 min-h-0 border-r-[3px]" style={{ borderColor: 'var(--bd)' }}>
          <div className="flex gap-2 flex-shrink-0">
            <ReadoutV9
              label="Ćwiartka kg" unit="kg"
              value={takenMode === 'kg' ? kgTaken : fmtKg(takenRaw * KG_PER_CONTAINER, 0)}
              active={active === 'taken' && takenMode === 'kg'}
              onActivate={() => switchTakenMode('kg')}
            />
            <ReadoutV9
              label="Pojemniki" unit="poj."
              value={takenMode === 'poj' ? kgTaken : String(Math.floor(takenRaw / KG_PER_CONTAINER))}
              active={active === 'taken' && takenMode === 'poj'}
              onActivate={() => switchTakenMode('poj')}
            />
          </div>

          <ReadoutV9
            label="Mięso Z/S" unit="kg"
            value={kgMeat}
            active={active === 'meat'}
            onActivate={() => setActive('meat')}
            extra={
              entryYield > 0 ? (
                <span className="text-sm font-black tabular-nums" style={{ color: yieldInk(entryYield) }}>
                  {fmtPct(entryYield, 1)} wydajność
                </span>
              ) : undefined
            }
          />

          {/* Temperatury HACCP — opcjonalne, nie blokują zapisu */}
          <div className="flex gap-2 flex-shrink-0">
            <ReadoutV9
              label="Temp. surowca" unit="°C" size={30}
              value={tempIn} valueColor={tempInColor}
              active={active === 'tempIn'}
              onActivate={() => setActive('tempIn')}
              extra={<Thermometer size={16} style={{ color: 'var(--mut)' }} />}
            />
            <ReadoutV9
              label="Temp. sali" unit="°C" size={30}
              value={tempRoom}
              active={active === 'tempRoom'}
              onActivate={() => setActive('tempRoom')}
              extra={<Thermometer size={16} style={{ color: 'var(--mut)' }} />}
            />
          </div>

          <NumpadV9
            onKey={pressKey}
            onBackspaceStart={handleStartBackspaceHold}
            onBackspaceEnd={handleEndBackspaceHold}
            disabled={!selBatch || !selWorker}
          />

          <button type="button" onClick={handleSave}
            disabled={!canSave || addLoading}
            className={cn(
              'flex-shrink-0 h-[88px] w-full rounded-lg text-2xl font-black flex items-center justify-center gap-4 transition-all active:scale-[0.98]',
              saveFlash && 'scale-[1.01]'
            )}
            style={{
              background: canSave ? 'var(--grn)' : 'var(--panel)',
              color: canSave ? '#fff' : 'var(--mut)',
              border: `3px solid ${canSave ? 'var(--grn)' : 'var(--bd)'}`,
              opacity: !canSave ? 0.5 : 1,
            }}>
            {addLoading
              ? <span className="w-9 h-9 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              : <Save size={34} />}
            ZAPISZ WPIS
          </button>
        </div>

        {/* PRAWA: sterownia (33%) */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Wskaźniki zmiany */}
          <div className="flex-shrink-0 p-3 flex flex-col gap-3 border-b-[3px]" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center gap-2">
              <Gauge size={16} style={{ color: 'var(--mut)' }} />
              <span className="text-[11px] font-black uppercase tracking-[.18em]" style={{ color: 'var(--mut)' }}>Zmiana — wskaźniki</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Wydajność z pasmem celu */}
              <div className="rounded-lg p-3" style={{ background: 'var(--panel)', border: '3px solid var(--bd)' }}>
                <div className="text-[10px] font-black uppercase tracking-[.16em] mb-1" style={{ color: 'var(--mut)' }}>
                  Wydajność · cel {YIELD_BAND_LO}–{YIELD_BAND_HI}%
                </div>
                <div className="font-mono text-4xl font-black tabular-nums leading-none mb-2"
                  style={{ color: yieldInk(shift.yieldPct) }}>
                  {shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—'}
                </div>
                <TargetBand value={shift.yieldPct} min={40} max={100} bandLo={YIELD_BAND_LO} bandHi={YIELD_BAND_HI} />
              </div>
              {/* Tempo z pasmem celu */}
              <div className="rounded-lg p-3" style={{ background: 'var(--panel)', border: '3px solid var(--bd)' }}>
                <div className="text-[10px] font-black uppercase tracking-[.16em] mb-1" style={{ color: 'var(--mut)' }}>
                  Tempo · cel {TEMPO_TARGET} kg/h
                </div>
                <div className="font-mono text-4xl font-black tabular-nums leading-none mb-2">
                  {fmtKg(shift.tempo, 0)}<span className="text-base font-bold" style={{ color: 'var(--mut)' }}> kg/h</span>
                </div>
                <TargetBand value={shift.tempo} min={0} max={TEMPO_TARGET * 1.5} bandLo={TEMPO_TARGET * 0.85} bandHi={TEMPO_TARGET * 1.15} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg px-3 py-2 flex items-baseline justify-between" style={{ background: 'var(--panel)', border: '3px solid var(--bd)' }}>
                <span className="text-[10px] font-black uppercase tracking-[.14em]" style={{ color: 'var(--mut)' }}>Prognoza dnia</span>
                <span className="font-mono text-xl font-black tabular-nums">
                  {shift.prognoza != null ? `${fmtKg(shift.prognoza, 0)} kg` : '—'}
                </span>
              </div>
              <div className="rounded-lg px-3 py-2 flex items-baseline justify-between" style={{ background: 'var(--panel)', border: '3px solid var(--bd)' }}>
                <span className="text-[10px] font-black uppercase tracking-[.14em]" style={{ color: 'var(--mut)' }}>Aktywni (60 min)</span>
                <span className="font-mono text-xl font-black tabular-nums">
                  {shift.activeWorkers}<span style={{ color: 'var(--mut)' }}> / {perWorker.size}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Lista alarmów */}
          <div className="flex-shrink-0 p-3 border-b-[3px]" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Bell size={16} style={{ color: alarms.length > 0 ? (redCount > 0 ? 'var(--red)' : 'var(--amb)') : 'var(--mut)' }} />
              <span className="text-[11px] font-black uppercase tracking-[.18em]" style={{ color: 'var(--mut)' }}>Alarmy aktywne</span>
            </div>
            {alarms.length === 0 ? (
              <div className="rounded-lg px-3 py-2.5 text-sm font-bold" style={{ background: 'var(--panel)', border: '3px solid var(--bd)', color: 'var(--mut)' }}>
                Brak aktywnych alarmów — stan normalny
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[132px] overflow-y-auto">
                {alarms.map(a => (
                  <div key={a.id} className="rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2"
                    style={{
                      background: a.level === 'red' ? 'var(--redSoft)' : 'var(--ambSoft)',
                      border: `3px solid ${a.level === 'red' ? 'var(--red)' : 'var(--amb)'}`,
                      color: a.level === 'red' ? 'var(--red)' : 'var(--amb)',
                    }}>
                    {a.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ostatnie wpisy — feed na żywo */}
          <div className="flex-1 min-h-0 p-3 flex flex-col">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <ListOrdered size={16} style={{ color: 'var(--mut)' }} />
              <span className="text-[11px] font-black uppercase tracking-[.18em]" style={{ color: 'var(--mut)' }}>Ostatnie wpisy</span>
              <span className="ml-auto text-xs font-bold tabular-nums" style={{ color: 'var(--mut)' }}>{entries.length} dziś</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg" style={{ background: 'var(--panel)', border: '3px solid var(--bd)' }}>
              {recent.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : recent.map((e: DeboningEntry, i) => (
                <div key={e.id} className={cn('grid grid-cols-[52px_1fr_64px_110px_60px] items-center gap-2 px-3 py-2.5', i > 0 && 'border-t-2')}
                  style={{ borderColor: 'var(--panel2)' }}>
                  <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--mut)' }}>
                    {new Date(e.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-sm font-bold truncate">{e.workerName}</span>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.rawBatchNo}</span>
                  <span className="font-mono text-sm tabular-nums text-right">
                    {fmtKg(e.kgTaken, 1)} → {fmtKg(e.kgMeat, 1)}
                  </span>
                  <span className="font-mono text-sm font-black tabular-nums text-right" style={{ color: yieldInk(e.yieldPct) }}>
                    {fmtPct(e.yieldPct, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── PASEK KPI (72px) ─── */}
      <div className="flex-shrink-0 h-[72px] grid grid-cols-8 border-t-[3px]" style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
        {[
          { label: 'Ćwiartka dziś', val: `${fmtKg(shift.totTaken, 0)} kg` },
          { label: 'Mięso',         val: `${fmtKg(shift.totMeat, 0)} kg` },
          { label: 'Wydajność',     val: shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—', color: yieldInk(shift.yieldPct) },
          { label: 'Grzbiety',      val: `${fmtKg(shift.totBacks, 0)} kg` },
          { label: 'Kości',         val: `${fmtKg(shift.totBones, 0)} kg` },
          { label: 'Wpisy',         val: String(entries.length) },
          { label: 'Tempo',         val: `${fmtKg(shift.tempo, 0)} kg/h` },
        ].map(c => (
          <div key={c.label} className="flex flex-col items-center justify-center border-r-[3px]" style={{ borderColor: 'var(--bd)' }}>
            <span className="font-mono text-2xl font-black tabular-nums leading-none" style={{ color: c.color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase tracking-[.14em] mt-1" style={{ color: 'var(--mut)' }}>{c.label}</span>
          </div>
        ))}
        <button type="button" onClick={() => setStatsModal(true)}
          className="flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform"
          style={{ color: 'var(--accent)' }}>
          <BarChart3 size={22} />
          <span className="text-[10px] font-black uppercase tracking-[.14em]">Statystyki</span>
        </button>
      </div>

      {/* ─── MODAL: Statystyki pracowników ─── */}
      {statsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" style={VARS[theme]}>
          <div className="w-[720px] max-h-[80vh] rounded-2xl flex flex-col"
            style={{ background: 'var(--panel)', border: '3px solid var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4 px-6 py-4 border-b-[3px] flex-shrink-0" style={{ borderColor: 'var(--bd)' }}>
              <BarChart3 size={26} style={{ color: 'var(--accent)' }} />
              <h3 className="text-2xl font-black flex-1">Statystyki zmiany</h3>
              <button type="button" onClick={() => setStatsModal(false)}
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ border: '3px solid var(--bd)', color: 'var(--mut)' }}>
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-4 sticky top-0" style={{ background: 'var(--panel2)' }}>
                <div className="px-4 py-3 text-[11px] font-black uppercase tracking-[.14em]" style={{ color: 'var(--mut)' }}>
                  Pracownik
                </div>
                {([['taken', 'Ćwiartka'], ['meat', 'Mięso'], ['yield', 'Procent']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => {
                    if (statsSort === key) setStatsDir(d => d === 'asc' ? 'desc' : 'asc')
                    else { setStatsSort(key); setStatsDir('desc') }
                  }}
                    className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[.14em] flex items-center justify-end gap-1 transition-colors"
                    style={{ color: statsSort === key ? 'var(--accent)' : 'var(--mut)' }}>
                    {label}
                    <span className="text-[10px]">{statsSort === key ? (statsDir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                ))}
              </div>
              {workerStats.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : workerStats.map(s => (
                <div key={s.name} className="grid grid-cols-4 px-4 py-4 border-t-2 items-center" style={{ borderColor: 'var(--panel2)' }}>
                  <span className="font-semibold text-base">{s.name}</span>
                  <span className="text-right font-mono font-bold tabular-nums text-base"
                    style={{ color: statsSort === 'taken' ? 'var(--ink)' : 'var(--mut)' }}>
                    {fmtKg(s.taken, 1)} kg
                  </span>
                  <span className="text-right font-mono font-bold tabular-nums text-base"
                    style={{ color: statsSort === 'meat' ? 'var(--ink)' : 'var(--mut)' }}>
                    {fmtKg(s.meat, 1)} kg
                  </span>
                  <span className="text-right font-mono font-black tabular-nums text-xl" style={{ color: yieldInk(s.yieldPct) }}>
                    {fmtPct(s.yieldPct, 1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Zakończenie partii ─── */}
      {finishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" style={VARS[theme]}>
          <div className="w-[480px] rounded-2xl p-8 flex flex-col gap-6"
            style={{ background: 'var(--panel)', border: '3px solid var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ border: '3px solid var(--amb)', color: 'var(--amb)' }}><Flag size={30} /></div>
              <div>
                <h3 className="text-2xl font-black">Zakończenie partii</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>
                  {pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--mut)' }}>Grzbiety (kg)</span>
                <input type="number" min="0" step="0.01" value={inputBacks}
                  onChange={e => setInputBacks(e.target.value)}
                  className="h-14 rounded-xl px-4 text-2xl font-mono font-bold bg-transparent outline-none"
                  style={{ border: '3px solid var(--bd)', color: 'var(--ink)' }} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--mut)' }}>Kości (kg)</span>
                <input type="number" min="0" step="0.01" value={inputBones}
                  onChange={e => setInputBones(e.target.value)}
                  className="h-14 rounded-xl px-4 text-2xl font-mono font-bold bg-transparent outline-none"
                  style={{ border: '3px solid var(--bd)', color: 'var(--ink)' }} />
              </label>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)}
                className="flex-1 h-14 rounded-xl text-lg font-bold"
                style={{ border: '3px solid var(--bd)', color: 'var(--mut)' }}>
                Anuluj
              </button>
              <button type="button" onClick={handleFinishBatchConfirm}
                className="flex-[2] h-14 rounded-xl text-lg font-bold"
                style={{ background: 'var(--amb)', color: '#fff' }}>
                Zatwierdź zakończenie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Zakończenie zmiany ─── */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" style={VARS[theme]}>
          <div className="w-[400px] rounded-2xl p-8 flex flex-col gap-6"
            style={{ background: 'var(--panel)', border: '3px solid var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ border: '3px solid var(--red)', color: 'var(--red)' }}><LogOut size={30} /></div>
              <div>
                <h3 className="text-2xl font-black">Zakończyć zmianę?</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>Sesja zostanie zamknięta.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)}
                className="flex-1 h-14 rounded-xl text-lg font-bold"
                style={{ border: '3px solid var(--bd)', color: 'var(--mut)' }}>
                Anuluj
              </button>
              <button type="button" onClick={handleCloseShift} disabled={closeLoading}
                className="flex-[2] h-14 rounded-xl text-lg font-bold flex items-center justify-center gap-3"
                style={{ background: 'var(--red)', color: '#fff' }}>
                {closeLoading
                  ? <span className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                  : <LogOut size={22} />}
                Zakończ zmianę
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
