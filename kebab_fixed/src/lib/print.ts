/**
 * Druk stron dokumentów — jedno miejsce dla przeglądarki i aplikacji desktopowej.
 *
 * POWÓD ISTNIENIA: `window.print()` wywołane z JavaScriptu w oknie Tauri
 * (WebView2 na Windows) **nie robi nic**. Operator otwierał plan masowania czy
 * listę wypłat, widział dokument i nie mógł go wydrukować — dopiero ręczne
 * Ctrl+P otwierało okno drukarki. W przeglądarce działało normalnie, więc
 * problem był niewidoczny podczas pracy nad kodem.
 *
 * Natywne okno druku otwiera dopiero webview po stronie Rusta (komenda
 * `print_page`), dlatego w Tauri idziemy przez `invoke`, a w przeglądarce
 * zostajemy przy `window.print()`.
 */

const wTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Otwórz okno drukarki. Bezpieczne w obu środowiskach. */
export async function drukuj(): Promise<void> {
  if (!wTauri) {
    window.print()
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('print_page')
  } catch {
    // Starsza wersja desktopu bez komendy print_page — lepiej spróbować
    // przeglądarkowo (nic nie zrobi) niż wywalić stronę wyjątkiem.
    window.print()
  }
}

/**
 * Auto-druk po załadowaniu dokumentu — ten sam wzorzec, który każda strona
 * wydruku miała u siebie (`setTimeout(() => window.print(), N)`).
 *
 * @param gotowe czy dane dokumentu są już wczytane
 * @param opoznienie ile ms odczekać na dociągnięcie fontów i układu
 */
export function autoDrukuj(gotowe: boolean, opoznienie = 500): () => void {
  if (!gotowe) return () => {}
  const t = setTimeout(() => { void drukuj() }, opoznienie)
  return () => clearTimeout(t)
}
