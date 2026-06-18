/**
 * Dodruk pojedynczej etykiety sztuki (awaria druku QR).
 * Lista sztuk linii planu ze statusem; „Dodrukuj" otwiera druk TYLKO tej sztuki
 * (ten sam QR — bez nowej sztuki, bez wpływu na traceability).
 */
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi, type FinishedUnitCard } from '@/lib/api'
import { isScanned } from '@/lib/unitReprint'
import { formatCartonNo } from '@/lib/unitLocation'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Printer, ScanLine, ScanBarcode } from 'lucide-react'

export interface ReprintLine {
  id: string
  clientName?: string
  recipeId?: string
  recipeName?: string
  qty?: number
}

export function UnitReprintModal({ line, open, onClose }: {
  line: ReprintLine | null
  open: boolean
  onClose: () => void
}) {
  const { data, loading } = useApi(
    () => (line ? finishedUnitsApi.listByPlanLine(line.id) : Promise.resolve([])),
    [line?.id, open],
  )
  const units: FinishedUnitCard[] = data ?? []

  function reprint(u: FinishedUnitCard) {
    if (!line) return
    const p = new URLSearchParams({ planLineId: line.id, unitIds: u.id })
    if (line.clientName) p.set('clientId', line.clientName)
    if (line.recipeId)   p.set('recipeId', line.recipeId)
    window.open(`/etykiety/druk?${p.toString()}`, '_blank')
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Dodruk etykiety — {line?.recipeName || 'linia'}{line?.qty ? ` (${line.qty} szt)` : ''}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : units.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Brak wygenerowanych sztuk dla tej linii — najpierw „Etykiety".
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {units.map((u, i) => {
              const scanned = isScanned(u.status)
              return (
                <div
                  key={u.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    scanned ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'}`}
                >
                  <span className="w-6 text-center text-xs font-bold tabular-nums text-slate-500">{i + 1}</span>
                  <span className="font-mono text-sm font-bold text-slate-800">{u.batchNo || '—'}</span>
                  {u.cartonNo && (
                    <span className="text-[10px] font-semibold text-violet-700">Karton {formatCartonNo(Number(u.cartonNo))}</span>
                  )}
                  <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold ${
                    scanned ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {scanned ? <ScanBarcode size={13} /> : <ScanLine size={13} />}
                    {scanned ? 'Zeskanowana' : 'Niezeskanowana'}
                  </span>
                  <button
                    onClick={() => reprint(u)}
                    className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <Printer size={13} /> Dodrukuj
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
