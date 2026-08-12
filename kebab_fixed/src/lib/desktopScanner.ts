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
  const b64 = await invoke<string>('scan_document')
  if (!b64) throw new Error('Skaner nie zwrócił dokumentu')
  return base64ToFile(b64, 'skan-hdi.pdf')
}

/** Raport diagnostyczny mostu (skąd config, czy widać NAPS2) — dla serwisu. */
export async function scannerDiagnose(): Promise<string> {
  if (!isDesktopApp()) return 'Skanowanie dostępne tylko w aplikacji desktopowej MES.'
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('scanner_diagnose')
}
