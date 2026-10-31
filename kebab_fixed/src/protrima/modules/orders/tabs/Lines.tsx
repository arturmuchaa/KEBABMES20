import { Pencil, Plus } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { kg, num, type Order } from '../../../data/model'

/**
 * Pozycje: wiele wyrobów, receptur i gramatur w jednym zamówieniu — do odczytu.
 * Zmiany idą przez jeden edytor zamówienia (karta robocza, F2), nie przez osobną
 * edycję w tabeli: tam pilnujemy id pozycji, palet i wydań na WZ.
 */
export function LinesTab({ order }: { order: Order }) {
  const app = useApp()
  const editable = order.status === 'draft' || order.status === 'confirmed'
  const totalKg = order.lines.reduce((a, l) => a + l.qty * l.kgPerUnit, 0)
  const totalQty = order.lines.reduce((a, l) => a + l.qty, 0)

  return (
    <div className="dock-pad">
      <div className="sect-h">
        <h3>Pozycje zamówienia</h3>
        <span className="sub">{order.lines.length} poz. · {num(totalQty)} szt. · {kg(totalKg)}</span>
        <div className="tools">
          <button className="btn" disabled={!editable} onClick={() => app.editOrder(order.id)} data-tip={editable ? undefined : 'Edytować można szkic albo potwierdzone'}><Plus size={15} />Dodaj pozycję</button>
          <button className="btn primary" disabled={!editable} onClick={() => app.editOrder(order.id)}><Pencil size={15} />Edytuj zamówienie<span className="kbd">F2</span></button>
        </div>
      </div>
      <div className="box">
        <table className="tbl">
          <thead><tr>
            <th className="num" style={{ width: 44 }}>Lp.</th><th>Wyrób</th><th>Receptura</th><th className="num">Gramatura</th><th className="hide-s">Opakowanie</th>
            <th className="num">Ilość</th><th className="num">Masa</th><th className="hide-m">Plan</th><th>Uwagi</th>
          </tr></thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr key={l.id} className={`row${i % 2 ? ' zebra' : ''}`}>
                <td className="num muted">{l.lp}</td>
                <td>{l.product}</td>
                <td className="strong">{l.recipe}</td>
                <td className="num">{l.kgPerUnit} kg</td>
                <td className="hide-s">{l.packaging}</td>
                <td className="num"><b>{num(l.qty)}</b><span className="sub">szt.</span></td>
                <td className="num">{kg(l.qty * l.kgPerUnit)}</td>
                <td className="hide-m muted">{l.planNo ?? '—'}</td>
                <td className="ell muted" style={{ maxWidth: 260 }} title={l.note}>{l.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td /><td colSpan={4}>Razem</td><td className="num">{num(totalQty)} <span className="sub">szt.</span></td><td className="num">{kg(totalKg)}</td><td className="hide-m" /><td /></tr></tfoot>
        </table>
      </div>
    </div>
  )
}
