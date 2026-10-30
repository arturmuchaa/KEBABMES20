import React from 'react'
import { Building2, ClipboardList, StickyNote } from 'lucide-react'
import type { DetailTab } from '../../../shell/context'
import { computeMetrics, kg, num, pct, fmtDate, dueText, type Order } from '../../../data/model'
import { StageNode, FlagIcon } from '../../../ui/Glyphs'

type Lvl = 'ok' | 'warn' | 'crit' | 'idle'

/** Ta sama linia procesu co na Pulpicie — tylko w skali jednego zamówienia. */
export function OverviewTab({ order, onTab }: { order: Order; onTab: (t: DetailTab) => void }) {
  const m = computeMetrics(order)
  const closed = order.status === 'done' || order.status === 'cancelled'
  const due = m.dueDays ?? 99
  const planned = order.lines.filter(l => l.planNo).length
  const plans = [...new Set(order.lines.map(l => l.planNo).filter(Boolean))]
  const draft = order.status === 'draft'

  const stages: Array<{ key: DetailTab; name: string; value: string; sub: string; level: Lvl }> = [
    { key: 'history', name: 'Przyjęte', value: fmtDate(order.orderDate).slice(0, 5), sub: order.status === 'draft' ? 'szkic' : 'potwierdzone', level: draft ? 'warn' : 'ok' },
    { key: 'production', name: 'Zaplanowane', value: `${planned}/${order.lines.length} poz.`, sub: plans.length ? plans.join(', ') : 'brak planu', level: draft ? 'idle' : planned === order.lines.length ? 'ok' : due <= 3 ? 'warn' : 'idle' },
    { key: 'production', name: 'Produkcja', value: pct(m.prodPct), sub: `zgłoszono ${kg(m.producedKg)}`, level: draft ? 'idle' : m.prodPct >= 100 ? 'ok' : due <= 1 ? 'warn' : m.prodPct > 0 ? 'ok' : 'idle' },
    { key: 'coverage', name: 'Magazyn', value: pct(m.coverPct), sub: m.missingKg > 0 ? `brak ${kg(m.missingKg)}` : 'wyrób kompletny', level: draft ? 'idle' : m.missingKg === 0 ? 'ok' : due < 0 || due === 0 ? 'crit' : due === 1 ? 'warn' : 'idle' },
    { key: 'pallets', name: 'Palety', value: m.palletsTotal ? `${m.palletsReady}/${m.palletsTotal}` : '—', sub: m.palletsTotal ? (m.unassignedQty ? `${num(m.unassignedQty)} szt. bez palety` : 'spakowane / rozpisane') : 'nierozpisane', level: draft ? 'idle' : m.palletsTotal && m.palletsReady === m.palletsTotal ? 'ok' : (m.unassignedQty > 0 && due <= 1) ? 'warn' : m.palletsTotal ? 'ok' : 'idle' },
    { key: 'shipping', name: 'Załadunek', value: m.palletsTotal ? `${m.palletsLoaded}/${m.palletsTotal}` : '—', sub: m.palletsLoaded ? 'skan QR przy załadunku' : 'nic nie załadowano', level: m.palletsTotal && m.palletsLoaded === m.palletsTotal ? 'ok' : 'idle' },
    { key: 'documents', name: 'Wydane', value: pct(m.shipPct), sub: m.deliveredKg > 0 ? `WZ: ${kg(m.deliveredKg)}` : 'WZ nie wystawione', level: m.shipPct >= 100 ? 'ok' : 'idle' },
  ]

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

      <div className="box measures" aria-label="Trzy osobne miary realizacji">
        <div className="measure">
          <span className="mk"><i className="f-prod" />Produkcja</span>
          <span className="mv num">{pct(m.prodPct)}<small>{kg(m.producedKg)} z {kg(m.orderedKg)}</small></span>
          <span className="track"><i className="f-prod" style={{ width: `${Math.min(100, m.prodPct)}%` }} /></span>
          <span className="md">Zgłoszenia z tabletów produkcyjnych. Źródło diagnostyczne — nie zwiększa pokrycia, dopóki wyrób nie zostanie przyjęty na magazyn.</span>
        </div>
        <div className="measure">
          <span className="mk"><i className="f-stock" />Pokrycie</span>
          <span className="mv num">{pct(m.coverPct)}<small>{m.missingKg > 0 && !closed ? <span className="crit-ink">brak {kg(m.missingKg)}</span> : 'komplet'}</small></span>
          <span className="track">
            {m.shipPct > 0 && <i className="f-ship" style={{ width: `${m.shipPct}%` }} />}
            {m.stockPct > 0 && <i className="f-stock" style={{ width: `${m.stockPct}%` }} />}
            {m.missingKg > 0 && <i className="f-short" style={{ flex: 1 }} />}
          </span>
          <span className="md">W magazynie {kg(m.stockKg)} + wydano {kg(m.deliveredKg)}. Liczy się tylko wyrób fizycznie przydzielony temu zamówieniu.</span>
        </div>
        <div className="measure">
          <span className="mk"><i className="f-ship" />Wysyłka</span>
          <span className="mv num">{pct(m.shipPct)}<small>{kg(m.deliveredKg)} na WZ</small></span>
          <span className="track"><i className="f-ship" style={{ width: `${Math.min(100, m.shipPct)}%` }} /></span>
          <span className="md">Do wysłania: {kg(m.orderedKg - m.deliveredKg)}. </span>
        </div>
      </div>

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
            <dt>Termin dostawy</dt><dd className={m.dueDays !== null && m.dueDays < 0 && !closed ? 'crit-ink strong' : 'strong'}>{dueText(order)}</dd>
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
