/**
 * Fokus zamknięty w oknie modalnym ekranu produkcji.
 *
 * `aria-modal` nic nie blokuje — sam Tab wychodził z okna skanu na listę
 * planu i przyciski pod spodem, a Enter/spacja zmieniały wtedy pozycję
 * w trakcie skanowania. Hook:
 *   • stawia fokus w oknie przy otwarciu (wskazany element albo pierwszy
 *     aktywny),
 *   • zawija Tab / Shift+Tab w obrębie okna,
 *   • ściąga z powrotem fokus, który jakoś uciekł poza okno (klik w tło),
 *   • po zamknięciu oddaje fokus tam, gdzie był przed otwarciem.
 *
 * Bez zależności — ten sam wzorzec dla okna skanu i szczegółów pozycji.
 */
import { useEffect, useRef, type RefObject } from 'react'

const AKTYWNE = [
  'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', 'a[href]', '[tabindex]:not([tabindex="-1"])',
].join(',')

export const aktywneW = (el: HTMLElement): HTMLElement[] =>
  Array.from(el.querySelectorAll<HTMLElement>(AKTYWNE))

export function useModalFocus(
  okno: RefObject<HTMLElement | null>,
  start?: RefObject<HTMLElement | null>,
) {
  const startRef = useRef(start); startRef.current = start

  useEffect(() => {
    const el = okno.current
    if (!el) return
    const poprzedni = document.activeElement as HTMLElement | null
    const doWnetrza = () => {
      const cel = startRef.current?.current ?? aktywneW(el)[0] ?? el
      cel.focus()
    }
    doWnetrza()

    const tab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const lista = aktywneW(el)
      if (!lista.length) { e.preventDefault(); return }
      const pierwszy = lista[0], ostatni = lista[lista.length - 1]
      const teraz = document.activeElement
      if (!el.contains(teraz)) { e.preventDefault(); pierwszy.focus(); return }
      if (e.shiftKey && teraz === pierwszy) { e.preventDefault(); ostatni.focus() }
      else if (!e.shiftKey && teraz === ostatni) { e.preventDefault(); pierwszy.focus() }
    }
    const ucieczka = (e: FocusEvent) => {
      if (e.target instanceof Node && !el.contains(e.target)) doWnetrza()
    }
    document.addEventListener('keydown', tab, true)
    document.addEventListener('focusin', ucieczka, true)
    return () => {
      document.removeEventListener('keydown', tab, true)
      document.removeEventListener('focusin', ucieczka, true)
      // Powrót tam, skąd operator przyszedł — o ile ten element jeszcze stoi.
      if (poprzedni && poprzedni.isConnected && typeof poprzedni.focus === 'function') poprzedni.focus()
    }
  }, [okno])
}
