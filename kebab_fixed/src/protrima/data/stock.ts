/**
 * Magazyn wyrobu gotowego — pozycje z `finishedGoodsApi.list()` (mapowane w `mapuj.ts`).
 * Każda zmiana stanu ma ruch magazynowy po stronie backendu; tu jest tylko widok.
 */
import { TODAY } from './model'

export type StockStatus = 'stock' | 'pallet' | 'blocked'

export interface Movement { at: string; type: string; qty: number; who: string; doc?: string }

export interface StockPos {
  id: string
  product: string
  recipe: string
  recipeId: string
  /** Rodzaj z wiersza magazynu — do poprawki rodzaju (PoprawWyrob). */
  productTypeId?: string
  /** Ile sztuk z tej partii już wyjechało — po wyjeździe rodzaju/receptury się nie poprawia. */
  qtyShipped?: number
  kgPerUnit: number
  packaging: string
  batch: string
  prodDate?: Date
  /** API wyrobu gotowego nie podaje daty przydatności — wtedy brak. */
  bestBefore?: Date
  location: string
  qty: number
  orderId?: string
  /** Numer zamówienia z wiersza magazynu — także gdy zamówienie jest zamknięte i nie ma go na liście. */
  orderNo?: string
  clientName?: string
  lineId?: string
  palletNo?: number
  cartons: string[]
  status: StockStatus
  blockReason?: string
  movements: Movement[]
  planNo?: string
  seasonedBatches: string[]
  producedBy: string[]
}

export const posKg = (p: StockPos) => p.qty * p.kgPerUnit
/** Dni do końca przydatności; null, gdy data nie jest znana. */
export const daysLeft = (p: StockPos): number | null =>
  p.bestBefore ? Math.round((p.bestBefore.getTime() - TODAY.getTime()) / 86_400_000) : null
export const STOCK_STATUS: Record<StockStatus, string> = { stock: 'Na stanie', pallet: 'Na palecie', blocked: 'Zablokowane' }
