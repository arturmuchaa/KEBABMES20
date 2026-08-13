/**
 * Ręczne potwierdzanie wykonanej produkcji PRZEZ BIURO.
 *
 * Rozwiązanie TYMCZASOWE — dopóki hala nie ma kiosku, biuro wpisuje wykonane
 * sztuki z kartki (karty produkcji) i zatwierdza plan.
 *
 * Wpisy mają DOKŁADNIE ten sam kształt co te z tabletu, bo idą tą samą
 * ścieżką: tablet-finish → office-confirm → finish_day. To ona tworzy wyroby
 * gotowe z podziałem na partie, zwalnia rezerwacje mięsa i zamyka plan —
 * dublowanie jej dla biura rozjechałoby traceability.
 */
import type { ProductionPlan, ProductionPlanLine } from '@/lib/mockApi'

export interface OfficeFinishEntry {
  planLineId:       string
  qty:              number
  workerNames:      string[]
  kgPerUnit:        number
  productTypeId:    string
  productTypeName:  string
  recipeId:         string
  recipeName:       string
  packagingId?:     string
  packagingName?:   string
  clientOrderId?:   string
  clientOrderNo?:   string
  clientName?:      string
  seasonedBatchNos: string[]
}

const qtyDoneOf = (l: ProductionPlanLine): number =>
  Math.max(0, Number((l as any).qtyDone ?? 0))

function batchNosOf(l: ProductionPlanLine): string[] {
  const nos = (l as any).seasonedBatchNos
  if (Array.isArray(nos) && nos.length > 0) return nos
  return l.seasonedBatchNo ? [l.seasonedBatchNo] : []
}

/**
 * Wpisy do zatwierdzenia — domyślnie tylko pozycje z realnym wykonaniem.
 * `workerNames` puste: biuro potwierdza zbiorczo, bez podziału na ludzi
 * (kiosk na hali doda to później).
 *
 * `all: true` = „zatwierdź wszystko": każda pozycja idzie w PEŁNEJ zaplanowanej
 * ilości, bez wpisywania sztuka po sztuce. Typowy dzień, w którym hala zrobiła
 * dokładnie to, co zaplanowano.
 */
export function buildOfficeFinishEntries(
  plan: ProductionPlan,
  opts: { all?: boolean } = {},
): OfficeFinishEntry[] {
  const qtyOf = (l: ProductionPlanLine) =>
    opts.all ? Math.max(0, Number(l.qty) || 0) : qtyDoneOf(l)
  return (plan?.lines ?? [])
    .filter(l => qtyOf(l) > 0)
    .map(l => ({
      planLineId:       l.id,
      qty:              qtyOf(l),
      workerNames:      [],
      kgPerUnit:        Number(l.kgPerUnit) || 0,
      productTypeId:    l.productTypeId || '',
      productTypeName:  l.productTypeName || '',
      recipeId:         l.recipeId || '',
      recipeName:       l.recipeName || '',
      packagingId:      l.packagingId,
      packagingName:    l.packagingName,
      clientOrderId:    l.clientOrderId,
      clientOrderNo:    l.clientOrderNo,
      clientName:       l.clientName,
      seasonedBatchNos: batchNosOf(l),
    }))
}

export interface OfficeFinishSummary {
  lines:   number
  pieces:  number
  kg:      number
  /** Pozycje wykonane w części — biuro ma to zobaczyć przed zatwierdzeniem. */
  partial: number
}

export function officeFinishSummary(plan: ProductionPlan): OfficeFinishSummary {
  const done = (plan?.lines ?? []).filter(l => qtyDoneOf(l) > 0)
  return {
    lines:   done.length,
    pieces:  done.reduce((s, l) => s + qtyDoneOf(l), 0),
    kg:      done.reduce((s, l) => s + qtyDoneOf(l) * (Number(l.kgPerUnit) || 0), 0),
    partial: done.filter(l => qtyDoneOf(l) < (Number(l.qty) || 0)).length,
  }
}
