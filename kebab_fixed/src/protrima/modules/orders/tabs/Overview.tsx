import React from 'react'
import { Building2, ClipboardList, StickyNote } from 'lucide-react'
import type { DetailTab } from '../../../shell/context'
import { computeMetrics, kg, num, pct, fmtDate, dueText, type Order } from '../../../data/model'
import { StageNode, FlagIcon } from '../../../ui/Glyphs'
import { pctPokrycia } from '../../../ui/Meters'

type Lvl = 'ok' | 'warn' | 'crit' | 'idle'

/** Ta sama linia procesu co na Pulpicie — tylko w skali jednego zamówienia. */
export function OverviewTab({ order, onTab }: { order: Order; onTab: (t: DetailTab) => void }) {
  const m = computeMetrics(order)
  const closed = order.status === 'done' || order.status === 'cancelled'
  const due = m.dueDays ?? 99
  const planned = order.lines.filter(l => l.planNo).length
  const plans = [...new Set(order.lines.map(l => l.planNo).filter(Boolean))]
  const draft = order.status === 'draft'
  // Cały wyrób już jest (magazyn lub wydany) — plan i produkcja nie są potrzebne; bez fałszywego bursztynu.
  const zMagazynu = !draft && m.missingKg === 0 && order.lines.length > 0

  // Jedno słownictwo w całym panelu: Zamówiono · Produkcja · Pokrycie · Wydano.
  const stages: Array<{ key: DetailTab; name: string; value: string; sub: string; level: Lvl }> = [
    { key: 'history', name: 'Przyjęte', value: fmtDate(order.orderDate).slice(0, 5), sub: draft ? 'szkic — do potwierdzenia' : 'potwierdzone', level: draft ? 'warn' : 'ok' },
    zMagazynu && planned < order.lines.length
      ? { key: 'production', name: 'Zaplanowane', value: 'nie trzeba', sub: 'cały wyrób z magazynu', level: 'ok' }
      : { key: 'production', name: 'Zaplanowane', value: `${planned}/${order.lines.length} poz.`, sub: plans.length ? plans.join(', ') : 'brak planu', level: draft ? 'idle' : planned === order.lines.length ? 'ok' : due <= 3 ? 'warn' : 'idle' },
    zMagazynu && m.prodPct < 100
      ? { key: 'production', name: 'Produkcja', value: 'nie trzeba', sub: 'cały wyrób z magazynu', level: 'ok' }
      : { key: 'production', name: 'Produkcja', value: pct(m.prodPct), sub: `zgłoszono ${kg(m.producedKg)}`, level: draft ? 'idle' : m.prodPct >= 100 ? 'ok' : due <= 1 ? 'warn' : m.prodPct > 0 ? 'ok' : 'idle' },
    { key: 'coverage', name: 'Pokrycie', value: `${pctPokrycia(m.coverPct)}%`, sub: m.missingKg > 0 ? `brak ${kg(m.missingKg)}` : 'komplet wyrobu', level: draft ? 'idle' : m.missingKg === 0 ? 'ok' : due < 0 || due === 0 ? 'crit' : due === 1 ? 'warn' : 'idle' },
    { key: 'pallets', name: 'Palety', value: m.palletsTotal ? `${m.palletsReady}/${m.palletsTotal}` : '—', sub: m.palletsTotal ? (m.unassignedQty ? `${num(m.unassignedQty)} szt. bez palety` : 'gotowe z rozpisanych') : 'nierozpisane', level: draft ? 'idle' : m.palletsTotal && m.palletsReady === m.palletsTotal ? 'ok' : (m.unassignedQty > 0 && due <= 1) ? 'warn' : m.palletsTotal ? 'ok' : 'idle' },
    { key: 'shipping', name: 'Załadunek', value: m.palletsTotal ? `${m.palletsLoaded}/${m.palletsTotal}` : '—', sub: m.palletsLoaded ? 'palet na aucie (skan QR)' : 'nic nie załadowano', level: m.palletsTotal && m.palletsLoaded === m.palletsTotal ? 'ok' : 'idle' },
    { key: 'documents', name: 'Wydano', value: pct(m.shipPct), sub: m.deliveredKg > 0 ? `na WZ ${kg(m.deliveredKg)}` : 'WZ nie wystawione', level: m.shipPct >= 100 ? 'ok' : 'idle' },
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
