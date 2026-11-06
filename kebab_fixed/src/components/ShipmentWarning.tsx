import type { ShipmentCoverage } from '@/lib/api'

/** Persistent warning: a partial shipment is allowed, not a failed scan. */
export function ShipmentWarning({ coverage }: { coverage?: ShipmentCoverage | null }) {
  if (!coverage || coverage.complete) return null
  return <div role="alert" className="my-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
    <p className="font-bold">Wydanie częściowe — zamówienie nie wyjechało w całości.</p>
    <ul className="mt-1 list-disc pl-5">
      {coverage.missing.map(p => <li key={p.order_line_id}>
        {p.name} {p.kg_per_unit} kg: brakuje <b>{p.missing_qty} szt. / {p.missing_kg} kg</b>
      </li>)}
      {coverage.extra_qty > 0 && <li>Nadmiar lub inny produkt: {coverage.extra_qty} szt. — wymaga wyjaśnienia z biurem.</li>}
    </ul>
    <p className="mt-2">Dokumenty obejmują tylko potwierdzony załadunek. Brakujące sztuki pozostają do realizacji.</p>
  </div>
}
