/**
 * Otwieranie stron dokumentów (wydruki, etykiety, raporty).
 *
 * POWÓD ISTNIENIA: wszędzie było `window.open(url, '_blank')`. W przeglądarce
 * otwiera to nową kartę, ale w aplikacji desktopowej **zwraca null i nie robi
 * nic** — operator klikał „Plan operatora" czy „Drukuj WZ" i ekran się nie
 * zmieniał. Wyglądało to na zepsuty przycisk.
 *
 * Część miejsc miała już ratunek `if (!win) window.location.href = url`, ale
 * pełne przejście pod adres w Tauri przeładowuje aplikację i na głębokiej
 * ścieżce (`/office/wz/123/druk`) potrafi skończyć się białym ekranem, bo
 * protokół Tauri nie zna przekierowania na index.html.
 *
 * Dlatego w aplikacji desktopowej wchodzimy w dokument **routerem**, bez
 * wychodzenia z aplikacji — powrót zapewnia pasek `PrintToolbar`.
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

const wTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Adres wewnątrz aplikacji (a nie blob:, data: czy http do innego serwisu). */
function wewnetrzny(url: string): boolean {
  return url.startsWith('/')
}

/**
 * Wersja bez routera — dla funkcji poza komponentem.
 * W Tauri przechodzi pod adres, w przeglądarce otwiera kartę.
 */
export function otworzDokument(url: string): void {
  if (wTauri) {
    window.location.href = url
    return
  }
  const win = window.open(url, '_blank')
  // Blokada wyskakujących okien w przeglądarce — lepiej otworzyć w tej samej
  // karcie niż nie otworzyć wcale.
  if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
}

/**
 * Zalecana wersja: w aplikacji desktopowej wchodzi w dokument routerem,
 * w przeglądarce zostaje przy nowej karcie (operator lubi mieć zamówienie
 * i wydruk obok siebie).
 */
export function useOtworzDokument(): (url: string) => void {
  const navigate = useNavigate()
  return useCallback((url: string) => {
    if (wTauri && wewnetrzny(url)) {
      navigate(url)
      return
    }
    otworzDokument(url)
  }, [navigate])
}
