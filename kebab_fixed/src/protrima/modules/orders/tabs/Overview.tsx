import React from 'react'
import { Building2, ClipboardList, StickyNote } from 'lucide-react'
import type { DetailTab } from '../../../shell/context'
import { computeMetrics, kg, num, fmtDate, dueText, type Order } from '../../../data/model'
import { etapyZamowienia } from '../../../data/krok'
import { StageNode, FlagIcon } from '../../../ui/Glyphs'

/** Ta sama linia procesu co na Pulpicie — tylko w skali jednego zamówienia. */
export function OverviewTab({ order, onTab }: { order: Order; onTab: (t: DetailTab) => void }) {
  const m = computeMetrics(order)
  const closed = order.status === 'done' || order.status === 'cancelled'
  // Te same etapy co mini-szyna na liście (data/krok.ts) — jedno słownictwo: Zamówiono · Produkcja · Pokrycie · Wydano.
  const stages = etapyZamowienia(order, m)

  return (
    <div className="dock-pad">
      <div className="box">
        <div className="pline mini">
          {stages.map((s, i) => (
            <button key={i} className={`pstage ${s.level}`} onClick={() => onTab(s.key)}>
              <span className="rail" />
              <span className="ph"><span className="node"><StageNode level={s.level} size={12} /></span><span className="pn">{s.name}</span></span>
              <span className="pv num">{s.value}</span>
              <span className="ps">{s.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Trzy miary (produkcja · pokrycie · wydano) są liczbami w nagłówku panelu, z opisem w dymku — bez trzeciego powtórzenia tutaj. */}
      <div className="ov-grid">
        <div className="box ov-card">
          <h4><Building2 size={16} />Klient</h4>
          <dl className="kv">
            <dt>Nazwa</dt><dd className="strong">{order.client.name}</dd>
            <dt>NIP / VAT</dt><dd className="num">{order.client.nip || <span className="faint">—</span>}</dd>
            <dt>Adres</dt><dd>{order.client.address || <span className="faint">—</span>}</dd>
            <dt>Kontakt</dt><dd>{[order.client.contact, order.client.phone].filter(Boolean).join(' · ') || <span className="faint">—</span>}</dd>
          </dl>
        </div>
        <div className="box ov-card">
          <h4><ClipboardList size={16} />Zamówienie</h4>
          <dl className="kv">
            <dt>Data zamówienia</dt><dd className="num">{fmtDate(order.orderDate)}</dd>
            <dt>Termin wyjazdu</dt><dd className={m.dueDays !== null && m.dueDays < 0 && !closed ? 'crit-ink strong' : 'strong'}>{dueText(order)}</dd>
            <dt>Ilość</dt><dd className="num">{order.lines.length} poz. · {num(m.orderedQty)} szt. · {kg(m.orderedKg)}</dd>
          </dl>
        </div>
        <div className="box ov-card ov-notes">
          <h4><StickyNote size={16} />Uwagi i sygnały</h4>
          {order.notes ? <p style={{ lineHeight: 1.45 }}>{order.notes}</p> : <p className="muted">Brak uwag do zamówienia.</p>}
          {m.flags.map(f => (
            <div key={f.code} className={`note ${f.level}`}><FlagIcon level={f.level} size={15} /><div><b>{f.label}.</b> {f.detail}</div></div>
          ))}
        </div>
      </div>
    </div>
  )
}
