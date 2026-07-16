/**
 * EntryFixDialogs — modale korekt wpisu rozbioru z biura, wspólne dla
 * Statystyk rozbioru (feed) i Panelu rozbioru (kontrola per partia):
 *
 * - EntryCorrectionDialog: pracownik i/lub kg. Działa TAKŻE na zatwierdzonej
 *   zmianie (wpisy starsze niż dziś zawsze w niej są), dlatego powód jest
 *   WYMAGANY i razem z historią korekt widoczny przy wpisie.
 * - ChangeBatchDialog: przeniesienie wpisu na inną partię surowca.
 *
 * Wpis przychodzi z dwóch różnych źródeł (stats.recent vs /entries), więc
 * pola normalizujemy: kgQuarter|kgTaken, at|completedAt|createdAt; feed
 * statystyk nie niesie workerId — wtedy select startuje od nazwy z wpisu.
 */
import { useEffect, useState } from 'react'
import {
  deboningEntriesApi, rawBatchesApi, usersApi, type EntryCorrection,
} from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { AlertTriangle, ArrowLeftRight, History, Loader2, PencilLine } from 'lucide-react'

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function yieldTone(pct: number): string {
  if (pct >= 68) return 'text-emerald-600'
  if (pct >= 64) return 'text-amber-600'
  return 'text-red-600'
}

/** Wpis rozbioru w kształcie z feedu statystyk LUB z GET /entries. */
export interface FixableEntry {
  id: string
  workerName?: string
  workerId?: string
  rawBatchNo?: string
  kgQuarter?: number
  kgTaken?: number
  kgMeat?: number
  at?: string
  completedAt?: string | null
  createdAt?: string
}

const entryQuarter = (e: FixableEntry) => e.kgQuarter ?? e.kgTaken ?? 0
const entryAt = (e: FixableEntry) => e.at ?? e.completedAt ?? e.createdAt ?? ''

export function EntryCorrectionDialog({ entry, onClose, onSaved }: {
  entry: FixableEntry
  onClose: () => void
  onSaved: () => void
}) {
  const [worker, setWorker] = useState(entry.workerId ?? '')
  const [quarter, setQuarter] = useState(String(entryQuarter(entry) || ''))
  const [meat, setMeat] = useState(String(entry.kgMeat ?? ''))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [history, setHistory] = useState<EntryCorrection[]>([])
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => { usersApi.list().then(w => setWorkers(w as any)).catch(() => setWorkers([])) }, [])
  useEffect(() => {
    deboningEntriesApi.corrections(entry.id).then(setHistory).catch(() => setHistory([]))
  }, [entry.id])

  const q = parseFloat((quarter || '0').replace(',', '.')) || 0
  const m = parseFloat((meat || '0').replace(',', '.')) || 0
  const yieldPct = q > 0 ? (m / q) * 100 : 0
  const valid = reason.trim().length >= 3 && q > 0 && m > 0 && m <= q

  async function submit() {
    if (!valid) return
    setBusy(true); setErr('')
    try {
      await deboningEntriesApi.correct(entry.id, {
        workerId: worker || undefined,
        kgQuarter: q,
        kgMeat: m,
        reason: reason.trim(),
      })
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się zapisać korekty')
    } finally {
      setBusy(false)
    }
  }

  const when = entryAt(entry)
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine size={16} className="text-brand" />
            Popraw wpis
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="text-[12px] text-ink-3">
            Partia <code className="font-mono bg-brand/10 text-brand px-1 rounded">{entry.rawBatchNo}</code>
            {when && <> · {new Date(when).toLocaleString('pl-PL')}</>}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase text-ink-4">Pracownik</span>
            <select value={worker} onChange={e => setWorker(e.target.value)}
              className="h-9 px-2 text-[13px] rounded border border-surface-4 bg-surface-1">
              {!workers.some(w => w.id === worker) && (
                <option value={worker}>{entry.workerName ?? '—'}</option>
              )}
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase text-ink-4">Ćwiartka [kg]</span>
              <input value={quarter} onChange={e => setQuarter(e.target.value)} inputMode="decimal"
                className="h-9 px-2 text-[13px] tabular-nums rounded border border-surface-4 bg-surface-1" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase text-ink-4">Mięso [kg]</span>
              <input value={meat} onChange={e => setMeat(e.target.value)} inputMode="decimal"
                className="h-9 px-2 text-[13px] tabular-nums rounded border border-surface-4 bg-surface-1" />
            </label>
          </div>
          <div className="text-[12px] text-ink-3">
            Uzysk po korekcie:{' '}
            <span className={cn('font-black tabular-nums', yieldTone(yieldPct))}>{nf1.format(yieldPct)}%</span>
            {m > q && <span className="text-red-600 font-semibold"> — mięso nie może przekraczać ćwiartki</span>}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase text-ink-4">Powód korekty *</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="np. pomyłka operatora — Adrian zamiast Raschada"
              className="h-9 px-2 text-[13px] rounded border border-surface-4 bg-surface-1" />
          </label>

          <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            <span>Korekta zmieni wstecz akord pracownika i statystyki. Powód trafi do historii wpisu.</span>
          </div>

          {history.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-surface-3">
              <span className="text-[11px] font-bold uppercase text-ink-4 flex items-center gap-1">
                <History size={12} /> Historia korekt
              </span>
              {history.map(h => (
                <div key={h.id} className="text-[11px] text-ink-3 leading-snug">
                  <span className="text-ink-4">{h.at ? new Date(h.at).toLocaleString('pl-PL') : '—'}</span>
                  {h.bySubject && <span className="text-ink-4"> · {h.bySubject}</span>}
                  {' — '}
                  {Object.entries(h.changes).map(([k, v]) => (
                    <span key={k} className="font-semibold">{k}: {String(v.from)} → {String(v.to)}; </span>
                  ))}
                  <span className="italic">„{h.reason}"</span>
                </div>
              ))}
            </div>
          )}

          {err && <div className="text-[12px] text-red-600 font-semibold">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={busy}
              className="h-9 px-3 text-[13px] font-semibold rounded border border-surface-4 text-ink-2 hover:bg-surface-2">
              Anuluj
            </button>
            <button onClick={submit} disabled={busy || !valid}
              className="h-9 px-3 text-[13px] font-bold rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <PencilLine size={14} />}
              Zapisz korektę
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ChangeBatchDialog({ entry, onClose, onSaved }: {
  entry: FixableEntry
  onClose: () => void
  onSaved: () => void
}) {
  const [batches, setBatches] = useState<any[]>([])
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    rawBatchesApi.all().then(p => setBatches(p.data ?? [])).catch(() => setBatches([]))
  }, [])

  async function submit() {
    if (!target) return
    setBusy(true); setErr('')
    try {
      await deboningEntriesApi.changeBatch(entry.id, target)
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się zmienić partii')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v && !busy) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand/10 text-brand"><ArrowLeftRight size={15} /></span>
            Zmień partię wpisu
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div className="rounded-lg bg-surface-2 border border-surface-4 px-3 py-2 text-ink-2">
            <b className="text-ink">{entry.workerName}</b> · mięso {nf1.format(entry.kgMeat ?? 0)} kg · obecna partia{' '}
            <code className="font-mono bg-brand/10 text-brand px-1 rounded">{entry.rawBatchNo}</code>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-4 mb-1">Nowa partia surowca</label>
            <select value={target} onChange={e => setTarget(e.target.value)}
              className="w-full h-9 px-2 text-[13px] border border-surface-4 rounded bg-white">
              <option value="">— wybierz partię —</option>
              {batches
                .filter(b => b.internalBatchNo !== entry.rawBatchNo)
                .map(b => (
                  <option key={b.id} value={b.id}>
                    {b.internalBatchNo}{(b.supplierDisplayName || b.supplierName) ? ` — ${b.supplierDisplayName || b.supplierName}` : ''} (wolne {nf0.format(b.kgAvailable)} kg)
                  </option>
                ))}
            </select>
          </div>
          <p className="text-[11px] text-ink-4">
            Ćwiartka wróci do obecnej partii i zejdzie z nowej; wyprodukowane mięso i produkty uboczne przejdą na nową partię. Wpis zostaje bez zmian (pracownik, kg, czas).
          </p>
          {err && <div className="text-[12px] text-red-600 font-semibold">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={busy}
              className="h-9 px-3 text-[13px] font-semibold rounded border border-surface-4 text-ink-2 hover:bg-surface-2">
              Anuluj
            </button>
            <button onClick={submit} disabled={busy || !target}
              className="h-9 px-3 text-[13px] font-bold rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              Zmień partię
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
