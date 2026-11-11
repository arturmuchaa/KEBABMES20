/**
 * Rozrachunki — drobne klocki wspólne dla listy, karty i okien: pamięć wyboru
 * w przeglądarce, kolor salda, zapis z blokadą i komunikat odmowy serwera.
 */
import React, { useId, useRef, useState } from 'react'
import { FlagIcon } from '../../ui/Glyphs'
import { liczba, symbolWaluty, znakSalda } from './model'

/** Pamięć wyboru użytkownika (sortowanie, filtry). Bez pamięci przeglądarki — po prostu nic nie pamięta. */
export const pamiec = {
  czytaj(k: string) { try { return window.localStorage.getItem(k) } catch { return null } },
  zapisz(k: string, v: string | null) {
    try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v) } catch { /* bez pamięci przeglądarki */ }
  },
}

/** Klasa koloru salda: dług — czerwień, nadpłata — zieleń, zero — zwykły tekst. */
export const klasaSalda = (x: number) => (znakSalda(x) < 0 ? ' crit-ink' : znakSalda(x) > 0 ? ' ok-ink' : '')

export const tekstBledu = (e: unknown, zast: string) => (e instanceof Error && e.message ? e.message : zast)

/** Zapis z blokadą przed podwójnym kliknięciem; błąd serwera zostaje w oknie, pola nietknięte. */
export function useZapis(zast = 'Nie udało się zapisać') {
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)
  const zapisz = async (fn: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setBlad(null)
    try { await fn() } catch (e) { setBlad(tekstBledu(e, zast)) } finally { lock.current = false; setBusy(false) }
  }
  return { busy, blad, zapisz }
}

export const OdmowaSerwera = ({ blad }: { blad: string | null }) => (blad
  ? <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>
  : null)

/** Enter w polu — zatwierdza (bez wysyłania formularza drugi raz). */
export const naEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); fn() }
}

/**
 * Pole kwoty: przyjmuje zapis biura (`15 000,50`, `15000.5`), symbol waluty w polu,
 * zaznacza całość przy wejściu (wpisanie nowej kwoty bez kasowania starej).
 */
export function PoleKwoty({ label, value, onChange, waluta, blad, onEnter, autofocus, placeholder = '0,00', duze }: {
  label: string; value: string; onChange: (v: string) => void; waluta: string
  /** Komunikat przy polu (po polsku); pusty — pole poprawne. */
  blad?: string | null
  onEnter?: () => void; autofocus?: boolean; placeholder?: string
  /** Główne pole okna — większy krój. */
  duze?: boolean
}) {
  const idBledu = useId()
  return (
    <>
      <span className={`rr-kwota-pole${duze ? ' duze' : ''}`}>
        <input className={`field num${blad ? ' invalid' : ''}`} inputMode="decimal" autoComplete="off" value={value} aria-label={label}
          aria-invalid={blad ? true : undefined} aria-describedby={blad ? idBledu : undefined} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} onFocus={e => e.currentTarget.select()} onKeyDown={onEnter ? naEnter(onEnter) : undefined}
          {...(autofocus ? { 'data-autofocus': true } : {})} />
        <span className="rr-sfx" aria-hidden="true">{symbolWaluty(waluta)}</span>
      </span>
      {blad && <span className="rr-pole-blad" id={idBledu}>{blad}</span>}
    </>
  )
}

/** Kwota z pola: liczba albo NaN; puste — NaN. */
export const kwotaZPola = (t: string) => (t.trim() ? liczba(t) : NaN)

/** Przełącznik segmentowy powłoki (`.seg`) jako grupa z nazwą. */
export function Segment<T extends string>({ label, value, opcje, onChange, autofocus }: {
  label: string; value: T; opcje: ReadonlyArray<readonly [NoInfer<T>, string]>; onChange: (v: NoInfer<T>) => void; autofocus?: boolean
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {opcje.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          {...(autofocus && value === v ? { 'data-autofocus': true } : {})}>{t}</button>
      ))}
    </div>
  )
}
