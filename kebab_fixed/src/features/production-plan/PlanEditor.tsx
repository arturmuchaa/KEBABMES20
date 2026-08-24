/**
 * PlanEditor — plan produkcji jako terminal dnia.
 *
 * Zastępuje `PlanForm`: ten sam kontrakt propsów, inny idiom obsługi. Powód
 * jest twardy — planowanie produkcji ODBIŁO. W całej bazie produkcyjnej były
 * dwa plany (13 i 14.08.2026), bo stary ekran wbijało się myszką przez
 * rozwijane listy i był wolniejszy niż kartka.
 *
 * Układ: pasek wsadu pod klawiaturę u góry, pozycje w stałych kolumnach,
 * a obok żywy panel partii, który mówi nie tylko ILE mięsa zostało, ale i
 * KTÓRA partia poszła na którą pozycję.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import {
  seasonedMeatApi, packagingApi, clientsApi, productionPlansApi,
} from '@/lib/apiClient'
import { useProductTypes } from '@/features/products/hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtKgTrim } from '@/lib/utils'
import { Factory, Save, AlertTriangle } from 'lucide-react'

import { usePlanDraft } from './usePlanDraft'
import { PlanTerminal } from './components/PlanTerminal'
import { PlanLinesTable, type PlanLineRow } from './components/PlanLinesTable'
import { BatchPanel } from './components/BatchPanel'
import { num, type PlanLine } from './planLineModel'
import type { CreatePlanLineDto } from '@/lib/mockApi'

export interface PlanEditorProps {
  initialPlan?:   any
  existingPlans?: any[]
  onSave:  (lines: CreatePlanLineDto[], planDate: string) => Promise<string>
  onClose: () => void
  /** Otwórz edycję planu, który już istnieje na wybrany dzień. */
  onOpenExisting?: (planId: string) => void
}

/** Pozycja szkicu → DTO backendu. Kształt bez zmian — backend nietknięty. */
function toDto(l: PlanLine): CreatePlanLineDto {
  const ids = l.seasonedBatchIds.length > 0
    ? l.seasonedBatchIds
    : (l.seasonedBatchId ? [l.seasonedBatchId] : [])
  return {
    id:                l.id || undefined,
    qty:               num(l.qty),
    kgPerUnit:         num(l.kgPerUnit),
    productTypeId:     l.productTypeId || '',
    recipeId:          l.recipeId,
    packagingId:       l.packagingId || undefined,
    seasonedBatchId:   ids[0] || undefined,
    seasonedBatchIds:  ids.length > 0 ? ids : undefined,
    clientOrderId:     l.clientOrderId     || undefined,
    clientOrderNo:     l.clientOrderNo     || undefined,
    clientOrderLineId: l.clientOrderLineId || undefined,
    clientName:        l.clientName        || undefined,
  }
}

export function PlanEditor({
  initialPlan, existingPlans, onSave, onClose, onOpenExisting,
}: PlanEditorProps) {
  // Edycja MUSI widzieć także partie w 100% zarezerwowane przez TEN plan —
  // lista „do zaplanowania" filtruje kg_free > 0, więc własne mięso planu
  // znikałoby z niej całkowicie i ekran świeciłby gigantycznym brakiem.
  const { data: seasonedApi } = useApi(
    () => (initialPlan
      ? seasonedMeatApi.all().then((rows: any[]) =>
          (rows ?? []).filter(s => Number(s.kgAvailable || 0) > 0))
      : seasonedMeatApi.list()),
    [initialPlan?.id],
  )
  const { data: pkgList }    = useApi(() => packagingApi.list())
  const { data: clientList } = useApi(() => clientsApi.list())
  const { productTypes }     = useProductTypes()
  const { recipes }          = useRecipes()

  const seasoned  = useMemo(() => (seasonedApi ?? []) as any[], [seasonedApi])
  const packaging = useMemo(() => (pkgList ?? []) as any[], [pkgList])
  const clients   = useMemo(
    () => ((clientList ?? []) as any[]).filter(c => c.active), [clientList])

  const draft = usePlanDraft({ initialPlan, seasoned, recipes: (recipes ?? []) as any[] })

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const nazwaRodzaju = (id: string) =>
    ((productTypes ?? []) as any[]).find(p => p.id === id)?.name ?? ''
  const nazwaReceptury = (id: string) =>
    ((recipes ?? []) as any[]).find(r => r.id === id)?.name ?? ''
  const numerPartii = (id: string) =>
    draft.batchRows.find(b => b.id === id)?.batchNo ?? ''

  const rows: PlanLineRow[] = draft.lines.map(l => ({
    qty:             l.qty,
    kgPerUnit:       l.kgPerUnit,
    productTypeName: nazwaRodzaju(l.productTypeId),
    recipeName:      nazwaReceptury(l.recipeId),
    clientName:      l.clientName,
    batchNos:        l.seasonedBatchIds.map(numerPartii).filter(Boolean),
    frozen:          num(l.qtyDone) > 0,
  }))

  /** Plan na ten sam dzień, który już istnieje — jeden dzień, jeden plan. */
  const duplikat = useMemo(
    () => (existingPlans ?? []).find((p: any) =>
      p.id !== initialPlan?.id
      && String(p.planDate ?? '').slice(0, 10) === draft.planDate
      && p.status !== 'cancelled'),
    [existingPlans, initialPlan, draft.planDate],
  )

  async function zapisz(toProduction: boolean) {
    setError('')
    const gotowe = draft.lines.filter(l => l.recipeId && num(l.qty) > 0 && num(l.kgPerUnit) > 0)
    if (gotowe.length === 0) { setError('Dodaj przynajmniej jedną pozycję z recepturą i kg'); return }

    const braki = draft.shortfalls(toProduction)
    if (braki.length > 0) {
      setError(
        (toProduction
          ? 'Nie można wysłać do produkcji — niewystarczająca ilość mięsa:\n'
          : 'Nie można zapisać — niewystarczająca ilość mięsa:\n')
        + braki.map(s => '• ' + s).join('\n'),
      )
      return
    }

    setSaving(true)
    try {
      const planId = await onSave(gotowe.map(toDto), draft.planDate)
      if (toProduction) {
        try {
          await productionPlansApi.updateStatus(planId, 'active')
        } catch (e) {
          setError(`Plan zapisany jako szkic. Błąd aktywacji: ${e instanceof Error ? e.message : 'Niewystarczająca ilość mięsa'}`)
          setSaving(false)
          return
        }
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {/* ── Dzień planu ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Data produkcji
          </Label>
          <Input type="date" value={draft.planDate}
            onChange={e => draft.setPlanDate(e.target.value)}
            className="h-9 w-auto text-sm" />
        </div>
        <span className="pb-2 font-mono text-[12px] tabular-nums text-ink-3">
          {draft.lines.length} poz. · {fmtKgTrim(draft.totalKg)} kg
        </span>
      </div>

      {/* Jeden dzień = jeden plan. Nie podmieniamy szkicu po cichu — planista
          mógł już coś wpisać; dajemy mu przejść świadomie. */}
      {duplikat && (
        <div className="flex items-center gap-3 rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
          <AlertTriangle size={15} className="shrink-0" />
          <span>Na {draft.planDate} istnieje już plan {duplikat.planNo ?? ''}.</span>
          {onOpenExisting && (
            <Button size="sm" variant="outline" className="ml-auto h-7 text-[11.5px]"
              onClick={() => onOpenExisting(duplikat.id)}>
              Otwórz tamten plan
            </Button>
          )}
        </div>
      )}

      <PlanTerminal
        productTypes={(productTypes ?? []) as any[]}
        recipes={(recipes ?? []) as any[]}
        packaging={packaging}
        clients={clients}
        lastLine={draft.lines[draft.lines.length - 1] ?? null}
        onCommit={draft.addLine}
      />

      <div className="flex min-h-[240px] items-stretch gap-3">
        <div className="flex min-w-0 flex-1 flex-col border border-surface-4 bg-white shadow-card">
          <PlanLinesTable
            rows={rows}
            editingIdx={null}
            onEdit={() => { /* poprawianie pozycji — zadanie osobne */ }}
            onRemove={draft.removeLine}
          />
        </div>
        <aside className="w-[300px] shrink-0">
          <BatchPanel rows={draft.batchRows} demandByRecipe={draft.demand} onRecalc={draft.recalcFefo} />
        </aside>
      </div>

      {error && (
        <div className="whitespace-pre-line rounded-[3px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] font-semibold text-destructive">
          {error}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center gap-3 border border-surface-4 bg-white px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,.05)]">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Anuluj</Button>
        <span className="ml-auto font-mono text-[20px] font-bold tabular-nums text-ink">
          {fmtKgTrim(draft.totalKg)}<span className="ml-1 font-display text-[11px] uppercase text-ink-4">kg</span>
        </span>
        <Button variant="outline" className="gap-1.5" disabled={saving} onClick={() => zapisz(false)}>
          <Save size={15} /> Zapisz szkic
        </Button>
        <Button className="gap-1.5" disabled={saving} onClick={() => zapisz(true)}>
          <Factory size={15} /> Wyślij do produkcji
        </Button>
      </div>
    </div>
  )
}
