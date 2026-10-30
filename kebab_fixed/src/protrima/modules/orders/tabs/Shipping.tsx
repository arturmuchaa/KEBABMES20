import React, { useState } from 'react'
import { CheckCircle2, CircleDashed, Truck, FileText, Printer } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { FAZA_ZAPISU } from '../../../proba'
import { computeMetrics, kg, num, palletKg, dueText, type Order } from '../../../data/model'
import { FlagIcon, PalletStatusLabel } from '../../../ui/Glyphs'

type G = 'ok' | 'wait' | 'warn' | 'crit'
const GateIcon = ({ s }: { s: G }) => s === 'ok' ? <CheckCircle2 size={18} color="var(--ok)" /> : s === 'wait' ? <CircleDashed size={18} color="var(--ink-4)" /> : <span className={`alert-ico ${s}`}><FlagIcon level={s} size={17} /></span>

export function ShippingTab({ order }: { order: Order }) {
  const app = useApp()
  const m = computeMetrics(order)
  const [wz, setWz] = useState(false)
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
            <dt>Dostawa</dt><dd>{dueText(order)}</dd>
            <dt>Załadowano</dt><dd className="num">{m.palletsLoaded} z {m.palletsTotal} palet</dd>
          </dl>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Kursy i pojazdy są w module Wysyłki starego MES — w próbie bez zmian.</p>
          {!closed && <div className="row-wrap">
            <button className="btn sm" onClick={() => app.toast({ kind: 'info', title: 'Dokumenty dla kierowcy', detail: FAZA_ZAPISU })}><Printer size={14} />Dokumenty dla kierowcy</button>
          </div>}
        </div>
        <div className="box">
          <div className="panel-h"><h2 style={{ fontSize: 'var(--fs-md)' }}>Gotowość do wysyłki</h2>
            <span className="tools">
              {!closed && <button className="btn sm primary" disabled={toShip === 0} onClick={() => setWz(true)} data-tip={toShip === 0 ? 'Brak wyrobu w magazynie do wydania' : undefined}><FileText size={14} />Wystaw WZ…</button>}
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
      {wz && <Dialog title={`Wystaw WZ — ${order.no}`} icon={<FileText size={20} color="var(--accent)" />} onClose={() => setWz(false)}
        footer={<><button className="btn" onClick={() => setWz(false)}>Anuluj</button><button className="btn primary" onClick={() => {
          setWz(false)
          app.toast({ kind: 'info', title: 'Wystawienie WZ', detail: FAZA_ZAPISU })
        }}>Wystaw WZ</button></>}>
        <dl className="kv">
          <dt>Odbiorca</dt><dd className="strong">{order.client.name}</dd>
          <dt>Wydanie</dt><dd className="num strong">{kg(toShip)} <span className="muted">z {kg(m.orderedKg)}</span></dd>
          <dt>Pozycje</dt><dd>{order.lines.filter(l => l.stock > 0).map(l => `${l.recipe} ${l.kgPerUnit} kg × ${l.stock}`).join(', ')}</dd>
        </dl>
        {m.missingKg > 0
          ? <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>WZ będzie częściowa.</b> Obejmie tylko wyrób z magazynu. Brakujące {kg(m.missingKg)} zostanie na zamówieniu jako brak — po dołożeniu wyrobu wystawisz kolejną WZ.</div></div>
          : <div className="note info"><FlagIcon level="info" size={15} /><div>WZ obejmie całe zamówienie. Po wystawieniu zamówienie można zamknąć.</div></div>}
        {foreign && <div className="note"><FlagIcon level="info" size={15} /><div>Dostawa za granicę ({order.client.country}) — po WZ wystaw CMR z zakładki Dokumenty.</div></div>}
      </Dialog>}
    </div>
  )
}
