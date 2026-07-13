/**
 * ProductionPlanEditorPage — pełnoekranowy edytor planu produkcji.
 *
 * Zastępuje modal ("okno") z ProductionPlanningPage: planowanie dostaje całą
 * stronę, więc panel mięsa, pozycje i dobór partii mają miejsce i są czytelne.
 * Reużywa sprawdzony <PlanForm> (cała logika: szybkie dodawanie, podgląd
 * alokacji FEFO, receptury komponentowe, walidacja braków). Trasy:
 *   /office/planowanie-produkcji/nowy            → nowy plan
 *   /office/planowanie-produkcji/:id/edytuj      → edycja (też aktywnego)
 */
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { productionPlansApi } from '@/lib/apiClient'
import type { CreatePlanLineDto } from '@/lib/mockApi'
import { PlanForm } from './ProductionPlanningPage'

const LIST_PATH = '/office/planowanie-produkcji'

export function ProductionPlanEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: plans, loading } = useApi(() => productionPlansApi.list())

  const editPlan = id ? (plans ?? []).find(p => p.id === id) ?? null : null
  const back = () => navigate(LIST_PATH)

  // Nawigacja NIE tutaj: PlanForm.save() po sukcesie (i ewentualnej aktywacji)
  // sam woła onClose → back(). Zwracamy tylko id planu.
  async function handleSave(lines: CreatePlanLineDto[], planDate: string): Promise<string> {
    const plan = editPlan
      ? await productionPlansApi.update(editPlan.id, { planDate, lines })
      : await productionPlansApi.create({ planDate, lines })
    return plan.id
  }

  // Edycja: czekamy aż lista się wczyta, żeby mieć initialPlan.
  if (id && loading) {
    return <div className="p-6 text-sm text-muted-foreground">Wczytuję plan…</div>
  }
  if (id && !editPlan) {
    return (
      <div className="p-6 space-y-3">
        <button onClick={back} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} /> Wróć do planów
        </button>
        <div className="text-sm text-destructive">Nie znaleziono planu do edycji.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={back}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
          <ArrowLeft size={15} /> Plany produkcji
        </button>
        <h1 className="text-lg font-bold text-ink">
          {editPlan ? `Edycja planu ${editPlan.planNo}` : 'Nowy plan produkcji'}
        </h1>
        {editPlan?.status === 'active' && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
            aktywny — wyprodukowane pozycje zablokowane
          </span>
        )}
      </div>

      <PlanForm
        initialPlan={editPlan ?? undefined}
        onSave={handleSave}
        onClose={back}
        existingPlans={plans ?? []}
      />
    </div>
  )
}
