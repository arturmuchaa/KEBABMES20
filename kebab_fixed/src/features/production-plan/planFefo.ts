/**
 * planFefo — przydział partii przyprawionego do pozycji planu produkcji.
 *
 * Wyjęte z `PlanForm.autoAssignRecipe`, z jedną różnicą: pozycja ruszona
 * ręcznie niesie znacznik `batchesManual` i automat jej NIE nadpisuje.
 * Bez tego znacznika nie dało się przeliczyć planu od nowa, nie depcząc
 * decyzji planisty — a i odwrotnie: każda ręczna zmiana ginęła przy
 * następnym wpisanym kilogramie.
 *
 * Pozycje rozpoczęte na hali (`qtyDone > 0`) są ZAMROŻONE i nie rusza ich
 * nawet `force`: ich mięso już poszło w produkcję.
 *
 * Partię dokładamy tylko wtedy, gdy zmieści choć jedną CAŁĄ sztukę — sztuka
 * nosi jeden numer partii (patrz `planMeatAllocation`, JOIN_LEFTOVER_PIECES).
 *
 * JEDEN wspólny przebieg po pozycjach: pozycje biorą z puli po kolei, więc
 * dwie pozycje tej samej receptury nie zgłoszą tych samych kilogramów.
 *
 * Zero importów z React/UI — czysta logika, testowana w node.
 */
import { fefoLotCompare } from '@/lib/utils/fefo'
import { allocatePlanMeat } from './planMeatAllocation'
import { lineComponents, type CompositionCatalog } from './planComponents'

export interface FefoLine {
  productTypeId?: string
  recipeId:          string
  qty:               string | number
  kgPerUnit:         string | number
  seasonedBatchIds?: string[]
  seasonedBatchId?:  string
  /** Partie wybrał człowiek — automat ma je zostawić w spokoju. */
  batchesManual?:    boolean
  /** Sztuki wykonane na hali; > 0 = pozycja zamrożona. */
  qtyDone?:          number
}

export interface FefoBatch {
  materialTypeId?: string
  id:          string
  recipeId:    string
  batchNo?:    string
  expiryDate?: string
  /** Wolne kilogramy partii PO uwzględnieniu rezerwacji tego planu. */
  kgFree:      number
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Pozycja zamrożona — hala już z niej produkuje. */
const zamrozona = (l: FefoLine): boolean => num(l.qtyDone) > 0

/** Czy pozycja ma już jakiekolwiek partie. */
const maPartie = (l: FefoLine): boolean =>
  (l.seasonedBatchIds?.length ?? 0) > 0 || !!l.seasonedBatchId

export function assignFefo<T extends FefoLine>(
  lines: T[],
  batches: FefoBatch[],
  opts: { recipeId?: string; force?: boolean; catalog?: CompositionCatalog } = {},
): T[] {
  const pula = [...batches]
    .filter(b => b.kgFree > 0)
    .sort((a, b) => fefoLotCompare(
      { expiryDate: a.expiryDate, no: a.batchNo, id: a.id },
      { expiryDate: b.expiryDate, no: b.batchNo, id: b.id },
    ))
    .map(b => ({ ...b, rem: b.kgFree }))

  return lines.map(line => {
    if (opts.recipeId && line.recipeId !== opts.recipeId) return line
    if (zamrozona(line)) return line
    if (!opts.force && (line.batchesManual || maPartie(line))) return line

    const qty  = num(line.qty)
    const kgPu = num(line.kgPerUnit)
    if (!line.recipeId || qty <= 0 || kgPu <= 0) return line

    const components = lineComponents(line, opts.catalog)
    if (components.length > 0) {
      const candidates = pula.filter(b => b.recipeId === line.recipeId
        && components.some(c => c.materialTypeId === b.materialTypeId) && b.rem > 0)
      const ids = candidates.map(b => b.id)
      const alloc = allocatePlanMeat([{ ...line, seasonedBatchIds: ids, seasonedBatchId: '' }],
        pula.map(b => ({ ...b, kgFree: b.rem })), opts.catalog)
      const used = ids.filter(id => (alloc.usedByBatch[id] ?? 0) > 0)
      for (const b of pula) b.rem = alloc.freeByBatch[b.id] ?? b.rem
      const selected = used.length > 0 ? used : ids
      return { ...line, seasonedBatchIds: selected, seasonedBatchId: selected[0] ?? '', batchesManual: false }
    }

    let zostaloSztuk = qty
    const przydzielone: string[] = []
    for (const b of pula) {
      if (zostaloSztuk <= 0) break
      if (b.recipeId !== line.recipeId) continue
      const sztuk = Math.min(zostaloSztuk, Math.floor(b.rem / kgPu))
      if (sztuk <= 0) continue
      b.rem -= sztuk * kgPu
      zostaloSztuk -= sztuk
      przydzielone.push(b.id)
    }

    if (przydzielone.length === 0) return line
    return {
      ...line,
      seasonedBatchIds: przydzielone,
      seasonedBatchId:  przydzielone[0],
      batchesManual:    false,
    }
  })
}

/** Zdejmij znaczniki ręczne przed przeliczeniem planu od nowa.
 *  Pozycji rozpoczętych nie dotyka — one i tak zostaną nietknięte. */
export function clearManual<T extends FefoLine>(lines: T[]): T[] {
  return lines.map(l => (zamrozona(l) ? l : { ...l, batchesManual: false }))
}
