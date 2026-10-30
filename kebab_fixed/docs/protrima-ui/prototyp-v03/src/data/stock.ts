/**
 * Magazyn wyrobu gotowego — DANE DEMONSTRACYJNE.
 * Pozycje przydzielone są budowane z zamówień (line.stock), więc oba moduły
 * pokazują ten sam stan. Każda zmiana stanu ma ruch magazynowy (zasada KEBABMES20).
 */
import { addDays, TODAY, pad2, type Order } from './model'

export type StockStatus = 'stock' | 'pallet' | 'blocked'

export interface Movement { at: string; type: string; qty: number; who: string; doc?: string }

export interface StockPos {
  id: string
  product: string
  recipe: string
  kgPerUnit: number
  packaging: string
  batch: string
  prodDate: Date
  bestBefore: Date
  location: string
  qty: number
  orderId?: string
  lineId?: string
  palletNo?: number
  cartons: string[]
  status: StockStatus
  blockReason?: string
  movements: Movement[]
}

const d6 = (d: Date) => `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
const dm = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`
const packFor = (k: number) => k <= 10 ? 'Tuleja 30 cm' : k >= 30 ? 'Tuleja metal 80 cm' : 'Tuleja metal 65 cm'
const LOC = ['Mroźnia M1 · R01', 'Mroźnia M1 · R02', 'Mroźnia M1 · R04', 'Mroźnia M2 · R01', 'Mroźnia M2 · R03', 'Chłodnia C1 · strefa wydań']
let cartonSeq = 600
const cartons = (n: number) => Array.from({ length: n }, () => String(++cartonSeq).padStart(6, '0'))

export function buildStock(orders: Order[]): StockPos[] {
  const out: StockPos[] = []
  let i = 0
  for (const o of orders) {
    if (o.status === 'done' || o.status === 'cancelled') continue
    for (const l of o.lines) {
      if (l.stock <= 0) continue
      // Większe ilości dzielimy na dwie partie z różnych dni
      const parts = l.stock > 20 ? [Math.ceil(l.stock * 0.6), l.stock - Math.ceil(l.stock * 0.6)] : [l.stock]
      parts.forEach((q, k) => {
        i++
        const prod = addDays(TODAY, -(1 + ((i + k) % 3)))
        const pallet = o.pallets.find(p => p.status !== 'created' && p.status !== 'packing' && p.items.some(it => it.lineId === l.id))
        const batch = `P-${d6(prod)}-${pad2(1 + (i % 6))}`
        const nC = Math.max(1, Math.ceil(q / 4))
        out.push({
          id: `s${i}-${k}`, product: l.product, recipe: l.recipe, kgPerUnit: l.kgPerUnit, packaging: l.packaging,
          batch, prodDate: prod, bestBefore: addDays(prod, 180), location: pallet ? 'Strefa wydań · palety' : LOC[i % LOC.length],
          qty: q, orderId: o.id, lineId: l.id, palletNo: pallet?.no, cartons: cartons(nC), status: pallet ? 'pallet' : 'stock',
          movements: [
            ...(pallet ? [{ at: `${dm(TODAY)} 09:5${i % 10}`, type: `Spakowano na paletę ${pallet.no}`, qty: q, who: 'Skaner MG-01', doc: `karton ${pallet.carton}` }] : []),
            { at: `${dm(prod)} 16:${pad2(10 + (i % 40))}`, type: `Przydział do ${o.no}`, qty: q, who: 'System (przydział globalny)' },
            { at: `${dm(prod)} 15:${pad2(5 + (i % 50))}`, type: 'Przyjęcie z produkcji', qty: q, who: `Tablet T-0${1 + (i % 4)}`, doc: batch },
          ],
        })
      })
    }
  }
  const free: Array<[string, string, number, number, number, string?]> = [
    ['Kebab mix 95/5', 'BEYAZ', 15, 6, 2],
    ['Kebab udo 100%', 'KIRMIZI', 20, 9, 1],
    ['Kebab mix 95/5', 'WROCŁAW', 25, 8, 3],
    ['Kebab udo 100%', 'GOLD', 15, 12, 1],
    ['Kebab udo 100%', 'KIRMIZI', 15, 14, 172],
    ['Kebab drobiowo-wołowy 70/30', 'BERLIN', 20, 10, 2, 'Kontrola jakości: odchylenie masy partii — czeka na decyzję technologa'],
  ]
  free.forEach(([product, recipe, kgu, qty, age, block], k) => {
    const prod = addDays(TODAY, -age)
    const batch = `P-${d6(prod)}-${pad2(3 + k)}`
    out.push({
      id: `f${k}`, product, recipe, kgPerUnit: kgu, packaging: packFor(kgu), batch, prodDate: prod, bestBefore: addDays(prod, 180),
      location: block ? 'Mroźnia M2 · strefa QC' : LOC[(k + 2) % LOC.length], qty, cartons: cartons(Math.max(1, Math.ceil(qty / 4))),
      status: block ? 'blocked' : 'stock', blockReason: block,
      movements: [
        ...(block ? [{ at: `${dm(prod)} 17:20`, type: 'Blokada jakościowa', qty, who: 'Kontrola jakości' }] : []),
        { at: `${dm(prod)} 15:${pad2(20 + k)}`, type: 'Przyjęcie z produkcji', qty, who: 'Tablet T-02', doc: batch },
      ],
    })
  })
  return out
}

export const posKg = (p: StockPos) => p.qty * p.kgPerUnit
export const daysLeft = (p: StockPos) => Math.round((p.bestBefore.getTime() - TODAY.getTime()) / 86_400_000)
export const STOCK_STATUS: Record<StockStatus, string> = { stock: 'Na stanie', pallet: 'Na palecie', blocked: 'Zablokowane' }
