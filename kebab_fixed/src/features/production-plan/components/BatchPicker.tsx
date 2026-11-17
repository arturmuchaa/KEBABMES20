/**
 * BatchPicker — ręczny wybór partii dla pozycji planu.
 *
 * Cała zasada tego ekranu brzmi „FEFO PROPONUJE, człowiek decyduje" — bez tego
 * okna była tylko pierwsza połowa. Planista otwiera je z kolumny „Partie".
 *
 * Zaznaczenie trzymamy w kolejności FEFO (`toggleBatchSelection`), bo przydział
 * idzie partia po partii: odznaczenie i ponowne zaznaczenie musi wrócić do tego
 * samego stanu, inaczej pozycja podbiera mięso sąsiedniej.
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { fmtKgTrim } from '@/lib/utils'
import { RotateCcw } from 'lucide-react'
import { allocatePlanMeat, toggleBatchSelection } from '../planMeatAllocation'
import type { MeatComponent } from '../planComponents'
import type { BatchPanelRow } from './BatchPanel'

export function BatchPicker({ recipeName, neededKg, batches, selected, onSave, onClose,
  components = [], qty, kgPerUnit }: {
  components?: MeatComponent[]
  qty?: number
  kgPerUnit?: number
  recipeName: string
  /** Ile kilogramów pozycja potrzebuje — po to, żeby było widać, czy starczy. */
  neededKg:   number
  /** Partie tej receptury, w kolejności FEFO (tak je oddaje panel). */
  batches:    BatchPanelRow[]
  selected:   string[]
  onSave:     (ids: string[]) => void
  onClose:    () => void
}) {
  const [wybrane, setWybrane] = useState<string[]>(selected)
  const kolejnoscFefo = useMemo(() => batches.map(b => b.id), [batches])

  // The caller returns this line's own allocation, excluding all other lines.
  const zaznaczoneKg = batches
    .filter(b => wybrane.includes(b.id))
    .reduce((s, b) => s + b.kgFreeRaw, 0)
  const allocation = qty && kgPerUnit ? allocatePlanMeat([
    { recipeId: 'picker', qty, kgPerUnit, seasonedBatchIds: wybrane },
  ], batches.map(b => ({ ...b, recipeId: 'picker', kgFree: b.kgFreeRaw })), {
    recipes: [{ id: 'picker', components }],
  }).lines[0] : null
  const brakuje = allocation ? (wybrane.length ? allocation.missingKg : neededKg)
    : Math.max(0, neededKg - zaznaczoneKg)

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Partie dla pozycji · {recipeName}</DialogTitle>
          <DialogDescription>
            Pozycja potrzebuje {fmtKgTrim(neededKg)} kg. Kolejność zaznaczania nie ma
            znaczenia — przydział zawsze idzie od najstarszej partii.
          </DialogDescription>
        </DialogHeader>

        {components.length > 0 && (
          <div className="space-y-1 text-[12px]" data-testid="picker-components">
            {components.map((c, i) => {
              const free = batches.filter(b => wybrane.includes(b.id) && b.materialTypeId === c.materialTypeId)
                .reduce((sum, b) => sum + b.kgFreeRaw, 0)
              return <p key={`${c.materialTypeId}-${i}`}>
                {c.materialName || c.materialTypeId} ({c.pct}%): potrzeba {fmtKgTrim(neededKg * c.pct / 100)} kg,
                {' '}wybrane {fmtKgTrim(free)} kg
              </p>
            })}
          </div>
        )}

        <div className="max-h-[46vh] space-y-1 overflow-y-auto">
          {batches.length === 0 && (
            <p className="py-6 text-center text-[12px] text-ink-4">
              Brak partii tej receptury — mięso pojawi się po masowaniu.
            </p>
          )}
          {batches.map(b => (
            <label key={b.id} data-testid={`picker-partia-${b.id}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-[3px] border border-surface-3 px-2.5 py-1.5">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--brand,#171717)]"
                checked={wybrane.includes(b.id)}
                onChange={() => setWybrane(w => toggleBatchSelection(w, b.id, kolejnoscFefo))} />
              <code className="font-mono text-[12.5px] font-bold text-ink">{b.batchNo}</code>
              {b.materialName && <span className="text-[11px] text-ink-3">{b.materialName}</span>}
              {b.productionDay && (
                <span className="text-[10.5px] text-ink-4">
                  {b.productionDay.slice(8, 10)}.{b.productionDay.slice(5, 7)}
                </span>
              )}
              <span className="ml-auto font-mono text-[12px] tabular-nums text-ink-2">
                {fmtKgTrim(b.kgFreeRaw)} kg
              </span>
            </label>
          ))}
        </div>

        <div data-testid="picker-podsumowanie"
          className={`rounded-[3px] px-3 py-2 text-[12px] font-bold ${
            brakuje > 0 ? 'bg-danger-light text-danger' : 'bg-surface-2 text-ink-2'
          }`}>
          {brakuje > 0
            ? `Zaznaczone ${fmtKgTrim(zaznaczoneKg)} kg — brakuje pokrycia na ${fmtKgTrim(brakuje)} kg produktu${components.length ? ' w wymaganych proporcjach' : ''}`
            : `Zaznaczone ${fmtKgTrim(zaznaczoneKg)} kg — starczy`}
          {components.length > 0 && allocation && <div className="mt-1">
            {allocation.joined.map(j => `${j.label}: ${j.pieces} szt.`).join(' · ')}
          </div>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" className="gap-1.5" data-testid="picker-fefo"
            onClick={() => { onSave([]); onClose() }}>
            <RotateCcw size={14} /> Zostaw FEFO
          </Button>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button data-testid="picker-zapisz" onClick={() => { onSave(wybrane); onClose() }}>
            Zapisz wybór
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
