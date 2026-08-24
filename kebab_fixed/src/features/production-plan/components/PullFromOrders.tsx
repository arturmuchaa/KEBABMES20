/**
 * PullFromOrders — panel boczny „Wciągnij z zamówień".
 *
 * Plan powstaje po połowie z zamówień i z decyzji szefa, więc oba wejścia mają
 * być wygodne — ale panel otwiera się NA ŻĄDANIE, a nie zajmuje stałej kolumny:
 * w bazie produkcyjnej jest jedno zamówienie w całej historii, więc w większość
 * dni ta kolumna stałaby pusta.
 *
 * Pokazujemy RESZTĘ do wyprodukowania, nie ilość z zamówienia — pozycja zrobiona
 * w połowie nie może wjechać w plan drugi raz w całości.
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { fmtKgTrim } from '@/lib/utils'
import { X, Download } from 'lucide-react'
import { pullableLines, toPlanLines, type OrderLite, type ProgressByLine } from '../pullFromOrders'
import type { PlanLine } from '../planLineModel'

export function PullFromOrders({ orders, progress, onPull, onClose }: {
  orders:   OrderLite[]
  progress: ProgressByLine
  onPull:   (lines: PlanLine[]) => void
  onClose:  () => void
}) {
  const dostepne = useMemo(() => pullableLines(orders, progress), [orders, progress])
  const [zazn, setZazn] = useState<Set<string>>(() => new Set(dostepne.map(l => l.lineId)))

  const wybrane = dostepne.filter(l => zazn.has(l.lineId))
  const sumaKg = wybrane.reduce((s, l) => s + l.kg, 0)

  const przelacz = (id: string) => setZazn(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border border-surface-4 bg-white shadow-card"
      data-testid="panel-zamowien">
      <header className="flex items-center gap-2 border-b border-surface-3 bg-surface-2 px-3 py-1.5">
        <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Do wciągnięcia z zamówień
        </span>
        <button onClick={onClose} className="ml-auto text-ink-4 hover:text-ink" title="Zamknij">
          <X size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {dostepne.length === 0 && (
          <p className="py-6 text-center text-[11.5px] text-ink-4">
            Nie ma potwierdzonych zamówień z niezrealizowanymi pozycjami.
          </p>
        )}
        {dostepne.map(l => (
          <label key={l.lineId} data-testid="zamowienie-pozycja"
            className="flex cursor-pointer items-start gap-2 border-b border-surface-3 py-1.5 last:border-b-0">
            <input type="checkbox" checked={zazn.has(l.lineId)} onChange={() => przelacz(l.lineId)}
              className="mt-1 h-3.5 w-3.5 accent-[var(--brand,#171717)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-ink">{l.clientName}</span>
              <span className="block font-mono text-[11px] text-ink-4">{l.orderNo}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-[12.5px] font-bold tabular-nums text-ink">
                {l.qtyRemaining}×{fmtKgTrim(l.kgPerUnit)}
              </span>
              <span className="block font-mono text-[11px] tabular-nums text-ink-3">
                {fmtKgTrim(l.kg)} kg
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-surface-4 bg-surface-2/60 px-3 py-2">
        <span className="font-mono text-[11.5px] tabular-nums text-ink-3">
          {wybrane.length} poz. · {fmtKgTrim(sumaKg)} kg
        </span>
        <Button size="sm" className="ml-auto gap-1.5" disabled={wybrane.length === 0}
          data-testid="wciagnij"
          onClick={() => { onPull(toPlanLines(wybrane)); onClose() }}>
          <Download size={13} /> Wciągnij
        </Button>
      </div>
    </aside>
  )
}
