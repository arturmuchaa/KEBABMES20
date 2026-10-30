import React from 'react'
import { Eye, Printer, FilePlus2, Lock, CircleCheck, CircleDashed, CircleMinus, CircleSlash } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { DOC_NAME, type DocState, type Order, type OrderDoc } from '../../../data/model'

const STATE: Record<DocState, { label: string; icon: React.ReactNode }> = {
  available: { label: 'Gotowy do wydruku', icon: <CircleCheck size={16} color="var(--ink-3)" /> },
  issued: { label: 'Wystawiony', icon: <CircleCheck size={16} color="var(--ok)" /> },
  partial: { label: 'Częściowo', icon: <CircleCheck size={16} color="var(--accent)" /> },
  todo: { label: 'Do wystawienia', icon: <CircleDashed size={16} color="var(--accent)" /> },
  blocked: { label: 'Niedostępny', icon: <CircleSlash size={16} color="var(--ink-4)" /> },
  not_required: { label: 'Niewymagany', icon: <CircleMinus size={16} color="var(--ink-4)" /> },
  frozen: { label: 'Zamrożony', icon: <Lock size={16} color="var(--ink-3)" /> },
}

export function DocumentsTab({ order }: { order: Order }) {
  const app = useApp()
  const demo = (t: string) => app.toast({ kind: 'info', title: t, detail: 'W demo dokumenty nie są generowane ani drukowane.' })
  const actions = (d: OrderDoc) => {
    if (d.state === 'blocked' || d.state === 'not_required') return null
    if (d.state === 'todo' || (d.state === 'available' && d.kind === 'HDI')) return <button className="btn sm primary" onClick={() => demo(`${d.kind === 'HDI' ? 'Generowanie HDI' : `Wystawianie ${d.kind}`}`)}><FilePlus2 size={14} />{d.kind === 'HDI' ? 'Generuj' : 'Wystaw'}</button>
    return <><button className="btn sm ghost" onClick={() => demo('Podgląd dokumentu')}><Eye size={14} />Podgląd</button><button className="btn sm" onClick={() => demo('Drukowanie')}><Printer size={14} />Drukuj</button></>
  }
  return (
    <div className="dock-pad">
      <div className="sect-h"><h3>Dokumenty</h3><span className="sub">wydruki wewnętrzne i dokumenty wydania</span></div>
      <div className="box">
        <table className="tbl">
          <thead><tr><th>Dokument</th><th>Numer</th><th>Stan</th><th className="hide-s">Data</th><th className="hide-m">Wystawił</th><th>Uwagi</th><th className="r">Działania</th></tr></thead>
          <tbody>
            {order.docs.map((d, i) => (
              <tr key={d.kind} className={`row${i % 2 ? ' zebra' : ''}`}>
                <td className="strong">{DOC_NAME[d.kind]}</td>
                <td className="num">{d.number ?? <span className="faint">—</span>}</td>
                <td><span className="status">{STATE[d.state].icon}{STATE[d.state].label}</span></td>
                <td className="num hide-s">{d.date ?? <span className="faint">—</span>}</td>
                <td className="hide-m">{d.by ?? <span className="faint">—</span>}</td>
                <td className={`ell ${d.state === 'available' && d.kind === 'HDI' && /stan faktyczny/.test(d.note ?? '') ? 'warn-ink' : 'muted'}`} style={{ maxWidth: 380 }} title={d.note}>{d.note}</td>
                <td className="r"><span style={{ display: 'inline-flex', gap: 4 }}>{actions(d)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
