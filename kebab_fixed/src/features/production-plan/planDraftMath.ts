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
import { allocatePlanMeat, type PlanAllocation } from './planMeatAllocation'
import { assignFefo, type FefoBatch } from './planFefo'
import { batchIdsFromAllocation } from './planMeatAllocation'
import { emptyPlanLine } from './planLineModel'
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
    // Surowe wolne kg — mianownik dla braku. Liczenie braku od `kgFreeLive`
    // odejmowałoby zapotrzebowanie planu DWA RAZY.
    kgFreeRaw:     Math.max(0, Number(s.kgFree ?? s.kgAvailable ?? 0)),
    // Brak klucza w `freeByBatch` = partia nietknięta przez ten szkic.
    kgFreeLive:    alloc.freeByBatch[s.id] ?? Math.max(0, Number(s.kgFree ?? s.kgAvailable ?? 0)),
    usedByLines:   uzycie[s.id] ?? [],
  }))
}

/** Partie widziane przez FEFO: wolne kg PO uwzględnieniu podanej alokacji. */
function pulaPo(seasoned: SeasonedLite[], alloc: PlanAllocation): FefoBatch[] {
  return seasoned.map(s => ({
    id:         s.id,
    recipeId:   s.recipeId,
    batchNo:    s.batchNo,
    expiryDate: s.expiryDate,
    kgFree:     alloc.freeByBatch[s.id] ?? Math.max(0, Number(s.kgFree ?? s.kgAvailable ?? 0)),
  }))
}

/**
 * Dopisz pozycję i od razu przydziel jej partie.
 *
 * Pula MUSI być pomniejszona o to, co zabrały już pozycje stojące na liście —
 * inaczej nowa pozycja zgłosiłaby te same kilogramy co poprzednia i backend
 * odrzuciłby cały plan. Stąd przydział liczymy na `freeByBatch` bieżącej
 * alokacji, a nie na surowych wolnych kilogramach partii.
 */
export function addLineWithFefo(
  lines: PlanLine[], nowa: PlanLine, seasoned: SeasonedLite[],
): PlanLine[] {
  const alloc = allocatePlanMeat(lines, seasoned as any)
  const przydzielona = assignFefo([nowa], pulaPo(seasoned, alloc))[0]
  return [...lines, przydzielona]
}

/**
 * Przelicz przydział całego planu od nowa.
 *
 * Zdejmujemy partie ze wszystkich pozycji POZA rozpoczętymi na hali, liczymy
 * co trzymają te rozpoczęte, i dopiero resztę rozdajemy FEFO. Wersja „na
 * skróty" — assignFefo z force na surowej puli — oddawałaby do rozdania mięso,
 * które fizycznie poszło już w produkcję.
 */
export function recalcAll(lines: PlanLine[], seasoned: SeasonedLite[]): PlanLine[] {
  const zdjete = lines.map(l => (num(l.qtyDone) > 0
    ? l
    : { ...l, seasonedBatchIds: [], seasonedBatchId: '', batchesManual: false }))
  // Po zdjęciu partii tylko pozycje zamrożone cokolwiek zajmują.
  const trzymaneRegularnie = allocatePlanMeat(zdjete, seasoned as any)
  return assignFefo(zdjete, pulaPo(seasoned, trzymaneRegularnie))
}

/**
 * Pozycje istniejącego planu w kształcie szkicu.
 *
 * Partie odczytujemy Z ALOKACJI: baza nie ma kolumny `seasoned_batch_ids`,
 * więc pozycja wielopartyjna gubiła po kliknięciu ołówka wszystkie partie
 * poza główną i świeciła „brakuje mięsa" (zgłoszenie 13.08.2026). Kolejność
 * bierze się z `seasonedBatchNos`, bo przydział idzie partia po partii.
 *
 * Wczytane partie liczą się jako RĘCZNE: ktoś je już raz zatwierdził
 * zapisem planu, więc automat nie ma prawa ich przemielić przy pierwszej
 * zmianie w innej pozycji.
 */
export function planLinesFromPlan(plan?: { lines?: any[] } | null): PlanLine[] {
  return (plan?.lines ?? []).map((l: any) => {
    const zAlokacji = batchIdsFromAllocation(l.batchAllocation, l.seasonedBatchNos)
    const ids = zAlokacji.length > 0
      ? zAlokacji
      : (l.seasonedBatchId ? [l.seasonedBatchId] : [])
    return {
      ...emptyPlanLine(),
      id:                l.id ?? '',
      qty:               String(l.qty ?? ''),
      kgPerUnit:         String(l.kgPerUnit ?? ''),
      productTypeId:     l.productTypeId ?? '',
      recipeId:          l.recipeId ?? '',
      packagingId:       l.packagingId ?? '',
      clientId:          l.clientId ?? '',
      clientName:        l.clientName ?? '',
      seasonedBatchIds:  ids,
      seasonedBatchId:   ids[0] ?? '',
      batchesManual:     ids.length > 0,
      qtyDone:           Number(l.qtyDone ?? 0) || undefined,
      clientOrderId:     l.clientOrderId ?? '',
      clientOrderNo:     l.clientOrderNo ?? '',
      clientOrderLineId: l.clientOrderLineId ?? '',
    }
  })
}
