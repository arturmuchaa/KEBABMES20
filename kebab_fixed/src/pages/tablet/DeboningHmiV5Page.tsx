import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Sun, Moon, Play, Lock, AlertTriangle, Save, Flag, LogOut, Delete } from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const THEME_KEY = 'rozbior_hmi_v5_theme'
const KG_PER_CONTAINER = 15

type Theme = 'light' | 'dark'
type ActiveField = 'taken' | 'meat'

const VARS: Record<Theme, CSSProperties> = {
  dark: {
    ['--app' as string]:    '#0a0f1a',
    ['--panel' as string]:  '#111827',
    ['--panel2' as string]: '#1e2d40',
    ['--bd' as string]:     '#1e293b',
    ['--ink' as string]:    '#f1f5f9',
    ['--mut' as string]:    '#64748b',
    ['--accent' as string]: '#3b82f6',
    ['--grn' as string]:    '#22c55e',
    ['--amb' as string]:    '#f59e0b',
    ['--red' as string]:    '#ef4444',
  },
  light: {
    ['--app' as string]:    '#f0f4f8',
    ['--panel' as string]:  '#ffffff',
    ['--panel2' as string]: '#f8fafc',
    ['--bd' as string]:     '#e2e8f0',
    ['--ink' as string]:    '#0f172a',
    ['--mut' as string]:    '#64748b',
    ['--accent' as string]: '#2563eb',
    ['--grn' as string]:    '#16a34a',
    ['--amb' as string]:    '#d97706',
    ['--red' as string]:    '#dc2626',
  },
}

// ─── Zegar (izolowany — nie re-renderuje gridu) ────────────────────
const TopClock = memo(function TopClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

export function DeboningHmiV5Page() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
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
  const { entries, addEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<ActiveField>('taken')
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal, setFinishModal] = useState(false)
  const [shiftModal,  setShiftModal]  = useState(false)
  const [inputBacks,  setInputBacks]  = useState('')
  const [inputBones,  setInputBones]  = useState('')
  const [toastMsg,    setToastMsg]    = useState('')
  const [toastType,   setToastType]   = useState<'ok' | 'err'>('ok')
  const [toastVis,    setToastVis]    = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg(msg); setToastType(type); setToastVis(true)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastVis(false), 3000)
  }, [])

  // Partii — memoizacja stabilna, FEFO sort, max 6
  const batches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0))
      .slice(0, 6),
    [batchData.data])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  const entryCountByWorkerId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.workerId, (m.get(e.workerId) ?? 0) + 1)
    return m
  }, [entries])

  const taken = parseFloat(kgTaken) || 0
  const meat  = parseFloat(kgMeat)  || 0
  const yieldPct = taken > 0 && meat > 0 && meat <= taken ? (meat / taken) * 100 : 0
  const canSave  = !!selBatch && !!selWorker && taken > 0 && meat > 0 && meat <= taken

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
    if (active === 'taken') setKgTaken('')
    else setKgMeat('')
  }, [active])

  const handleStartBackspaceHold = useCallback(() => {
    longPressRef.current = setTimeout(clearActiveField, 600)
  }, [clearActiveField])

  const handleEndBackspaceHold = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
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
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 300)
    setKgTaken(''); setKgMeat(''); setActive('taken')
    showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

  async function handleCloseShift() {
    const err = await closeDay()
    if (err) showToast(err, 'err')
    else { setShiftModal(false); showToast('Zmiana zakończona') }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--app)] text-[var(--ink)]" style={VARS[theme]}>
      {children}
    </div>
  )

  if (sessionLoading) return wrap(
    <div className="flex items-center justify-center flex-1"><Spinner size={48} /></div>
  )

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-8">
      <div className="w-28 h-28 rounded-2xl border-2 flex items-center justify-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--grn)', color: 'var(--grn)' }}>
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
        className="absolute top-4 right-4 w-12 h-12 rounded-xl border-2 flex items-center justify-center"
        style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
        {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="w-28 h-28 rounded-2xl border-2 flex items-center justify-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--amb)', color: 'var(--amb)' }}>
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

  // Główny ekran — placeholder do następnych tasków
  return wrap(<div className="flex-1 flex items-center justify-center text-4xl font-bold" style={{ color: 'var(--mut)' }}>HMI v5 — w budowie</div>)
}
