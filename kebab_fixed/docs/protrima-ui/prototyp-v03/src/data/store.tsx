import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ORDERS } from './demo'
import { buildStock, type StockPos } from './stock'
import type { Order } from './model'

/**
 * Stan demo: zamówienia i magazyn wyrobu gotowego w jednym miejscu, żeby
 * przydział zrobiony w jednym module od razu był widoczny w drugim.
 * W docelowej aplikacji to warstwa API KEBABMES20 — backend jest jedynym źródłem prawdy.
 */
interface Store {
  orders: Order[]
  stock: StockPos[]
  byId: (id: string) => Order | undefined
  update: (id: string, fn: (o: Order) => Order) => void
  add: (o: Order) => void
  /** Przydziela `qty` szt. z pozycji magazynowej do pozycji zamówienia (z ruchem magazynowym). */
  allocate: (posId: string, orderId: string, lineId: string, qty: number) => void
  /** Zwalnia przydział pozycji — wyrób wraca do puli wolnej (z ruchem magazynowym). */
  release: (posId: string) => void
  /** WZ na wyrób z magazynu: magazyn → wydano; pozycje magazynowe znikają (ruch wydania). */
  issue: (orderId: string, wzNo: string) => void
  /** Anulowanie: przydzielony wyrób wraca do puli wolnej, historia zostaje. */
  cancel: (orderId: string, reason: string) => void
}
const Ctx = createContext<Store>(null as unknown as Store)
export const useOrders = () => useContext(Ctx)
export const useMes = useOrders

const NOW = '29.10 10:42'

export function OrdersProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<Order[]>(ORDERS)
  const [stock, setStock] = useState<StockPos[]>(() => buildStock(ORDERS))
  const update = useCallback((id: string, fn: (o: Order) => Order) => setOrders(list => list.map(o => o.id === id ? fn(o) : o)), [])
  const add = useCallback((o: Order) => setOrders(list => [o, ...list]), [])

  const allocate = useCallback((posId: string, orderId: string, lineId: string, qty: number) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    setStock(list => list.flatMap(p => {
      if (p.id !== posId) return [p]
      const mv = { at: NOW, type: `Przydział do ${order.no}`, qty, who: 'Anna Nowak' }
      if (qty >= p.qty) return [{ ...p, orderId, lineId, movements: [mv, ...p.movements] }]
      const keepCartons = Math.max(1, Math.round(p.cartons.length * (p.qty - qty) / p.qty))
      return [
        { ...p, qty: p.qty - qty, cartons: p.cartons.slice(0, keepCartons), movements: [{ at: NOW, type: `Podział partii — ${qty} szt. do ${order.no}`, qty: -qty, who: 'Anna Nowak' }, ...p.movements] },
        { ...p, id: `${p.id}-a${Date.now()}`, qty, orderId, lineId, cartons: p.cartons.slice(keepCartons).length ? p.cartons.slice(keepCartons) : [p.cartons[p.cartons.length - 1]], movements: [mv, ...p.movements] },
      ]
    }))
    const pos = stock.find(p => p.id === posId)
    setOrders(list => list.map(o => o.id !== orderId ? o : {
      ...o,
      lines: o.lines.map(l => l.id === lineId ? { ...l, stock: l.stock + qty, produced: Math.max(l.produced, l.stock + l.delivered + qty) } : l),
      history: [{ at: NOW, who: 'Anna Nowak', text: `Przydzielono z magazynu ${qty} szt. ${pos?.recipe ?? ''} ${pos?.kgPerUnit ?? ''} kg (partia ${pos?.batch ?? ''})`, kind: 'edit' }, ...o.history],
    }))
  }, [orders, stock])

  const release = useCallback((posId: string) => {
    const pos = stock.find(p => p.id === posId)
    if (!pos?.orderId) return
    const order = orders.find(o => o.id === pos.orderId)
    setStock(list => list.map(p => p.id !== posId ? p : { ...p, orderId: undefined, lineId: undefined, palletNo: undefined, status: p.status === 'pallet' ? 'stock' : p.status, movements: [{ at: NOW, type: `Zwolniono przydział z ${order?.no ?? ''}`, qty: p.qty, who: 'Anna Nowak' }, ...p.movements] }))
    setOrders(list => list.map(o => o.id !== pos.orderId ? o : {
      ...o,
      lines: o.lines.map(l => l.id === pos.lineId ? { ...l, stock: Math.max(0, l.stock - pos.qty) } : l),
      history: [{ at: NOW, who: 'Anna Nowak', text: `Zwolniono przydział ${pos.qty} szt. ${pos.recipe} ${pos.kgPerUnit} kg (partia ${pos.batch}) — wyrób wrócił do puli wolnej`, kind: 'edit' }, ...o.history],
    }))
  }, [orders, stock])

  const issue = useCallback((orderId: string, wzNo: string) => {
    setStock(list => list.filter(p => p.orderId !== orderId))
    setOrders(list => list.map(o => {
      if (o.id !== orderId) return o
      const kgOut = o.lines.reduce((a, l) => a + l.stock * l.kgPerUnit, 0)
      const missing = o.lines.some(l => l.qty - l.stock - l.delivered > 0)
      return {
        ...o,
        lines: o.lines.map(l => ({ ...l, delivered: l.delivered + l.stock, stock: 0 })),
        pallets: o.pallets.map(p => p.status === 'created' || p.status === 'packing' ? p : { ...p, status: 'shipped', loadedAt: p.loadedAt ?? NOW }),
        docs: o.docs.map(d => d.kind === 'WZ' ? { ...d, state: missing ? 'partial' : 'issued', number: wzNo, date: '29.10.2026', by: 'Anna Nowak', note: missing ? 'Częściowa — na stan faktyczny' : 'Całość zamówienia' } : d),
        history: [{ at: NOW, who: 'Anna Nowak', text: `Wystawiono ${wzNo} na ${Math.round(kgOut).toLocaleString('pl-PL')} kg`, kind: 'doc' }, ...o.history],
      }
    }))
  }, [])

  const cancel = useCallback((orderId: string, reason: string) => {
    setStock(list => list.map(p => p.orderId !== orderId ? p : { ...p, orderId: undefined, lineId: undefined, palletNo: undefined, status: p.status === 'pallet' ? 'stock' : p.status, movements: [{ at: NOW, type: 'Zwolniono przydział (anulowanie zamówienia)', qty: p.qty, who: 'Anna Nowak' }, ...p.movements] }))
    setOrders(list => list.map(o => o.id !== orderId ? o : { ...o, status: 'cancelled', lines: o.lines.map(l => ({ ...l, stock: 0 })), history: [{ at: NOW, who: 'Anna Nowak', text: `Anulowano. Powód: ${reason}`, kind: 'edit' }, ...o.history] }))
  }, [])

  const value = useMemo(() => ({ orders, stock, update, add, allocate, release, issue, cancel, byId: (id: string) => orders.find(o => o.id === id) }), [orders, stock, update, add, allocate, release, issue, cancel])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
