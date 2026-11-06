import { useState, type CSSProperties } from 'react'
import { Delete, Lock } from 'lucide-react'

/**
 * Kod serwisowy przed zmianą, która rusza stany i akord (zmiana/usunięcie
 * pobrania, edycja/usunięcie wpisu). `run` zwraca błąd do pokazania albo null;
 * okno zostaje otwarte przy błędzie (np. zły kod, mięso już zużyte).
 */
export function ServiceCodeModal({ title, detail, confirmLabel, danger, vars, onCancel, run }: {
  title: string
  detail: string
  confirmLabel: string
  danger?: boolean
  vars?: CSSProperties
  onCancel: () => void
  run: (code: string) => Promise<string | null>
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const press = (k: string) => { setError(''); setCode(p => (k === '⌫' ? p.slice(0, -1) : (p + k).slice(0, 8))) }
  async function confirm() {
    setBusy(true)
    const err = await run(code)
    setBusy(false)
    if (err) { setError(err); setCode('') }
  }
  return (
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/45" style={vars} role="dialog" aria-label="Kod serwisowy">
      <div className="w-[440px] p-6 flex flex-col gap-4"
        style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 flex items-center justify-center flex-shrink-0"
            style={{ borderRadius: 10, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}><Lock size={20} /></span>
          <div>
            <div className="font-extrabold text-xl leading-tight">{title}</div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--mut)' }}>{detail}</div>
          </div>
        </div>
        <div className="h-14 flex items-center justify-center hmi-v10-mono text-3xl font-extrabold tracking-[.4em]" aria-label="Wpisany kod"
          style={{ borderRadius: 10, border: `1.5px solid ${error ? 'var(--redLine)' : 'var(--line)'}`, background: 'var(--bg)' }}>
          {code.replace(/./g, '•') || <span className="text-base tracking-normal font-bold" style={{ color: 'var(--mut)' }}>kod serwisowy</span>}
        </div>
        {error && <div role="alert" className="text-[14px] font-bold -mt-2" style={{ color: 'var(--red)' }}>{error}</div>}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? (
            <button key={k} type="button" onClick={() => press(k)} aria-label={k === '⌫' ? 'Usuń cyfrę' : k}
              className="hmi-v10-mono h-14 flex items-center justify-center text-2xl font-bold"
              style={{ borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--line)' }}>
              {k === '⌫' ? <Delete size={22} /> : k}
            </button>
          ) : <span key={`gap-${i}`} />)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} disabled={busy}
            className="h-14 font-bold text-base" style={{ borderRadius: 12, border: '1px solid var(--line)', color: 'var(--mut)' }}>
            Anuluj
          </button>
          <button type="button" onClick={() => { void confirm() }} disabled={busy || code.length < 4}
            className="h-14 font-extrabold text-base disabled:opacity-50"
            style={{ borderRadius: 12, background: danger ? 'var(--red)' : 'var(--accent)', color: '#fff' }}>
            {busy ? 'Chwila…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
