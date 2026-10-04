/**
 * Skaner słuchany na ekranach BEZ pola skanu z fokusem (menu magazynu, lista
 * kartonów, główny ekran produkcji).
 *
 * Właściciel (25.09.2026): „skan QR na kartce kartonu ma przenosić do
 * pakowania tego kartonu — teraz muszę wejść ręcznie". Skaner HID pisze jak
 * klawiatura, więc łapiemy znaki z całego dokumentu i składamy z nich kod.
 * Granice kodów wyznacza TEN SAM bufor ramek co w polach skanu
 * (`features/scan/buforSkanu`): sztuka i karta kartonu zamykają się po
 * ostatnim znaku, kartka palety po terminatorze, początku następnego kodu
 * albo ciszy. Seria skanów na menu się nie skleja (hala 02.10.2026).
 * Enter/Tab kończy ramkę tylko, gdy to skan (≥ 8 znaków w tempie skanera)
 * albo kompletna kartka palety — przypadkowe „a" + Enter nie leci na serwer
 * i nie zabiera Entera przyciskowi. Enter/Tab przejęty jako sufiks skanu ma
 * `preventDefault` — nie kliknie przycisku, na którym stoi fokus
 * („Dodaj", „Zakończ dzień", „Wyloguj").
 *
 * Nie przejmuje klawiszy, gdy kursor stoi w polu tekstowym (input, textarea,
 * select, contenteditable): tam pisze człowiek (numer rejestracyjny) albo
 * działa właściwe pole skanu. Pomija też skróty (Ctrl/Meta/Alt — poza AltGr,
 * którym część układów wystukuje „|") i kompozycję IME.
 *
 * WYJĄTEK — KOD ZACZĘTY POZA POLEM: skaner pisze dalej, a fokus w połowie
 * kodu przeskakuje do pola (koniec wczytywania ekranu pakowania). Bez tego
 * kod rozcinał się na dwa skany („U|bc82b8" z menu + reszta z pola — dwa
 * POST-y ze śmieciowymi kodami). Ramkę, którą JUŻ zbieramy, kończymy sami
 * i blokujemy znak w polu (preventDefault), żeby nie wpadł tam drugi raz.
 * Tak samo spóźniony sufiks (Enter/Tab) takiej ramki — nie przenosi fokusu.
 * Tylko przy tempie skanera: człowiek nie przeniesie fokusu na inne pole
 * w `KONTYNUACJA_MS` od ostatniego klawisza, więc jego pisanie zostaje jego.
 *
 * Zwraca `wyczysc` — zmiana kontekstu (np. skaner wstrzymany) zrzuca
 * niekompletny ogon, żeby nie dokleił się do pierwszego kodu po powrocie.
 * Przeniesione z `features/magazyn` (03.10.2026) — magazyn re-eksportuje.
 */
import { useCallback, useEffect, useRef } from 'react'
import { utworzStrumienSkanu, type Ramka, type StrumienSkanu } from './buforSkanu'

/** Maks. odstęp klawiszy, przy którym zaczęty kod idzie dalej mimo pola z fokusem. */
export const KONTYNUACJA_MS = 100

function czyPoleTekstowe(t: HTMLElement | null): boolean {
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
    || !!t.closest?.('[contenteditable]:not([contenteditable="false"])')
}

export function useSkanGlobalny(
  aktywny: boolean,
  onKod: (kod: string) => void,
  /** Nieczytelny / ucięty odczyt — nic nie wysłano, operator ma powtórzyć. */
  onBlad?: (komunikat: string, fragment: string) => void,
): { wyczysc: () => void } {
  const onKodRef = useRef(onKod)
  onKodRef.current = onKod
  const onBladRef = useRef(onBlad)
  onBladRef.current = onBlad
  const strumienRef = useRef<StrumienSkanu | null>(null)

  useEffect(() => {
    if (!aktywny) return
    const strumien = utworzStrumienSkanu({
      tryb: 'globalny',
      onRamka: (r: Ramka) => {
        if (r.rodzaj === 'kod') onKodRef.current(r.kod)
        else onBladRef.current?.(r.komunikat, r.fragment)
      },
    })
    strumienRef.current = strumien

    const naKlawisz = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === 'Process' || e.key === 'Dead') return
      const altGr = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')
      if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return
      const terminator = e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)
      if (!terminator && e.key.length !== 1) return

      if (czyPoleTekstowe(e.target as HTMLElement | null)) {
        // Pole ma fokus: tylko dokończenie NASZEJ ramki albo jej spóźniony sufiks.
        if (strumien.trwa(KONTYNUACJA_MS)) {
          e.preventDefault()
        } else {
          if (terminator && strumien.poznySufiks()) e.preventDefault()
          else strumien.wyczysc()
          return
        }
      }

      if (terminator) {
        // Enter/Tab przejmujemy tylko, gdy kończy SKAN albo jest spóźnionym
        // sufiksem kodu zamkniętego przed chwilą. Klawisze człowieka
        // („a" + Enter na menu) bufor porzuca — Enter zostaje przyciskowi.
        const pozny = strumien.poznySufiks()
        const ramki = strumien.reszta() ? strumien.zakoncz() : []
        if (ramki.length || pozny) e.preventDefault()
        return
      }
      strumien.wpisz(e.key)
    }

    document.addEventListener('keydown', naKlawisz)
    return () => {
      document.removeEventListener('keydown', naKlawisz)
      strumien.zatrzymaj()
      if (strumienRef.current === strumien) strumienRef.current = null
    }
  }, [aktywny])

  const wyczysc = useCallback(() => { strumienRef.current?.wyczysc() }, [])
  return { wyczysc }
}
