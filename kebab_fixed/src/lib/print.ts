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

import type { RodzajDruku } from './druk/rodzaje'
import type { WpisRejestru } from './druk/rejestr'

const wTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface OpcjeDruku {
  /** Rodzaj dokumentu — osobne zapamiętane ustawienia druku i wpis w rejestrze. */
  rodzaj?: RodzajDruku
  /** Tytuł zadania (kolejka drukarki, rejestr). Domyślnie tytuł strony. */
  tytul?: string
  /** Dodatkowe dane wpisu rejestru (zamówienie, palety, dokument). */
  rejestr?: Omit<WpisRejestru, 'rodzaj' | 'tytul' | 'kopie'>
  /** Gotowy PDF (np. dokument z serwera) zamiast zamiany bieżącej strony. */
  pdfBase64?: string
  strict?: boolean
  beforePrint?: () => void
}

async function zapisz(w: WpisRejestru) {
  try { const { zarejestruj } = await import('./druk/rejestr'); await zarejestruj(w) } catch { /* rejestr nie blokuje druku */ }
}

async function printPage(options: OpcjeDruku): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('print_page')
    return true
  } catch (error) {
    // Audited label jobs must surface native failure, not report the no-op
    // WebView fallback as a successful dialog invocation. Other callers retain
    // their existing best-effort behaviour.
    if (options.strict) throw error
    // Starsza wersja desktopu bez komendy print_page — lepiej spróbować
    // przeglądarkowo (nic nie zrobi) niż wywalić stronę wyjątkiem.
    options.beforePrint?.()
    window.print()
    return false
  }
}

/**
 * Drukuj. W aplikacji Tauri z nowym drukiem: nasze okno druku (drukarka,
 * zasobnik, opcje sterownika). Starsza aplikacja: okno systemowe (`print_page`).
 * Przeglądarka: `window.print()`. Każdy wydruk trafia do rejestru.
 */
export async function drukuj(options: OpcjeDruku = {}): Promise<void> {
  const rodzaj: RodzajDruku = options.rodzaj ?? 'inne'
  const tytul = options.tytul ?? (typeof document !== 'undefined' ? document.title : '')
  const wpis = (extra: Partial<WpisRejestru>): WpisRejestru => ({ rodzaj, tytul, ...(options.rejestr ?? {}), kopie: 1, ...extra })
  if (!wTauri()) {
    options.beforePrint?.()
    window.print()
    await zapisz(wpis({}))
    return
  }
  await import('@tauri-apps/api/core')
  options.beforePrint?.()
  const { natywny } = await import('./druk/natywny')
  if (!(await natywny.dostepny())) {
    if (await printPage(options)) await zapisz(wpis({ drukarka: 'okno systemowe' }))
    return
  }
  const { otworzOknoDruku } = await import('./druk/okno')
  const zrodlo = options.pdfBase64 ? { typ: 'pdf' as const, pdfBase64: options.pdfBase64 } : { typ: 'strona' as const }
  const wynik = await otworzOknoDruku({ rodzaj, tytul, zrodlo })
  if ('systemowe' in wynik) {
    if (await printPage(options)) await zapisz(wpis({ drukarka: 'okno systemowe' }))
    return
  }
  if (!wynik.wydrukowano) return
  await zapisz(wpis({ drukarka: wynik.drukarka, zasobnik: wynik.zasobnik, kopie: wynik.kopie, stron: wynik.stron }))
  try { const { uruchomPonawianie } = await import('./druk/rejestr'); uruchomPonawianie() } catch { /* brak */ }
}

/**
 * Auto-druk po załadowaniu dokumentu — ten sam wzorzec, który każda strona
 * wydruku miała u siebie (`setTimeout(() => window.print(), N)`).
 *
 * @param gotowe czy dane dokumentu są już wczytane
 * @param opoznienie ile ms odczekać na dociągnięcie fontów i układu
 */
export function autoDrukuj(gotowe: boolean, opoznienie = 500, opcje: OpcjeDruku = {}): () => void {
  if (!gotowe) return () => {}
  const t = setTimeout(() => { void drukuj(opcje) }, opoznienie)
  return () => clearTimeout(t)
}
