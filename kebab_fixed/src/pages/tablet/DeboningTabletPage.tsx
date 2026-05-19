/**
 * DeboningTabletPage v6
 *
 * Zmiany v6:
 * - Kości/grzbiety TYLKO przy zakończeniu partii (przycisk "Zakończ partię")
 * - Podczas pracy operator wpisuje tylko kg ćwiartki i kg mięsa (szybko, wielokrotnie)
 * - Sugestia kości/grzbietów pokazuje sumę z wszystkich wpisów danej partii
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Toast, Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, fmtDatePl, cn, calcDeboning } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  AlertTriangle, RotateCcw, Save, CheckCircle, Package,
  LogOut, Pencil, Play, Lock, Info, Flag,
} from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'
import { InstallIosHint } from '@/features/pwa/InstallIosHint'
import { usePwaPage } from '@/features/pwa/usePwaPage'

const KG_PER_CONTAINER = 15

const BATCH_PAL = [
  { idle:'bg-blue-50 border-blue-200',   sel:'bg-brand border-brand text-white'          },
  { idle:'bg-green-50 border-green-200', sel:'bg-success border-success text-white'       },
  { idle:'bg-amber-50 border-amber-200', sel:'bg-warn border-warn text-white'             },
  { idle:'bg-purple-50 border-purple-200',sel:'bg-purple-600 border-purple-600 text-white'},
  { idle:'bg-sky-50 border-sky-200',     sel:'bg-sky-600 border-sky-600 text-white'       },
]
const WORKER_PAL = [
  {bg:'#EEF1FD',color:'#2F4AC9'},{bg:'#F0FDF4',color:'#166534'},
  {bg:'#FFFBEB',color:'#92400E'},{bg:'#FDF4FF',color:'#7E22CE'},
  {bg:'#FFF5F5',color:'#991B1B'},{bg:'#F0F9FF',color:'#075985'},
]

function ExpiryBadgeLocal({ date, selected }: { date: string; selected: boolean }) {
  const d = getExpiryStatus(date).daysLeft
  const base = 'text-[10px] font-bold px-2 py-0.5 rounded-full mt-1'
  if (d < 0)   return <span className={cn(base, selected?'bg-white/20 text-white':'bg-danger-light text-danger')}>Wygasła</span>
  if (d === 0) return <span className={cn(base, selected?'bg-white/20 text-white':'bg-danger-light text-danger')}>Dziś!</span>
  if (d <= 2)  return <span className={cn(base, selected?'bg-white/20 text-white':'bg-warn-light text-warn')}>⚠ {d}d</span>
  return             <span className={cn(base, selected?'bg-white/20 text-white':'bg-success-light text-success')}>{d}d</span>
}

function SecHeader({ label, selected }: { label: string; selected?: string }) {
  return (
    <div className="flex items-center gap-3 mt-6 mb-3">
      <span className="text-[11px] font-bold uppercase tracking-widest text-ink-3 whitespace-nowrap">{label}</span>
      {selected && (
        <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-success-light text-success border border-success-border whitespace-nowrap">
          <CheckCircle size={10} /> {selected}
        </span>
      )}
      <span className="flex-1 h-px bg-surface-4" />
    </div>
  )
}

function BlockScreen({ icon, title, subtitle, action }: {
  icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 text-center max-w-sm mx-auto">
      <div className="w-20 h-20 rounded-full bg-surface-3 flex items-center justify-center mb-5 text-ink-4">{icon}</div>
      <h2 className="text-2xl font-black text-ink mb-2">{title}</h2>
      <p className="text-base text-ink-3 mb-6 leading-relaxed">{subtitle}</p>
      {action}
    </div>
  )
}

// ─── BatchTile (memoized) ─────────────────────────────────────────
// Wyciągnięte z mapy `batches.map(...)` żeby zatrzymać re-render gdy
// inne partie/state się zmieniają. React.memo + stabilny onSelect → tylko
// faktyczna zmiana wartości tile'a powoduje re-render.
interface BatchTileProps {
  batch: RawBatch
  selected: boolean
  paletteIdx: number
  entryCount: number
  onSelect: (b: RawBatch) => void
}
const BatchTile = memo(function BatchTile({ batch, selected, paletteIdx, entryCount, onSelect }: BatchTileProps) {
  const pal = BATCH_PAL[paletteIdx % BATCH_PAL.length]
  const supplier = batch.supplierDisplayName || batch.supplierName || '—'
  const kg = Number(batch.kgAvailable)
  const containers = Math.floor(kg / KG_PER_CONTAINER)
  const remainderKg = Math.round((kg % KG_PER_CONTAINER) * 10) / 10
  return (
    <button type="button" onClick={() => onSelect(batch)}
      className={cn('flex flex-col items-center justify-center gap-1 p-3 rounded-2xl border-2 min-h-[100px] text-center transition-colors active:scale-95 select-none',
        selected ? pal.sel : cn('bg-white', pal.idle, 'hover:shadow-md'))}>
      <div className={cn('text-[11px] font-bold uppercase truncate max-w-full leading-tight', selected?'text-white/90':'text-ink-3')}>{supplier}</div>
      <div className={cn('text-lg font-black font-mono leading-none', selected?'text-white':'text-ink')}>{batch.internalBatchNo}</div>
      <div className={cn('text-xs font-semibold leading-tight', selected?'text-white/80':'text-ink-3')}>
        {fmtKg(kg, 1)} kg · {containers} poj.{remainderKg > 0 ? ` + ${fmtKg(remainderKg, 1)} kg` : ''}
      </div>
      {entryCount > 0 && (
        <div className={cn('text-[10px] font-semibold', selected?'text-white/70':'text-green-600')}>
          {entryCount} wpis{entryCount > 1 ? 'y' : ''}
        </div>
      )}
      <ExpiryBadgeLocal date={batch.expiryDate} selected={selected} />
    </button>
  )
})

// ─── WorkerTile (memoized) ────────────────────────────────────────
interface WorkerTileProps {
  worker: User
  selected: boolean
  paletteIdx: number
  onSelect: (w: User) => void
}
const WorkerTile = memo(function WorkerTile({ worker, selected, paletteIdx, onSelect }: WorkerTileProps) {
  const pal = WORKER_PAL[paletteIdx % WORKER_PAL.length]
  const init = worker.name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className={cn('flex flex-col items-center justify-center gap-1.5 py-4 px-2 rounded-2xl border-2 min-h-[88px] text-center transition-colors active:scale-95 select-none',
        selected ? 'bg-brand border-brand shadow-md' : 'bg-white border-surface-4 hover:shadow-md')}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black"
        style={selected ? {background:'rgba(255,255,255,.2)',color:'#fff'} : {background:pal.bg,color:pal.color}}>
        {init}
      </div>
      <div className={cn('text-xs font-bold leading-tight', selected?'text-white':'text-ink')}>{worker.name}</div>
    </button>
  )
})

export function DeboningTabletPage() {
  usePwaPage({
    title: 'Rozbiór — Kebab MES',
    appleTitle: 'Rozbiór',
    manifestPath: '/manifest-rozbior.json',
    appleTouchIcon: '/icons/apple-touch-icon-180.png',
  })
  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())

  const { session, timeWindow, loading: sessionLoading, startDay, closeDay, startLoading, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,   setSelBatch]   = useState<RawBatch | null>(null)
  const [selWorker,  setSelWorker]  = useState<User | null>(null)
  const [kgTaken,    setKgTaken]    = useState('')
  const [kgMeat,     setKgMeat]     = useState('')

  // Modal kości/grzbietów — pojawia się TYLKO przy zakończeniu partii
  const [finishModal,   setFinishModal]   = useState(false)
  const [inputBacks,    setInputBacks]    = useState('')
  const [inputBones,    setInputBones]    = useState('')

  const [editEntry_s, setEditEntry_s] = useState<DeboningEntry | null>(null)
  const [shiftModal,  setShiftModal]  = useState(false)
  const [toast, setToast] = useState({ msg:'', type:'success' as 'success'|'error', visible:false })
  const cwRef = useRef<HTMLInputElement>(null)

  // Synchronizuj selBatch z odświeżonymi danymi (kgAvailable po zapisie)
  useEffect(() => {
    if (!selBatch) return
    const updated = (batchData.data?.data ?? []).find(b => b.id === selBatch.id)
    if (updated && updated.kgAvailable !== selBatch.kgAvailable) setSelBatch(updated)
  }, [batchData.data])

  // useMemo: stabilna referencja zfiltrowanych/posortowanych list — bez tego
  // każdy re-render parent (np. zmiana kgTaken state) produkuje nowy array,
  // co psuje memoization tile'i.
  const batches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      // FEFO: ta sama data ważności → niższy numer partii (starszy) idzie pierwszy
      .sort((a, b) => {
        if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
        return (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)
      }),
    [batchData.data])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  // Mapa batchId → liczba wpisów (do BatchTile, żeby nie liczyć w mapie inline)
  const entryCountByBatchId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.rawBatchId, (m.get(e.rawBatchId) ?? 0) + 1)
    return m
  }, [entries])

  const taken    = parseFloat(kgTaken) || 0
  const meat     = parseFloat(kgMeat)  || 0

  // BUGFIX: kgAvailable z bazy jest już odejmowane po każdym zapisie przez backend.
  // Wyświetlamy aktualne kgAvailable — backend pilnuje nieprzekroczenia stanu.
  const kgAvailableNow = Number(selBatch?.kgAvailable ?? 0)
  const isOver   = taken > 0 && !!selBatch && taken > kgAvailableNow + 0.01
  const canSave  = !!selBatch && !!selWorker && taken > 0 && meat > 0 && meat <= taken && !isOver
  const yieldPct = taken > 0 && meat > 0 && meat <= taken ? (meat / taken) * 100 : 0

  // Wpisy bieżącej partii w tej sesji
  const batchEntries = selBatch
    ? entries.filter(e => e.rawBatchId === selBatch.id)
    : []
  const batchTotalTaken = batchEntries.reduce((s, e) => s + e.kgTaken, 0)
  const batchTotalMeat  = batchEntries.reduce((s, e) => s + e.kgMeat,  0)

  // Wpisy do zamknięcia kośćmi/grzbietami: wszystkie w bieżącej sesji bez wpisanych
  // kg_backs i kg_bones. Pokrywa też przypadek dwóch partii z tej samej dostawy
  // rozbieranych po sobie — operator klika "Zakończ partię" raz na końcu.
  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)
  const finalizeTotalMeat  = pendingFinalize.reduce((s, e) => s + e.kgMeat, 0)
  const batchSuggestion = finalizeTotalTaken > 0 && finalizeTotalMeat > 0
    ? calcDeboning(finalizeTotalTaken, finalizeTotalMeat)
    : null

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000)
  }

  // useCallback: stabilna referencja onClick → React.memo na BatchTile/WorkerTile
  // może efektywnie zatrzymywać re-rendery tile'ów. Bez tego każdy render parenta
  // tworzy nową funkcję → memo nieskuteczne → mruganie listy.
  //
  // preventScroll: true — focus bez auto-scrolla do inputa.
  // Bez tego po wyborze partii ekran skakał w dół do pola "kg ćwiartki"
  // (browser default behaviour focusa).
  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat('')
    setTimeout(() => cwRef.current?.focus({ preventScroll: true }), 120)
  }, [])
  const pickWorker = useCallback((w: User) => {
    setSelWorker(w)
    setTimeout(() => cwRef.current?.focus({ preventScroll: true }), 120)
  }, [])
  function reset() {
    setSelBatch(null); setSelWorker(null); setKgTaken(''); setKgMeat('')
    setEditEntry_s(null); setFinishModal(false)
  }

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'error')
    else showToast('Dzień produkcyjny rozpoczęty')
  }

  // Zapisz kg mięsa — modal kości/grzbietów otwierany TYLKO ręcznie przez "Zakończ partię".
  // Auto-open po zużyciu pełnej raw_batch został usunięty: gdy z jednej dostawy było wiele
  // połączonych partii, modal odpalał się po każdej z osobna, a operator wpisywał za każdym razem
  // sumaryczne kg → kości/grzbiety były policzone wielokrotnie (zdublowane ilości).
  async function handleSave() {
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate,
    )
    if (err) { showToast(err, 'error'); return }
    batchData.refetch()

    const totalTaken = batchEntries.reduce((s, e) => s + e.kgTaken, 0) + taken
    const batchKg    = Number(selBatch.kgAvailable)
    const isFullyUsed = batchKg > 0 && totalTaken >= batchKg - 0.1

    setKgTaken(''); setKgMeat('')

    if (isFullyUsed) {
      showToast(`✓ Ćwiartka ${selBatch.internalBatchNo} rozebrana — kliknij "Zakończ partię" gdy wpiszesz wszystkie partie z dostawy`)
    } else {
      showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
    }
    setTimeout(() => cwRef.current?.focus({ preventScroll: true }), 100)
  }

  // Zakończ partię — otwiera modal kości/grzbietów dla wszystkich niezakończonych wpisów
  function handleFinishBatch() {
    if (pendingFinalize.length === 0) {
      showToast('Brak wpisów do zakończenia', 'error')
      return
    }
    setInputBacks(batchSuggestion ? batchSuggestion.kgBacks.toFixed(2) : '')
    setInputBones(batchSuggestion ? batchSuggestion.kgBones.toFixed(2) : '')
    setFinishModal(true)
  }

  // Potwierdź kości/grzbiety — rozkładamy proporcjonalnie do kg_taken na każdy
  // niezakończony wpis, żeby:
  //  * suma kg_backs/kg_bones w raportach była dokładnie tym, co operator wpisał (bez dublowania),
  //  * każda partia (raw_batch) z dostawy została fizycznie zamknięta (kg_backs/kg_bones>0),
  //    więc nie wpadnie ponownie do pendingFinalize przy kolejnym kliknięciu.
  async function handleFinishConfirm() {
    if (!session) return
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) {
      showToast('Wpisz kości lub grzbiety > 0', 'error')
      return
    }
    const toFinalize = pendingFinalize
    if (toFinalize.length === 0) {
      setFinishModal(false)
      return
    }
    const sumTaken = toFinalize.reduce((s, e) => s + e.kgTaken, 0) || 1
    let runningBacks = 0
    let runningBones = 0
    for (let i = 0; i < toFinalize.length; i++) {
      const e = toFinalize[i]
      const isLast = i === toFinalize.length - 1
      const share = e.kgTaken / sumTaken
      const kb = isLast
        ? Math.round((kbTotal - runningBacks) * 100) / 100
        : Math.round(kbTotal * share * 100) / 100
      const kn = isLast
        ? Math.round((knTotal - runningBones) * 100) / 100
        : Math.round(knTotal * share * 100) / 100
      runningBacks += kb
      runningBones += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }

    setFinishModal(false)
    showToast(`Zakończono ${toFinalize.length} ${toFinalize.length === 1 ? 'wpis' : 'wpisów'} (${fmtKg(kbTotal,2)} kg grzbietów, ${fmtKg(knTotal,2)} kg kości)`)
    setSelBatch(null); setKgTaken(''); setKgMeat('')
  }

  async function handleUpdateEntry() {
    if (!editEntry_s || !session) return
    const err = await editEntry(editEntry_s.id,
      { kgTaken: parseFloat(kgTaken)||0, kgMeat: parseFloat(kgMeat)||0 }, session)
    if (err) { showToast(err, 'error'); return }
    showToast('Wpis zaktualizowany')
    setEditEntry_s(null); setKgTaken(''); setKgMeat('')
    batchData.refetch()
  }

  if (sessionLoading) return (
    <div className="flex items-center justify-center min-h-screen"><Spinner size={32} /></div>
  )

  if (!session) {
    return (
      <BlockScreen icon={<Play size={40} />} title="Rozpocznij dzień"
        subtitle={`Data produkcyjna: ${timeWindow.productionDate}`}
        action={
          <button type="button" onClick={handleStartDay} disabled={startLoading}
            className="w-full max-w-xs h-16 bg-brand text-white rounded-2xl text-lg font-bold flex items-center justify-center gap-3 active:scale-95">
            {startLoading ? <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={22} />}
            Rozpocznij dzień
          </button>
        }
      />
    )
  }

  if (session.status === 'closed' || session.status === 'approved') {
    return (
      <BlockScreen icon={<Lock size={40} />}
        title={session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}
        subtitle={session.status === 'approved'
          ? `Dane z dnia ${session.sessionDate} zablokowane.`
          : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'} />
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-5 py-5 pb-10">

      {/* Status sesji */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-sm font-bold text-success">SESJA OTWARTA</span>
          <span className="text-xs text-ink-3">{session.sessionDate}</span>
        </div>
        <span className="text-sm font-mono font-semibold text-ink-3">{timeWindow.currentTimeHHMM}</span>
      </div>

      {/* FEFO alerty */}
      {batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 2).map(b => {
        const d = getExpiryStatus(b.expiryDate).daysLeft
        return (
          <div key={b.id} className={cn('flex items-start gap-2 px-4 py-3 rounded-xl mb-3 text-sm font-medium border',
            d <= 0 ? 'bg-danger-light border-danger-border text-danger' : 'bg-warn-light border-warn-border text-warn')}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            Partia <strong>{b.internalBatchNo}</strong> — {d < 0 ? 'PRZETERMINOWANA!' : d === 0 ? 'wygasa DZIŚ!' : `${d} dni`} · {fmtKg(b.kgAvailable)} kg
          </div>
        )
      })}

      {/* ① PARTIA */}
      <SecHeader label="Partia do rozbioru" selected={selBatch ? `✓ ${selBatch.internalBatchNo}` : undefined} />
      {batchData.loading
        ? <div className="flex justify-center py-8"><Spinner size={32} /></div>
        : batches.length === 0
          ? <div className="text-center py-8 text-sm text-ink-3"><Package size={32} className="mx-auto mb-2 text-ink-5" /><p>Brak partii.</p></div>
          : <div className={cn('grid gap-2.5 mb-3', batches.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
              {batches.map((b, i) => (
                <BatchTile
                  key={b.id}
                  batch={b}
                  selected={selBatch?.id === b.id}
                  paletteIdx={i}
                  entryCount={entryCountByBatchId.get(b.id) ?? 0}
                  onSelect={pickBatch}
                />
              ))}
            </div>
      }

      {selBatch && (
        <div className="bg-gradient-to-br from-brand-light to-white border-2 border-brand-border rounded-xl p-4 mb-3">
          <div className="text-[10px] font-bold text-brand uppercase tracking-wide mb-2">
            Partia {selBatch.internalBatchNo} — traceability
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label:'Dostępne', val: fmtKg(selBatch.kgAvailable, 1), unit:'kg' },
              { label:'Pojemniki', val: Math.floor(Number(selBatch.kgAvailable)/15), unit:'×15kg' },
              { label:'Data uboju', val: fmtDatePl(selBatch.slaughterDate), unit:'' },
              { label:'Ważność', val: fmtDatePl(selBatch.expiryDate), unit:'' },
            ].map(r => (
              <div key={r.label}>
                <div className="text-[9px] font-bold uppercase text-ink-3 mb-0.5">{r.label}</div>
                <div className="text-sm font-semibold text-ink leading-none">{r.val}</div>
                {r.unit && <div className="text-[10px] text-ink-3">{r.unit}</div>}
              </div>
            ))}
          </div>
          {selBatch.supplierName && (
            <div className="mt-2 text-[10px] text-ink-3">
              Dostawca: <strong>{selBatch.supplierName}</strong>
              {selBatch.supplierBatchNo && ` · Nr partii: ${selBatch.supplierBatchNo}`}
            </div>
          )}

          {/* Suma wpisów bieżącej partii + przycisk zakończenia */}
          {batchEntries.length > 0 && (
            <div className="mt-3 pt-2 border-t border-brand-border">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-brand font-semibold">
                  {batchEntries.length} wpis{batchEntries.length > 1 ? 'y' : ''} tej partii:
                  {' '}{fmtKg(batchTotalTaken, 1)} kg ćw. → {fmtKg(batchTotalMeat, 1)} kg mięsa
                  {' '}({fmtPct(batchTotalMeat/batchTotalTaken*100, 1)} wydajność)
                </div>
                <button type="button" onClick={handleFinishBatch}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-xl active:scale-95 transition-all">
                  <Flag size={12} /> Zakończ partię
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ② PRACOWNIK */}
      <SecHeader label="Wybierz pracownika" selected={selWorker?.name} />
      {workerData.loading
        ? <div className="flex justify-center py-6"><Spinner size={28} /></div>
        : <div className={cn('grid gap-2 mb-2',
            workers.length <= 3 ? `grid-cols-${Math.max(2,workers.length)}` : workers.length <= 6 ? 'grid-cols-3' : 'grid-cols-4')}>
            {workers.map((w, i) => (
              <WorkerTile
                key={w.id}
                worker={w}
                selected={selWorker?.id === w.id}
                paletteIdx={i}
                onSelect={pickWorker}
              />
            ))}
          </div>
      }

      {/* ③ KG — szybki wpis */}
      <div className={cn('transition-all duration-300', selBatch && selWorker ? 'opacity-100 pointer-events-auto' : 'opacity-40 pointer-events-none')}>
        <SecHeader label="Kilogramy" />
        <div className="flex flex-col gap-3 mb-3">
          <div className={cn('bg-white border-2 rounded-2xl px-5 py-4 transition-colors',
            isOver ? 'border-danger bg-danger-light' : kgTaken ? 'border-brand' : 'border-surface-4')}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">Ćwiartka pobrana</div>
            <div className="flex items-baseline gap-2">
              <input ref={cwRef} type="number" inputMode="decimal" min="0" step="0.1" placeholder="0" value={kgTaken}
                onChange={e => setKgTaken(e.target.value)}
                className={cn('flex-1 min-w-0 border-none bg-transparent outline-none text-[64px] font-black tabular-nums leading-none',
                  isOver ? 'text-danger' : 'text-ink',
                  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none')} />
              <span className="text-2xl font-medium text-ink-3">kg</span>
            </div>
            {/* BUGFIX: błąd widoczny w ramce podczas wpisywania */}
            {isOver && (
              <div className="mt-2 flex items-center gap-2 bg-danger text-white rounded-xl px-3 py-2">
                <span className="text-lg">⛔</span>
                <div>
                  <div className="text-[13px] font-black">Za dużo!</div>
                  <div className="text-[11px] font-semibold">
                    Dostępne tylko {fmtKg(kgAvailableNow)} kg w partii {selBatch?.internalBatchNo}
                  </div>
                </div>
              </div>
            )}
            {!isOver && taken > 0 && (() => {
              const takenContainers = Math.floor(taken / KG_PER_CONTAINER)
              const takenRemainder  = Math.round((taken % KG_PER_CONTAINER) * 10) / 10
              return (
                <div className="mt-2 bg-brand-light border border-brand-border rounded-xl px-3 py-2">
                  <div className="text-[13px] font-bold text-brand">
                    {takenContainers} poj.{takenRemainder > 0 ? ` + ${fmtKg(takenRemainder, 1)} kg` : ''}
                  </div>
                  {kgAvailableNow > 0 && (
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      Zostanie: <strong>{fmtKg(Math.max(0, kgAvailableNow - taken))} kg</strong> z {fmtKg(kgAvailableNow)} kg
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
          <div className={cn('bg-white border-2 rounded-2xl px-5 py-4 transition-colors', kgMeat?'border-brand':'border-surface-4')}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">Mięso Z/S</div>
            <div className="flex items-baseline gap-2">
              <input type="number" inputMode="decimal" min="0" step="0.1" placeholder="0" value={kgMeat}
                onChange={e => setKgMeat(e.target.value)}
                className="flex-1 min-w-0 border-none bg-transparent outline-none text-[64px] font-black tabular-nums leading-none text-ink [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="text-2xl font-medium text-ink-3">kg</span>
            </div>
          </div>
        </div>

        {yieldPct > 0 && meat <= taken && (
          <div className="bg-white border-2 border-success-border rounded-xl p-4 flex items-center gap-5 mb-3">
            <div className={cn('text-5xl font-black leading-none tabular-nums',
              yieldPct >= 75 ? 'text-success' : yieldPct >= 60 ? 'text-warn' : 'text-danger')}>
              {fmtPct(yieldPct, 1)}
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">Wydajność</div>
              <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full', yieldPct >= 75?'bg-success':yieldPct >= 60?'bg-warn':'bg-danger')}
                  style={{ width:`${Math.min(100,yieldPct)}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Przycisk Zapisz — bez modalu kości */}
        <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
          className="w-full h-14 flex items-center justify-center gap-3 bg-brand text-white rounded-2xl text-base font-bold shadow-[0_4px_18px_rgba(29,78,216,.3)] hover:-translate-y-0.5 active:scale-[.98] transition-all disabled:opacity-50">
          {addLoading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
          Zapisz wpis
        </button>

        <button type="button" onClick={() => setShiftModal(true)}
          className="w-full h-11 mt-2.5 flex items-center justify-center gap-2 bg-white border-2 border-surface-4 text-ink-3 rounded-2xl text-sm font-semibold hover:border-danger hover:text-danger hover:bg-danger-light transition-all">
          <LogOut size={15} /> Zakończ zmianę
        </button>
      </div>

      {/* Wpisy z dziś */}
      <div className="flex items-center gap-3 mt-8 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-3">Wpisy z dziś</span>
        <span className="flex-1 h-px bg-surface-4" />
      </div>
      {entries.length === 0
        ? <div className="text-center py-5 text-sm text-ink-3">Brak wpisów z dziś</div>
        : <div className="space-y-2">
            {entries.map(s => (
              <div key={s.id} className="bg-white border border-surface-4 border-l-4 border-l-success rounded-xl px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink">{s.workerName}</span>
                      <span className="font-mono text-[11px] text-brand font-bold">{s.rawBatchNo}</span>
                      {s.meatLotNo && (
                        <span className="font-mono text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded">{s.meatLotNo}</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-3 mt-0.5">
                      {fmtKg(s.kgTaken,1)} kg ćw. → {fmtKg(s.kgMeat,1)} kg mięsa
                      {(s.kgBacks > 0 || s.kgBones > 0) && (
                        <span className="ml-1 text-orange-600">· grzbiety: {fmtKg(s.kgBacks,2)} · kości: {fmtKg(s.kgBones,2)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-sm font-black text-success bg-success-light border border-success-border rounded-lg px-2.5 py-1 tabular-nums">
                      {fmtPct(s.yieldPct)}
                    </div>
                    <button type="button" onClick={() => { setEditEntry_s(s); setKgTaken(String(s.kgTaken)); setKgMeat(String(s.kgMeat)) }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-surface-4 text-ink-3 hover:border-warn hover:text-warn">
                      <Pencil size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
      }

      {/* ─── Modal: Zakończenie partii — kości i grzbiety ──────── */}
      {finishModal && selBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                <Flag size={24} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-ink">Zakończenie partii</h3>
                <p className="text-sm text-ink-3">
                  Partia <strong className="text-brand">{selBatch.internalBatchNo}</strong>
                  {' '}· {batchEntries.length} wpisów · {fmtKg(batchTotalTaken, 1)} kg ćw.
                </p>
              </div>
            </div>

            {/* Sugestia z sumy wszystkich wpisów partii */}
            {batchSuggestion && (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 px-3 py-2.5 rounded-xl mb-4 text-[12px] text-blue-700">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold mb-0.5">Sugestia systemowa (z sumy wpisów)</div>
                  <div>Grzbiety: ~{batchSuggestion.kgBacks.toFixed(3)} kg
                    {' '}· Kości: ~{batchSuggestion.kgBones.toFixed(3)} kg</div>
                  <div className="text-[11px] text-blue-500 mt-0.5">Wpisz faktycznie zważone wartości</div>
                </div>
              </div>
            )}

            <div className="space-y-3 mb-5">
              {[
                { label:'Grzbiety (kg)', val:inputBacks, set:setInputBacks, color:'text-orange-600' },
                { label:'Kości (kg)',    val:inputBones, set:setInputBones, color:'text-amber-600'  },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-ink-3 block mb-1.5">{f.label}</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={f.val}
                    onChange={e => f.set(e.target.value)}
                    className={`w-full h-16 px-4 text-3xl font-bold ${f.color} rounded-xl border-2 border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} />
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => {
                if (batchSuggestion) {
                  setInputBacks(batchSuggestion.kgBacks.toFixed(2))
                  setInputBones(batchSuggestion.kgBones.toFixed(2))
                }
              }}
                className="flex-1 h-12 rounded-xl bg-blue-50 font-semibold text-sm text-blue-700 border border-blue-200">
                Użyj sugestii
              </button>
              <button type="button" onClick={handleFinishConfirm}
                className="flex-1 h-12 rounded-xl bg-amber-500 text-white font-bold text-sm">
                Potwierdź i zakończ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal edycji wpisu ─────────────────────────────────── */}
      {editEntry_s && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 bg-warn-light rounded-2xl flex items-center justify-center">
                <Pencil size={24} className="text-warn" />
              </div>
              <div>
                <h3 className="text-lg font-black text-ink">Edytuj wpis</h3>
                <p className="text-sm text-ink-3 font-mono">{editEntry_s.rawBatchNo} · {editEntry_s.meatLotNo ?? '—'}</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              {[{label:'Ćwiartka (kg)',val:kgTaken,set:setKgTaken},{label:'Mięso (kg)',val:kgMeat,set:setKgMeat}].map(f => (
                <div key={f.label}>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-ink-3 block mb-1.5">{f.label}</label>
                  <input type="number" inputMode="decimal" min="0" step="0.1" value={f.val}
                    onChange={e => f.set(e.target.value)}
                    className="w-full h-14 px-4 text-2xl font-bold rounded-xl border-2 border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setEditEntry_s(null); setKgTaken(''); setKgMeat('') }}
                className="flex-1 h-12 rounded-xl bg-surface-2 font-bold text-sm text-ink-2 border border-surface-4">Anuluj</button>
              <button type="button" onClick={handleUpdateEntry}
                className="flex-1 h-12 rounded-xl bg-warn text-white font-bold text-sm">Zapisz</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal zakończ zmianę ──────────────────────────────── */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
          onClick={() => setShiftModal(false)}>
          <div className="bg-white rounded-2xl shadow-modal w-full max-w-sm p-7" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink mb-2">Zakończyć zmianę?</h3>
            <p className="text-sm text-ink-3 mb-5">Sesja zostanie zamknięta. Biuro zatwierdzi dane.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShiftModal(false)}
                className="flex-1 h-11 rounded-xl bg-surface-2 text-ink-2 font-semibold text-sm border border-surface-4">Anuluj</button>
              <button type="button" onClick={async () => {
                setShiftModal(false)
                const err = await closeDay()
                if (err) showToast(err, 'error')
                else showToast('Zmiana zakończona')
              }} disabled={closeLoading}
                className="flex-1 h-11 rounded-xl bg-brand text-white font-bold text-sm disabled:opacity-50">
                Zakończ zmianę
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
      <InstallIosHint appKey="rozbior" appName="Rozbiór" />
    </div>
  )
}
