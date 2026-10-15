import type { ClientOrder, OrderFulfillment, OrderLine } from '@/lib/mockApi'

export const kgNumber = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3, useGrouping: true })
export const percentNumber = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
export const kgText = (value: number | null) => value === null ? '—' : `${kgNumber.format(value)} kg`
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
