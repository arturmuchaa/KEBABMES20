import React, { useEffect, useMemo, useState } from 'react'
import { Ban } from 'lucide-react'
import { useOrders } from '../../data/store'
import { computeMetrics, kg, type Order } from '../../data/model'
import { useApp, CommandBar, Dialog, type Cmd, type DetailTab } from '../../shell/context'
import { OrderDetail, TAB_DEFS, orderCommands, useConfirmOrder } from './OrderDetail'

/** Zamówienie otwarte w osobnym oknie — ten sam panel co pod listą, na całą wysokość, z tym samym paskiem narzędzi. */
export function OrderTab({ orderId, active, setCtx, setCmds }: { orderId: string; active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { byId, cancel } = useOrders()
  const order = byId(orderId)
  const [tab, setTab] = useState<DetailTab>('overview')
  const [cancelOpen, setCancelOpen] = useState(false)
  const confirmOrder = useConfirmOrder()

  const cmds = useMemo<Cmd[]>(() => order ? orderCommands(order, app, setTab, confirmOrder, () => setCancelOpen(true)) : [], [order, app, confirmOrder])
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

  if (!order) return <div className="placeholder"><div className="ph-card"><h2>Nie znaleziono zamówienia</h2><p className="muted">Mogło zostać usunięte w tej sesji demo.</p></div></div>
  return (
    <>
      <CommandBar title={order.no} count={order.client.name} cmds={cmds} right={<button className="btn ghost" onClick={() => app.gotoOrders({ select: order.id, tab, view: order.status === 'done' || order.status === 'cancelled' ? 'closed' : 'active' })}>Pokaż na liście</button>} />
      <div className="dock" style={{ flex: 1 }}><OrderDetail order={order} tab={tab} onTab={setTab} mode="page" onConfirm={confirmOrder} /></div>
      {cancelOpen && <CancelSimple order={order} onClose={() => setCancelOpen(false)} onConfirm={r => { cancel(order.id, r); setCancelOpen(false); app.toast({ title: 'Zamówienie anulowane', detail: 'Zmiana obowiązuje tylko w tej sesji demo.' }) }} />}
    </>
  )
}

function CancelSimple({ order, onClose, onConfirm }: { order: Order; onClose: () => void; onConfirm: (r: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`Anulować ${order.no}?`} icon={<Ban size={20} color="var(--crit)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} data-autofocus>Wróć</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} disabled={!reason} onClick={() => onConfirm(reason)}>Anuluj zamówienie</button></>}>
      <p>Przydzielony wyrób wróci do puli wolnej, numery palet zostaną zablokowane, historia zostaje.</p>
      <label className="label" htmlFor={`cr-${order.id}`}>Powód anulowania</label>
      <select id={`cr-${order.id}`} className="field" value={reason} onChange={e => setReason(e.target.value)}>
        <option value="">Wybierz powód…</option><option>Rezygnacja klienta</option><option>Zamówienie zdublowane</option><option>Zmiana na inne zamówienie</option>
      </select>
    </Dialog>
  )
}
