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
 *
 * Od 03.10.2026 ekran produkcji pokazuje pasek w NAGŁÓWKU (`kompakt`):
 * miejsce nad planem zajął stały pasek skanera, a na 1280×720 nie ma
 * wysokości na oba. Treść i przyciski te same, pełna lista rozwija się pod
 * nagłówkiem.
 */
import { useState } from 'react'
import { opiszZmiane, type PlanChange } from '../planDiff'

export function PlanChangedBanner({ changes, onAck, kompakt = false }: {
  changes: PlanChange[]; onAck: () => void; kompakt?: boolean
}) {
  const [rozwiniety, setRozwiniety] = useState(false)
  if (!changes.length) return null
  const btnH = kompakt ? 36 : 38
  return (
    <div data-testid="pasek-zmian" className={`relative flex items-center ${kompakt ? 'min-w-0 gap-2' : 'flex-shrink-0 gap-3'}`} style={{
      background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', borderRadius: 10,
      height: kompakt ? 42 : 44, padding: kompakt ? '0 3px 0 10px' : '0 4px 0 14px', color: 'var(--amb)',
      flex: kompakt ? '0 1 auto' : undefined,
    }}>
      <span aria-hidden="true" className="text-lg leading-none">⚠</span>
      <span className={kompakt ? 'sr-only' : 'text-[14px] font-extrabold whitespace-nowrap'}>Plan zmieniony przez biuro:</span>
      <ul className="flex-1 min-w-0 flex gap-4 overflow-hidden whitespace-nowrap text-[14px] font-semibold m-0 p-0 list-none">
        {changes.map((z, i) => <li key={i} className="flex-shrink-0 truncate" style={{ maxWidth: '100%' }} title={opiszZmiane(z)}>{opiszZmiane(z)}</li>)}
      </ul>
      {/* Zawsze, także przy JEDNEJ zmianie: długi opis potrafi się uciąć
          w linii paska, a operator musi móc go przeczytać w całości. */}
      <button type="button" data-testid="zmiany-rozwin" onClick={() => setRozwiniety(r => !r)} aria-expanded={rozwiniety}
        className="phmi-btn text-[13px] font-bold flex-shrink-0"
        style={{ height: btnH, padding: '0 12px', borderRadius: 8, border: '1px solid var(--ambLine)', background: 'var(--panel)', color: 'var(--amb)' }}>
        {rozwiniety ? 'Zwiń' : changes.length > 1 ? `Wszystkie (${changes.length})` : kompakt ? 'Pokaż' : 'Pokaż całość'}
      </button>
      <button type="button" onClick={onAck} className="phmi-btn text-sm font-bold flex-shrink-0"
        style={{ height: btnH, padding: kompakt ? '0 12px' : '0 20px', borderRadius: 8, border: 0, background: 'var(--amb)', color: '#fff' }}>
        Rozumiem
      </button>
      {rozwiniety && (
        <ul data-testid="zmiany-lista" className={`absolute z-30 m-0 text-[15px] font-semibold overflow-y-auto ${kompakt ? 'right-0' : 'left-0 right-0'}`}
          style={{ top: 'calc(100% + 4px)', maxHeight: '50vh', background: 'var(--panel)', border: '1px solid var(--ambLine)',
                   width: kompakt ? 'min(600px, 90vw)' : undefined,
                   borderRadius: 10, padding: '10px 14px 10px 32px', listStyle: 'disc', color: 'var(--ink)',
                   boxShadow: '0 12px 30px -12px rgba(0,0,0,.3)' }}>
          {kompakt && <li className="list-none -ml-4 mb-1 font-extrabold" style={{ color: 'var(--amb)' }}>Plan zmieniony przez biuro:</li>}
          {changes.map((z, i) => <li key={i} style={{ padding: '3px 0' }}>{opiszZmiane(z)}</li>)}
        </ul>
      )}
    </div>
  )
}
