import { useOtworzDokument } from '@/lib/otworzDokument'
/**
 * Dodruk pojedynczej etykiety sztuki (awaria druku QR).
 * Lista sztuk linii planu ze statusem; „Dodrukuj" otwiera druk TYLKO tej sztuki
 * (ten sam QR — bez nowej sztuki, bez wpływu na traceability).
 */
import { useApi } from '@/hooks/useApi'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { finishedUnitsApi, labelPrintJobsApi, labelTemplatesApi, type FinishedUnitCard, type LabelJobHistory } from '@/lib/api'
import { labelJobStateLabel } from '@/features/labels/printJobWorkflow'
import { isScanned } from '@/lib/unitReprint'
import { formatCartonNo } from '@/lib/unitLocation'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
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
  const otworz = useOtworzDokument()
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const [history, setHistory] = useState<{ unit: FinishedUnitCard; entries: LabelJobHistory[] } | null>(null)
  const context = `${open}:${line?.id}`
  const contextRef = useRef(context)
  contextRef.current = context
  useEffect(() => { setHistory(null) }, [context])
  const { data, loading } = useApi(
    () => (line ? finishedUnitsApi.listByPlanLine(line.id) : Promise.resolve([])),
    [line?.id, open],
  )
  const units: FinishedUnitCard[] = data ?? []

  async function openCurrent(u: FinishedUnitCard) {
    if (!line) return
    const p = new URLSearchParams({ planLineId: line.id, unitIds: u.id })
    const clientId = line.clientName || u.clientName || ''
    const recipeId = line.recipeId || u.recipeId || ''
    p.set('clientId', clientId); p.set('recipeId', recipeId)
    const { kind } = await labelTemplatesApi.resolve(clientId, recipeId)
    if (contextRef.current !== context) return
    if (kind === 'none') throw new Error('Brak szablonu')
    otworz(`/etykiety/${kind === 'zebra' ? 'zebra' : 'druk'}?${p.toString()}`)
  }

  async function reprint(u: FinishedUnitCard, current = false) {
    if (!line || openingRef.current) return
    openingRef.current = true
    setOpening(true)
    try {
      if (current) { await openCurrent(u); return }
      const entries = await labelPrintJobsApi.history(u.id)
      if (contextRef.current !== context) return
      if (entries.length) setHistory({ unit: u, entries })
      else await openCurrent(u)
    } catch {
      toast.error('Nie udało się odczytać historii lub ustalić szablonu. Nie otwarto dodruku.')
    } finally { setOpening(false); openingRef.current = false }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Dodruk etykiety — {line?.recipeName || 'linia'}{line?.qty ? ` (${line.qty} szt)` : ''}
          </DialogTitle>
          <DialogDescription>Niezeskanowana sztuka mogła już zostać wydrukowana. Dodruk zachowuje jej QR; nie tworzy nowej sztuki. Historia obejmuje zapisane zadania ZPL i A4, nie wcześniejsze wydruki bez snapshotu.</DialogDescription>
        </DialogHeader>
        {history && <section aria-label="Historia wydruków sztuki" className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h3 className="text-sm font-bold">Wybierz zapisany wydruk — {history.unit.qrCode}</h3>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {history.entries.map(entry => {
              const replayable = ['submitted', 'exported', 'dialog_opened', 'uncertain'].includes(entry.state)
              const p = new URLSearchParams(replayable ? { sourceJobId: entry.id, unitIds: history.unit.id } : { jobId: entry.id })
              return <div key={entry.id} className="rounded border bg-white p-2 text-xs">
                <div className="font-semibold">{labelJobStateLabel[entry.state]}</div>
                <div>Rewizja #{entry.revisionId} · {entry.printerName} · {entry.createdAt}</div>
                <button disabled={opening} onClick={() => otworz(`/etykiety/${entry.language === 'a4' ? 'druk' : 'zebra'}?${p}`)} className="mt-2 rounded border px-3 py-2 font-semibold">
                  {replayable ? 'Dodruk z tej wersji' : 'Otwórz całe zadanie (stan / anulowanie)'}
                </button>
              </div>
            })}
          </div>
          <button disabled={opening} onClick={() => reprint(history.unit, true)} className="rounded border bg-white px-3 py-2 text-xs font-semibold">
            Aktualny szablon (nie odtwarza historii)
          </button>
        </section>}
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
                    disabled={opening}
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
