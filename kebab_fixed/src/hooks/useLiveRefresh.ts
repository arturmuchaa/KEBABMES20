/**
 * useLiveRefresh — cykliczne odświeżanie żywych danych ekranu.
 *
 * POWÓD ISTNIENIA: ekran rozbioru miał ręcznie pisany `setInterval` z listą
 * czterech wywołań `refetch()` i tablicą zależności. Dołożenie piątego źródła
 * wymagało pamiętania o dopisaniu go w DWÓCH miejscach — i 24.08.2026 nie
 * zostało dopisane: licznik partii zamarzł na wartości sprzed wejścia na ekran,
 * bo `kg_initial` lotu rośnie w ciągu dnia, a panel tego nie widział.
 *
 * Tu nie ma listy do zapomnienia: odświeżamy WSZYSTKIE wpisy przekazanego
 * obiektu źródeł. Dopisanie źródła w jednym miejscu wystarcza.
 *
 * Zestaw źródeł trzymamy w ref, a nie w zależnościach efektu. Gdyby wisiał
 * w zależnościach, każdy render tworzyłby nowy obiekt, kasował timer przed
 * jego strzałem i odświeżanie nigdy by nie nastąpiło.
 */
import { useEffect, useRef } from 'react'

export interface Refetchable { refetch: () => void }

export function useLiveRefresh(
  sources: Record<string, Refetchable>,
  everyMs = 5000,
): void {
  const ref = useRef(sources)
  ref.current = sources

  useEffect(() => {
    const t = setInterval(() => {
      for (const s of Object.values(ref.current)) s?.refetch?.()
    }, everyMs)
    return () => clearInterval(t)
  }, [everyMs])
}
