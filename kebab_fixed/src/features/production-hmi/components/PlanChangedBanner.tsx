/**
 * Biuro zmieniło plan w trakcie zmiany.
 *
 * Pasek NIE znika sam — operator musi go potwierdzić, żeby zmiana nie przeszła
 * niezauważona przy hałasie. Nazywa konkret („doszła KIRMIZI 10×40 kg"),
 * bo „plan się zmienił" nie mówi hali nic.
 */
import { opiszZmiane, type PlanChange } from '../planDiff'

export function PlanChangedBanner({ changes, onAck }: { changes: PlanChange[]; onAck: () => void }) {
  if (!changes.length) return null
  return (
    <div className="flex items-center gap-4" style={{
      background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', borderRadius: 12,
      padding: '12px 16px', color: 'var(--amb)',
    }}>
      <span aria-hidden="true" className="text-xl leading-none">⚠</span>
      <div className="text-[15px] font-bold">
        Plan zmieniony przez biuro
        <ul className="pl-5 font-semibold" style={{ listStyle: 'disc' }}>
          {changes.map((z, i) => <li key={i}>{opiszZmiane(z)}</li>)}
        </ul>
      </div>
      <button type="button" onClick={onAck} className="ml-auto text-sm font-bold"
        style={{ height: 44, padding: '0 22px', borderRadius: 10, border: 0, background: 'var(--amb)', color: '#fff' }}>
        Rozumiem
      </button>
    </div>
  )
}
