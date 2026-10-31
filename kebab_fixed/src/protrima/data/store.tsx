import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { clientOrdersApi, clientsApi, finishedGoodsApi, orderPalletsApi, productionPlansApi, wzApi, zaladunkiApi, type OrderPallet, type WzDoc, type ZaladunekDoWydruku } from '@/lib/api'
import type { Client as ApiClient, ClientOrder, FinishedGoodsItem } from '@/lib/mockApi'
import { mapujWyrob, mapujZamowienie, planyPozycji } from './mapuj'
import type { Order } from './model'
import type { StockPos } from './stock'

/**
 * Stan PROTRIMA: zamówienia i magazyn wyrobu gotowego z API kopii bazy.
 * Backend jest jedynym źródłem prawdy — tu nic nie jest liczone „na boku”
 * ani zmieniane lokalnie. Zapis (faza 3) będzie wołał istniejące endpointy
 * i odświeżał ten stan.
 */
interface Store {
  orders: Order[]
  stock: StockPos[]
  byId: (id: string) => Order | undefined
  loading: boolean
  error: string | null
  /** Kiedy ostatnio udało się pobrać dane. */
  stamp: Date | null
  refresh: () => Promise<void>
}
const Ctx = createContext<Store>(null as unknown as Store)
export const useOrders = () => useContext(Ctx)
export const useMes = useOrders

/** Odświeżanie w tle — jak Pulpit starego MES. */
const CO_ILE_MS = 30_000

interface Surowe {
  orders: ClientOrder[]
  clients: ApiClient[]
  wz: WzDoc[]
  plans: Array<{ planNo: string; status?: string; lines: Array<{ clientOrderLineId?: string | null }> }>
  fg: FinishedGoodsItem[]
  pallets: Record<string, OrderPallet[]>
  zaladunki: Record<string, { plate: string; at?: string }>
}

/** Zapytanie pomocnicze: brak danych pobocznych (np. WZ) nie może zablokować listy zamówień. */
const albo = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback)

async function pobierz(): Promise<Surowe> {
  const [orders, clients, wz, plans, fg] = await Promise.all([
    clientOrdersApi.list(undefined, true),
    albo(clientsApi.list(), [] as ApiClient[]),
    albo(wzApi.list(), [] as WzDoc[]),
    albo(productionPlansApi.list(), []),
    albo(finishedGoodsApi.list(), [] as FinishedGoodsItem[]),
  ])
  // Palety tylko dla zamówień w toku — zamknięte nie zmieniają już rozpisu.
  const otwarte = orders.filter(o => o.status !== 'done' && o.status !== 'cancelled')
  const pary = await Promise.all(otwarte.map(o => albo(orderPalletsApi.list(o.id), [] as OrderPallet[]).then(p => [o.id, p] as const)))
  return { orders, clients, wz, plans, fg, pallets: Object.fromEntries(pary), zaladunki: await autaKursow() }
}

/**
 * Zamówienia z zakończonych kursów, które czekają na papiery biura → auto.
 * Lista kursów nie niesie id zamówień — dociągamy szczegóły (kursów czeka zwykle kilka).
 */
async function autaKursow(): Promise<Record<string, { plate: string; at?: string }>> {
  const kursy = await albo(zaladunkiApi.doWydruku(), [] as ZaladunekDoWydruku[])
  const szczegoly = await Promise.all(kursy.map(k => albo(zaladunkiApi.get(k.id) as Promise<{ plate?: string; finished_at?: string; pozycje?: Array<{ order_id?: string }> } | null>, null)))
  const out: Record<string, { plate: string; at?: string }> = {}
  szczegoly.forEach((d, i) => (d?.pozycje ?? []).forEach(p => {
    if (p.order_id) out[p.order_id] = { plate: d?.plate || kursy[i].plate, at: d?.finished_at || kursy[i].finishedAt || undefined }
  }))
  return out
}

export function OrdersProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<Surowe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stamp, setStamp] = useState<Date | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current
    const p = (async () => {
      try {
        const r = await pobierz()
        setRaw(r); setError(null); setStamp(new Date())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
        inFlight.current = null
      }
    })()
    inFlight.current = p
    return p
  }, [])

  useEffect(() => {
    refresh()
    const t = window.setInterval(() => { if (!document.hidden) refresh() }, CO_ILE_MS)
    return () => window.clearInterval(t)
  }, [refresh])

  const orders = useMemo<Order[]>(() => {
    if (!raw) return []
    const ctx = { clients: raw.clients, pallets: raw.pallets, wz: raw.wz, planByLine: planyPozycji(raw.plans), zaladunki: raw.zaladunki }
    return raw.orders.map(o => mapujZamowienie(o, ctx))
  }, [raw])
  const stock = useMemo<StockPos[]>(() => raw ? raw.fg.map(f => mapujWyrob(f, orders)).filter((x): x is StockPos => !!x) : [], [raw, orders])

  const value = useMemo(() => ({
    orders, stock, loading, error, stamp, refresh,
    byId: (id: string) => orders.find(o => o.id === id),
  }), [orders, stock, loading, error, stamp, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
