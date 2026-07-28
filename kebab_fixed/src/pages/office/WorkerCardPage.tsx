/**
 * WorkerCardPage — Kartoteka pracownika: każde pobranie i KAŻDA porcja ważenia
 * wybranej osoby, w zakresie dat albo od zawsze.
 *
 * Powód: reklamacja z hali (DENYS, 22.07.2026 — „pobrałem 60 kg więcej")
 * wymagała rozbicia dnia na pojedyncze pobrania i odczyty wagi; dotąd biuro
 * miało tylko sumy dzienne (Statystyki, Rozliczenia) i musiało schodzić do SQL.
 * Klik wiersza pokazuje porcje: brutto − tara wózka − pojemniki = netto, więc
 * widać, czy waga liczyła, czy ktoś wpisał ręcznie.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { deboningApi, usersApi, type WorkerEntry } from '@/lib/apiClient'
import type { User } from '@/types'
import { DataTable } from '@/components/DataTable'
import { SearchSelect } from '@/components/ui/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, fmtDatePl } from '@/lib/utils'
import { UserSearch, Scale, AlertTriangle } from 'lucide-react'

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

type PresetKey = 'week' | 'month' | 'year' | 'all' | 'custom'
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'week',   label: '7 dni' },
  { key: 'month',  label: 'Miesiąc' },
  { key: 'year',   label: 'Rok' },
  { key: 'all',    label: 'Całość' },
  { key: 'custom', label: 'Zakres' },
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
function presetRange(k: PresetKey): { from?: string; to?: string } {
  if (k === 'all') return {}
  const to = new Date()
  const from = new Date()
  if (k === 'week') from.setDate(to.getDate() - 6)
  if (k === 'month') from.setMonth(to.getMonth() - 1)
  if (k === 'year') from.setFullYear(to.getFullYear() - 1)
  return { from: iso(from), to: iso(to) }
}

function fmtTime(s: string | null): string {
  return s ? s.slice(11, 16) : '—'
}
function yieldTone(pct: number | null): string {
  if (pct == null || pct <= 0) return 'text-ink-4'
  if (pct < 63) return 'text-red-600'
  if (pct < 65) return 'text-amber-600'
  return 'text-emerald-700'
}

export function WorkerCardPage() {
  const [params, setParams] = useSearchParams()
  const [workerId, setWorkerId] = useState(params.get('worker') ?? '')
  const [preset, setPreset] = useState<PresetKey>('month')
  const [cf, setCf] = useState(iso(new Date()))
  const [ct, setCt] = useState(iso(new Date()))
  const [detail, setDetail] = useState<WorkerEntry | null>(null)

  const { data: workers } = useApi<User[]>(() => usersApi.list())
  const range = preset === 'custom' ? { from: cf, to: ct } : presetRange(preset)

  useEffect(() => {
    // Nr pracownika w URL — żeby dało się wejść tu prosto ze Statystyk.
    if (workerId) setParams({ worker: workerId }, { replace: true })
  }, [workerId])  // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading } = useApi(
    () => workerId
      ? deboningApi.workerEntries(workerId, range.from, range.to)
      : Promise.resolve(null),
    [workerId, range.from, range.to],
  )

  const rows = useMemo(() => data?.data ?? [], [data])
  const sum = data?.summary
  const workerName = useMemo(
    () => (workers ?? []).find(w => w.id === workerId)?.name ?? '',
    [workers, workerId],
  )

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="min-w-[260px]">
          <div className="text-[11px] uppercase tracking-wider text-ink-4 mb-1">Pracownik</div>
          <SearchSelect
            items={(workers ?? []).map(w => ({ id: w.id, label: w.name }))}
            value={workerId}
            onSelect={setWorkerId}
            placeholder="Wybierz pracownika…"
          />
        </div>
        <div className="inline-flex items-center rounded-lg border border-surface-4 bg-white p-0.5">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={cn('px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                preset === p.key ? 'bg-brand text-white shadow-sm' : 'text-ink-3 hover:text-ink hover:bg-surface-2')}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="inline-flex items-center gap-1">
            <input type="date" value={cf} max={ct || undefined} onChange={e => setCf(e.target.value)}
              className="h-8 rounded-md border border-surface-4 px-2 text-xs" />
            <span className="text-ink-4">–</span>
            <input type="date" value={ct} onChange={e => setCt(e.target.value)}
              className="h-8 rounded-md border border-surface-4 px-2 text-xs" />
          </div>
        )}
      </div>

      {!workerId ? (
        <div className="rounded-lg border border-surface-4 bg-white py-16 flex flex-col items-center gap-2">
          <UserSearch size={28} className="text-ink-4" />
          <span className="text-sm font-semibold text-ink-3">Wybierz pracownika</span>
          <span className="text-xs text-ink-4">Zobaczysz każde jego pobranie i każdą porcję ważenia</span>
        </div>
      ) : (
        <>
          {sum && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {[
                { l: 'Pobrań', v: nf0.format(sum.entries) },
                { l: 'Dni pracy', v: nf0.format(sum.days) },
                { l: 'Ćwiartka', v: `${nf0.format(sum.kgQuarter)} kg` },
                { l: 'Mięso', v: `${nf0.format(sum.kgMeat)} kg` },
                { l: 'Uzysk', v: `${nf1.format(sum.avgYield)}%`, tone: yieldTone(sum.avgYield) },
                { l: 'Ważeń', v: nf0.format(sum.portions) },
              ].map(k => (
                <div key={k.l} className="rounded-lg border border-surface-4 bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-4">{k.l}</div>
                  <div className={cn('text-lg font-black tabular-nums', k.tone ?? 'text-ink')}>{k.v}</div>
                </div>
              ))}
            </div>
          )}

          <DataTable<WorkerEntry>
            rows={rows} rowKey={e => e.id}
            initialSort={{ key: 'takenAtLocal', dir: 'desc' }}
            searchText={e => `${e.rawBatchNo} ${e.dayLocal}`}
            searchPlaceholder="Szukaj partii lub dnia…"
            onRowClick={e => setDetail(e)}
            empty={loading ? 'Ładowanie…' : (
              <div className="py-10 text-center text-xs text-ink-4">
                Brak pobrań {workerName ? `pracownika ${workerName} ` : ''}w tym zakresie
              </div>
            )}
            footer={r => {
              const q = r.reduce((a, e) => a + e.kgQuarter, 0)
              const m = r.reduce((a, e) => a + e.kgMeat, 0)
              return (
                <>
                  <span>Razem · {r.length} pobrań</span>
                  <span className="ml-auto">Ćwiartka: <b>{nf1.format(q)} kg</b></span>
                  <span>Mięso: <b className="text-brand">{nf1.format(m)} kg</b></span>
                  <span>Uzysk: <b className={yieldTone(q > 0 ? m / q * 100 : null)}>{q > 0 ? nf1.format(m / q * 100) : '—'}%</b></span>
                </>
              )
            }}
            columns={[
              { key: 'dayLocal', header: 'Dzień', sortable: true, sortValue: e => e.dayLocal, width: 110,
                cell: e => <span className="text-ink-2">{fmtDatePl(e.dayLocal)}</span> },
              { key: 'takenAtLocal', header: 'Pobrano', sortable: true, sortValue: e => e.takenAtLocal, width: 80,
                cell: e => <span className="tabular-nums text-ink-3">{fmtTime(e.takenAtLocal)}</span> },
              { key: 'completedAtLocal', header: 'Zważono', sortable: true, sortValue: e => e.completedAtLocal ?? '', width: 80,
                cell: e => <span className="tabular-nums text-ink-3">{fmtTime(e.completedAtLocal)}</span> },
              { key: 'rawBatchNo', header: 'Partia', sortable: true, sortValue: e => e.rawBatchNo, width: 90,
                cell: e => <code className="font-mono font-bold text-brand">{e.rawBatchNo}</code> },
              { key: 'kgQuarter', header: 'Ćwiartka [kg]', align: 'right', sortable: true, sortValue: e => e.kgQuarter,
                cell: e => <span className="font-semibold tabular-nums text-ink">{nf1.format(e.kgQuarter)}</span> },
              { key: 'kgMeat', header: 'Mięso [kg]', align: 'right', sortable: true, sortValue: e => e.kgMeat,
                cell: e => <span className="font-bold tabular-nums text-brand">{nf1.format(e.kgMeat)}</span> },
              { key: 'yieldPct', header: 'Uzysk', align: 'right', sortable: true, sortValue: e => e.yieldPct ?? -1,
                cell: e => <span className={cn('font-black tabular-nums', yieldTone(e.yieldPct))}>
                  {e.yieldPct != null ? `${nf1.format(e.yieldPct)}%` : '—'}</span> },
              { key: 'portions', header: 'Ważeń', align: 'right', sortable: true, sortValue: e => e.portions, width: 70,
                cell: e => e.portions > 0
                  ? <span className={cn('tabular-nums', e.portions > 1 ? 'font-bold text-ink' : 'text-ink-3')}>{e.portions}</span>
                  : <span className="text-ink-4">—</span> },
              { key: 'flags', header: '', width: 120,
                cell: e => (
                  <span className="flex items-center gap-1">
                    {e.status === 'pending' && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">Trwa</span>
                    )}
                    {e.corrected && (
                      <span title="Wpis poprawiany z biura"
                        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">Korekta</span>
                    )}
                  </span>
                ) },
            ]}
          />
        </>
      )}

      {/* Szczegóły pobrania: każda porcja z audytem wagi */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale size={16} className="text-ink-3" />
              Pobranie {detail?.rawBatchNo} · {detail && fmtDatePl(detail.dayLocal)} {detail && fmtTime(detail.takenAtLocal)}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4 text-sm">
                <span>Ćwiartka: <b className="tabular-nums">{nf1.format(detail.kgQuarter)} kg</b></span>
                <span>Mięso: <b className="tabular-nums text-brand">{nf1.format(detail.kgMeat)} kg</b></span>
                <span>Uzysk: <b className={cn('tabular-nums', yieldTone(detail.yieldPct))}>
                  {detail.yieldPct != null ? `${nf1.format(detail.yieldPct)}%` : '—'}</b></span>
              </div>
              {detail.corrected && (
                <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  Ten wpis był poprawiany z biura — pokazane liczby mogą pochodzić z korekty, nie z wagi.
                </div>
              )}
              {detail.weighings.length === 0 ? (
                <div className="rounded-md border border-surface-4 bg-surface-2 px-3 py-4 text-center text-xs text-ink-4">
                  Brak zapisanych porcji — wpis powstał bez ważenia na wadze (wpisany ręcznie albo z korekty).
                </div>
              ) : (
                <table className="w-full text-[12px] [font-variant-numeric:tabular-nums]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-ink-4 border-b border-surface-4">
                      <th className="text-left py-1.5">Godzina</th>
                      <th className="text-right">Brutto</th>
                      <th className="text-right">Tara wózka</th>
                      <th className="text-right">Pojemniki</th>
                      <th className="text-right">Netto</th>
                      <th className="text-left pl-3">Tryb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.weighings.map((w, i) => (
                      <tr key={i} className="border-b border-surface-3 last:border-0">
                        <td className="py-1.5">{fmtTime(w.weighedAtLocal)}</td>
                        <td className="text-right">{w.kgGross != null ? nf1.format(w.kgGross) : '—'}</td>
                        <td className="text-right text-ink-3">{w.tareCartKg != null ? nf1.format(w.tareCartKg) : '—'}</td>
                        <td className="text-right text-ink-3">
                          {w.e2Count ? `${w.e2Count} szt · ${nf1.format(w.tareE2Kg ?? 0)} kg` : '—'}
                        </td>
                        <td className="text-right font-bold text-brand">{nf1.format(w.kgMeat)}</td>
                        <td className="pl-3">
                          <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                            w.weighMode === 'auto'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-surface-2 text-ink-3 border-surface-4')}>
                            {w.weighMode === 'auto' ? 'Waga' : 'Ręcznie'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setDetail(null)}>Zamknij</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
