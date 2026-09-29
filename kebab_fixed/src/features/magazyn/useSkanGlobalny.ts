/**
 * Skaner słuchany na ekranach BEZ pola skanu (menu, lista kartonów).
 *
 * Właściciel (25.09.2026): „skan QR na kartce kartonu ma przenosić do
 * pakowania tego kartonu — teraz muszę wejść ręcznie". Skaner HID pisze jak
 * klawiatura, więc łapiemy znaki z całego dokumentu i składamy z nich kod.
 * Kod kończy Enter albo — gdy skaner nie ma sufiksu — rozpoznanie kompletnego
 * kodu / tempa skanera, jak we wspólnym `useSkanAutoSubmit`.
 *
 * Nie przejmuje klawiszy, gdy kursor stoi w polu tekstowym: tam pisze człowiek
 * (numer rejestracyjny) albo działa właściwe pole skanu.
 *
 * WYJĄTEK — KOD ZACZĘTY POZA POLEM: skaner pisze dalej, a fokus w połowie
 * kodu przeskakuje do pola (koniec wczytywania ekranu pakowania). Bez tego
 * kod rozcinał się na dwa skany („U|bc82b8" z menu + reszta z pola — dwa
 * POST-y ze śmieciowymi kodami). Bufor, który JUŻ zbieramy, kończymy sami
 * i blokujemy znak w polu (preventDefault), żeby nie wpadł tam drugi raz.
 * Tylko przy tempie skanera: człowiek nie przeniesie fokusu na inne pole
 * w `KONTYNUACJA_MS` od ostatniego klawisza, więc jego pisanie zostaje jego.
 */
import { useEffect, useRef } from 'react'
import { czyKompletnyKod, czyWpisalSkaner } from '@/features/scan/skanKodu'

/** Przerwa, po której bufor uznajemy za porzucony (człowiek coś stuknął). */
const PRZERWA_MS = 400
const OPOZNIENIE_MS = 150
/** Maks. odstęp klawiszy, przy którym zaczęty kod idzie dalej mimo pola z fokusem. */
export const KONTYNUACJA_MS = 100

export function useSkanGlobalny(aktywny: boolean, onKod: (kod: string) => void) {
  const onKodRef = useRef(onKod)
  onKodRef.current = onKod

  useEffect(() => {
    if (!aktywny) return
    let bufor = ''
    let start = 0
    let ostatni = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const wyslij = () => {
      const kod = bufor.trim()
      bufor = ''
      if (timer) { clearTimeout(timer); timer = null }
      if (kod) onKodRef.current(kod)
    }

    const naKlawisz = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const teraz = Date.now()
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        // Pole ma fokus: tylko dokończenie NASZEGO zaczętego kodu.
        if (!bufor || teraz - ostatni > KONTYNUACJA_MS) { bufor = ''; return }
        if (e.key !== 'Enter' && e.key.length !== 1) return
        e.preventDefault()
      }
      if (teraz - ostatni > PRZERWA_MS) { bufor = ''; start = teraz }
      ostatni = teraz
      if (e.key === 'Enter') {
        if (bufor.length >= 8) { e.preventDefault(); wyslij() }
        else bufor = ''
        return
      }
      if (e.key.length !== 1) return
      bufor += e.key
      if (timer) clearTimeout(timer)
      if (czyKompletnyKod(bufor) || czyWpisalSkaner(bufor.length, teraz - start)) {
        timer = setTimeout(wyslij, OPOZNIENIE_MS)
      }
    }

    document.addEventListener('keydown', naKlawisz)
    return () => {
      document.removeEventListener('keydown', naKlawisz)
      if (timer) clearTimeout(timer)
    }
  }, [aktywny])
}
