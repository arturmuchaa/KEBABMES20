import { useCallback, useEffect, useRef } from 'react'
import { czyKompletnyKod, czyWpisalSkaner, utworzStraznikaWysylki } from './skanKodu'

/**
 * Auto-wysyłka zeskanowanego kodu — MES niezależny od konfiguracji skanera.
 *
 * Skaner HID wpisuje kod jak klawiatura. Bez sufiksu Enter formularz nigdy
 * się nie wysyła i wygląda to jak awaria MES (zakład, 17.09.2026: DS2278
 * wpisywał `…/m/p/<zam>/7`, a paleta zostawała `created`). Konfiguracja
 * skanera ginie przy wymianie urządzenia albo resecie, więc ekran rozpoznaje
 * KOMPLETNY kod sam i wysyła go po krótkiej chwili bezczynności.
 *
 * Kolejność jest nośna dla poprawności, stąd stan, a nie goły `setTimeout`:
 *   wpis → rozpoznanie kompletnego kodu → odczekanie → wyślij RAZ → blokada
 *   → Enter, który przyjdzie później, nic już nie robi.
 *
 * Enter i auto-wysyłka idą przez TĘ SAMĄ bramkę (`probuj`), więc nie ma
 * znaczenia, które zadziała pierwsze — drugie jest bezczynne.
 */
export function useSkanAutoSubmit(
  wartosc: string,
  wyslij: (kod: string) => void | Promise<void>,
  opcje: { opoznienieMs?: number; oknoBlokadyMs?: number } = {},
) {
  const { opoznienieMs = 150, oknoBlokadyMs = 2000 } = opcje
  const straznik = useRef(utworzStraznikaWysylki(oknoBlokadyMs))
  // Callback w refie: gdyby wszedł do zależności efektu, każdy render ekranu
  // kasowałby odliczanie i auto-wysyłka nigdy by nie dojrzała.
  const wyslijRef = useRef(wyslij)
  wyslijRef.current = wyslij

  const probuj = useCallback((kod: string) => {
    if (!straznik.current.wolno(kod)) return
    try {
      const r = wyslijRef.current(kod)
      // Nieudana wysyłka zdejmuje blokadę — operator ma prawo ponowić ten sam
      // skan od razu, bez czekania, aż okno wygaśnie.
      if (r && typeof (r as Promise<void>).catch === 'function') {
        void (r as Promise<void>).catch(() => straznik.current.zwolnij())
      }
    } catch {
      straznik.current.zwolnij()
      throw new Error('Nie udało się wysłać skanu')
    }
  }, [])

  // Kiedy pole zaczęło się wypełniać — z tego liczymy TEMPO, po którym
  // poznajemy skaner. Zerujemy przy pustym polu, więc każdy skan mierzy się
  // od nowa (po udanej wysyłce ekran czyści pole).
  const startCzas = useRef(0)

  useEffect(() => {
    const teraz = Date.now()
    if (!wartosc) { startCzas.current = 0; return }
    if (startCzas.current === 0) startCzas.current = teraz

    // Dwa niezależne sygnały, że kod jest kompletny:
    //   * ZNANY FORMAT palety, sztuki albo kartonu — pewny, działa nawet gdy ktoś wklei kod myszą;
    //   * TEMPO — skaner wrzuca kilkanaście znaków w kilkadziesiąt ms, czego
    //     człowiek nie osiągnie. To obejmuje formaty, których tu nie
    //     wyliczamy: sztuki, kartony i cokolwiek dojdzie później.
    const wystarczy = czyKompletnyKod(wartosc)
      || czyWpisalSkaner(wartosc.length, teraz - startCzas.current)
    if (!wystarczy) return

    const t = setTimeout(() => probuj(wartosc), opoznienieMs)
    return () => clearTimeout(t)
  }, [wartosc, opoznienieMs, probuj])

  /** Do `onSubmit` formularza — Enter po auto-wysyłce jest bezczynny. */
  const zatwierdz = useCallback((kod: string) => { probuj(kod) }, [probuj])

  return { zatwierdz }
}
