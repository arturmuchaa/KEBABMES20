/**
 * planDraftMath — arytmetyka szkicu planu produkcji.
 *
 * Wyjęte z `PlanForm`, bo to na tych dwóch rachunkach opiera się cała
 * odpowiedź na pytanie „czy starczy mięsa", a w środku komponentu nie dało
 * się ich sprawdzić bez DOM-u.
 *
 * Zero importów z React/UI — testowane w node.
 */
import { num, type PlanLine } from './planLineModel'
import type { PlanAllocation } from './planMeatAllocation'
import type { BatchPanelRow } from './components/BatchPanel'

export interface SeasonedLite {
  id:             string
  recipeId:       string
  recipeName?:    string
  batchNo?:       string
  productionDay?: string
  expiryDate?:    string
  kgFree?:        number
  kgAvailable?:   number
}

interface RecipeLite {
  id:          string
  name?:       string
  /** Skład produkcyjny (70/30). Niepusty = partie dobiera backend. */
  components?: unknown[]
}

/**
 * Żywe zapotrzebowanie kg per receptura — WSZYSTKIE pozycje szkicu, także te
 * BEZ przypisanych partii: saldo w panelu ma schodzić już przy wpisaniu
 * szt × kg i wracać po usunięciu pozycji.
 *
 * Receptury komponentowe (70/30) świadomie POMIJAMY — ich partie dobiera
 * backend per komponent, a liczenie ich tutaj pokazywałoby fałszywy brak.
 */
export function demandByRecipe(
  lines: PlanLine[], recipes: RecipeLite[],
): Record<string, { name: string; kg: number }> {
  const out: Record<string, { name: string; kg: number }> = {}
  for (const l of lines) {
    if (!l.recipeId) continue
    const r = recipes.find(x => x.id === l.recipeId)
    if ((r?.components?.length ?? 0) > 0) continue
    const kg = num(l.qty) * num(l.kgPerUnit)
    if (kg <= 0) continue
    const cur = out[l.recipeId] ?? { name: r?.name ?? l.recipeId, kg: 0 }
    cur.kg += kg
    out[l.recipeId] = cur
  }
  return out
}

/**
 * Które pozycje planu biorą z której partii — numery pozycji od 1, w kolejności
 * wyświetlania. To jedyna informacja pozwalająca planiście świadomie zmienić
 * przydział ręcznie.
 *
 * Liczą się oba rodzaje pobrania: sztuki CAŁE z jednej partii (`perBatch`)
 * i sztuki złożone z resztek (`joined`).
 */
export function usedLinesByBatch(alloc: PlanAllocation): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  const dopisz = (batchId: string, nr: number) => {
    const lista = out[batchId] ?? []
    if (!lista.includes(nr)) lista.push(nr)
    out[batchId] = lista
  }
  alloc.lines.forEach((la, i) => {
    for (const t of la.perBatch) dopisz(t.batchId, i + 1)
    for (const j of la.joined) for (const p of j.parts) dopisz(p.batchId, i + 1)
  })
  return out
}

/** Wiersze panelu partii: wolne kg PO przydziale szkicu + kto z nich bierze. */
export function buildBatchRows(
  seasoned: SeasonedLite[], alloc: PlanAllocation,
): BatchPanelRow[] {
  const uzycie = usedLinesByBatch(alloc)
  return seasoned.map(s => ({
    id:            s.id,
    recipeId:      s.recipeId,
    recipeName:    s.recipeName ?? s.recipeId,
    batchNo:       s.batchNo ?? '',
    productionDay: s.productionDay,
    // Brak klucza w `freeByBatch` = partia nietknięta przez ten szkic.
    kgFreeLive:    alloc.freeByBatch[s.id] ?? Math.max(0, Number(s.kgFree ?? s.kgAvailable ?? 0)),
    usedByLines:   uzycie[s.id] ?? [],
  }))
}
