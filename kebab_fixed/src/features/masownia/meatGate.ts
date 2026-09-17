/**
 * Bramka partii — jedyna różnica panelu wobec prototypu 0.9.
 *
 * Biuro planując masowanie może wskazać partie mięsa (`mixing_order_lots`).
 * Jeśli wskazało, operator ma do wyboru TYLKO te partie; reszta zostaje na
 * ekranie, ale szara — mięso jest, tylko nie to. Jeśli biuro nie wskazało nic
 * (8 z 12 ostatnich zleceń na produkcji), wolno wziąć wszystko, co leży.
 *
 * Kafelki odrzucone nie znikają i nie przesuwają siatki: operator ma stały
 * układ ekranu i widzi, czego nie wolno, zamiast szukać znikającego kafelka.
 */
import type { MeatTile } from './meatTiles'

export interface GatedTile extends MeatTile {
  allowed: boolean
  /** Powód odmowy pod kafelkiem; pusty, gdy kafelek jest dostępny. */
  reason: string
}

export interface OrderLot {
  meatLotNo: string
}

const numery = (orderLots: OrderLot[]) =>
  orderLots.map(l => (l.meatLotNo || '').trim()).filter(Boolean)

export function officeChoiceLabel(orderLots: OrderLot[]): string {
  return numery(orderLots).join(', ')
}

export function gateMeatTiles(tiles: MeatTile[], orderLots: OrderLot[]): GatedTile[] {
  const plan = new Set(numery(orderLots))
  if (plan.size === 0) {
    return tiles.map(t => ({ ...t, allowed: true, reason: '' }))
  }
  const etykieta = officeChoiceLabel(orderLots)
  return tiles.map(t => {
    // Paleta mieszana przechodzi tylko w komplecie: jeden dotyk nie może
    // wciągnąć do wsadu partii spoza planu, bo po zamknięciu pokrywy nikt
    // tego nie odkręci.
    const spoza = t.lots.map(l => l.lotNo).filter(no => !plan.has(no))
    if (spoza.length === 0) return { ...t, allowed: true, reason: '' }
    const reason = t.lots.length > 1
      ? `Na palecie jest też partia ${spoza.join(', ')}, spoza planu`
      : `Biuro wybrało ${plan.size > 1 ? 'partie' : 'partię'} ${etykieta}`
    return { ...t, allowed: false, reason }
  })
}
