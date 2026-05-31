/**
 * DeboningHmiV4Page — HMI v4 „SCADA Industrial" dla dużego zakładu mięsnego.
 *
 * Język wizualny inspirowany Siemens WinCC Unified / Ignition Perspective:
 * płaskie panele, tag-readouty (monospace), paski statusu, semaforowe stany
 * (zielony/amber/czerwony), niebieski = nawigacja. Bez gradientów, glassu i
 * zbędnych cieni. Warianty LIGHT i DARK (przełącznik w pasku górnym).
 *
 * Logika i dane = istniejący rozbiór (useProductionSession / useDeboningEntries) —
 * to wyłącznie nowa, niezależna warstwa prezentacji. Pozostałe warianty (klasyk,
 * v2, v3) nietknięte.
 *
 * Anti-refresh: stan selekcji/wagi lokalny (brak remountów), kafle i paski KPI
 * jako memo ze stabilnymi kluczami, zegar i KPI mają własne, izolowane timery —
 * tiki czasu NIE re-renderują obszaru roboczego. useApi pomija setData przy
 * identycznym pollu (zero migotania).
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn, calcDeboning } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  AlertTriangle, Save, Package, LogOut, Play, Lock, Flag, Delete, Info, X, Check,
  Sun, Moon, Boxes, Users, Activity,
} from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const KG_PER_CONTAINER = 15
const THEME_KEY = 'rozbior_hmi_v4_theme'

type Theme = 'light' | 'dark'

// Paleta jako zmienne CSS — jeden JSX, przełączenie motywu = podmiana wartości.
const VARS: Record<Theme, CSSProperties> = {
  dark: {
    ['--app' as string]: '#0d1117', ['--panel' as string]: '#161b22', ['--panel2' as string]: '#1c2230',
    ['--bd' as string]: '#30363d', ['--bd2' as string]: '#21262d',
    ['--ink' as string]: '#e6edf3', ['--mut' as string]: '#8b949e',
    ['--grn' as string]: '#3fb950', ['--amb' as string]: '#d29922', ['--red' as string]: '#f85149', ['--blu' as string]: '#388bfd',
    ['--rdbg' as string]: '#05080d', ['--rdink' as string]: '#3fb950',
  },
  light: {
    ['--app' as string]: '#e7ebf0', ['--panel' as string]: '#ffffff', ['--panel2' as string]: '#eef2f7',
    ['--bd' as string]: '#c2cad6', ['--bd2' as string]: '#d8dee6',
    ['--ink' as string]: '#0f172a', ['--mut' as string]: '#5b6675',
    ['--grn' as string]: '#15803d', ['--amb' as string]: '#b45309', ['--red' as string]: '#dc2626', ['--blu' as string]: '#1d4ed8',
    ['--rdbg' as string]: '#0c1320', ['--rdink' as string]: '#34d399',
  },
}

// ─── Zegar (izolowany 1s tick) ─────────────────────────────────────
const TopClock = memo(function TopClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i) }, [])
  return (
    <span className="font-mono text-2xl font-bold tabular-nums text-[var(--ink)]">
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

// ─── Komórka tagu w pasku górnym ───────────────────────────────────
function TagCell({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col justify-center px-4 border-l border-[var(--bd)] min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--mut)] leading-none mb-1">{label}</span>
      <span className="text-base font-bold leading-none truncate" style={{ color: accent ?? 'var(--ink)' }}>{value}</span>
    </div>
  )
}

// ─── Pasek KPI (memo, własny 30s timer dla kg/h) ───────────────────
const KpiBar = memo(function KpiBar({ entries, startedAt }: { entries: DeboningEntry[]; startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i) }, [])

  const totTaken = entries.reduce((s, e) => s + e.kgTaken, 0)
  const totMeat  = entries.reduce((s, e) => s + e.kgMeat, 0)
  const totWaste = entries.reduce((s, e) => s + (e.kgBones ?? 0) + (e.kgBacks ?? 0), 0)
  const yieldPct = totTaken > 0 ? (totMeat / totTaken) * 100 : 0
  const wastePct = totTaken > 0 ? (totWaste / totTaken) * 100 : 0
  const hours = startedAt ? Math.max((now - new Date(startedAt).getTime()) / 3_600_000, 1 / 60) : 0
  const kgH = hours > 0 ? totMeat / hours : 0
  const workers = new Set(entries.map(e => e.workerId)).size

  const yColor = yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : totMeat > 0 ? 'var(--red)' : 'var(--mut)'
  const cells: { label: string; val: string; color?: string }[] = [
    { label: 'Suma zmiany', val: `${fmtKg(totMeat, 0)} kg`, color: 'var(--ink)' },
    { label: 'Wydajność', val: totMeat > 0 ? fmtPct(yieldPct, 1) : '—', color: yColor },
    { label: 'kg / h', val: kgH > 0 ? fmtKg(kgH, 0) : '—', color: 'var(--blu)' },
    { label: 'Odpad', val: totWaste > 0 ? fmtPct(wastePct, 1) : '—', color: 'var(--amb)' },
    { label: 'Wpisy', val: String(entries.length), color: 'var(--ink)' },
    { label: 'Operatorzy', val: String(workers), color: 'var(--ink)' },
  ]
  return (
    <div className="grid grid-cols-6 flex-shrink-0 border-t border-[var(--bd)] bg-[var(--panel)]">
      {cells.map(c => (
        <div key={c.label} className="flex flex-col items-center justify-center py-2.5 border-l border-[var(--bd2)] first:border-l-0">
          <span className="font-mono text-3xl font-bold tabular-nums leading-none" style={{ color: c.color }}>{c.val}</span>
          <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--mut)] mt-1.5">{c.label}</span>
        </div>
      ))}
    </div>
  )
})

// ─── Kafel partii ──────────────────────────────────────────────────
const BatchCard = memo(function BatchCard({ batch, selected, entryCount, onSelect }: {
  batch: RawBatch; selected: boolean; entryCount: number; onSelect: (b: RawBatch) => void
}) {
  const kg = Number(batch.kgAvailable)
  const containers = Math.floor(kg / KG_PER_CONTAINER)
  const d = getExpiryStatus(batch.expiryDate).daysLeft
  const stat = d <= 0 ? 'var(--red)' : d <= 2 ? 'var(--amb)' : 'var(--grn)'
  return (
    <button type="button" onClick={() => onSelect(batch)}
      className={cn('relative flex flex-col items-start gap-1 rounded-md border-2 min-h-[104px] p-2.5 text-left select-none active:translate-y-px',
        selected ? 'bg-[var(--panel2)] border-[var(--blu)]' : 'bg-[var(--panel)] border-[var(--bd)]')}>
      {selected && <span className="absolute inset-x-0 top-0 h-1 bg-[var(--blu)] rounded-t" />}
      <div className="flex items-center justify-between w-full">
        <span className="font-mono text-2xl font-bold leading-none text-[var(--ink)]">{batch.internalBatchNo}</span>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: stat }} />
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums text-[var(--mut)]">{fmtKg(kg, 0)} kg · {containers} poj.</span>
      <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: stat }}>
        {d < 0 ? 'PRZETERM.' : d === 0 ? 'DZIŚ!' : `${d} dni`}
      </span>
      {entryCount > 0 && (
        <span className="absolute bottom-1.5 right-1.5 min-w-[20px] h-5 px-1 rounded text-[12px] font-bold flex items-center justify-center bg-[var(--grn)] text-[var(--app)]">{entryCount}</span>
      )}
    </button>
  )
})

// ─── Kafel operatora ───────────────────────────────────────────────
const EmployeeCard = memo(function EmployeeCard({ worker, selected, onSelect }: {
  worker: User; selected: boolean; onSelect: (w: User) => void
}) {
  const init = worker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className={cn('relative flex items-center gap-2.5 rounded-md border-2 min-h-[60px] px-3 select-none active:translate-y-px',
        selected ? 'bg-[var(--panel2)] border-[var(--blu)]' : 'bg-[var(--panel)] border-[var(--bd)]')}>
      <span className="w-10 h-10 rounded flex items-center justify-center text-base font-bold flex-shrink-0 border"
        style={selected ? { background: 'var(--blu)', color: 'var(--app)', borderColor: 'var(--blu)' } : { background: 'var(--panel2)', color: 'var(--ink)', borderColor: 'var(--bd)' }}>
        {init}
      </span>
      <span className="text-sm font-bold leading-tight text-[var(--ink)] truncate">{worker.name}</span>
    </button>
  )
})

// ─── Keypad ────────────────────────────────────────────────────────
const KEYS = ['7','8','9','4','5','6','1','2','3','0','.','⌫'] as const
const Keypad = memo(function Keypad({ onKey, disabled }: { onKey: (k: string) => void; disabled: boolean }) {
  return (
    <div className={cn('grid grid-cols-3 gap-2 flex-1', disabled && 'opacity-40 pointer-events-none')}>
      {KEYS.map(k => (
        <button key={k} type="button" onClick={() => onKey(k)}
          className={cn('rounded-md border-2 font-mono text-3xl font-bold tabular-nums flex items-center justify-center select-none active:translate-y-px',
            k === '⌫'
              ? 'bg-[var(--panel2)] border-[var(--bd)] text-[var(--amb)]'
              : 'bg-[var(--panel)] border-[var(--bd)] text-[var(--ink)] active:bg-[var(--panel2)]')}>
          {k === '⌫' ? <Delete size={28} /> : k}
        </button>
      ))}
    </div>
  )
})

// ─── Pasek wpisów (memo) ───────────────────────────────────────────
const EntriesStrip = memo(function EntriesStrip({ entries }: { entries: DeboningEntry[] }) {
  if (entries.length === 0) return <span className="text-sm text-[var(--mut)] px-1">Brak wpisów z dziś</span>
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
      {entries.slice().reverse().map(e => (
        <div key={e.id} className="flex-shrink-0 flex items-center gap-2 rounded border border-[var(--bd)] bg-[var(--panel)] px-2.5 py-1">
          <span className="font-mono text-sm font-bold text-[var(--blu)]">{e.rawBatchNo}</span>
          <span className="text-sm font-semibold text-[var(--ink)]">{e.workerName.split(' ')[0]}</span>
          <span className="font-mono text-sm tabular-nums text-[var(--mut)]">{fmtKg(e.kgTaken, 0)}→{fmtKg(e.kgMeat, 0)}</span>
          <span className="font-mono text-sm font-bold tabular-nums" style={{ color: e.yieldPct >= 75 ? 'var(--grn)' : e.yieldPct >= 60 ? 'var(--amb)' : 'var(--red)' }}>{fmtPct(e.yieldPct, 0)}</span>
        </div>
      ))}
    </div>
  )
})

// ─── Readout wagi (tag-display) ────────────────────────────────────
function Readout({ label, value, active, error, onActivate }: {
  label: string; value: string; active: boolean; error?: boolean; onActivate: () => void
}) {
  const ring = error ? 'var(--red)' : active ? 'var(--blu)' : 'var(--bd)'
  return (
    <button type="button" onClick={onActivate}
      className="w-full text-left rounded-md border-2 p-2.5 bg-[var(--panel)]" style={{ borderColor: ring }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold uppercase tracking-[.16em]" style={{ color: error ? 'var(--red)' : active ? 'var(--blu)' : 'var(--mut)' }}>{label}</span>
        {active && <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--blu)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--blu)]" /> aktywne</span>}
      </div>
      <div className="flex items-baseline justify-end gap-2 rounded px-3 py-1.5 bg-[var(--rdbg)] border border-black/40">
        <span className="font-mono text-[56px] leading-none font-bold tabular-nums" style={{ color: error ? 'var(--red)' : value ? 'var(--rdink)' : '#3a4150' }}>{value || '0'}</span>
        <span className="text-lg font-bold text-[var(--mut)] uppercase">kg</span>
      </div>
    </button>
  )
}

// ─── Toast ─────────────────────────────────────────────────────────
function HmiToast({ msg, type, visible }: { msg: string; type: 'success'|'error'; visible: boolean }) {
  return (
    <div className={cn('fixed top-4 left-1/2 -translate-x-1/2 z-[120] px-6 py-3.5 rounded-md text-base font-bold flex items-center gap-3 border-2 transition-opacity duration-150',
      visible ? 'opacity-100' : 'opacity-0 pointer-events-none')}
      style={{ background: 'var(--panel)', color: 'var(--ink)', borderColor: type === 'success' ? 'var(--grn)' : 'var(--red)' }}>
      {type === 'success' ? <Check size={24} style={{ color: 'var(--grn)' }} /> : <AlertTriangle size={24} style={{ color: 'var(--red)' }} />}
      <span>{msg}</span>
    </div>
  )
}

export function DeboningHmiV4Page() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  const toggleTheme = useCallback(() => {
    setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(THEME_KEY, n) } catch { /**/ } return n })
  }, [])

  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())
  const { session, timeWindow, loading: sessionLoading, startDay, closeDay, startLoading, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<'taken' | 'meat'>('taken')
  const [finishModal, setFinishModal] = useState(false)
  const [inputBacks,  setInputBacks]  = useState('')
  const [inputBones,  setInputBones]  = useState('')
  const [shiftModal,  setShiftModal]  = useState(false)
  const [toast, setToast] = useState({ msg: '', type: 'success' as 'success'|'error', visible: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000)
  }, [])

  useEffect(() => {
    if (!selBatch) return
    const updated = (batchData.data?.data ?? []).find(b => b.id === selBatch.id)
    if (updated && updated.kgAvailable !== selBatch.kgAvailable) setSelBatch(updated)
  }, [batchData.data]) // eslint-disable-line

  const batches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)),
    [batchData.data])
  const workers = useMemo(() => (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'), [workerData.data])
  const entryCountByBatchId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.rawBatchId, (m.get(e.rawBatchId) ?? 0) + 1)
    return m
  }, [entries])

  const taken = parseFloat(kgTaken) || 0
  const meat  = parseFloat(kgMeat)  || 0
  const kgAvailableNow = Number(selBatch?.kgAvailable ?? 0)
  const isOver  = taken > 0 && !!selBatch && taken > kgAvailableNow + 0.01
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && meat <= taken && !isOver
  const yieldPct = taken > 0 && meat > 0 && meat <= taken ? (meat / taken) * 100 : 0
  const batchEntries = selBatch ? entries.filter(e => e.rawBatchId === selBatch.id) : []
  const batchTotalTaken = batchEntries.reduce((s, e) => s + e.kgTaken, 0)
  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)
  const finalizeTotalMeat  = pendingFinalize.reduce((s, e) => s + e.kgMeat, 0)
  const batchSuggestion = finalizeTotalTaken > 0 && finalizeTotalMeat > 0 ? calcDeboning(finalizeTotalTaken, finalizeTotalMeat) : null

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
    if (active === 'taken') setKgTaken(apply); else setKgMeat(apply)
  }, [active])

  const pickBatch  = useCallback((b: RawBatch) => { setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken') }, [])
  const pickWorker = useCallback((w: User) => { setSelWorker(w); setActive('taken') }, [])

  async function handleStartDay() {
    const err = await startDay(); if (err) showToast(err, 'error'); else showToast('Dzień produkcyjny rozpoczęty')
  }
  async function handleSave() {
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry({ sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate)
    if (err) { showToast(err, 'error'); return }
    batchData.refetch()
    const isFullyUsed = kgAvailableNow > 0 && (batchTotalTaken + taken) >= kgAvailableNow - 0.1
    setKgTaken(''); setKgMeat(''); setActive('taken')
    showToast(isFullyUsed ? `✓ Ćwiartka ${selBatch.internalBatchNo} rozebrana — "Zakończ partię"` : `Zapisano: ${fmtKg(meat)} kg mięsa`)
  }
  function handleFinishBatch() {
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', 'error'); return }
    setInputBacks(batchSuggestion ? batchSuggestion.kgBacks.toFixed(2) : '')
    setInputBones(batchSuggestion ? batchSuggestion.kgBones.toFixed(2) : '')
    setFinishModal(true)
  }
  async function handleFinishConfirm() {
    if (!session) return
    const kbTotal = parseFloat(inputBacks) || 0, knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', 'error'); return }
    const toFinalize = pendingFinalize
    if (toFinalize.length === 0) { setFinishModal(false); return }
    const sumTaken = toFinalize.reduce((s, e) => s + e.kgTaken, 0) || 1
    let rb = 0, rn = 0
    for (let i = 0; i < toFinalize.length; i++) {
      const e = toFinalize[i], isLast = i === toFinalize.length - 1, share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - rb) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - rn) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      rb += kb; rn += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }
    setFinishModal(false)
    showToast(`Zakończono ${toFinalize.length} wpis(ów) (${fmtKg(kbTotal, 2)} kg grzb., ${fmtKg(knTotal, 2)} kg kości)`)
    setSelBatch(null); setKgTaken(''); setKgMeat(''); setActive('taken')
  }

  const wrap = (children: React.ReactNode) => (
    <div className="h-full w-full overflow-hidden bg-[var(--app)] text-[var(--ink)]" style={VARS[theme]}>{children}</div>
  )

  if (sessionLoading) return wrap(<div className="flex items-center justify-center h-full"><Spinner size={40} /></div>)

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center h-full p-10 text-center">
      <div className="w-24 h-24 rounded-md bg-[var(--panel)] border-2 border-[var(--bd)] flex items-center justify-center mb-6" style={{ color: 'var(--grn)' }}><Play size={48} /></div>
      <h2 className="text-3xl font-black mb-2">Rozpocznij dzień</h2>
      <p className="text-lg text-[var(--mut)] mb-8">Data produkcyjna: {timeWindow.productionDate}</p>
      <button type="button" onClick={handleStartDay} disabled={startLoading}
        className="h-20 px-12 rounded-md text-2xl font-black flex items-center justify-center gap-4 active:translate-y-px"
        style={{ background: 'var(--grn)', color: 'var(--app)' }}>
        {startLoading ? <span className="w-8 h-8 border-[3px] border-current/30 border-t-current rounded-full animate-spin" /> : <Play size={30} />}
        Rozpocznij dzień
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center h-full p-10 text-center">
      <div className="w-24 h-24 rounded-md bg-[var(--panel)] border-2 border-[var(--bd)] flex items-center justify-center mb-6" style={{ color: 'var(--amb)' }}><Lock size={48} /></div>
      <h2 className="text-3xl font-black mb-2">{session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}</h2>
      <p className="text-lg text-[var(--mut)] max-w-md">{session.status === 'approved' ? `Dane z dnia ${session.sessionDate} zablokowane.` : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'}</p>
    </div>
  )

  const fefoAlerts = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 2)
  const enabled = !!selBatch && !!selWorker

  return wrap(
    <div className="h-full flex flex-col">

      {/* ─── PASEK GÓRNY ─── */}
      <header className="flex items-stretch h-16 flex-shrink-0 bg-[var(--panel)] border-b-2 border-[var(--bd)]">
        <div className="flex items-center gap-3 px-5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--grn)' }} />
          <div className="leading-none">
            <div className="text-lg font-black tracking-tight">ROZBIÓR</div>
            <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--mut)]">Stacja · Deboning</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-4 border-l border-[var(--bd)]">
          <Activity size={16} style={{ color: 'var(--grn)' }} />
          <span className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--grn)' }}>Online</span>
        </div>
        <TagCell label="Partia" value={selBatch ? selBatch.internalBatchNo : '—'} accent={selBatch ? 'var(--blu)' : 'var(--mut)'} />
        <TagCell label="Operator" value={selWorker ? selWorker.name : '—'} accent={selWorker ? 'var(--blu)' : 'var(--mut)'} />
        <TagCell label="Zmiana" value={session.sessionDate} />
        <div className="flex-1 flex items-center justify-end gap-4 px-4 border-l border-[var(--bd)]">
          {fefoAlerts.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-bold border-2" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
              <AlertTriangle size={16} /> {fefoAlerts.length === 1 ? `Partia ${fefoAlerts[0].internalBatchNo} — termin!` : `${fefoAlerts.length} partii — termin!`}
            </span>
          )}
          <TopClock />
          <button type="button" onClick={toggleTheme} aria-label="Motyw"
            className="w-10 h-10 rounded-md border-2 border-[var(--bd)] flex items-center justify-center text-[var(--mut)] active:translate-y-px">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      {/* ─── OBSZAR GŁÓWNY ─── */}
      <div className="flex-1 grid grid-cols-[minmax(300px,27%)_minmax(420px,1fr)_minmax(220px,250px)] gap-px bg-[var(--bd)] overflow-hidden">

        {/* LEWY: selekcje */}
        <div className="flex flex-col gap-px bg-[var(--bd)] overflow-hidden">
          <section className="flex flex-col flex-1 bg-[var(--app)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--panel)] border-b border-[var(--bd)] flex-shrink-0">
              <Boxes size={16} style={{ color: 'var(--blu)' }} />
              <span className="text-xs font-black uppercase tracking-[.16em] text-[var(--mut)]">Partia · FEFO</span>
            </div>
            {batchData.loading
              ? <div className="flex justify-center py-8"><Spinner size={28} /></div>
              : batches.length === 0
                ? <div className="flex flex-col items-center justify-center flex-1 text-[var(--mut)]"><Package size={32} className="mb-2" />Brak partii</div>
                : <div className="grid grid-cols-2 gap-2 p-2 overflow-y-auto scrollbar-thin content-start">
                    {batches.map(b => <BatchCard key={b.id} batch={b} selected={selBatch?.id === b.id} entryCount={entryCountByBatchId.get(b.id) ?? 0} onSelect={pickBatch} />)}
                  </div>}
          </section>
          <section className="flex flex-col bg-[var(--app)] max-h-[42%] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--panel)] border-b border-[var(--bd)] flex-shrink-0">
              <Users size={16} style={{ color: 'var(--blu)' }} />
              <span className="text-xs font-black uppercase tracking-[.16em] text-[var(--mut)]">Operator</span>
            </div>
            {workerData.loading
              ? <div className="flex justify-center py-6"><Spinner size={24} /></div>
              : <div className="grid grid-cols-2 gap-2 p-2 overflow-y-auto scrollbar-thin content-start">
                  {workers.map(w => <EmployeeCard key={w.id} worker={w} selected={selWorker?.id === w.id} onSelect={pickWorker} />)}
                </div>}
          </section>
        </div>

        {/* ŚRODEK: aktywna sesja + keypad */}
        <div className="flex flex-col bg-[var(--app)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--panel)] border-b border-[var(--bd)] flex-shrink-0">
            <span className="w-2 h-2 rounded-full" style={{ background: enabled ? 'var(--grn)' : 'var(--mut)' }} />
            <span className="text-xs font-black uppercase tracking-[.16em] text-[var(--mut)]">Aktywna sesja rozbioru</span>
            {selBatch && <span className="ml-auto font-mono text-xs text-[var(--mut)]">Dostępne {fmtKg(kgAvailableNow, 0)} kg{batchEntries.length > 0 ? ` · wpis ${batchEntries.length}.` : ''}</span>}
          </div>

          <div className={cn('flex-1 flex flex-col gap-2.5 p-3 overflow-hidden', !enabled && 'opacity-55')}>
            <div className="grid grid-cols-2 gap-2.5">
              <Readout label="Ćwiartka pobrana" value={kgTaken} active={active === 'taken'} error={isOver} onActivate={() => setActive('taken')} />
              <Readout label="Mięso Z/S" value={kgMeat} active={active === 'meat'} onActivate={() => setActive('meat')} />
            </div>

            {isOver ? (
              <div className="flex items-center gap-3 rounded-md px-4 py-2.5 border-2" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
                <AlertTriangle size={28} /><div><div className="text-lg font-black">ZA DUŻO</div><div className="text-sm font-semibold">Dostępne {fmtKg(kgAvailableNow)} kg w partii {selBatch?.internalBatchNo}</div></div>
              </div>
            ) : (
              <div className="flex items-center gap-4 rounded-md px-4 py-2 bg-[var(--panel)] border border-[var(--bd)]">
                <span className="font-mono text-4xl font-bold tabular-nums leading-none" style={{ color: yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : yieldPct > 0 ? 'var(--red)' : 'var(--mut)' }}>
                  {yieldPct > 0 ? fmtPct(yieldPct, 1) : '—'}
                </span>
                <div className="flex-1">
                  <div className="text-[11px] font-black uppercase tracking-[.14em] text-[var(--mut)] mb-1">Wydajność wpisu</div>
                  <div className="h-2 rounded-full overflow-hidden bg-[var(--panel2)]">
                    <div className="h-full" style={{ width: `${Math.min(100, yieldPct)}%`, background: yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : 'var(--red)' }} />
                  </div>
                </div>
              </div>
            )}

            <Keypad onKey={pressKey} disabled={!enabled} />
          </div>
        </div>

        {/* PRAWY: akcje */}
        <div className="flex flex-col gap-2 p-2 bg-[var(--app)] overflow-hidden">
          <div className="text-xs font-black uppercase tracking-[.16em] text-[var(--mut)] px-1 py-1">Operacje</div>
          <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
            className="flex-1 min-h-[120px] rounded-md flex flex-col items-center justify-center gap-2 text-2xl font-black active:translate-y-px disabled:opacity-30"
            style={{ background: canSave ? 'var(--grn)' : 'var(--panel2)', color: canSave ? 'var(--app)' : 'var(--mut)', border: '2px solid var(--bd)' }}>
            {addLoading ? <span className="w-8 h-8 border-[3px] border-current/30 border-t-current rounded-full animate-spin" /> : <Save size={36} />}
            ZAPISZ WPIS
          </button>
          <button type="button" onClick={handleFinishBatch} disabled={pendingFinalize.length === 0}
            className="h-20 rounded-md flex items-center justify-center gap-2 text-lg font-bold active:translate-y-px disabled:opacity-30 border-2"
            style={{ color: 'var(--amb)', borderColor: 'var(--amb)' }}>
            <Flag size={22} /> Zakończ partię
          </button>
          <button type="button" onClick={() => setShiftModal(true)}
            className="h-16 rounded-md flex items-center justify-center gap-2 text-base font-bold active:translate-y-px border-2"
            style={{ color: 'var(--red)', borderColor: 'var(--bd)' }}>
            <LogOut size={20} /> Zakończ zmianę
          </button>
        </div>
      </div>

      {/* ─── PASEK WPISÓW + KPI ─── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[var(--panel)] border-t border-[var(--bd)] flex-shrink-0 h-11">
        <span className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--mut)] flex-shrink-0">Dziś</span>
        <EntriesStrip entries={entries} />
      </div>
      <KpiBar entries={entries} startedAt={session.startedAt} />

      {/* ─── MODALE ─── */}
      {finishModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/70" style={VARS[theme]}>
          <div className="w-full max-w-xl p-6 rounded-md bg-[var(--panel)] border-2 border-[var(--bd)] text-[var(--ink)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-md border-2 flex items-center justify-center" style={{ color: 'var(--amb)', borderColor: 'var(--amb)' }}><Flag size={26} /></div>
              <div><h3 className="text-2xl font-black">Zakończenie partii</h3><p className="text-sm text-[var(--mut)]">{pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki</p></div>
            </div>
            {batchSuggestion && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-md mb-4 text-sm border-2" style={{ color: 'var(--blu)', borderColor: 'var(--blu)' }}>
                <Info size={18} className="flex-shrink-0 mt-0.5" />
                <div><div className="font-black mb-0.5">Sugestia (z sumy wpisów)</div>Grzbiety ~{batchSuggestion.kgBacks.toFixed(2)} kg · Kości ~{batchSuggestion.kgBones.toFixed(2)} kg</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-5">
              {[{ label: 'Grzbiety (kg)', val: inputBacks, set: setInputBacks }, { label: 'Kości (kg)', val: inputBones, set: setInputBones }].map(f => (
                <div key={f.label}>
                  <label className="text-sm font-black uppercase tracking-wide text-[var(--mut)] block mb-1.5">{f.label}</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={f.val} onChange={e => f.set(e.target.value)}
                    className="w-full h-20 px-4 font-mono text-4xl font-bold rounded-md border-2 tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{ background: 'var(--rdbg)', color: 'var(--rdink)', borderColor: 'var(--bd)' }} />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)} className="flex-1 h-16 rounded-md font-bold text-lg border-2 border-[var(--bd)] text-[var(--mut)]">Anuluj</button>
              <button type="button" onClick={handleFinishConfirm} className="flex-[2] h-16 rounded-md font-black text-lg flex items-center justify-center gap-2" style={{ background: 'var(--amb)', color: 'var(--app)' }}><Flag size={22} /> Potwierdź i zakończ</button>
            </div>
          </div>
        </div>
      )}

      {shiftModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/70" style={VARS[theme]} onClick={() => setShiftModal(false)}>
          <div className="w-full max-w-md p-6 rounded-md bg-[var(--panel)] border-2 border-[var(--bd)] text-[var(--ink)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-md border-2 flex items-center justify-center" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}><LogOut size={26} /></div>
              <h3 className="text-2xl font-black">Zakończyć zmianę?</h3>
            </div>
            <p className="text-base text-[var(--mut)] mb-6">Sesja zostanie zamknięta. Biuro zatwierdzi dane.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)} className="flex-1 h-16 rounded-md font-bold text-lg border-2 border-[var(--bd)] text-[var(--mut)] flex items-center justify-center gap-2"><X size={22} /> Anuluj</button>
              <button type="button" disabled={closeLoading} onClick={async () => { setShiftModal(false); const err = await closeDay(); if (err) showToast(err, 'error'); else showToast('Zmiana zakończona') }}
                className="flex-1 h-16 rounded-md font-black text-lg flex items-center justify-center gap-2" style={{ background: 'var(--red)', color: '#fff' }}><LogOut size={22} /> Zakończ</button>
            </div>
          </div>
        </div>
      )}

      <HmiToast msg={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
