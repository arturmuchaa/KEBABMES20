import type { ClientOrder } from '@/lib/mockApi'
import { OrderSection } from './OrderUI'
import { kgText, mixingTotals, percentNumber, summarizeOrders } from './orderPlanning'

export function OrderMaterialShortfall({ order }: { order: ClientOrder }) {
  const { recipes } = summarizeOrders([order])
  return <OrderSection title="Zapotrzebowanie na mieszanie" description="Tylko to zamówienie · mięso bazowe przed dodaniem wody i składników receptury" className="mb-4">
    <div className="overflow-x-auto"><table className="order-table min-w-[550px]">
      <thead><tr><th>Receptura</th><th className="numeric">Brak wyrobu</th><th className="numeric">Przyrost masy</th><th className="numeric">Mięso bazowe</th></tr></thead>
      <tbody>{recipes.map(r => {
        const lines = r.details.map(d => d.line), m = mixingTotals(lines)
        const growth = lines[0]?.mixing?.growthPct
        const reasons = [...new Set(lines.map(l => l.mixing?.reason || (!l.mixing ? 'Brak danych MES.' : '')).filter(Boolean))]
        return <tr key={r.key}><td><b>{r.name}</b>{reasons.map(reason => <small className="order-warning max-w-sm" key={reason}>{reason}</small>)}</td>
          <td className="numeric">{kgText(m.remainingKg)}</td><td className="numeric">{growth == null ? '—' : `+${percentNumber.format(growth)}%`}</td>
          <td className="numeric"><span className="mixing-value">{kgText(m.meatKg)}</span><small>Dodatki: {kgText(m.additivesKg)}</small></td></tr>
      })}</tbody>
    </table></div>
    <p className="order-info">Potrzeba technologiczna po pokryciu wyrobem. Nie odejmuje mięsa przyprawionego ani rezerwacji planów; nie jest automatycznym zleceniem kolejnego wsadu.</p>
  </OrderSection>
}
