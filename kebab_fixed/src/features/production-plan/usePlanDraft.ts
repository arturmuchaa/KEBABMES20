/**
 * usePlanDraft — stan szkicu planu produkcji.
 *
 * Świadomie CIENKI: cała arytmetyka (przydział FEFO, zapotrzebowanie, wiersze
 * panelu partii, braki) siedzi w czystych modułach obok i ma własne testy.
 * Tutaj zostaje wyłącznie trzymanie stanu i spinanie tego w jedno.
 */
import { useCallback, useMemo, useState } from 'react'
import { todayIso } from '@/lib/utils'
import { withOwnReservations } from './planOwnReservations'
import { allocatePlanMeat } from './planMeatAllocation'
import { assignFefo } from './planFefo'
import { lineKg, type PlanLine } from './planLineModel'
import {
  demandByRecipe, buildBatchRows, addLineWithFefo, recalcAll, planLinesFromPlan,
  type SeasonedLite,
} from './planDraftMath'
import { planShortfalls } from './planShortfalls'

interface RecipeLite { id: string; name?: string; components?: any[] }

export function usePlanDraft({ initialPlan, seasoned, recipes }: {
  initialPlan?: { planDate?: string; lines?: any[] } | null
  seasoned:     SeasonedLite[]
  recipes:      RecipeLite[]
}) {
  const [planDate, setPlanDate] = useState(initialPlan?.planDate ?? todayIso())
  // Zasianie RAZ, przez inicjator useState: kolejny przelot API (polling)
  // nie może skasować tego, co planista zdążył wpisać.
  const [lines, setLines] = useState<PlanLine[]>(() => planLinesFromPlan(initialPlan))

  /**
   * Mięso trzymane przez WŁASNE pozycje edytowanego planu wraca do puli —
   * backend przy zapisie i tak zwolni te rezerwacje (`_restore_reservations`),
   * więc bez tego formularz blokowałby zapis „brakuje kg" na własnym mięsie.
   * Pozycje rozpoczęte (qtyDone>0) są zamrożone — ich kg NIE wracają.
   */
  const seasonedRaw = useMemo(
    () => withOwnReservations(seasoned as any[], (initialPlan?.lines ?? []) as any[]) as SeasonedLite[],
    [seasoned, initialPlan],
  )

  const planAlloc  = useMemo(() => allocatePlanMeat(lines, seasonedRaw as any), [lines, seasonedRaw])
  const batchRows  = useMemo(() => buildBatchRows(seasonedRaw, planAlloc), [seasonedRaw, planAlloc])
  const demand     = useMemo(() => demandByRecipe(lines, recipes), [lines, recipes])
  const totalKg    = useMemo(() => lines.reduce((s, l) => s + lineKg(l), 0), [lines])

  const addLine = useCallback(
    (l: PlanLine) => setLines(prev => addLineWithFefo(prev, l, seasonedRaw)),
    [seasonedRaw],
  )
  const replaceLine = useCallback(
    (i: number, l: PlanLine) => setLines(prev => prev.map((x, j) => (j === i ? l : x))),
    [],
  )
  const removeLine = useCallback(
    (i: number) => setLines(prev => prev.filter((_, j) => j !== i)),
    [],
  )
  /**
   * Ręczna zmiana partii — od tej chwili FEFO tej pozycji nie nadpisuje.
   *
   * PUSTA lista znaczy „oddaj tę pozycję automatowi": zdejmujemy znacznik
   * ręczny i od razu przydzielamy jej partie od nowa. Bez tego „Zostaw FEFO"
   * zapisywałoby pozycję jako ręcznie pustą i zostawałaby bez mięsa.
   */
  const setLineBatches = useCallback((i: number, ids: string[]) => {
    setLines(prev => {
      const zmienione = prev.map((x, j) => (j === i
        ? {
            ...x,
            seasonedBatchIds: ids,
            seasonedBatchId:  ids[0] ?? '',
            batchesManual:    ids.length > 0,
          }
        : x))
      if (ids.length > 0) return zmienione
      // Pula musi być pomniejszona o to, co trzymają POZOSTAŁE pozycje.
      const bezTej = zmienione.map((x, j) => (j === i
        ? { ...x, seasonedBatchIds: [], seasonedBatchId: '' }
        : x))
      const alloc = allocatePlanMeat(bezTej, seasonedRaw as any)
      return assignFefo(bezTej, seasonedRaw.map(s => ({
        id: s.id, recipeId: s.recipeId, batchNo: s.batchNo, expiryDate: s.expiryDate,
        kgFree: alloc.freeByBatch[s.id] ?? Math.max(0, Number(s.kgFree ?? s.kgAvailable ?? 0)),
      })))
    })
  }, [seasonedRaw])
  const recalcFefo = useCallback(
    () => setLines(prev => recalcAll(prev, seasonedRaw)),
    [seasonedRaw],
  )

  const shortfalls = useCallback(
    (toProduction: boolean) => planShortfalls(lines, seasonedRaw as any, recipes, planAlloc, toProduction),
    [lines, seasonedRaw, recipes, planAlloc],
  )

  return {
    planDate, setPlanDate,
    lines, addLine, replaceLine, removeLine, setLineBatches, recalcFefo,
    planAlloc, batchRows, demand, totalKg, shortfalls,
  }
}
