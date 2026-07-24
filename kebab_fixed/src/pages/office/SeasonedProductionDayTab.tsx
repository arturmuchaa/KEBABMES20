/**
 * SeasonedProductionDayTab — "Zamknięcie dnia" na SeasonedMeatPage.
 *
 * Raz dziennie per receptura: biuro wpisuje ile mięsa przyprawionego
 * FAKTYCZNIE zostało (ścinki z formowania kebaba nikną z bilansu, bo
 * produkcja 10 t/dzień nie ma czasu ich ważyć). Korekta idzie przez
 * POST .../production-days/reconcile — ten sam mechanizm audytu co
 * dzisiejsze "Koryguj partię" (stock_movements, source_type='reconcile'),
 * tylko zsumowany na poziomie (receptura, dzień). Patrz spec:
 * docs/superpowers/specs/2026-07-23-zamkniecie-dnia-produkcji-design.md
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { seasonedMeatApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { ChevronDown, ChevronUp, Loader2, SlidersHorizontal } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

const REASONS = [
  'ścinki / resztki z produkcji',
  'zaniżona teoria (fizycznie więcej)',
  'resztka technologiczna',
  'strata / odpad',
  'korekta ważenia',
  'inne',
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function SeasonedProductionDayTab() {
  const [day, setDay] = useState(todayIso())
  const { data: groups, loading, refetch: refetchGroups } =
    useApi(() => seasonedMeatApi.productionDays(day), [day])
  const { data: history, refetch: refetchHistory } =
    useApi(() => seasonedMeatApi.productionDayHistory(50), [])
  const [showHistory, setShowHistory] = useState(false)

  const [rec, setRec] = useState<any | null>(null)
  const [recKg, setRecKg] = useState('')
  const [recReason, setRecReason] = useState(REASONS[0])
  const [recBusy, setRecBusy] = useState(false)
  const [recErr, setRecErr] = useState('')

  function openReconcile(g: any) {
    setRec(g)
    setRecKg(String(Number(g.theoreticalKg ?? 0)))
    setRecReason(REASONS[0])
    setRecErr('')
  }

  async function submitReconcile() {
    if (!rec) return
    setRecBusy(true); setRecErr('')
    try {
      await seasonedMeatApi.reconcileDay({
        recipeId: rec.recipeId,
        productionDay: rec.productionDay,
        actualKg: Number(recKg.replace(',', '.')) || 0,
        reason: recReason,
      })
      setRec(null)
      refetchGroups(); refetchHistory()
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Nie udało się zapisać korekty')
    } finally {
      setRecBusy(false)
    }
  }

  const rows: any[] = groups ?? []
  const historyRows: any[] = history ?? []

  return (
    <div className="space-y-3">
      <Card className="p-3 flex items-center gap-2">
        <label className="text-[11px] font-bold uppercase tracking-wide text-ink-4">
          Dzień produkcji
        </label>
        <Input type="date" value={day} onChange={e => setDay(e.target.value)} className="h-9 w-44" />
      </Card>

      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 text-sm text-muted-foreground">
          Ładowanie…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <div className="text-sm font-medium text-muted-foreground">
            Brak partii przyprawionego z tego dnia
          </div>
        </div>
      ) : (
        <DataTable
          rows={rows}
          rowKey={g => g.recipeId}
          onRowClick={g => openReconcile(g)}
          columns={[
            { key: 'recipeName', header: 'Receptura', sortable: true, sortValue: g => g.recipeName || '',
              cell: g => <span className="font-medium text-ink">{g.recipeName}</span> },
            { key: 'batchCount', header: 'Partii', align: 'right', sortable: true, sortValue: g => g.batchCount,
              cell: g => g.batchCount },
            { key: 'theoreticalKg', header: 'Teoretycznie zostało', align: 'right', sortable: true,
              sortValue: g => g.theoreticalKg,
              cell: g => <span className="font-bold text-emerald-700">{fmtKg(g.theoreticalKg, 1)} kg</span> },
            { key: 'lastReconciledAt', header: 'Ostatnia korekta', sortable: true,
              sortValue: g => g.lastReconciledAt || '',
              cell: g => g.lastReconciledAt
                ? <span className="text-ink-2">{fmtDatePl(String(g.lastReconciledAt).slice(0, 10))} · {g.lastReconcileReason}</span>
                : <span className="text-muted-foreground">—</span> },
            { key: 'act', header: '', align: 'right',
              cell: g => (
                <button
                  onClick={e => { e.stopPropagation(); openReconcile(g) }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50"
                  title="Wpisz realną pozostałość"
                ><SlidersHorizontal size={12} /></button>
              ) },
          ]}
        />
      )}

      {historyRows.length > 0 && (
        <Card>
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Historia zamknięć</span>
              <Badge variant="outline" className="text-[10px]">{historyRows.length}</Badge>
            </div>
            {showHistory ? <ChevronUp size={14} className="text-muted-foreground"/> : <ChevronDown size={14} className="text-muted-foreground"/>}
          </button>
          {showHistory && (
            <div className="border-t overflow-auto max-h-[40vh]">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                  <tr>
                    {['Data', 'Receptura', 'Partia', 'Zmiana', 'Powód'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((h, idx) => (
                    <tr key={`${h.batchNo}-${h.createdAt}-${idx}`}
                      className={cn('border-b border-surface-3', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40')}>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{fmtDatePl(String(h.productionDay))}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{h.recipeName}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap"><code className="font-mono text-[10px] bg-surface-3 text-ink px-1.5 py-0.5 rounded">{h.batchNo}</code></td>
                      <td className={cn('px-2.5 py-2 whitespace-nowrap font-bold',
                        h.movementType === 'IN' ? 'text-emerald-700' : 'text-red-700')}>
                        {h.movementType === 'IN' ? '+' : '−'}{fmtKg(h.qty, 1)} kg
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{h.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {rec && (
        <Dialog open onOpenChange={v => { if (!v && !recBusy) setRec(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-amber-600" />
                Zamknięcie dnia — {rec.recipeName}
              </DialogTitle>
              <DialogDescription>
                Wpisz, ile mięsa przyprawionego z tej receptury i dnia FAKTYCZNIE
                zostało. System skoryguje żywy stan i zapisze różnicę do audytu.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-[13px]">
              <div className="rounded-lg bg-surface-2 border border-surface-4 px-3 py-2 text-center">
                <div className="text-[10px] uppercase tracking-wide text-ink-4">Teoretycznie zostało</div>
                <div className="font-bold tabular-nums text-ink">{fmtKg(rec.theoreticalKg ?? 0, 1)} kg</div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-4 mb-1">Ile fizycznie zostało [kg]</label>
                <Input type="number" step="0.1" min="0" value={recKg}
                  onChange={e => setRecKg(e.target.value)}
                  className="h-9 tabular-nums font-bold" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-4 mb-1">Powód (dla audytu / weterynarii)</label>
                <select value={recReason} onChange={e => setRecReason(e.target.value)}
                  className="w-full h-9 px-2 text-[13px] border border-surface-4 rounded bg-white">
                  {REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              {recErr && <div className="text-[12px] text-red-600 font-semibold">{recErr}</div>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => setRec(null)} disabled={recBusy}
                  className="h-9 px-3 text-[13px] font-semibold rounded border border-surface-4 text-ink-2 hover:bg-surface-2">
                  Anuluj
                </button>
                <button onClick={submitReconcile} disabled={recBusy}
                  className="h-9 px-3 text-[13px] font-bold rounded bg-brand text-white hover:bg-brand/90 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {recBusy ? <Loader2 size={14} className="animate-spin" /> : <SlidersHorizontal size={14} />}
                  Zapisz korektę
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
