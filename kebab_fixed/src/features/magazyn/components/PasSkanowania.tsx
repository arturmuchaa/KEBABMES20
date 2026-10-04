/**
 * Pole skanowania kiosku magazynu.
 *
 * Czytnik Zebra bez sufiksu Enter wpisuje kod i nic więcej — formularz się
 * nie wysyła i wygląda to jak awaria MES (zakład, 17.09.2026, DS2278).
 * Dlatego pole samo rozpoznaje granice kodów — wspólnym buforem ramek
 * (`usePoleSkanu`, ten sam co w oknie skanu produkcji). Kod sztuki i karty
 * kartonu wychodzi w chwili, gdy dotrze jego ostatni znak; następny kod
 * zbiera się od nowa, więc szybka seria się nie skleja (hala 02.10.2026).
 * Enter / Tab, jeśli przyjdą, kończą kod od razu.
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
 * LICZNIK „ODEBRANO": pokazuje skany przyjęte do kolejki, a jeszcze nie
 * rozliczone — to NIE jest potwierdzenie zapisu. Werdykt (cisza, ton,
 * alarm) daje ekran dopiero po odpowiedzi serwera.
 *
 * ODRZUCONY `onSkan`: ekrany same łapią błędy zapisu i mówią o nich. Gdyby
 * jednak obsługa rzuciła wyjątek, skan nie znika po cichu: trwały komunikat
 * z kodem i dźwięk błędu, kolejka idzie dalej. Nic nie jest ponawiane
 * automatycznie, a komunikat nie twierdzi, że nic nie zapisano — wynik
 * takiego zapisu bywa niepewny.
 *
 * CHWILA ODCZYTU: `onSkan` dostaje drugim argumentem `{ ts }` — kiedy kod
 * PRZYSZEDŁ (pole albo `dodaj`), a nie kiedy kolejka do niego doszła. Po
 * wolnym odczycie z serwera czas wykonania mówi o sieci, nie o skanerze.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { usePoleSkanu } from '@/features/scan/usePoleSkanu'
import type { Ramka } from '@/features/scan/buforSkanu'
import { grajBlad } from '../dzwiek'

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
  const pole = useRef<HTMLInputElement>(null)
  const kolejka = useRef(Promise.resolve())
  const oczekuje = useRef(0)
  const [ileCzeka, setIleCzeka] = useState(0)
  const [bladOdczytu, setBladOdczytu] = useState<string | null>(null)
  const [bledyObslugi, setBledyObslugi] = useState<{ nr: number; kod: string; komunikat: string }[]>([])
  const nrBledu = useRef(0)
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
    setIleCzeka(oczekuje.current)
    pendingCallback.current?.(true)
    const mojaEpoka = epoka.current
    const zadanie = kolejka.current.then(() => {
      // Bez `onPominiety` ekran nie umiałby powiedzieć o pominięciu, więc
      // zachowuje dawne zachowanie (wysyła) — tak działa załadunek.
      const pomin = pominietyCallback.current
      if (pomin && (!zywy.current || wylaczony.current || epoka.current !== mojaEpoka)) { pomin(t); return }
      return callback.current(t, { ts })
    }).then(() => {}, (e: unknown) => {
      // Ostatnia linia obrony — nie zastępuje obsługi błędów ekranu.
      if (!zywy.current) return
      const nr = ++nrBledu.current
      const powod = (e as { message?: string } | null)?.message || 'nieznany błąd'
      setBledyObslugi(b => [...b, { nr, kod: t,
        komunikat: `Błąd obsługi skanu (${powod}) — nie wiadomo, czy zapis doszedł. Sprawdź tę sztukę, zanim zeskanujesz ją ponownie.` }])
      grajBlad('L')
    })
    kolejka.current = zadanie
    return zadanie.finally(() => {
      oczekuje.current--
      if (zywy.current) {
        setIleCzeka(oczekuje.current)
        pendingCallback.current?.(oczekuje.current > 0)
      }
    })
  }

  /** Gotowa ramka z pola — do kolejki od razu, bez czekania na API. */
  function przyjmij(r: Ramka) {
    if (wylaczony.current) return
    if (r.rodzaj === 'blad') {
      // Nieczytelny odczyt nie leci na serwer, ale nie znika bez śladu.
      grajBlad('L')
      setBladOdczytu(r.komunikat)
      return
    }
    const t = r.kod.trim()
    if (!t) return
    void doKolejki(t)
  }

  useImperativeHandle(ref, () => ({
    dodaj: (kod: string, ts?: number) => { const t = kod.trim(); if (t) void doKolejki(t, ts) },
  }), [])

  const { onChange, onKeyDown, onPaste, onCompositionStart, onCompositionEnd } =
    usePoleSkanu(pole, przyjmij, { aktywny: !disabled })

  useEffect(() => {
    if (disabled) return
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
        {/* Pole NIEKONTROLOWANE: treść należy do bufora ramek, nie do stanu
            Reacta — render nie może zjeść początku następnego kodu. */}
        <input
          ref={pole}
          className="hmi-v10-mono min-w-0 flex-1 rounded-xl px-4 py-3 text-[20px] font-semibold outline-none"
          style={{ border: '2px solid var(--accent)', background: '#fff', color: 'var(--ink)' }}
          placeholder={placeholder}
          aria-label="Pole skanowania"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        {ileCzeka > 0 ? (
          <span data-testid="skany-oczekujace" aria-live="polite"
            className="hmi-v10-mono shrink-0 rounded-lg px-3 py-2 text-[14px] font-bold"
            style={{ background: 'var(--ambSoft)', color: 'var(--amb)', border: '1px solid var(--ambLine)' }}>
            odebrano {ileCzeka} · zapisuję…
          </span>
        ) : null}
        {podpis ? (
          <span className="hidden max-w-[260px] text-[13px] leading-snug lg:block"
            style={{ color: 'var(--mut)' }}>{podpis}</span>
        ) : null}
      </div>
      {bladOdczytu ? (
        <div data-testid="blad-odczytu" role="alert" className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-bold"
          style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>
          <span className="min-w-0 flex-1 break-words">{bladOdczytu}</span>
          <button type="button" onClick={() => { setBladOdczytu(null); pole.current?.focus() }}
            className="min-h-9 shrink-0 rounded-lg border px-3 text-[13px]" style={{ borderColor: 'var(--redLine)' }}>
            Przeczytane
          </button>
        </div>
      ) : null}
      {bledyObslugi.length ? (
        <div data-testid="bledy-obslugi" role="alert"
          className="mt-2 flex items-start gap-3 rounded-lg px-3 py-2 text-[14px] font-bold"
          style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>
          <ul className="m-0 min-w-0 flex-1 list-none overflow-y-auto p-0" style={{ maxHeight: 120 }}>
            {bledyObslugi.map(b => (
              <li key={b.nr} data-testid="blad-obslugi" className="break-words">
                <span className="hmi-v10-mono">{b.kod}</span> — {b.komunikat}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => { setBledyObslugi([]); pole.current?.focus() }}
            className="min-h-9 shrink-0 rounded-lg border px-3 text-[13px]" style={{ borderColor: 'var(--redLine)' }}>
            Przeczytane
          </button>
        </div>
      ) : null}
    </div>
  )
})
