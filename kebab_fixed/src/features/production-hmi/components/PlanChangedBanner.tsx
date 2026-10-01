/**
 * Biuro zmieniło plan w trakcie zmiany.
 *
 * Pasek NIE znika sam — operator musi go potwierdzić, żeby zmiana nie przeszła
 * niezauważona przy hałasie. Nazywa konkret („doszła KIRMIZI 10×40 kg"),
 * bo „plan się zmienił" nie mówi hali nic.
 *
 * Od 01.10.2026 pasek ma JEDNĄ linię: przy kilku zmianach lista rosła w dół
 * i zjadała wysokość planu, który ma się mieścić cały na ekranie. Zmiany stoją
 * w jednej linii (ile się zmieści), a pełna lista rozwija się NAD planem,
 * nie przesuwając go.
 */
import { useState } from 'react'
import { opiszZmiane, type PlanChange } from '../planDiff'

export function PlanChangedBanner({ changes, onAck }: { changes: PlanChange[]; onAck: () => void }) {
  const [rozwiniety, setRozwiniety] = useState(false)
  if (!changes.length) return null
  return (
    <div data-testid="pasek-zmian" className="relative flex-shrink-0 flex items-center gap-3" style={{
      background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', borderRadius: 10,
      height: 44, padding: '0 4px 0 14px', color: 'var(--amb)',
    }}>
      <span aria-hidden="true" className="text-lg leading-none">⚠</span>
      <span className="text-[14px] font-extrabold whitespace-nowrap">Plan zmieniony przez biuro:</span>
      <ul className="flex-1 min-w-0 flex gap-4 overflow-hidden whitespace-nowrap text-[14px] font-semibold m-0 p-0 list-none">
        {changes.map((z, i) => <li key={i} className="flex-shrink-0 truncate" style={{ maxWidth: '100%' }} title={opiszZmiane(z)}>{opiszZmiane(z)}</li>)}
      </ul>
      {/* Zawsze, także przy JEDNEJ zmianie: długi opis potrafi się uciąć
          w linii paska, a operator musi móc go przeczytać w całości. */}
      <button type="button" data-testid="zmiany-rozwin" onClick={() => setRozwiniety(r => !r)} aria-expanded={rozwiniety}
        className="phmi-btn text-[13px] font-bold flex-shrink-0"
        style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--ambLine)', background: 'var(--panel)', color: 'var(--amb)' }}>
        {rozwiniety ? 'Zwiń' : changes.length > 1 ? `Wszystkie (${changes.length})` : 'Pokaż całość'}
      </button>
      <button type="button" onClick={onAck} className="phmi-btn text-sm font-bold flex-shrink-0"
        style={{ height: 38, padding: '0 20px', borderRadius: 8, border: 0, background: 'var(--amb)', color: '#fff' }}>
        Rozumiem
      </button>
      {rozwiniety && (
        <ul data-testid="zmiany-lista" className="absolute left-0 right-0 z-30 m-0 text-[15px] font-semibold overflow-y-auto"
          style={{ top: 'calc(100% + 4px)', maxHeight: '50vh', background: 'var(--panel)', border: '1px solid var(--ambLine)',
                   borderRadius: 10, padding: '10px 14px 10px 32px', listStyle: 'disc', color: 'var(--ink)',
                   boxShadow: '0 12px 30px -12px rgba(0,0,0,.3)' }}>
          {changes.map((z, i) => <li key={i} style={{ padding: '3px 0' }}>{opiszZmiane(z)}</li>)}
        </ul>
      )}
    </div>
  )
}
