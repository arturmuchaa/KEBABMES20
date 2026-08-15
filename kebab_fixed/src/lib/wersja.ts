/**
 * Wersja aplikacji pokazywana w nagłówku biura.
 *
 * POWÓD ISTNIENIA: nagłówek brał wersję z `package.json`, a wydanie desktopu
 * bierze ją z `src-tauri/Cargo.toml`. Te pliki się rozjechały — zainstalowana
 * aplikacja 2.5.53 pokazywała **v2.5.50**, więc po aktualizacji nie dało się
 * odróżnić „zainstalowało się" od „nie zainstalowało się". Kosztowało to
 * kilka niepotrzebnych reinstalacji.
 *
 * W aplikacji desktopowej pytamy więc Tauri o wersję z instalatora — to
 * jedyne źródło, którego nie da się rozsynchronizować. W przeglądarce
 * (gdzie nie ma instalatora) zostaje wersja z paczki.
 */
import { useEffect, useState } from 'react'
import pkg from '../../package.json'

const wTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Wersja frontendu z paczki — w przeglądarce to jedyne, co mamy. */
export const WERSJA_PACZKI: string = pkg.version

export function useWersjaAplikacji(): string {
  const [wersja, setWersja] = useState(WERSJA_PACZKI)

  useEffect(() => {
    if (!wTauri) return
    let porzucone = false
    void (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        const v = await getVersion()
        // Pusty string zamiast wersji zostawiłby nagłówek bez numeru —
        // lepiej pokazać wersję z paczki niż samo „v".
        if (!porzucone && v) setWersja(v)
      } catch {
        // Starszy desktop bez tego API — zostaje wersja z paczki.
      }
    })()
    return () => { porzucone = true }
  }, [])

  return wersja
}
