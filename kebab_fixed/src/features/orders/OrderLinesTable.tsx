import type { ClientOrder } from '@/lib/mockApi'
import { kgText } from './orderPlanning'
import { ProductionProgress } from './OrderUI'

/** Compact rows inside an expanded order. Shared explanations appear once. */
export function OrderLinesTable({ order }: { order: ClientOrder }) {
  return <section className="order-lines" aria-label={`Pozycje ${order.orderNo}`}>
    <h3 className="sr-only">Pozycje zamówienia ({order.lines.length})</h3>
    {order.lines.map(line => <div key={line.id} className="order-product-row">
      <div className="order-product-identity">
        <div className="order-product-title"><h4>{line.recipeName || 'Nieznana receptura'}</h4>
          <p className="order-product-quantity">{line.qty} × {kgText(line.kgPerUnit)} <span>· {kgText(line.fulfillment?.orderedKg ?? line.qty * line.kgPerUnit)}</span></p></div>
        <p>{line.productTypeName || 'Nie podano rodzaju'} · {line.packagingName || 'Bez opakowania'}</p>
        {line.notes && <p className="order-line-note">{line.notes}</p>}
      </div>
      <ProductionProgress line={line} compact />
      <div className="order-line-remaining">
        <span>Pozostało wg raportów produkcji</span>
        <div className="order-line-balance"><strong>{order.status === 'cancelled' ? 'Nie planuj' : kgText(line.production?.remainingKg ?? null)}</strong>
          <small>{line.production ? `${line.production.remainingQty} szt.` : 'Brak danych MES'}</small></div>
        <small>Brak do pokrycia zamówienia: <b>{order.status === 'cancelled' ? '—' : kgText(line.mixing?.remainingKg ?? null)}</b></small>
        {line.mixing?.reason && line.mixing.remainingKg === null && <small className="order-warning">{line.mixing.reason}</small>}
      </div>
      <div className="order-line-stock">
        <span>Pokrycie zamówienia · osobne dane</span>
        <dl><div><dt>W magazynie</dt><dd>{line.fulfillment ? `${line.qtyStock ?? 0} szt.` : '—'}</dd></div>
          <div><dt>Wydane wg MES</dt><dd>{line.fulfillment ? `${line.qtyDelivered ?? 0} szt.` : '—'}</dd></div></dl>
      </div>
    </div>)}
    <p className="order-lines-note">GOTOWE: sztuki zgłoszone w powiązanych planach MES. Brak danych oznacza brak wiarygodnego powiązania z raportem.
      Magazyn i wydania pokazujemy osobno. Palet i kartonów nie dodajemy do produkcji.</p>
  </section>
}
