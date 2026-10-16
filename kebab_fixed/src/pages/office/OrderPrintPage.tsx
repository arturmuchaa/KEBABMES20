import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, clientsApi, settingsApi } from '@/lib/apiClient'
import { fmtDatePl } from '@/lib/utils'
import { drukuj } from '@/lib/print'
import { kgNumber, kgText } from '@/features/orders/orderPlanning'
import { OrderPickingPrintPage } from './OrderPickingPrintPage'
import '@/features/orders/order-print.css'

export function OrderPrintPage() {
  const [params] = useSearchParams()
  return params.get('internal') === '1' ? <OrderPickingPrintPage /> : <CustomerOrderPrint />
}

function CustomerOrderPrint() {
  const { id = '' } = useParams<{ id: string }>()
  const orderRes = useApi(() => clientOrdersApi.byId(id), [id])
  const companyRes = useApi(() => settingsApi.getCompany())
  const clientsRes = useApi(() => clientsApi.list())
  const order = orderRes.data, company = companyRes.data
  const client = clientsRes.data?.find(c => c.id === order?.clientId)
  const loading = orderRes.loading || companyRes.loading || clientsRes.loading
  const error = orderRes.error || companyRes.error || clientsRes.error
  useEffect(() => {
    const previous = document.title
    document.title = order ? `Zamówienie ${order.orderNo}` : 'Wydruk zamówienia'
    return () => { document.title = previous }
  }, [order])
  // Exact persisted variants and weights, not live catalog substitutions.
  const units = (order?.lines ?? []).reduce((s, l) => s + l.qty, 0)
  const mass = (order?.lines ?? []).reduce((s, l) => s + Math.round(l.qty * l.kgPerUnit * 1000), 0) / 1000
  return <div className="customer-order-print">
    {/* Mounted only on this document: no global @page leak into QR labels.
        A named page creates a blank trailing page for the app's toast portal. */}
    <style>{'@media print { @page { size: A4; margin: 14mm 12mm; } }'}</style>
    <nav className="order-print-toolbar no-print" aria-label="Opcje wydruku">
      <Link to="/office/zamowienia"><ArrowLeft size={16} aria-hidden="true" />Wróć do zamówień</Link>
      <span>Wydruk dla klienta · A4</span>
      <button type="button" disabled={loading || !!error || !order} onClick={() => void drukuj()}><Printer size={16} aria-hidden="true" />Drukuj / zapisz PDF</button>
    </nav>
    {loading ? <p className="order-print-message" role="status">Ładowanie danych dokumentu…</p> : error || !order ?
      <div className="order-print-message" role="alert"><h1>Nie udało się otworzyć wydruku</h1><p>{error || 'Nie znaleziono zamówienia.'}</p><button onClick={() => { void orderRes.refetch(); void companyRes.refetch(); void clientsRes.refetch() }}>Ponów pobieranie</button></div> :
      <article className="order-document" aria-label="Zamówienie dla klienta">
        <header className="order-document-header">
          <div className="order-document-supplier">
            {company?.name?.toLocaleLowerCase('pl').includes('księżyc') && <img src="/logo-ksiezyc-print.png" alt="" />}
            <strong>{company?.name || 'Dane firmy nie zostały skonfigurowane'}</strong>
            <p>{company?.address}</p><p>{[company?.postalCode, company?.city].filter(Boolean).join(' ')}</p>
            {company?.nip && <p>NIP: {company.nip}</p>}
            <p>{[company?.phone, company?.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="order-document-title"><p>Dokument zamówienia</p><h1>ZAMÓWIENIE</h1><strong>{order.orderNo}</strong></div>
        </header>
        <section className="order-document-parties">
          <div><h2>Klient</h2><strong>{client?.name || order.clientName}</strong>
            {client?.address && <p>{client.address}</p>}<p>{[client?.postalCode, client?.city].filter(Boolean).join(' ')}</p>
            {client?.nip && <p>NIP: {client.nip}</p>}
          </div>
          <dl><div><dt>Data zamówienia</dt><dd>{fmtDatePl(order.orderDate)}</dd></div>
            {order.deliveryDate && <div><dt>Planowana dostawa</dt><dd>{fmtDatePl(order.deliveryDate)}</dd></div>}
            <div><dt>Liczba pozycji</dt><dd>{order.lines.length}</dd></div>
          </dl>
        </section>
        <table className="order-document-table">
          <thead><tr><th scope="col">Lp.</th><th scope="col">Produkt / receptura</th><th scope="col">Waga sztuki</th><th scope="col">Ilość sztuk</th><th scope="col">Łączna masa</th></tr></thead>
          <tbody>{order.lines.map((line, index) => <tr key={line.id} data-testid={`customer-line-${line.id}`}>
            <td>{index + 1}</td><td><strong>{line.recipeName || line.productTypeName || 'Produkt'}</strong>
              <small>{line.productTypeName && line.recipeName && <span>{line.productTypeName}</span>}
                {line.productTypeName && line.recipeName && line.packagingName && ' · '}
                {line.packagingName && <span>{line.packagingName}</span>}</small>
            </td><td>{kgText(line.kgPerUnit)}</td><td>{kgNumber.format(line.qty)}</td><td><strong>{kgText(Math.round(line.qty * line.kgPerUnit * 1000) / 1000)}</strong></td>
          </tr>)}</tbody>
        </table>
        <section className="order-document-total" data-testid="customer-totals"><div><span>Łączna liczba sztuk</span><strong>{kgNumber.format(units)}</strong></div><div><span>Łączna masa zamówienia</span><strong>{kgText(mass)}</strong></div></section>
        <footer className="order-document-footer"><span>{company?.name}</span><span>Zamówienie {order.orderNo}</span></footer>
      </article>}
  </div>
}
