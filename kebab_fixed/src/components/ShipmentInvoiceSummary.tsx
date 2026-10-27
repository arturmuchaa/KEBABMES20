import type { ShipmentInvoiceData } from '@/lib/api'

export function ShipmentInvoiceSummary({ data }: { data?: ShipmentInvoiceData | null }) {
  if (!data) return null
  return <section className="my-3 rounded-lg border p-3" aria-label="Dane do faktury z załadunku">
    <h3 className="font-semibold">Do faktury — tylko towar tego załadunku</h3>
    <p className="text-sm">Na fakturę: <b>{data.invoice_kg} kg</b> · Na WZ klienta: <b>{data.wz_kg} kg</b>.</p>
    <ul className="my-2 list-disc pl-5 text-sm">{data.lines.map(l => <li key={l.order_line_id}>
      {l.name} {l.kg_per_unit} kg: FV {l.invoice_qty} szt. / {l.invoice_kg} kg; WZ {l.wz_qty} szt. / {l.wz_kg} kg.
    </li>)}</ul>
    <p className="text-sm">To dane do wystawienia faktury, nie faktura. MES nie wysyła ich automatycznie do Subiekta GT.</p>
  </section>
}
