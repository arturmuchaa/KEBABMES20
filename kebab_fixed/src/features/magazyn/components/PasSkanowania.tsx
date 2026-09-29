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
 *
 * JEDNA KOLEJKA: skany idą po kolei, każdy po zakończeniu poprzedniego.
 * Skan złapany jeszcze na menu (zanim pole istniało) wchodzi do tej samej
 * kolejki przez `ref.dodaj` — inaczej wyprzedzałby albo dublował skany
 * z pola. Skan, który czekał w kolejce, a w międzyczasie ekran zniknął
 * albo otworzył się dialog, NIE jest wysyłany, gdy ekran podał
 * `onPominiety` — ten mówi operatorowi, że skan trzeba powtórzyć. Dotyczy
 * to też dialogu, który zdążył się zamknąć (epoka kolejki). Żądanie
 * już wysłane kończy się normalnie.
 *
 * CHWILA ODCZYTU: `onSkan` dostaje drugim argumentem `{ ts }` — kiedy kod
 * PRZYSZEDŁ (pole albo `dodaj`), a nie kiedy kolejka do niego doszła. Po
 * wolnym odczycie z serwera czas wykonania mówi o sieci, nie o skanerze.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useSkanAutoSubmit } from '@/features/scan/useSkanAutoSubmit'

export interface PasSkanowaniaUchwyt {
  /** Wstaw kod do kolejki tak, jakby przyszedł z pola. `ts` — chwila odczytu. */
  dodaj: (kod: string, ts?: number) => void
}

/** Metadane skanu niesione kolejką aż do decyzji. */
export interface SkanMeta { /** chwila odczytu (Date.now()) */ ts: number }

export const PasSkanowania = forwardRef<PasSkanowaniaUchwyt, {
  placeholder: string
  onSkan: (kod: string, meta: SkanMeta) => void | Promise<void>
  /** Krótka linia obok pola — co tu się skanuje. */
  podpis?: string
  disabled?: boolean
  onPendingChange?: (pending: boolean) => void
  /** Skan czekał w kolejce, ale ekran zniknął / został zablokowany. */
  onPominiety?: (kod: string) => void
}>(function PasSkanowania({ placeholder, onSkan, podpis, disabled = false, onPendingChange, onPominiety }, ref) {
  const [wartosc, setWartosc] = useState('')
  const pole = useRef<HTMLInputElement>(null)
  const kolejka = useRef(Promise.resolve())
  const oczekuje = useRef(0)
  const callback = useRef(onSkan)
  callback.current = onSkan
  const pendingCallback = useRef(onPendingChange)
  pendingCallback.current = onPendingChange
  const pominietyCallback = useRef(onPominiety)
  pominietyCallback.current = onPominiety
  const wylaczony = useRef(disabled)
  wylaczony.current = disabled
  // Epoka kolejki: rośnie przy każdej blokadzie. Skan pamięta epokę z chwili
  // dodania — jeśli blokada przyszła i zdążyła minąć, zanim kolejka do niego
  // doszła, i tak jest nieaktualny (modal przerwał kolejkę).
  const epoka = useRef(0)
  useLayoutEffect(() => { if (disabled) epoka.current++ }, [disabled])
  const zywy = useRef(true)
  useEffect(() => {
    zywy.current = true
    return () => { zywy.current = false }
  }, [])

  function doKolejki(t: string, ts = Date.now()) {
    oczekuje.current++
    pendingCallback.current?.(true)
    const mojaEpoka = epoka.current
    const zadanie = kolejka.current.then(() => {
      // Bez `onPominiety` ekran nie umiałby powiedzieć o pominięciu, więc
      // zachowuje dawne zachowanie (wysyła) — tak działa załadunek.
      const pomin = pominietyCallback.current
      if (pomin && (!zywy.current || wylaczony.current || epoka.current !== mojaEpoka)) { pomin(t); return }
      return callback.current(t, { ts })
    }).then(() => {})
    kolejka.current = zadanie.catch(() => {})
    return zadanie.finally(() => {
      oczekuje.current--
      if (zywy.current) pendingCallback.current?.(oczekuje.current > 0)
    })
  }

  function wyslij(kod: string) {
    const t = kod.trim()
    setWartosc('')
    if (!t || disabled) return
    return doKolejki(t)
  }

  useImperativeHandle(ref, () => ({
    dodaj: (kod: string, ts?: number) => { const t = kod.trim(); if (t) void doKolejki(t, ts).catch(() => {}) },
  }), [])

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
})
