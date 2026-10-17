import type { ClientOrder, OrderFulfillment, OrderLine } from '@/lib/mockApi'

export const kgNumber = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3, useGrouping: true })
export const percentNumber = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
export const kgText = (value: number | null) => value === null ? '—' : `${kgNumber.format(value)} kg`
/** Current policy: allocated stock + deliveries, never plan reports.
 * Future per-piece scan authority requires an explicit business cutover;
 * see docs/ORDER_PROGRESS_POLICY.md. No auto-switch on the first scan.
 */
export function lineProgress(line: OrderLine) {
  const { qty, qtyStock, qtyDelivered, kgPerUnit, fulfillment } = line
  const validQty = (n: number | undefined): n is number => n !== undefined && Number.isSafeInteger(n) && n >= 0
  if (!fulfillment || !validQty(qty) || !validQty(qtyStock) || !validQty(qtyDelivered) || !Number.isFinite(kgPerUnit) || kgPerUnit <= 0) return null
  const deliveredQty = Math.min(qty, qtyDelivered)
  const stockQty = Math.min(qty - deliveredQty, qtyStock)
  const readyQty = stockQty + deliveredQty
  const readyKg = milli(readyQty * kgPerUnit) / 1000
  const remainingKg = milli((qty - readyQty) * kgPerUnit) / 1000
  if (!Number.isFinite(fulfillment.coveredKg) || !Number.isFinite(fulfillment.remainingKg)
    || Math.abs(fulfillment.coveredKg - readyKg) > .001 || Math.abs(fulfillment.remainingKg - remainingKg) > .001) return null
  return { readyQty, readyKg, remainingQty: qty - readyQty, remainingKg, stockQty, deliveredQty, percent: qty > 0 ? readyQty / qty * 100 : 0 }
}

export function progressTotals(lines: OrderLine[]) {
  const progress = lines.map(lineProgress)
  const known = progress.every(p => p !== null)
  const orderedQty = lines.reduce((s, l) => s + l.qty, 0)
  return {
    orderedQty,
    readyQty: known ? progress.reduce((s, p) => s + p!.readyQty, 0) : null,
    readyKg: known ? progress.reduce((s, p) => s + milli(p!.readyKg), 0) / 1000 : null,
    remainingQty: known ? progress.reduce((s, p) => s + p!.remainingQty, 0) : null,
    remainingKg: known ? progress.reduce((s, p) => s + milli(p!.remainingKg), 0) / 1000 : null,
    // A surplus of one variant never completes a different variant.
    percent: known ? coveragePercent(totalLines(lines)) : null,
  }
}

export function mixingTotals(lines: OrderLine[]) {
  const sum = (key: 'remainingKg' | 'meatKg' | 'additivesKg') => lines.some(l => l.mixing?.[key] == null) ? null : lines.reduce((s, l) => s + milli(l.mixing![key]!), 0) / 1000
  return { remainingKg: sum('remainingKg'), meatKg: sum('meatKg'), additivesKg: sum('additivesKg') }
}
// The API has NUMERIC(...,3) kilograms. Add integers, not floating point tails.
const milli = (value: number) => Math.round(value * 1000)
export type PlanningTotals = { [K in keyof OrderFulfillment]: number | null } & { orderedKg: number }

export function totalLines(lines: OrderLine[]): PlanningTotals {
  let ordered = 0
  const totals = { stockKg: 0, deliveredKg: 0, coveredKg: 0, remainingKg: 0 }
  let known = true
  for (const line of lines) {
    ordered += milli(line.fulfillment?.orderedKg ?? line.qty * line.kgPerUnit)
    if (!line.fulfillment) { known = false; continue }
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] += milli(line.fulfillment[key])
    }
  }
  return {
    orderedKg: ordered / 1000,
    stockKg: known ? totals.stockKg / 1000 : null,
    deliveredKg: known ? totals.deliveredKg / 1000 : null,
    coveredKg: known ? totals.coveredKg / 1000 : null,
    remainingKg: known ? totals.remainingKg / 1000 : null,
  }
}

export function coveragePercent(t: PlanningTotals): number | null {
  return t.coveredKg === null ? null : t.orderedKg > 0 ? Math.min(100, t.coveredKg / t.orderedKg * 100) : 0
}

export function productionState(t: PlanningTotals) {
  if (t.coveredKg === null) return 'unknown'
  if (t.orderedKg > 0 && t.remainingKg === 0) return 'complete'
  return t.coveredKg > 0 ? 'partial' : 'none'
}

export interface RecipeDemand {
  key: string
  name: string
  totals: PlanningTotals
  details: { order: ClientOrder; line: OrderLine }[]
}

export function summarizeOrders(orders: ClientOrder[]) {
  const included = orders.filter(o => o.status !== 'cancelled')
  const groups = new Map<string, Omit<RecipeDemand, 'totals'>>()
  for (const order of included) {
    for (const line of order.lines) {
      // Never merge by display name: different recipe IDs may share a name.
      // Unknown recipes remain isolated, as do ALL detail rows / variants.
      const key = line.recipeId ? `recipe:${line.recipeId}` : `unknown:${order.id}:${line.id}`
      const group = groups.get(key) ?? { key, name: line.recipeName || 'Nieznana receptura', details: [] }
      group.details.push({ order, line })
      groups.set(key, group)
    }
  }
  const recipes: RecipeDemand[] = [...groups.values()].map(g => ({
    ...g, totals: totalLines(g.details.map(d => d.line)),
  })).sort((a, b) => (b.totals.remainingKg ?? -1) - (a.totals.remainingKg ?? -1) || a.name.localeCompare(b.name, 'pl'))
  return {
    totals: totalLines(included.flatMap(o => o.lines)),
    recipes,
    excludedCount: orders.length - included.length,
    closedCount: included.filter(o => o.status === 'done').length,
    draftCount: included.filter(o => o.status === 'draft').length,
    unknownCount: included.filter(o => o.lines.some(l => !l.fulfillment)).length,
  }
}
