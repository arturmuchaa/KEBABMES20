/**
 * desktopScanner — skan HDI wprost z MES, z aplikacji desktopowej.
 *
 * Dlaczego tylko desktop: serwer MES stoi w serwerowni i do skanera w sieci
 * zakładu nie ma jak sięgnąć, a przeglądarka nie ma dostępu do skanera
 * z zasady (żadna strona internetowa go nie ma). Aplikacja desktopowa jest
 * jedynym miejscem, które stoi we WŁAŚCIWEJ SIECI i może uruchomić program —
 * dokładnie tak, jak działa u Was Zebra przez lokalną usługę BrowserPrint.
 *
 * Samo skanowanie robi most w Rust (`scanner.rs` → NAPS2). Idzie przez Rust,
 * a nie przez `fetch` z okna, bo warstwa natywna nie podlega CSP przeglądarki
 * i nie zależy od tego, co wolno oknu aplikacji.
 */

/** Czy MES działa w aplikacji desktopowej (a nie w przeglądarce). */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * errorText — powód odrzucenia z warstwy natywnej.
 *
 * Tauri odrzuca obietnicę TYM, co zwrócił Rust — dla `Result<_, String>` jest
 * to goły tekst, a NIE obiekt `Error`. Sprawdzanie `e instanceof Error`
 * kasowało więc cały komunikat mostu („nie znaleziono NAPS2", „NAPS2
 * zakończył się błędem: …") i operator widział tylko bezużyteczne
 * „nie udało się zeskanować".
 */
export function errorText(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e
  if (e instanceof Error && e.message) return e.message
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
    try { return JSON.stringify(e) } catch { /* poniżej */ }
  }
  return 'Nie udało się zeskanować'
}

/** base64 → File, żeby skan wszedł tą samą drogą co plik wskazany ręcznie. */
function base64ToFile(b64: string, name: string): File {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'application/pdf' })
}

/**
 * scanDocument — uruchamia skanowanie i zwraca gotowy plik.
 *
 * Rzuca czytelnym komunikatem z mostu (brak NAPS2, pusty podajnik, zacięcie),
 * bo operator ma wiedzieć, co poprawić przy urządzeniu, a nie zobaczyć
 * „błąd skanowania".
 */
export async function scanDocument(): Promise<File> {
  if (!isDesktopApp()) throw new Error('Skanowanie działa tylko w aplikacji desktopowej MES')
  const { invoke } = await import('@tauri-apps/api/core')
  let b64: string
  try {
    b64 = await invoke<string>('scan_document')
  } catch (e) {
    // Normalizujemy TU, na granicy z warstwą natywną — wołający dostaje
    // zwykły Error z prawdziwym powodem i nie musi znać kaprysów Tauri.
    throw new Error(errorText(e))
  }
  if (!b64) throw new Error('Skaner nie zwrócił dokumentu')
  return base64ToFile(b64, 'skan-hdi.pdf')
}

/** Raport diagnostyczny mostu (skąd config, czy widać NAPS2) — dla serwisu. */
export async function scannerDiagnose(): Promise<string> {
  if (!isDesktopApp()) return 'Skanowanie dostępne tylko w aplikacji desktopowej MES.'
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<string>('scanner_diagnose')
  } catch (e) {
    return `Diagnostyka niedostępna: ${errorText(e)}`
  }
}
