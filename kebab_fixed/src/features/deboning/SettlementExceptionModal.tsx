import { useState, type CSSProperties } from 'react'
import { AlertTriangle, Delete } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { toleranceLabel, type TakeSettlement } from './settlement'

export const EXCEPTION_REASONS = [
  'Mięso upadło / odpad',
  'Ubytek: wyciek, szron, obcięte',
  'Pomyłka ważenia nie do odtworzenia',
  'Inne — wyjaśnię w biurze',
]

/**
 * Closing a take OUTSIDE the tolerance (+1.5 % / −0.5 %): a conscious manager decision with a reason.
 * The code is verified by the server; weights stay exactly as measured.
 */
export function SettlementExceptionModal({ s, vars, busy, error, onCancel, onConfirm }: {
  s: TakeSettlement
  vars?: CSSProperties
  busy?: boolean
  error?: string
  onCancel: () => void
  onConfirm: (code: string, reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [code, setCode] = useState('')
  const diff = s.differenceKg
  const press = (k: string) => setCode(prev => (k === '⌫' ? prev.slice(0, -1) : (prev + k).slice(0, 8)))
  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40" style={vars} role="dialog" aria-label="Zatwierdzenie z wyjątkiem">
      <div className="w-[620px] p-7 flex flex-col gap-5"
        style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 flex items-center justify-center flex-shrink-0"
            style={{ borderRadius: 12, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}>
            <AlertTriangle size={26} />
          </div>
          <div>
            <h3 className="font-extrabold text-xl leading-tight">Zatwierdź poza tolerancją — {s.workerName}</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--mut)' }}>
              {diff < 0 ? 'Brakuje' : 'Nadmiar'} {fmtKg(Math.abs(diff), 1)} kg z {fmtKg(Number(s.kgTaken), 1)} kg
              (dopuszczalne {toleranceLabel(s)} = {fmtKg(s.minKg, 1)}–{fmtKg(s.maxKg, 1)} kg). Wagi zostaną zapisane tak, jak zważono — bez dopisywania kilogramów.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Powód</span>
          <div className="grid grid-cols-2 gap-2">
            {EXCEPTION_REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
                className="min-h-12 px-3 text-[14px] font-bold text-left"
                style={{ borderRadius: 10, background: reason === r ? 'var(--amb)' : 'var(--panel)',
                  color: reason === r ? '#fff' : 'var(--ink)', border: '1.5px solid var(--ambLine)' }}>{r}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Kod kierownika</span>
            <div className="h-14 flex items-center justify-center hmi-v10-mono text-3xl font-extrabold tracking-[.4em]"
              aria-label="Wpisany kod" style={{ borderRadius: 10, border: `1.5px solid ${error ? 'var(--redLine)' : 'var(--line)'}`, background: 'var(--bg)' }}>
              {code.replace(/./g, '•') || <span className="text-base tracking-normal font-bold" style={{ color: 'var(--mut)' }}>wpisz kod</span>}
            </div>
            {error ? <span role="alert" className="text-[13px] font-bold" style={{ color: 'var(--red)' }}>{error}</span> : null}
          </div>
          <div className="grid grid-cols-3 gap-1.5 flex-shrink-0">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? (
              <button key={k} type="button" onClick={() => press(k)} aria-label={k === '⌫' ? 'Usuń cyfrę' : k}
                className="w-14 h-11 flex items-center justify-center text-xl font-extrabold"
                style={{ borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                {k === '⌫' ? <Delete size={20} /> : k}
              </button>
            ) : <span key={`gap-${i}`} />)}
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy}
            className="h-14 flex-1 text-base font-bold" style={{ borderRadius: 10, border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
            Wróć — popraw ważenia
          </button>
          <button type="button" onClick={() => onConfirm(code, reason)} disabled={busy || reason.length < 3 || code.length < 4}
            className="h-14 flex-1 text-base font-bold disabled:opacity-50"
            style={{ borderRadius: 10, background: 'var(--amb)', color: '#fff' }}>
            {busy ? 'Zatwierdzam…' : 'Zatwierdź z wyjątkiem'}
          </button>
        </div>
      </div>
    </div>
  )
}
