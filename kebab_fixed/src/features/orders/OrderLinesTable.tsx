import type { ClientOrder } from '@/lib/mockApi'
import { kgText, totalLines } from './orderPlanning'

export function OrderLinesTable({ order }: { order: ClientOrder }) {
  const totals = totalLines(order.lines)
  return <div className="overflow-x-auto rounded-lg border border-surface-4 bg-white">
    <table className="w-full min-w-[900px] text-xs tabular-nums">
      <caption className="px-4 py-3 text-left text-sm font-semibold">Pozycje zamówienia ({order.lines.length})</caption>
      <thead className="bg-surface-2 text-ink-3"><tr>
        {['Receptura / rodzaj', 'Tuleja / długość / opakowanie', 'Masa × sztuki', 'Zamówiono', 'W magazynie', 'Wydane wg MES', 'Pokryte wyrobem', 'Pozostało'].map((h, i) =>
          <th scope="col" key={h} className={`px-3 py-3 font-medium ${i < 3 ? 'text-left' : 'text-right'}`}>{h}</th>)}
      </tr></thead>
      <tbody>{order.lines.map(line => <tr key={line.id} className="border-t border-surface-3">
        <td className="max-w-64 px-3 py-3"><span className="font-semibold">{line.recipeName || 'Nieznana receptura'}</span><span className="mt-1 block text-ink-3">{line.productTypeName || 'Nie podano rodzaju'}</span></td>
        <td className="max-w-64 break-words px-3 py-3">{line.packagingName || 'Nie podano'}{line.notes && <span className="block text-ink-3">{line.notes}</span>}</td>
        <td className="px-3 py-3 whitespace-nowrap">{kgText(line.kgPerUnit)} × {line.qty} szt.</td>
        <td className="px-3 py-3 text-right whitespace-nowrap">{kgText(line.fulfillment?.orderedKg ?? line.qty * line.kgPerUnit)}</td>
        <td className="px-3 py-3 text-right whitespace-nowrap">{kgText(line.fulfillment?.stockKg ?? null)}</td>
        <td className="px-3 py-3 text-right whitespace-nowrap">{kgText(line.fulfillment?.deliveredKg ?? null)}</td>
        <td className="px-3 py-3 text-right whitespace-nowrap">{kgText(line.fulfillment?.coveredKg ?? null)}</td>
        <td className="px-3 py-3 text-right whitespace-nowrap font-semibold">{order.status === 'cancelled' ? 'Nie planuj' : kgText(line.fulfillment?.remainingKg ?? null)}</td>
      </tr>)}</tbody>
      <tfoot className="border-t border-surface-4 bg-surface-2 font-semibold"><tr>
        <th scope="row" colSpan={3} className="px-3 py-3 text-left">Razem</th>
        {[totals.orderedKg, totals.stockKg, totals.deliveredKg, totals.coveredKg].map((v, i) => <td key={i} className="px-3 py-3 text-right whitespace-nowrap">{kgText(v)}</td>)}
        <td className="px-3 py-3 text-right whitespace-nowrap">{order.status === 'cancelled' ? 'Nie planuj' : kgText(totals.remainingKg)}</td>
      </tr></tfoot>
    </table>
  </div>
}
