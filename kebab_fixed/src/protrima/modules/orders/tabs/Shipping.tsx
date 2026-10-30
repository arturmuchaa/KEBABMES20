import React, { useState } from 'react'
import { CheckCircle2, CircleDashed, Truck, FileText, Printer } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { W_STARYM_MES } from '../../../proba'
import { computeMetrics, kg, num, palletKg, dueText, type Order } from '../../../data/model'
import { FlagIcon, PalletStatusLabel } from '../../../ui/Glyphs'

type G = 'ok' | 'wait' | 'warn' | 'crit'
const GateIcon = ({ s }: { s: G }) => s === 'ok' ? <CheckCircle2 size={18} color="var(--ok)" /> : s === 'wait' ? <CircleDashed size={18} color="var(--ink-4)" /> : <span className={`alert-ico ${s}`}><FlagIcon level={s} size={17} /></span>

export function ShippingTab({ order }: { order: Order }) {
  const app = useApp()
  const m = computeMetrics(order)
  const foreign = !!order.client.country && order.client.country !== 'PL'
  const wzDoc = order.docs.find(d => d.kind === 'WZ')
  const cmrDoc = order.docs.find(d => d.kind === 'CMR')
  const closed = order.status === 'done' || order.status === 'cancelled'
  const toShip = order.lines.reduce((a, l) => a + l.stock * l.kgPerUnit, 0)

  const gates: Array<{ k: string; d: string; s: G }> = [
    { k: 'Wyrób kompletny', d: m.missingKg ? `brakuje ${kg(m.missingKg)}` : 'cała ilość w magazynie lub wydana', s: m.missingKg ? ((m.dueDays ?? 9) <= 1 ? 'crit' : 'wait') : 'ok' },
    { k: 'Palety rozpisane', d: m.unassignedQty ? `${num(m.unassignedQty)} szt. bez palety` : `${m.palletsTotal} palet`, s: m.unassignedQty ? 'warn' : m.palletsTotal ? 'ok' : 'wait' },
    { k: 'Palety spakowane', d: `${m.palletsReady} z ${m.palletsTotal}`, s: m.palletsTotal && m.palletsReady === m.palletsTotal ? 'ok' : 'wait' },
    { k: 'Załadowane (skan QR)', d: `${m.palletsLoaded} z ${m.palletsTotal}`, s: m.palletsTotal && m.palletsLoaded === m.palletsTotal ? 'ok' : 'wait' },
    { k: 'WZ / WM', d: order.docs.filter(d => d.kind === 'WZ').map(d => d.number).join(', ') || 'brak dokumentu wydania', s: wzDoc?.state === 'issued' ? 'ok' : 'wait' },
    ...(foreign ? [{ k: 'CMR', d: cmrDoc?.number ?? `dostawa za granicę (${order.client.country})`, s: (cmrDoc?.state === 'issued' ? 'ok' : 'wait') as G }] : []),
  ]

  return (
    <div className="dock-pad">
      <div className="ov-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
        <div className="box ov-card">
          <h4><Truck size={16} />Kurs</h4>
          <dl className="kv">
            <dt>Wyjazd</dt><dd>{dueText(order)}</dd>
            <dt>Załadowano</dt><dd className="num">{m.palletsLoaded} z {m.palletsTotal} palet</dd>
          </dl>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Kursy i pojazdy są w module Wysyłki starego MES — w próbie bez zmian.</p>
          {!closed && <div className="row-wrap">
            <button className="btn sm" onClick={() => app.toast({ kind: 'info', title: 'Dokumenty dla kierowcy', detail: W_STARYM_MES })}><Printer size={14} />Dokumenty dla kierowcy</button>
          </div>}
        </div>
        <div className="box">
          <div className="panel-h"><h2 style={{ fontSize: 'var(--fs-md)' }}>Gotowość do wysyłki</h2>
            <span className="tools">
              {!closed && <button className="btn sm primary" disabled={toShip === 0} onClick={() => app.issueWz(order.id)} data-tip={toShip === 0 ? 'Brak wyrobu w magazynie do wydania' : undefined}><FileText size={14} />Wystaw WZ…</button>}
            </span>
          </div>
          <div className="gates">
            {gates.map(g => <div key={g.k} className="gate"><GateIcon s={g.s} /><div><div className="gk">{g.k}</div><div className="gd">{g.d}</div></div></div>)}
          </div>
        </div>
      </div>
      {order.pallets.length > 0 && <>
        <div className="sect-h"><h3>Kolejność załadunku</h3><span className="sub">wg numerów palet · skan QR potwierdza załadunek</span></div>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Paleta</th><th>Karton</th><th className="num">Masa</th><th>Stan</th><th>Załadowano</th></tr></thead>
            <tbody>{order.pallets.map((p, i) => (
              <tr key={p.id} className={`row${i % 2 ? ' zebra' : ''}`}><td className="strong">Paleta {p.no}</td><td className="code">{p.carton}</td><td className="num">{kg(palletKg(order, p))}</td>
                <td><PalletStatusLabel status={p.status} /></td><td className="num">{p.loadedAt ?? <span className="faint">—</span>}</td></tr>))}</tbody>
          </table>
        </div>
      </>}

    </div>
  )
}
