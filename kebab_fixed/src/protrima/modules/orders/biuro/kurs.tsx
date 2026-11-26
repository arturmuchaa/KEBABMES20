import React from 'react'
import { Check } from 'lucide-react'
import { FlagIcon } from '../../../ui/Glyphs'
import { kg, num } from '../../../data/model'
import { errCode, type PartialLoadingConfirmation, type WynikKursu } from '@/lib/api'

/** Odmowa „wydanie częściowe — potwierdź” z serwera (ta sama co na HMI), albo null. */
export function czesciowe(e: unknown): PartialLoadingConfirmation | null {
  if (errCode(e) !== 'PARTIAL_LOADING_CONFIRMATION_REQUIRED') return null
  const d = (e as { detail?: PartialLoadingConfirmation }).detail
  return d?.confirmation_token && Array.isArray(d.orders) ? d : null
}

/** Braki wydania częściowego — biuro widzi, czego nie ma na aucie, zanim potwierdzi wyjazd. */
export function BrakiCzesciowe({ p }: { p: PartialLoadingConfirmation }) {
  const zBrakami = p.orders.filter(o => !o.coverage.complete)
  return (
    <div className="note warn" role="alert"><FlagIcon level="warn" size={15} /><div>
      <b>Wydanie częściowe.</b> Na aucie jest mniej, niż zamówiono — dokumenty obejmą tylko to, co pojedzie.
      {zBrakami.map(o => (
        <div key={o.order_id} style={{ marginTop: 6 }}>
          <span className="strong">{o.order_no}</span> <span className="muted">{o.client_name}</span>
          <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
            {o.coverage.missing.map(m => <li key={m.order_line_id}>{m.name}: brakuje <b className="num">{num(m.missing_qty)} szt.</b> ({kg(m.missing_kg)})</li>)}
          </ul>
        </div>
      ))}
    </div></div>
  )
}

/** Wynik zamknięcia kursu: co pojechało, numery HDI/WM i zamówienia pominięte (brak wyrobu na stanie). */
export function WynikKursuNotka({ w }: { w: WynikKursu }) {
  const pominiete = w.orders.filter(o => o.skipped)
  return <>
    <div className="note ok"><Check size={15} color="var(--ok)" aria-hidden="true" /><div>
      <b>Kurs zakończony{w.plate ? ` — ${w.plate}` : ''}.</b>
      {w.orders.filter(o => !o.skipped).map(o => (
        <div key={o.order_id}>{o.order_no}: {o.wz_number ? `${o.wz_number} potwierdzony` : 'dokumenty wystawisz w „Kursy po załadunku”'}{o.hdi_number ? ` · HDI ${o.hdi_number}` : ''}</div>
      ))}
    </div></div>
    {pominiete.length > 0 && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>
      <b>Pominięte — nie ma czego wydać:</b> {pominiete.map(o => `${o.order_no} (${o.skipped})`).join('; ')}. Sprawdź wyrób gotowy na stanie.
    </div></div>}
  </>
}
