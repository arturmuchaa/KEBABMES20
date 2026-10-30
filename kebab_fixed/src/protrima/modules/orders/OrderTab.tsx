import React, { useEffect, useMemo, useState } from 'react'
import { Ban } from 'lucide-react'
import { useOrders } from '../../data/store'
import { computeMetrics, kg, type Order } from '../../data/model'
import { useApp, CommandBar, Dialog, type Cmd, type DetailTab } from '../../shell/context'
import { OrderDetail, TAB_DEFS, orderCommands } from './OrderDetail'
import { useOrderActions } from './akcje'
import { FAZA_ZAPISU } from '../../proba'

/** Zamówienie otwarte w osobnym oknie — ten sam panel co pod listą, na całą wysokość, z tym samym paskiem narzędzi. */
export function OrderTab({ orderId, active, setCtx, setCmds }: { orderId: string; active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { byId } = useOrders()
  const order = byId(orderId)
  const [tab, setTab] = useState<DetailTab>('overview')
  const akcje = useOrderActions()

  const cmds = useMemo<Cmd[]>(() => order ? orderCommands(order, app, setTab, akcje.zapytaj) : [], [order, app, akcje.zapytaj])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && /^[1-8]$/.test(e.key) && !document.querySelector('.dialog-wrap')) { e.preventDefault(); setTab(TAB_DEFS[Number(e.key) - 1].key) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active])
  useEffect(() => {
    if (!active || !order) return
    const m = computeMetrics(order)
    setCtx(<><span><b>{order.no}</b> · {order.client.name} · {kg(m.orderedKg)}</span><span className="hint hide-m"><span className="kbd">Alt+1…8</span> zakładki <span className="kbd">Ctrl+W</span> zamknij okno</span></>)
  }, [active, order, setCtx])

  if (!order) return <div className="placeholder"><div className="ph-card"><h2>Nie znaleziono zamówienia</h2><p className="muted">Mogło zostać usunięte w starym MES. Lista odświeża się co 30 s.</p></div></div>
  return (
    <>
      <CommandBar title={order.no} count={order.client.name} cmds={cmds} right={<button className="btn ghost" onClick={() => app.gotoOrders({ select: order.id, tab, view: order.status === 'done' || order.status === 'cancelled' ? 'closed' : 'active' })}>Pokaż na liście</button>} />
      <div className="dock" style={{ flex: 1 }}><OrderDetail order={order} tab={tab} onTab={setTab} mode="page" onConfirm={o => akcje.zapytaj('confirm', o)} /></div>
      {akcje.dialog}
    </>
  )
}
