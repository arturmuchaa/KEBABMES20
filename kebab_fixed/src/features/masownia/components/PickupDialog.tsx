/**
 * Odbiór z masownicy — operator waży paleciakiem i przepisuje odczyt.
 *
 * Waga paleciaka nie jest podpięta do systemu, więc liczba wchodzi ręcznie.
 * Obok stoi wartość WYLICZONA z receptury: jest punktem odniesienia, a nie
 * podpowiedzią do przepisania — realny wsad zawsze trochę się od niej różni
 * i to jest normalne.
 */
import { useState } from 'react'
import type { Charge } from '../useMasowniaData'
import { NumPad, numpadValue } from './NumPad'

const kg = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',')

export function PickupDialog({ charge, expectedKg, onConfirm, onClose, busy }: {
  charge: Charge
  expectedKg: number
  onConfirm: (kgOutput: number) => void
  onClose: () => void
  busy?: boolean
}) {
  const [wpis, setWpis] = useState('')
  const ile = numpadValue(wpis)
  const wolno = !Number.isNaN(ile) && ile > 0 && !busy

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-9" style={{ background: 'rgba(15,23,42,.5)' }}>
      <div className="rounded-2xl w-[880px] flex flex-col overflow-hidden" style={{ background: 'var(--panel)' }}>
        <div className="p-4 px-6 flex items-center gap-3.5" style={{ borderBottom: '1px solid var(--line)' }}>
          <h3 className="m-0 text-[22px] font-extrabold">
            Masownica {charge.machine_id} — {charge.recipe_name || 'wsad'} wymieszane
          </h3>
          <span className="hmi-v10-mono text-xs font-bold px-2 py-1 rounded-md"
            style={{ border: '1px solid var(--line)', color: 'var(--mut)' }}>
            partia {charge.batch_no || '—'}
          </span>
        </div>

        <div className="p-5 px-6 flex gap-6 items-center">
          <div className="flex-1">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--mut)' }}>
              Zważ paleciakiem i wpisz
            </div>
            <div className="rounded-xl p-4 px-5 mt-2 text-right"
              style={{ border: '2px solid var(--line)', background: 'var(--bg)' }}>
              <span className="hmi-v10-mono text-[60px] font-bold leading-tight">
                {wpis || '0'}<i className="not-italic text-[26px] ml-2" style={{ color: 'var(--mut)' }}>kg</i>
              </span>
            </div>
            <div className="flex items-center justify-between mt-3 text-[15px]">
              <span style={{ color: 'var(--mut)' }}>Z receptury wychodzi</span>
              <b className="hmi-v10-mono text-[17px] font-bold">{kg(expectedKg)} kg</b>
            </div>
            <div className="flex items-center justify-between mt-1 text-[15px]">
              <span style={{ color: 'var(--mut)' }}>Mięsa we wsadzie</span>
              <b className="hmi-v10-mono text-[17px] font-bold">{kg(charge.kg_meat)} kg</b>
            </div>
          </div>
          <NumPad value={wpis} onChange={setWpis} />
        </div>

        <div className="p-4 px-6 flex gap-3 items-center" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
          <button type="button" onClick={onClose}
            className="h-[52px] px-6 rounded-[10px] text-base font-extrabold"
            style={{ background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
            Jeszcze nie
          </button>
          <button type="button" onClick={() => wolno && onConfirm(ile)}
            className="h-[52px] px-7 rounded-[10px] text-base font-extrabold ml-auto"
            style={{
              background: 'var(--success)', color: '#fff',
              opacity: wolno ? 1 : 0.35, cursor: wolno ? 'pointer' : 'not-allowed',
            }}>
            {busy ? 'Zapisuję…' : 'Zatwierdź odbiór'}
          </button>
        </div>
      </div>
    </div>
  )
}
