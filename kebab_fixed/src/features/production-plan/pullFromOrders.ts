/**
 * pullFromOrders — pozycje zamówień do wciągnięcia w plan dnia.
 *
 * Plan powstaje „po połowie": część z zamówień klientów, część z decyzji
 * szefa. Kluczowa liczba to ILE JESZCZE ZOSTAŁO z pozycji zamówienia —
 * pozycja częściowo wyprodukowana nie może wjechać do planu w pełnej ilości,
 * bo zakład zrobiłby ją drugi raz.
 *
 * Zero importów z React/UI — testowane w node.
 */
import { emptyPlanLine, type PlanLine } from './planLineModel'

export interface OrderLineLite {
  id:             string
  qty:            number
  kgPerUnit:      number
  productTypeId?: string
  recipeId:       string
  packagingId?:   string | null
}

export interface OrderLite {
  id:          string
  orderNo:     string
  clientId:    string
  clientName:  string
  status?:     string
  lines:       OrderLineLite[]
}

/** Postęp produkcji per pozycja zamówienia (z clientOrdersApi.productionProgress). */
export type ProgressByLine = Record<string, { qtyRemaining?: number }>

export interface PullableLine {
  orderId:        string
  orderNo:        string
  clientId:       string
  clientName:     string
  lineId:         string
  productTypeId:  string
  recipeId:       string
  packagingId:    string
  kgPerUnit:      number
  /** Ile sztuk zostało do wyprodukowania. */
  qtyRemaining:   number
  /** Kilogramy RESZTY, nie całego zamówienia. */
  kg:             number
}

export function pullableLines(
  orders: OrderLite[], progress: ProgressByLine,
): PullableLine[] {
  const out: PullableLine[] = []
  for (const o of orders ?? []) {
    // Do planu wchodzą wyłącznie zamówienia POTWIERDZONE — szkic może się
    // jeszcze zmienić, a plan rezerwuje pod niego mięso.
    if (o.status && o.status !== 'confirmed') continue
    for (const l of o.lines ?? []) {
      const zostalo = progress[l.id]?.qtyRemaining ?? l.qty
      if (!(zostalo > 0)) continue
      out.push({
        orderId:       o.id,
        orderNo:       o.orderNo,
        clientId:      o.clientId,
        clientName:    o.clientName,
        lineId:        l.id,
        productTypeId: l.productTypeId ?? '',
        recipeId:      l.recipeId,
        packagingId:   l.packagingId ?? '',
        kgPerUnit:     Number(l.kgPerUnit ?? 0),
        qtyRemaining:  zostalo,
        kg:            Math.round(zostalo * Number(l.kgPerUnit ?? 0) * 10) / 10,
      })
    }
  }
  return out
}

/**
 * Wciągnięte pozycje w kształcie szkicu planu.
 *
 * Powiązanie z pozycją zamówienia (`clientOrderLineId`) jedzie dalej — po nim
 * rozlicza się zamówienie i po nim liczy się „ile jeszcze zostało" przy
 * następnym planowaniu. Partii NIE ustawiamy: dobierze je FEFO, bo zależą
 * od ilości, a ta bywa mniejsza niż w zamówieniu.
 */
export function toPlanLines(picked: PullableLine[]): PlanLine[] {
  return picked.map(p => ({
    ...emptyPlanLine(),
    qty:               String(p.qtyRemaining),
    kgPerUnit:         String(p.kgPerUnit),
    productTypeId:     p.productTypeId,
    recipeId:          p.recipeId,
    packagingId:       p.packagingId,
    clientId:          p.clientId,
    clientName:        p.clientName,
    clientOrderId:     p.orderId,
    clientOrderNo:     p.orderNo,
    clientOrderLineId: p.lineId,
  }))
}
