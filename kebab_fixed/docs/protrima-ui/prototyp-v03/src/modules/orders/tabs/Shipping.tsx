import React, { useState } from 'react'
import { CircleCheck, CircleDashed, Truck, FileText, Printer } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { computeMetrics, kg, num, palletKg, dueText, type Order } from '../../../data/model'
import { SHIPMENTS } from '../../../data/demo'
import { FlagIcon, PalletStatusLabel } from '../../../ui/Glyphs'

type G = 'ok' | 'wait' | 'warn' | 'crit'
const GateIcon = ({ s }: { s: G }) => s === 'ok' ? <CircleCheck size={18} color="var(--ok)" /> : s === 'wait' ? <CircleDashed size={18} color="var(--ink-4)" /> : <span className={`alert-ico ${s}`}><FlagIcon level={s} size={17} /></span>

export function ShippingTab({ order }: { order: Order }) {
  const app = useApp()
  const { issue } = useOrders()
  const m = computeMetrics(order)
  const ship = SHIPMENTS.find(s => s.id === order.shipmentId)
  const [wz, setWz] = useState(false)
  const foreign = order.client.country !== 'PL'
  const wzDoc = order.docs.find(d => d.kind === 'WZ')
  const cmrDoc = order.docs.find(d => d.kind === 'CMR')
  const closed = order.status === 'done' || order.status === 'cancelled'
  const toShip = order.lines.reduce((a, l) => a + l.stock * l.kgPerUnit, 0)

  const gates: Array<{ k: string; d: string; s: G }> = [
    { k: 'Wyrób kompletny', d: m.missingKg ? `brakuje ${kg(m.missingKg)}` : 'cała ilość w magazynie lub wydana', s: m.missingKg ? ((m.dueDays ?? 9) <= 1 ? 'crit' : 'wait') : 'ok' },
    { k: 'Palety rozpisane', d: m.unassignedQty ? `${num(m.unassignedQty)} szt. bez palety` : `${m.palletsTotal} palet`, s: m.unassignedQty ? 'warn' : m.palletsTotal ? 'ok' : 'wait' },
    { k: 'Palety spakowane', d: `${m.palletsReady} z ${m.palletsTotal}`, s: m.palletsTotal && m.palletsReady === m.palletsTotal ? 'ok' : 'wait' },
    { k: 'Załadowane (skan QR)', d: `${m.palletsLoaded} z ${m.palletsTotal}`, s: m.palletsTotal && m.palletsLoaded === m.palletsTotal ? 'ok' : 'wait' },
    { k: 'WZ', d: wzDoc?.number ? `${wzDoc.number}${wzDoc.state === 'partial' ? ' (częściowa)' : ''}` : wzDoc?.note ?? '', s: wzDoc?.state === 'issued' ? 'ok' : 'wait' },
    { k: 'CMR', d: foreign ? (cmrDoc?.number ?? `wymagany — ${order.client.country}`) : 'dostawa krajowa — niewymagany', s: !foreign || cmrDoc?.state === 'issued' ? 'ok' : 'wait' },
  ]

  return (
    <div className="dock-pad">
      <div className="ov-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
        <div className="box ov-card">
          <h4><Truck size={16} />Kurs</h4>
          {ship ? (
            <dl className="kv">
              <dt>Numer</dt><dd className="num strong">{ship.no}</dd>
              <dt>Wyjazd</dt><dd>{dueText({ delivery: ship.date, deliveryTime: ship.time })}</dd>
              <dt>Pojazd</dt><dd>{ship.vehicle} · <span className="num">{ship.plate}</span></dd>
              <dt>Kierowca</dt><dd>{ship.driver}</dd>
              <dt>Przewoźnik</dt><dd>{ship.carrier}</dd>
              <dt>Dostawa</dt><dd>{dueText(order)}</dd>
            </dl>
          ) : <p className="muted">Zamówienie nie ma przypisanego kursu.</p>}
          {!closed && <div className="row-wrap">
            <button className="btn sm" onClick={() => app.openModule('wysylki')}>{ship ? 'Zmień kurs' : 'Przypisz do kursu'}</button>
            <button className="btn sm" onClick={() => app.toast({ kind: 'info', title: 'Dokumenty dla kierowcy', detail: 'Demo nie drukuje.' })}><Printer size={14} />Dokumenty dla kierowcy</button>
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
          issue(order.id, 'WZ/2026/10/0241')
          setWz(false)
          app.toast({ title: 'Wystawiono WZ/2026/10/0241', detail: 'Pokrycie bez zmian, wysyłka wzrosła. Zapis tylko w tej sesji demo.' })
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
