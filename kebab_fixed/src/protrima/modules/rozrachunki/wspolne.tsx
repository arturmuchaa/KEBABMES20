/**
 * Rozrachunki — drobne klocki wspólne dla listy, karty i okien: pamięć wyboru
 * w przeglądarce, kolor salda, zapis z blokadą i komunikat odmowy serwera.
 */
import React, { useRef, useState } from 'react'
import { FlagIcon } from '../../ui/Glyphs'
import { znakSalda } from './model'

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
