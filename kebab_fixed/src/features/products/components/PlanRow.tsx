// src/features/products/components/PlanRow.tsx
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtKg } from '@/lib/utils'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Trash2,
  CheckCircle, AlertTriangle,
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

const ROW_STATUS: Record<string, { label: string; cls: string }> = {
  new:         { label: 'nowa',        cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  planned:     { label: 'w kolejce',   cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  confirmed:   { label: 'w kolejce',   cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  in_progress: { label: 'w masownicy', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  done:        { label: 'gotowe',      cls: 'bg-green-50 text-green-700 border-green-200' },
}

export function PlanRow({
  row, index, total, recipes, lots, output, expanded,
  onUpdate, onMove, onDelete, onToggle, onAutoFefoRow,
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

  return (
    <div className={`rounded-lg border ${locked ? 'bg-muted/40' : 'bg-white'}`}
      onDragOver={dragHandlers.onDragOver} onDrop={dragHandlers.onDrop}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          draggable={dragHandlers.draggable && !locked}
          onDragStart={dragHandlers.onDragStart}
          onDragEnd={dragHandlers.onDragEnd}
          className={`flex-shrink-0 ${locked ? 'opacity-20' : 'cursor-grab text-muted-foreground hover:text-ink'}`}
          title={locked ? 'Pozycja w masownicy/gotowa' : 'Przeciągnij, by zmienić kolejność'}>
          <GripVertical size={16} />
        </span>
        <span className="w-5 text-center text-sm font-black text-violet-700 tabular-nums">{index + 1}</span>

        <div className="flex-1 min-w-0">
          <Select value={row.recipeId || '__none'} disabled={locked}
            onValueChange={v => onUpdate({ recipeId: v === '__none' ? '' : v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Receptura..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Receptura...</SelectItem>
              {recipes.map(rc => <SelectItem key={rc.id} value={rc.id}>{rc.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 w-24 flex-shrink-0">
          <Input type="number" min="1" step="10" value={row.meatKg} disabled={locked}
            onChange={e => onUpdate({ meatKg: e.target.value })}
            className="h-8 text-[13px] font-bold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          <span className="text-[10px] text-muted-foreground">kg</span>
        </div>

        <span className="w-24 text-right text-[12px] text-green-700 font-semibold tabular-nums flex-shrink-0">
          → {fmtKg(output, 0)} kg
        </span>

        {!locked && (
          <span className={`flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 w-20 ${lotsOk ? 'text-green-700' : 'text-amber-700'}`}>
            {lotsOk ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
            {lotsOk ? 'partie' : 'brak'}
          </span>
        )}

        <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${st.cls}`}>
          {st.label}{row.status === 'in_progress' && row.kgDone ? ` · ${fmtKg(row.kgDone, 0)} kg` : ''}
        </Badge>

        <div className="flex flex-col flex-shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0}
            className="h-4 w-7 flex items-center justify-center text-muted-foreground hover:text-ink disabled:opacity-20">
            <ArrowUp size={13} />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1}
            className="h-4 w-7 flex items-center justify-center text-muted-foreground hover:text-ink disabled:opacity-20">
            <ArrowDown size={13} />
          </button>
        </div>

        <button onClick={onToggle} disabled={locked}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted/60 disabled:opacity-20 flex-shrink-0"
          title="Partie i składniki">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <button onClick={onDelete} disabled={locked}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-20 flex-shrink-0"
          title={locked ? 'Pozycja w masownicy/gotowa' : 'Usuń z planu'}>
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && !locked && (
        <div className="px-3 pb-3 pt-1 border-t bg-muted/20 grid grid-cols-2 gap-3">
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
