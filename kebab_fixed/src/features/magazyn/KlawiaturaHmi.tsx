import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'

/** In-app keyboard: no Windows OSK or physical keyboard needed. */
export function KlawiaturaHmi({ label, value, maxLength = 160, onAccept, onClose }: {
  label: string; value: string; maxLength?: number; onAccept: (value: string) => void; onClose: () => void
}) {
  const [text, setText] = useState(value)
  const [upper, setUpper] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  function insert(char: string, remove = false) {
    const el = input.current
    const start = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? text.length
    const from = remove && start === end ? Math.max(0, start - 1) : start
    const next = text.slice(0, from) + char + text.slice(end)
    if (next.length > maxLength) return
    setText(next)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(from + char.length, from + char.length) })
  }
  const accept = () => { onAccept(text); onClose() }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent style={HMI_VARS} className="w-[98vw] max-w-[920px] max-h-[96vh] overflow-y-auto p-3"
      onOpenAutoFocus={e => { e.preventDefault(); input.current?.focus(); input.current?.setSelectionRange(value.length, value.length) }}>
      <DialogTitle>Klawiatura · {label}</DialogTitle>
      <DialogDescription>Wpisz tekst dotykiem i zatwierdź.</DialogDescription>
      <input ref={input} aria-label={label} inputMode="none" value={text} maxLength={maxLength}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') accept() }}
        className="min-h-14 w-full rounded-lg border px-3 text-xl" />
      {['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'ąćęłńóśźż', '-.,/()'].map(row => <div key={row} className="flex justify-center gap-1">
        {[...row].map(c => <button type="button" key={c} onPointerDown={e => e.preventDefault()} onClick={() => insert(upper ? c.toLocaleUpperCase('pl') : c)}
          className="min-h-12 min-w-0 flex-1 rounded-lg border text-lg font-bold" style={{ background: 'var(--panel)', color: 'var(--ink)' }}>
          {upper ? c.toLocaleUpperCase('pl') : c}
        </button>)}
      </div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={upper} onPointerDown={e => e.preventDefault()} onClick={() => setUpper(!upper)} className="min-h-12 rounded-lg border px-4">Aa</button>
        <button type="button" onPointerDown={e => e.preventDefault()} onClick={() => insert(' ')} className="min-h-12 flex-1 rounded-lg border px-4">Spacja</button>
        <button type="button" onPointerDown={e => e.preventDefault()} onClick={() => insert('', true)} className="min-h-12 rounded-lg border px-4">Usuń znak</button>
        <button type="button" onClick={onClose} className="min-h-12 rounded-lg border px-4">Anuluj</button>
        <button type="button" onClick={accept} className="min-h-12 rounded-lg px-6 font-bold text-white" style={{ background: 'var(--accent)' }}>Gotowe</button>
      </div>
    </DialogContent>
  </Dialog>
}
