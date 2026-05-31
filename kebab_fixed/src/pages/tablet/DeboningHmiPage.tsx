/**
 * DeboningHmiPage — HMI v2 rozbioru dla ekranu hali (19"/21", landscape).
 *
 * Projektowany pod obsługę w rękawicach, przy wodzie, przez operatora który
 * "nie myśli nad UI": wielkie cele dotykowe, numpad ekranowy, zero scrolla w
 * głównej pętli, jeden ekran. Dane/logika reużyte z klasyka (te same hooki) —
 * to wyłącznie nowa warstwa prezentacji. Klasyczny ekran pozostaje nietknięty.
 *
 * Anti-flicker: useApi pomija setData przy identycznym pollu; strefa ważenia
 * trzyma stan lokalny; kafle i pasek wpisów są memo ze stabilnymi kluczami —
 * poll nie re-renderuje obszaru wpisywania.
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, fmtDatePl, cn, calcDeboning } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  AlertTriangle, Save, CheckCircle, Package, LogOut, Play, Lock,
  Flag, Delete, Info, X, Check,
} from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const KG_PER_CONTAINER = 15

// ─── Toast HMI — duży, kontrastowy, na środku góry ─────────────────
function HmiToast({ msg, type, visible }: { msg: string; type: 'success'|'error'; visible: boolean }) {
  return (
    <div className={cn(
      'fixed top-4 left-1/2 -translate-x-1/2 z-[120] px-7 py-4 rounded-2xl text-white text-xl font-bold shadow-modal flex items-center gap-3 transition-all duration-200 max-w-[90vw]',
      type === 'success' ? 'bg-success' : 'bg-danger',
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none',
    )}>
      {type === 'success' ? <Check size={28} className="flex-shrink-0" /> : <AlertTriangle size={28} className="flex-shrink-0" />}
      <span className="leading-tight">{msg}</span>
    </div>
  )
}

// ─── Block screen — pełnoekranowy, wielki ──────────────────────────
function BlockScreen({ icon, title, subtitle, action }: {
  icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-10 text-center bg-surface-2">
      <div className="w-28 h-28 rounded-full bg-surface-3 flex items-center justify-center mb-7 text-ink-4">{icon}</div>
      <h2 className="text-4xl font-black text-ink mb-3">{title}</h2>
      <p className="text-xl text-ink-3 mb-8 leading-relaxed max-w-md">{subtitle}</p>
      {action}
    </div>
  )
}

// ─── Kafel partii (memo) ───────────────────────────────────────────
const BatchTile = memo(function BatchTile({ batch, selected, entryCount, onSelect }: {
  batch: RawBatch; selected: boolean; entryCount: number; onSelect: (b: RawBatch) => void
}) {
  const kg = Number(batch.kgAvailable)
  const containers = Math.floor(kg / KG_PER_CONTAINER)
  const d = getExpiryStatus(batch.expiryDate).daysLeft
  const expWarn = d <= 0
  const expSoon = d > 0 && d <= 2
  return (
    <button type="button" onClick={() => onSelect(batch)}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1 rounded-2xl border-[3px] min-h-[112px] p-2 text-center transition-colors active:scale-[.97] select-none',
        selected
          ? 'bg-brand border-brand text-white shadow-[0_6px_22px_rgba(29,78,216,.35)]'
          : 'bg-white border-surface-4 hover:border-brand-border',
      )}>
      {entryCount > 0 && (
        <span className={cn('absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1 rounded-full text-[12px] font-black flex items-center justify-center',
          selected ? 'bg-white/25 text-white' : 'bg-success text-white')}>{entryCount}</span>
      )}
      <div className={cn('text-2xl font-black font-mono leading-none', selected ? 'text-white' : 'text-ink')}>
        {batch.internalBatchNo}
      </div>
      <div className={cn('text-base font-bold leading-tight', selected ? 'text-white/90' : 'text-ink-2')}>
        {fmtKg(kg, 0)} kg · {containers} poj.
      </div>
      <span className={cn('text-[12px] font-bold px-2 py-0.5 rounded-full mt-0.5',
        selected ? 'bg-white/20 text-white'
          : expWarn ? 'bg-danger-light text-danger'
          : expSoon ? 'bg-warn-light text-warn'
          : 'bg-success-light text-success')}>
        {d < 0 ? 'PRZETERM.' : d === 0 ? 'DZIŚ!' : `${d} dni`}
      </span>
    </button>
  )
})

// ─── Kafel pracownika (memo) ───────────────────────────────────────
const WorkerTile = memo(function WorkerTile({ worker, selected, onSelect }: {
  worker: User; selected: boolean; onSelect: (w: User) => void
}) {
  const init = worker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-2xl border-[3px] min-h-[96px] p-2 text-center transition-colors active:scale-[.97] select-none',
        selected ? 'bg-brand border-brand shadow-[0_6px_22px_rgba(29,78,216,.35)]' : 'bg-white border-surface-4 hover:border-brand-border',
      )}>
      <div className={cn('w-12 h-12 rounded-full flex items-center justify-center text-lg font-black',
        selected ? 'bg-white/25 text-white' : 'bg-brand-light text-brand')}>
        {init}
      </div>
      <div className={cn('text-sm font-bold leading-tight', selected ? 'text-white' : 'text-ink')}>{worker.name}</div>
    </button>
  )
})

// ─── Numpad (memo) — wielkie klawisze, działa w rękawicach ─────────
const KEYS = ['7','8','9','4','5','6','1','2','3','0','.','⌫'] as const
const Numpad = memo(function Numpad({ onKey, disabled }: { onKey: (k: string) => void; disabled: boolean }) {
  return (
    <div className={cn('grid grid-cols-3 gap-2.5 transition-opacity', disabled && 'opacity-40 pointer-events-none')}>
      {KEYS.map(k => (
        <button key={k} type="button" onClick={() => onKey(k)}
          className={cn(
            'min-h-[68px] rounded-2xl text-3xl font-black tabular-nums select-none transition-colors active:scale-95',
            k === '⌫'
              ? 'bg-surface-3 text-ink-2 hover:bg-surface-4 flex items-center justify-center'
              : 'bg-white border-2 border-surface-4 text-ink hover:border-brand-border',
          )}>
          {k === '⌫' ? <Delete size={30} /> : k}
        </button>
      ))}
    </div>
  )
})

// ─── Pasek wpisów "DZIŚ" (memo) — izolacja od strefy ważenia ───────
const EntriesStrip = memo(function EntriesStrip({ entries }: { entries: DeboningEntry[] }) {
  if (entries.length === 0) {
    return <div className="flex-1 text-base text-ink-4 font-medium px-2">Brak wpisów z dziś</div>
  }
  return (
    <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-thin py-1">
      {entries.slice().reverse().map(e => (
        <div key={e.id} className="flex-shrink-0 flex items-center gap-2 bg-white border border-surface-4 rounded-xl px-3 py-1.5">
          <span className="font-mono text-sm font-bold text-brand">{e.rawBatchNo}</span>
          <span className="text-sm font-semibold text-ink-2">{e.workerName.split(' ')[0]}</span>
          <span className="text-sm text-ink-3 tabular-nums">{fmtKg(e.kgTaken, 0)}→{fmtKg(e.kgMeat, 0)}</span>
          <span className={cn('text-sm font-black tabular-nums', e.yieldPct >= 75 ? 'text-success' : e.yieldPct >= 60 ? 'text-warn' : 'text-danger')}>
            {fmtPct(e.yieldPct, 0)}
          </span>
        </div>
      ))}
    </div>
  )
})

// ─── Wyświetlacz wagi ──────────────────────────────────────────────
function WeightDisplay({ label, value, unit, active, error, onActivate }: {
  label: string; value: string; unit: string; active: boolean; error?: boolean; onActivate: () => void
}) {
  return (
    <button type="button" onClick={onActivate}
      className={cn(
        'w-full text-left rounded-2xl border-[3px] px-5 py-3 transition-colors',
        error ? 'border-danger bg-danger-light'
          : active ? 'border-brand bg-brand-light ring-4 ring-brand/15'
          : 'border-surface-4 bg-white',
      )}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-black uppercase tracking-wide text-ink-3">{label}</span>
        {active && <span className="text-[11px] font-black text-brand uppercase">◀ wpisuję</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-[56px] leading-none font-black tabular-nums', error ? 'text-danger' : value ? 'text-ink' : 'text-ink-5')}>
          {value || '0'}
        </span>
        <span className="text-2xl font-bold text-ink-3">{unit}</span>
      </div>
    </button>
  )
}

export function DeboningHmiPage() {
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

  // Synchronizuj wybraną partię z odświeżonym kgAvailable po zapisie.
  useEffect(() => {
    if (!selBatch) return
    const updated = (batchData.data?.data ?? []).find(b => b.id === selBatch.id)
    if (updated && updated.kgAvailable !== selBatch.kgAvailable) setSelBatch(updated)
  }, [batchData.data]) // eslint-disable-line

  const batches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => {
        if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
        return (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)
      }),
    [batchData.data])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

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
  const batchTotalMeat  = batchEntries.reduce((s, e) => s + e.kgMeat, 0)

  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)
  const finalizeTotalMeat  = pendingFinalize.reduce((s, e) => s + e.kgMeat, 0)
  const batchSuggestion = finalizeTotalTaken > 0 && finalizeTotalMeat > 0
    ? calcDeboning(finalizeTotalTaken, finalizeTotalMeat) : null

  // ─── Numpad → aktywne pole ───────────────────────────────────────
  const pressKey = useCallback((k: string) => {
    const apply = (prev: string): string => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev === '' ? '0.' : prev + '.')
      // ogranicz długość i miejsca po przecinku
      const next = prev + k
      if (next.replace('.', '').length > 6) return prev
      const dot = next.indexOf('.')
      if (dot >= 0 && next.length - dot - 1 > 2) return prev
      return next
    }
    if (active === 'taken') setKgTaken(apply)
    else setKgMeat(apply)
  }, [active])

  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [])
  const pickWorker = useCallback((w: User) => {
    setSelWorker(w); setActive('taken')
  }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'error')
    else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate,
    )
    if (err) { showToast(err, 'error'); return }
    batchData.refetch()

    const totalTaken = batchTotalTaken + taken
    const isFullyUsed = kgAvailableNow > 0 && totalTaken >= kgAvailableNow - 0.1

    setKgTaken(''); setKgMeat(''); setActive('taken')
    if (isFullyUsed) showToast(`✓ Ćwiartka ${selBatch.internalBatchNo} rozebrana — kliknij "Zakończ partię"`)
    else showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

  function handleFinishBatch() {
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', 'error'); return }
    setInputBacks(batchSuggestion ? batchSuggestion.kgBacks.toFixed(2) : '')
    setInputBones(batchSuggestion ? batchSuggestion.kgBones.toFixed(2) : '')
    setFinishModal(true)
  }

  async function handleFinishConfirm() {
    if (!session) return
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', 'error'); return }
    const toFinalize = pendingFinalize
    if (toFinalize.length === 0) { setFinishModal(false); return }
    const sumTaken = toFinalize.reduce((s, e) => s + e.kgTaken, 0) || 1
    let runningBacks = 0, runningBones = 0
    for (let i = 0; i < toFinalize.length; i++) {
      const e = toFinalize[i]
      const isLast = i === toFinalize.length - 1
      const share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - runningBacks) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - runningBones) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      runningBacks += kb; runningBones += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }
    setFinishModal(false)
    showToast(`Zakończono ${toFinalize.length} ${toFinalize.length === 1 ? 'wpis' : 'wpisów'} (${fmtKg(kbTotal, 2)} kg grzb., ${fmtKg(knTotal, 2)} kg kości)`)
    setSelBatch(null); setKgTaken(''); setKgMeat(''); setActive('taken')
  }

  // ─── Block screens ───────────────────────────────────────────────
  if (sessionLoading) return (
    <div className="flex items-center justify-center h-full"><Spinner size={40} /></div>
  )

  if (!session) return (
    <BlockScreen icon={<Play size={56} />} title="Rozpocznij dzień"
      subtitle={`Data produkcyjna: ${timeWindow.productionDate}`}
      action={
        <button type="button" onClick={handleStartDay} disabled={startLoading}
          className="h-20 px-12 bg-brand text-white rounded-3xl text-2xl font-black flex items-center justify-center gap-4 active:scale-95 shadow-[0_8px_30px_rgba(29,78,216,.35)]">
          {startLoading ? <span className="w-8 h-8 border-[3px] border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={30} />}
          Rozpocznij dzień
        </button>
      } />
  )

  if (session.status === 'closed' || session.status === 'approved') return (
    <BlockScreen icon={<Lock size={56} />}
      title={session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}
      subtitle={session.status === 'approved'
        ? `Dane z dnia ${session.sessionDate} zablokowane.`
        : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'} />
  )

  const fefoAlerts = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 2)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-2">

      {/* Pasek statusu sesji + alert FEFO */}
      <div className="flex items-center gap-4 px-5 py-2 bg-white border-b border-surface-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
          <span className="text-base font-black text-success uppercase tracking-wide">Sesja otwarta</span>
          <span className="text-base text-ink-3 font-semibold">{session.sessionDate}</span>
        </div>
        {fefoAlerts.length > 0 && (
          <div className="flex items-center gap-2 ml-auto px-3 py-1 rounded-xl bg-danger-light border border-danger-border text-danger text-sm font-bold">
            <AlertTriangle size={16} />
            {fefoAlerts.length === 1
              ? <>Partia {fefoAlerts[0].internalBatchNo} — {getExpiryStatus(fefoAlerts[0].expiryDate).daysLeft <= 0 ? 'PRZETERMINOWANA!' : 'wygasa wkrótce!'}</>
              : <>{fefoAlerts.length} partii blisko terminu!</>}
          </div>
        )}
      </div>

      {/* Główna pętla — dwie kolumny, bez scrolla globalnego */}
      <div className="flex-1 grid grid-cols-[minmax(360px,42%)_1fr] gap-3 p-3 overflow-hidden">

        {/* LEWA: selekcja partii + pracownika */}
        <div className="flex flex-col gap-3 overflow-hidden">
          {/* KROK 1 — Partia */}
          <div className="flex flex-col bg-white rounded-2xl border border-surface-4 p-3 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <span className="text-sm font-black uppercase tracking-widest text-ink-3">1 · Partia</span>
              {selBatch && <span className="flex items-center gap-1 text-sm font-bold px-2.5 py-0.5 rounded-full bg-success-light text-success"><CheckCircle size={14} /> {selBatch.internalBatchNo}</span>}
            </div>
            {batchData.loading
              ? <div className="flex justify-center py-8"><Spinner size={32} /></div>
              : batches.length === 0
                ? <div className="flex flex-col items-center justify-center flex-1 text-ink-4"><Package size={36} className="mb-2" /><span className="text-base">Brak partii</span></div>
                : <div className="grid grid-cols-3 gap-2 overflow-y-auto scrollbar-thin pr-1 content-start">
                    {batches.map(b => (
                      <BatchTile key={b.id} batch={b}
                        selected={selBatch?.id === b.id}
                        entryCount={entryCountByBatchId.get(b.id) ?? 0}
                        onSelect={pickBatch} />
                    ))}
                  </div>
            }
          </div>
          {/* KROK 2 — Pracownik */}
          <div className="flex flex-col bg-white rounded-2xl border border-surface-4 p-3 flex-shrink-0 max-h-[42%] overflow-hidden">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <span className="text-sm font-black uppercase tracking-widest text-ink-3">2 · Pracownik</span>
              {selWorker && <span className="flex items-center gap-1 text-sm font-bold px-2.5 py-0.5 rounded-full bg-success-light text-success"><CheckCircle size={14} /> {selWorker.name}</span>}
            </div>
            {workerData.loading
              ? <div className="flex justify-center py-6"><Spinner size={28} /></div>
              : <div className="grid grid-cols-4 gap-2 overflow-y-auto scrollbar-thin pr-1 content-start">
                  {workers.map(w => (
                    <WorkerTile key={w.id} worker={w} selected={selWorker?.id === w.id} onSelect={pickWorker} />
                  ))}
                </div>
            }
          </div>
        </div>

        {/* PRAWA: ważenie + numpad */}
        <div className={cn('flex flex-col gap-3 bg-white rounded-2xl border border-surface-4 p-3 overflow-hidden transition-opacity',
          (!selBatch || !selWorker) && 'opacity-50')}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm font-black uppercase tracking-widest text-ink-3">3 · Waga</span>
            {selBatch && (
              <span className="text-sm font-semibold text-ink-3">
                Dostępne: <strong className="text-ink">{fmtKg(kgAvailableNow, 0)} kg</strong>
                {batchEntries.length > 0 && <> · ten wpis {batchEntries.length}.</>}
              </span>
            )}
          </div>

          <div className="flex-1 grid grid-cols-2 gap-3 overflow-hidden">
            {/* Wyświetlacze + wydajność */}
            <div className="flex flex-col gap-2.5 overflow-hidden">
              <WeightDisplay label="Ćwiartka" value={kgTaken} unit="kg" active={active === 'taken'} error={isOver} onActivate={() => setActive('taken')} />
              <WeightDisplay label="Mięso Z/S" value={kgMeat} unit="kg" active={active === 'meat'} onActivate={() => setActive('meat')} />

              {isOver ? (
                <div className="flex items-center gap-3 bg-danger text-white rounded-2xl px-4 py-3">
                  <span className="text-3xl">⛔</span>
                  <div>
                    <div className="text-lg font-black">ZA DUŻO!</div>
                    <div className="text-sm font-semibold">Dostępne {fmtKg(kgAvailableNow)} kg w partii {selBatch?.internalBatchNo}</div>
                  </div>
                </div>
              ) : yieldPct > 0 ? (
                <div className="bg-surface-2 rounded-2xl px-4 py-3 flex items-center gap-4">
                  <div className={cn('text-5xl font-black leading-none tabular-nums',
                    yieldPct >= 75 ? 'text-success' : yieldPct >= 60 ? 'text-warn' : 'text-danger')}>
                    {fmtPct(yieldPct, 0)}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-black uppercase tracking-wide text-ink-3 mb-1.5">Wydajność</div>
                    <div className="h-2.5 bg-surface-4 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', yieldPct >= 75 ? 'bg-success' : yieldPct >= 60 ? 'bg-warn' : 'bg-danger')}
                        style={{ width: `${Math.min(100, yieldPct)}%` }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-ink-4 text-center text-base px-4">
                  {!selBatch ? 'Wybierz partię' : !selWorker ? 'Wybierz pracownika' : 'Wpisz wagę ćwiartki i mięsa'}
                </div>
              )}
            </div>

            {/* Numpad */}
            <div className="flex flex-col">
              <Numpad onKey={pressKey} disabled={!selBatch || !selWorker} />
            </div>
          </div>

          {/* ZAPISZ */}
          <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
            className="h-[72px] flex-shrink-0 flex items-center justify-center gap-3 bg-brand text-white rounded-2xl text-2xl font-black shadow-[0_6px_22px_rgba(29,78,216,.35)] active:scale-[.98] transition-all disabled:opacity-40 disabled:shadow-none">
            {addLoading ? <span className="w-7 h-7 border-[3px] border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={28} />}
            ZAPISZ WPIS
          </button>
        </div>
      </div>

      {/* Pasek dolny: wpisy dziś + akcje */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-t border-surface-4 flex-shrink-0">
        <span className="text-xs font-black uppercase tracking-widest text-ink-3 flex-shrink-0">Dziś</span>
        <EntriesStrip entries={entries} />
        <button type="button" onClick={handleFinishBatch} disabled={pendingFinalize.length === 0}
          className="flex-shrink-0 flex items-center gap-2 h-12 px-4 bg-warn text-white rounded-2xl text-base font-bold active:scale-95 transition-transform disabled:opacity-40">
          <Flag size={18} /> Zakończ partię
        </button>
        <button type="button" onClick={() => setShiftModal(true)}
          className="flex-shrink-0 flex items-center gap-2 h-12 px-4 bg-white border-2 border-surface-4 text-ink-2 rounded-2xl text-base font-bold hover:border-danger hover:text-danger active:scale-95 transition-all">
          <LogOut size={18} /> Zakończ zmianę
        </button>
      </div>

      {/* Modal: zakończenie partii — kości i grzbiety */}
      {finishModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-ink/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-xl p-7">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-warn-light rounded-2xl flex items-center justify-center"><Flag size={28} className="text-warn" /></div>
              <div>
                <h3 className="text-2xl font-black text-ink">Zakończenie partii</h3>
                <p className="text-base text-ink-3">{pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki</p>
              </div>
            </div>
            {batchSuggestion && (
              <div className="flex items-start gap-2 bg-brand-light border border-brand-border px-4 py-3 rounded-2xl mb-4 text-sm text-brand">
                <Info size={18} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-black mb-0.5">Sugestia (z sumy wpisów)</div>
                  Grzbiety ~{batchSuggestion.kgBacks.toFixed(2)} kg · Kości ~{batchSuggestion.kgBones.toFixed(2)} kg
                  <div className="text-xs text-brand/70 mt-0.5">Wpisz faktycznie zważone wartości</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-5">
              {[
                { label: 'Grzbiety (kg)', val: inputBacks, set: setInputBacks },
                { label: 'Kości (kg)', val: inputBones, set: setInputBones },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-sm font-black uppercase tracking-wide text-ink-3 block mb-1.5">{f.label}</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={f.val}
                    onChange={e => f.set(e.target.value)}
                    className="w-full h-20 px-4 text-4xl font-black text-ink rounded-2xl border-[3px] border-surface-4 focus:outline-none focus:border-brand tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)}
                className="flex-1 h-16 rounded-2xl bg-surface-2 font-bold text-lg text-ink-2 border-2 border-surface-4">Anuluj</button>
              <button type="button" onClick={handleFinishConfirm}
                className="flex-[2] h-16 rounded-2xl bg-warn text-white font-black text-lg flex items-center justify-center gap-2"><Flag size={22} /> Potwierdź i zakończ</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: zakończ zmianę */}
      {shiftModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-ink/50 backdrop-blur-sm" onClick={() => setShiftModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-md p-7" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 bg-danger-light rounded-2xl flex items-center justify-center"><LogOut size={28} className="text-danger" /></div>
              <h3 className="text-2xl font-black text-ink">Zakończyć zmianę?</h3>
            </div>
            <p className="text-lg text-ink-3 mb-6">Sesja zostanie zamknięta. Biuro zatwierdzi dane.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)}
                className="flex-1 h-16 rounded-2xl bg-surface-2 text-ink-2 font-bold text-lg border-2 border-surface-4 flex items-center justify-center gap-2"><X size={22} /> Anuluj</button>
              <button type="button" disabled={closeLoading}
                onClick={async () => { setShiftModal(false); const err = await closeDay(); if (err) showToast(err, 'error'); else showToast('Zmiana zakończona') }}
                className="flex-1 h-16 rounded-2xl bg-danger text-white font-black text-lg disabled:opacity-50 flex items-center justify-center gap-2"><LogOut size={22} /> Zakończ</button>
            </div>
          </div>
        </div>
      )}

      <HmiToast msg={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
