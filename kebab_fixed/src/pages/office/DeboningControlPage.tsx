/**
 * DeboningControlPage — Panel rozbioru: kontrola i korekty per PARTIA.
 *
 * Rola strony (decyzja właściciela 2026-07-16): statystyki zostają
 * statystykami, a to jest miejsce do KONTROLI — lista partii z aktywnością
 * rozbioru (nie dni! partia 411 szła 2 dni i feed dzienny gubił jej wpisy),
 * po rozwinięciu wszystkie wpisy partii z korektami: „Popraw" (pracownik/kg
 * + wymagany powód, działa też na zatwierdzonej zmianie) i „Zmień partię".
 * Uboczne zbiorcze (grzbiety/kości) tylko do wglądu w podsumowaniu.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { deboningEntriesApi, type DeboningPanelBatch } from '@/lib/api'
import { ChangeBatchDialog, EntryCorrectionDialog, type FixableEntry } from '@/features/deboning/EntryFixDialogs'
import { StatusBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  ArrowLeftRight, Bone, ChevronDown, ChevronRight, Clock3, Loader2,
  PencilLine, Search, Scissors,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function yieldTone(pct: number): string {
  if (pct >= 66) return 'text-emerald-600'
  if (pct >= 64) return 'text-ink'
  return 'text-amber-600'
}

const dayShort = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : '—'

/** Zakres dni aktywności partii: „15.07" albo „13.07–14.07". */
function activitySpan(b: DeboningPanelBatch): string {
  const f = dayShort(b.firstAt)
  const l = dayShort(b.lastAt)
  return f === l ? f : `${f}–${l}`
}

function SummaryChip({ label, value, unit, tone }: {
  label: string; value: string; unit?: string; tone?: string
}) {
  return (
    <div className="rounded-lg bg-surface-2 border border-surface-3 px-3 py-1.5 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-4">{label}</div>
      <div className={cn('text-[15px] font-black tabular-nums leading-tight', tone ?? 'text-ink')}>
        {value}{unit && <span className="text-[10px] text-ink-4 ml-0.5">{unit}</span>}
      </div>
    </div>
  )
}

export function DeboningControlPage() {
  const [batches, setBatches] = useState<DeboningPanelBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, any[]>>({})
  const [entriesLoading, setEntriesLoading] = useState<string | null>(null)

  const [fixEntry, setFixEntry] = useState<FixableEntry | null>(null)
  const [cbEntry, setCbEntry] = useState<FixableEntry | null>(null)

  const load = useCallback(() => {
    deboningEntriesApi.panel().then(setBatches).catch(() => setBatches([])).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const loadEntries = useCallback((rawBatchId: string) => {
    setEntriesLoading(rawBatchId)
    deboningEntriesApi.listByBatch(rawBatchId)
      .then(list => setEntries(prev => ({ ...prev, [rawBatchId]: list })))
      .catch(() => setEntries(prev => ({ ...prev, [rawBatchId]: [] })))
      .finally(() => setEntriesLoading(null))
  }, [])

  function toggle(b: DeboningPanelBatch) {
    const next = open === b.rawBatchId ? null : b.rawBatchId
    setOpen(next)
    if (next && !entries[next]) loadEntries(next)
  }

  // Po korekcie odśwież i listę partii (sumy), i wpisy rozwiniętej partii.
  const onSaved = useCallback(() => {
    load()
    if (open) loadEntries(open)
  }, [load, loadEntries, open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return batches
    return batches.filter(b =>
      (b.batchNo || '').toLowerCase().includes(needle) ||
      (b.supplierName || '').toLowerCase().includes(needle),
    )
  }, [batches, q])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Szukaj partii lub dostawcy…"
            className="w-full h-9 pl-8 pr-2 text-[13px] rounded border border-surface-4 bg-surface-1" />
        </div>
        <span className="text-[12px] text-ink-4">
          {filtered.length} {filtered.length === 1 ? 'partia' : 'partii'} z rozbiorem
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink-4">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-[13px] text-ink-4">
          Brak partii z aktywnością rozbioru{q ? ' dla tego wyszukiwania' : ''}.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(b => {
            const expanded = open === b.rawBatchId
            const list = entries[b.rawBatchId]
            return (
              <Card key={b.rawBatchId} className={cn(expanded && 'ring-1 ring-brand/30')}>
                <CardContent className="p-0">
                  <button type="button" onClick={() => toggle(b)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
                    {expanded ? <ChevronDown size={16} className="text-brand shrink-0" /> : <ChevronRight size={16} className="text-ink-4 shrink-0" />}
                    <Scissors size={15} className="text-ink-4 shrink-0" />
                    <code className="font-mono text-[14px] font-bold bg-brand/10 text-brand px-1.5 rounded shrink-0">{b.batchNo}</code>
                    <span className="text-[13px] font-semibold text-ink truncate">{b.supplierName || '—'}</span>
                    <span className="text-[12px] text-ink-4 tabular-nums shrink-0">{activitySpan(b)}</span>
                    {b.pendingCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                        <Clock3 size={11} /> {b.pendingCount} otwarte
                      </span>
                    )}
                    <span className="ml-auto shrink-0"><StatusBadge status={b.status} /></span>
                    <span className="text-[12px] text-ink-3 tabular-nums shrink-0 hidden sm:inline">
                      {nf0.format(b.kgQuarter)} kg ćw. · {b.entriesCount} wpisów
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t border-surface-3 px-4 py-3 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
                        <SummaryChip label="Ćwiartka pobrana" value={nf0.format(b.kgQuarter)} unit="kg" />
                        <SummaryChip label="Mięso" value={nf0.format(b.kgMeat)} unit="kg" tone="text-brand"
                        />
                        <SummaryChip label="Grzbiety" value={nf0.format(b.backsKg)} unit="kg" />
                        <SummaryChip label="Kości" value={nf0.format(b.bonesKg)} unit="kg" />
                        <SummaryChip label="Bilans masy"
                          value={b.balancePct != null ? nf1.format(b.balancePct) : '—'} unit="%"
                          tone={b.balancePct != null && (b.balancePct < 95 || b.balancePct > 105) ? 'text-red-600' : 'text-emerald-600'} />
                        <SummaryChip label="Na stanie" value={nf0.format(b.kgAvailable)} unit="kg" />
                        <SummaryChip label="Przyjęto" value={nf0.format(b.kgReceived)} unit="kg" />
                      </div>

                      {entriesLoading === b.rawBatchId ? (
                        <div className="flex items-center gap-2 py-4 text-ink-4 text-[13px]">
                          <Loader2 size={15} className="animate-spin" /> Wczytuję wpisy…
                        </div>
                      ) : (list ?? []).length === 0 ? (
                        <div className="py-3 text-[13px] text-ink-4">Brak wpisów.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[12.5px]">
                            <thead>
                              <tr className="text-[10.5px] font-bold uppercase tracking-wide text-ink-4 border-b border-surface-3">
                                <th className="text-left py-1.5 pr-3">Data</th>
                                <th className="text-left py-1.5 pr-3">Pracownik</th>
                                <th className="text-right py-1.5 pr-3">Ćwiartka</th>
                                <th className="text-right py-1.5 pr-3">Mięso</th>
                                <th className="text-right py-1.5 pr-3">Uzysk</th>
                                <th className="text-left py-1.5 pr-3">Status</th>
                                <th className="text-right py-1.5">Korekty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(list ?? []).map(e => {
                                const at = e.completedAt || e.createdAt
                                const pending = (e.status || 'complete') === 'pending'
                                return (
                                  <tr key={e.id} className="border-b border-surface-2 last:border-0">
                                    <td className="py-1.5 pr-3 tabular-nums text-ink-3 whitespace-nowrap">
                                      {at ? new Date(at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3 font-semibold text-ink">{e.workerName || '—'}</td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{nf1.format(e.kgTaken ?? 0)}</td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums font-bold text-brand">
                                      {pending ? '—' : nf1.format(e.kgMeat ?? 0)}
                                    </td>
                                    <td className={cn('py-1.5 pr-3 text-right tabular-nums font-black', yieldTone(e.yieldPct ?? 0))}>
                                      {pending ? '—' : `${nf1.format(e.yieldPct ?? 0)}%`}
                                    </td>
                                    <td className="py-1.5 pr-3">
                                      {pending
                                        ? <StatusBadge tone="amber" label="⏳ czeka na mięso" />
                                        : <StatusBadge tone="green" label="zważony" />}
                                    </td>
                                    <td className="py-1.5 text-right whitespace-nowrap">
                                      {/* Otwarte pobranie domyka HMI — korekta dopiero po zważeniu. */}
                                      {!pending && (
                                        <>
                                          <button onClick={() => setFixEntry(e)}
                                            title="Popraw pracownika lub kg (pomyłka operatora)"
                                            className="inline-flex w-7 h-7 rounded items-center justify-center text-ink-4 hover:text-brand hover:bg-brand/10">
                                            <PencilLine size={14} />
                                          </button>
                                          <button onClick={() => setCbEntry(e)}
                                            title="Przenieś wpis na inną partię"
                                            className="inline-flex w-7 h-7 rounded items-center justify-center text-ink-4 hover:text-brand hover:bg-brand/10">
                                            <ArrowLeftRight size={14} />
                                          </button>
                                        </>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {(b.backsKg > 0 || b.bonesKg > 0) && (
                        <p className="text-[11px] text-ink-4 flex items-center gap-1.5">
                          <Bone size={12} />
                          Grzbiety i kości ważone zbiorczo na partię — korekta ubocznych przez ważenie na HMI.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {fixEntry && (
        <EntryCorrectionDialog entry={fixEntry} onClose={() => setFixEntry(null)} onSaved={onSaved} />
      )}
      {cbEntry && (
        <ChangeBatchDialog entry={cbEntry} onClose={() => setCbEntry(null)} onSaved={onSaved} />
      )}
    </div>
  )
}
