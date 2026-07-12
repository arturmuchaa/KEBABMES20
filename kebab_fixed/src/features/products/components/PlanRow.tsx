/**
 * PlanRow — pozycja planu dnia masowania (gęsty wiersz w stylu Subiekt).
 *
 * Siatka kolumn MUSI odpowiadać nagłówkowi w MixingDayPlanEditor:
 * uchwyt | Lp | Receptura | Mięso kg | Półprodukt | Partie (chipy) | Status | Akcje.
 * Rozwinięcie: picker partii FEFO + podgląd składników receptury.
 */
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtKg, cn } from '@/lib/utils'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Trash2,
  AlertTriangle, CheckCheck, Loader2,
} from 'lucide-react'
import { MeatLotPicker, type PickerLot, type SelLot } from './MeatLotPicker'
import { IngredientPreview } from './IngredientPreview'

export interface PlanRowData {
  rowKey: string
  id?: string
  recipeId: string
  meatKg: string
  status: string          // new | planned | confirmed | in_progress | done
  orderNo?: string
  kgDone?: number
  lots: SelLot[]
}

// Statusy pozycji planu — etykiety domenowe na kanonicznym StatusBadge.
const ROW_STATUS: Record<string, { label: string; tone: 'blue' | 'gray' | 'amber' | 'green' }> = {
  new:         { label: 'Nowa',        tone: 'blue'  },
  planned:     { label: 'W kolejce',   tone: 'gray'  },
  confirmed:   { label: 'W kolejce',   tone: 'gray'  },
  in_progress: { label: 'W masownicy', tone: 'amber' },
  done:        { label: 'Gotowe',      tone: 'green' },
}

const GRID = 'grid grid-cols-[28px_20px_minmax(180px,1.2fr)_120px_96px_minmax(140px,1fr)_110px_88px] items-center gap-2'

export function PlanRow({
  row, index, total, recipes, lots, output, expanded,
  onUpdate, onMove, onDelete, onToggle, onAutoFefoRow,
  onConfirmExecution, confirmingExecution, canConfirmExecution, showConfirmExecution,
  dragHandlers,
}: {
  row: PlanRowData
  index: number
  total: number
  recipes: any[]
  lots: PickerLot[]
  output: number
  expanded: boolean
  onUpdate: (patch: Partial<PlanRowData>) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  onToggle: () => void
  onAutoFefoRow: () => void
  /** Biuro potwierdza wykonanie (brak HMI na masownicy) — wywołuje finish-session. */
  onConfirmExecution: () => void
  confirmingExecution: boolean
  /** Plan zapisany (ma id) i bez niezapisanych zmian — inaczej potwierdzenie
   * mogłoby dotyczyć pozycji, która zaraz zniknie/zmieni się przy zapisie. */
  canConfirmExecution: boolean
  /** Potwierdzenie ma sens TYLKO dla planu na dziś — przycisk w ogóle się
   * nie pokazuje przy oglądaniu przyszłego dnia. */
  showConfirmExecution: boolean
  dragHandlers: {
    draggable: boolean
    onDragStart: () => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: () => void
    onDragEnd: () => void
  }
}) {
  const st = ROW_STATUS[row.status] ?? ROW_STATUS.new
  const locked = row.status === 'in_progress' || row.status === 'done'
  const kg = parseFloat(row.meatKg) || 0
  const lotKg = row.lots.reduce((s, l) => s + (l.kgPlanned || 0), 0)
  const lotsOk = lotKg >= kg - 0.5 && kg > 0
  // Numer partii: najpierw z listy pickera; gdy partia w całości zarezerwowana
  // (znika z pickera), fallback na numer zapamiętany w wierszu planu z API.
  const lotNo = (id: string) =>
    lots.find(l => l.id === id)?.lotNo
    ?? row.lots.find(l => l.meatLotId === id)?.lotNo
    ?? '?'
  const shownLots = row.lots.slice(0, 3)
  const canConfirmNow = !locked && lotsOk && canConfirmExecution

  return (
    <div className={cn('border-b border-surface-3 last:border-b-0', locked ? 'bg-surface-2/60' : 'bg-white')}
      onDragOver={dragHandlers.onDragOver} onDrop={dragHandlers.onDrop}>
      <div className={cn(GRID, 'px-2.5 py-1.5')}>
        <span
          draggable={dragHandlers.draggable && !locked}
          onDragStart={dragHandlers.onDragStart}
          onDragEnd={dragHandlers.onDragEnd}
          className={cn('flex justify-center', locked ? 'opacity-20' : 'cursor-grab text-ink-4 hover:text-ink')}
          title={locked ? 'Pozycja w masownicy/gotowa' : 'Przeciągnij, by zmienić kolejność'}>
          <GripVertical size={15} />
        </span>
        <span className="text-center text-[13px] font-black text-brand tabular-nums">{index + 1}</span>

        <Select value={row.recipeId || '__none'} disabled={locked}
          onValueChange={v => onUpdate({ recipeId: v === '__none' ? '' : v })}>
          <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Receptura..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Receptura...</SelectItem>
            {recipes.map(rc => <SelectItem key={rc.id} value={rc.id}>{rc.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <span className="flex items-center gap-1 justify-end">
          <Input type="number" min="1" step="10" value={row.meatKg} disabled={locked}
            onChange={e => onUpdate({ meatKg: e.target.value })}
            className="h-8 w-20 text-[13px] font-bold text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          <span className="text-[10px] text-ink-4">kg</span>
        </span>

        <span className="text-right text-[12px] text-emerald-700 font-bold tabular-nums whitespace-nowrap">
          {output > 0 ? `${fmtKg(output, 0)} kg` : '—'}
        </span>

        {/* Partie — chipy z numerem lotu i kg; klik rozwija picker */}
        <button onClick={onToggle} disabled={locked}
          className="flex items-center gap-1 flex-wrap text-left disabled:cursor-default min-h-[26px]"
          title={locked ? undefined : 'Kliknij, aby dobrać partie'}>
          {row.lots.length === 0 ? (
            !locked && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                <AlertTriangle size={12} /> przypisz partie
              </span>
            )
          ) : (
            <>
              {shownLots.map(l => (
                <span key={l.meatLotId}
                  className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono font-bold tabular-nums',
                    lotsOk ? 'bg-surface-2 border-surface-4 text-ink' : 'bg-amber-50 border-amber-200 text-amber-800',
                  )}>
                  {lotNo(l.meatLotId)}
                  <span className="font-sans font-semibold text-ink-3">{fmtKg(l.kgPlanned, 0)}</span>
                </span>
              ))}
              {row.lots.length > 3 && (
                <span className="text-[11px] font-semibold text-ink-4">+{row.lots.length - 3}</span>
              )}
              {!lotsOk && (
                <span className="text-[10px] font-bold text-amber-700 whitespace-nowrap">
                  {fmtKg(lotKg, 0)}/{fmtKg(kg, 0)}
                </span>
              )}
            </>
          )}
        </button>

        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={st.tone}
            label={row.status === 'in_progress' && row.kgDone ? `${st.label} · ${fmtKg(row.kgDone, 0)} kg` : st.label} />
          {!locked && showConfirmExecution && (
            <button
              onClick={onConfirmExecution}
              disabled={!canConfirmNow || confirmingExecution}
              title={
                !canConfirmExecution ? 'Najpierw zapisz plan'
                : !lotsOk ? 'Uzupełnij partie mięsa, żeby potwierdzić wykonanie'
                : 'Brak HMI na masownicy — biuro potwierdza, że pozycja została wymieszana; mięso przyprawione wejdzie na magazyn'
              }
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap',
                canConfirmNow && !confirmingExecution
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-surface-4 text-ink-5 cursor-not-allowed',
              )}>
              {confirmingExecution
                ? <Loader2 size={10} className="animate-spin" />
                : <CheckCheck size={10} />}
              Potwierdź
            </button>
          )}
        </span>

        <span className="flex items-center justify-end gap-0.5">
          <span className="flex flex-col">
            <button onClick={() => onMove(-1)} disabled={index === 0}
              className="h-3.5 w-6 flex items-center justify-center text-ink-4 hover:text-ink disabled:opacity-20">
              <ArrowUp size={12} />
            </button>
            <button onClick={() => onMove(1)} disabled={index === total - 1}
              className="h-3.5 w-6 flex items-center justify-center text-ink-4 hover:text-ink disabled:opacity-20">
              <ArrowDown size={12} />
            </button>
          </span>
          <button onClick={onToggle} disabled={locked}
            className="w-6 h-6 rounded flex items-center justify-center text-ink-4 hover:bg-surface-2 disabled:opacity-20"
            title="Partie i składniki">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <button onClick={onDelete} disabled={locked}
            className="w-6 h-6 rounded flex items-center justify-center text-ink-4 hover:text-destructive hover:bg-destructive/10 disabled:opacity-20"
            title={locked ? 'Pozycja w masownicy/gotowa' : 'Usuń z planu'}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {expanded && !locked && (
        <div className="px-3 pb-3 pt-2 border-t border-surface-3 bg-surface-2/50 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <MeatLotPicker
            lots={lots} value={row.lots} targetKg={kg}
            onChange={next => onUpdate({ lots: next })}
            onAutoFefo={onAutoFefoRow} />
          <IngredientPreview
            recipe={recipes.find(r => r.id === row.recipeId)} meatKg={kg} />
        </div>
      )}
    </div>
  )
}
