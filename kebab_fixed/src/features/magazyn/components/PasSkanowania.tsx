/**
 * Pole skanowania kiosku magazynu.
 *
 * Czytnik Zebra bez sufiksu Enter wpisuje kod i nic więcej — formularz się
 * nie wysyła i wygląda to jak awaria MES (zakład, 17.09.2026, DS2278).
 * Dlatego auto-wysyłka przez wspólny hook `useSkanAutoSubmit` — ten sam,
 * którego używa telefon przy załadunku. Enter, jeśli przyjdzie, też działa.
 *
 * FOKUS WRACA SAM: dotknięcie listy czy przycisku zabiera fokus z pola,
 * a następny skan wpadłby w próżnię. Pole odzyskuje go po każdym kliknięciu
 * poza innymi polami tekstowymi.
 */
import { useEffect, useRef, useState } from 'react'
import { useSkanAutoSubmit } from '@/features/scan/useSkanAutoSubmit'

export function PasSkanowania({ placeholder, onSkan, podpis, disabled = false, onPendingChange }: {
  placeholder: string
  onSkan: (kod: string) => void | Promise<void>
  /** Krótka linia obok pola — co tu się skanuje. */
  podpis?: string
  disabled?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const [wartosc, setWartosc] = useState('')
  const pole = useRef<HTMLInputElement>(null)
  const kolejka = useRef(Promise.resolve())
  const oczekuje = useRef(0)
  const callback = useRef(onSkan)
  callback.current = onSkan
  const pendingCallback = useRef(onPendingChange)
  pendingCallback.current = onPendingChange

  function wyslij(kod: string) {
    const t = kod.trim()
    setWartosc('')
    if (!t || disabled) return
    oczekuje.current++
    pendingCallback.current?.(true)
    const zadanie = kolejka.current.then(() => callback.current(t)).then(() => {})
    kolejka.current = zadanie.catch(() => {})
    return zadanie.finally(() => {
      oczekuje.current--
      pendingCallback.current?.(oczekuje.current > 0)
    })
  }

  const { zatwierdz } = useSkanAutoSubmit(wartosc, wyslij)

  useEffect(() => {
    if (disabled) { setWartosc(''); return }
    pole.current?.focus()
    const wroc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('[role="dialog"]') || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      setTimeout(() => pole.current?.focus(), 0)
    }
    document.addEventListener('click', wroc)
    return () => document.removeEventListener('click', wroc)
  }, [disabled])

  return (
    <div className="shrink-0 px-5 pb-4 pt-3"
      style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
      <div className="flex items-center gap-3">
        <span className="grid shrink-0 place-items-center rounded-xl text-[22px]"
          style={{ width: 52, height: 52, background: 'var(--accentSoft)',
                   color: 'var(--accent)', border: '1.5px solid var(--accentLine)' }} aria-hidden>⌁</span>
        <input
          ref={pole}
          className="hmi-v10-mono min-w-0 flex-1 rounded-xl px-4 py-3 text-[20px] font-semibold outline-none"
          style={{ border: '2px solid var(--accent)', background: '#fff', color: 'var(--ink)' }}
          placeholder={placeholder}
          aria-label="Pole skanowania"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={wartosc}
          onChange={e => setWartosc(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            const v = (e.target as HTMLInputElement).value.trim()
            if (!v) return
            setWartosc('')
            zatwierdz(v)
          }}
        />
        {podpis ? (
          <span className="hidden max-w-[260px] text-[13px] leading-snug lg:block"
            style={{ color: 'var(--mut)' }}>{podpis}</span>
        ) : null}
      </div>
    </div>
  )
}
