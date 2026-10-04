/**
 * Pole skanu HMI (produkcja, magazyn) na wspólnym buforze ramek.
 *
 * Różnica wobec `useSkanAutoSubmit` (zostaje dla ekranów mobilnych): tam
 * efekt Reacta obserwował STAN pola i wysyłał po 150 ms ciszy — szybki
 * skaner bez Entera zdążał wpisać następny kod i oba sklejały się w jeden
 * (hala 02.10.2026). Tu pole jest NIEKONTROLOWANE: każdy znak (zmiana,
 * wklejenie, Enter/Tab) trafia do bufora SYNCHRONICZNIE w handlerze
 * zdarzenia, gotowe kody wychodzą od razu do `onRamka`, a w polu zostaje
 * tylko niekompletny ogon. Nic nie zależy od renderu ani efektu, więc
 * czyszczenie pola nie zjada początku następnego kodu.
 *
 * Strażnicy (synchroniczni, bez czekania na efekt):
 *   - nieaktywne (blokada, dialog) albo odmontowane pole nic nie przyjmuje,
 *     a ramka z timera, która dojrzała w takiej chwili, przepada,
 *   - kompozycja IME: tekst tymczasowy NIE jest skanem, Enter zatwierdza
 *     kompozycję, nie ramkę; po `compositionend` tekst wchodzi raz,
 *   - Ctrl/Meta/Alt+Enter nie kończy ramki.
 *
 * `onRamka` tylko KOLEJKUJE — nie czeka na API.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type ChangeEvent, type ClipboardEvent,
         type CompositionEvent, type KeyboardEvent, type RefObject } from 'react'
import { utworzStrumienSkanu, type Ramka, type StrumienSkanu } from './buforSkanu'

export function usePoleSkanu(
  pole: RefObject<HTMLInputElement | null>,
  onRamka: (r: Ramka) => void,
  opcje: { aktywny?: boolean } = {},
) {
  const aktywny = opcje.aktywny ?? true
  const onRamkaRef = useRef(onRamka)
  onRamkaRef.current = onRamka
  // Aktualizowane w renderze: handler i timer widzą blokadę od razu,
  // zanim efekt zdąży wyczyścić bufor.
  const aktywnyRef = useRef(aktywny)
  aktywnyRef.current = aktywny
  const zywy = useRef(false)
  const komponuje = useRef(false)

  const ustawPole = useCallback((reszta: string) => {
    const el = pole.current
    if (el && el.value !== reszta) el.value = reszta
  }, [pole])

  const strumien = useRef<StrumienSkanu | null>(null)
  if (!strumien.current) {
    strumien.current = utworzStrumienSkanu({
      tryb: 'pole',
      onRamka: r => { if (zywy.current && aktywnyRef.current) onRamkaRef.current(r) },
      onReszta: r => { if (!komponuje.current) ustawPole(r) },
    })
  }

  // Odmontowanie kasuje timer i ogon — kod czekający na ciszę nie trafi
  // tam, gdzie operatora już nie ma. `wznow` w setupie: StrictMode robi
  // setup → cleanup → setup.
  useEffect(() => {
    const s = strumien.current!
    zywy.current = true
    s.wznow()
    return () => { zywy.current = false; s.zatrzymaj() }
  }, [])

  // Blokada (dialog, menu, wyłączone pole): ogon i timer przepadają przed
  // malowaniem — nie trafiają do nowego kontekstu po odblokowaniu.
  useLayoutEffect(() => {
    if (aktywny) return
    komponuje.current = false
    strumien.current!.wyczysc()
    ustawPole('')
  }, [aktywny, ustawPole])

  const czynne = useCallback(() => zywy.current && aktywnyRef.current, [])

  /** Treść pola → bufor: dopisany koniec idzie jako nowe znaki, inna zmiana
   *  (Backspace, edycja w środku) zastępuje bufor. */
  const wczytajPole = useCallback((v: string) => {
    const s = strumien.current!
    const poprzednia = s.reszta()
    if (v.startsWith(poprzednia)) s.wpisz(v.slice(poprzednia.length))
    else s.zastap(v)
    ustawPole(s.reszta())
  }, [ustawPole])

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (!czynne()) { ustawPole(''); return }
    // Tekst tymczasowy IME — czekamy na compositionend.
    if (komponuje.current || (e.nativeEvent as InputEvent | undefined)?.isComposing) return
    wczytajPole(e.currentTarget.value)
  }, [czynne, ustawPole, wczytajPole])

  const onCompositionStart = useCallback(() => { komponuje.current = true }, [])

  const onCompositionEnd = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    komponuje.current = false
    if (!czynne()) { ustawPole(''); return }
    // Zatwierdzony tekst wchodzi RAZ; późniejszy input z tą samą treścią
    // dopisuje pusty przyrost.
    wczytajPole(e.currentTarget.value)
  }, [czynne, ustawPole, wczytajPole])

  const onPaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    if (!czynne()) { e.preventDefault(); return }
    // Wklejony tekst niesie separatory (CR/LF/Tab), które pole jednowierszowe
    // by zjadło — bierzemy go w całości ze schowka.
    const t = e.clipboardData?.getData('text')
    if (!t) return
    e.preventDefault()
    strumien.current!.wpisz(t)
    ustawPole(strumien.current!.reszta())
  }, [czynne, ustawPole])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    const s = strumien.current!
    if (e.key === 'Enter') {
      // Enter zatwierdzający kompozycję IME należy do IME.
      if (komponuje.current || e.nativeEvent?.isComposing || e.keyCode === 229) return
      e.preventDefault()
      if (!czynne() || e.ctrlKey || e.metaKey || e.altKey) return
      s.zakoncz()
      ustawPole(s.reszta())
      return
    }
    if (!czynne() || komponuje.current) return
    // Tab jako sufiks skanera kończy ramkę; spóźniony Tab po samoczynnym
    // zamknięciu jest połykany (fokus zostaje w polu). Shift+Tab i Tab
    // przy pustym polu działają normalnie (pułapka fokusu okna).
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (s.reszta()) {
        e.preventDefault()
        s.zakoncz()
        ustawPole(s.reszta())
      } else if (s.poznySufiks()) {
        e.preventDefault()
      }
    }
  }, [czynne, ustawPole])

  /** Do `onSubmit` formularza (Enter, który doszedł jako submit). */
  const zakoncz = useCallback(() => {
    if (!czynne() || komponuje.current) return
    strumien.current!.zakoncz()
    ustawPole(strumien.current!.reszta())
  }, [czynne, ustawPole])

  /** Kontekst się zmienił — ogon przepada. */
  const wyczysc = useCallback(() => {
    strumien.current!.wyczysc()
    ustawPole('')
  }, [ustawPole])

  return { onChange, onKeyDown, onPaste, onCompositionStart, onCompositionEnd, zakoncz, wyczysc }
}
