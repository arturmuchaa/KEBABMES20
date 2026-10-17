import type { ClientOrder } from '@/lib/mockApi'
import { kgNumber, kgText, lineProgress } from './orderPlanning'
import { OrderProgress } from './OrderUI'

/** Compact rows inside an expanded order. Shared explanations appear once. */
export function OrderLinesTable({ order }: { order: ClientOrder }) {
  return <section className="order-lines" aria-label={`Pozycje ${order.orderNo}`}>
    <h3 className="sr-only">Pozycje zamówienia ({order.lines.length})</h3>
    {order.lines.map(line => {
      const progress = lineProgress(line)
      return <div key={line.id} className="order-product-row">
        <div className="order-product-identity">
          <div className="order-product-title"><h4>{line.recipeName || 'Nieznana receptura'}</h4>
            <p className="order-product-quantity">{line.qty} × {kgText(line.kgPerUnit)} <span>· {kgText(line.fulfillment?.orderedKg ?? line.qty * line.kgPerUnit)}</span></p></div>
          <p>{line.productTypeName || 'Nie podano rodzaju'} · {line.packagingName || 'Bez opakowania'}</p>
          {line.notes && <p className="order-line-note">{line.notes}</p>}
        </div>
        <OrderProgress line={line} compact />
        <div className="order-line-remaining">
          <span>Pozostało</span>
          <div className="order-line-balance"><strong>{order.status === 'cancelled' ? 'Nie planuj' : kgText(progress?.remainingKg ?? null)}</strong>
            {order.status !== 'cancelled' && <small>{progress ? `${kgNumber.format(progress.remainingQty)} szt.` : 'Brak danych magazynowych'}</small>}</div>
        </div>
      </div>
    })}
    <p className="order-lines-note">Postęp: przydzielony magazyn wyrobu + wydania. Bez doliczania raportów planów, palet i kartonów.</p>
  </section>
}
