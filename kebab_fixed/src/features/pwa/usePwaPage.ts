/**
 * usePwaPage — dynamicznie ustawia meta tagi PWA dla bieżącej strony.
 *
 * iOS Safari czyta przy 'Dodaj do ekranu początkowego':
 *   - <link rel="manifest">  → start_url, name, scope
 *   - <meta apple-mobile-web-app-title>  → etykieta pod ikoną
 *   - <link rel="apple-touch-icon">      → ikona
 *   - <title>                            → fallback dla etykiety
 *
 * Hook ustawia te w runtime gdy strona się montuje, przywraca poprzednie
 * przy unmount. Dzięki temu każda strona-PWA (rozbiór, skaner) ma swoje
 * meta przy zachowaniu jednego index.html.
 */
import { useEffect } from 'react'

interface PwaPageConfig {
  /** Tytuł strony — pojawia się w <title> i jako fallback etykiety */
  title: string
  /** Krótka nazwa pod ikoną na iOS home screen */
  appleTitle: string
  /** Ścieżka do manifest.json (relatywna od root) */
  manifestPath: string
  /** Ścieżka do apple-touch-icon (180×180). Opcjonalne — gdy brak,
   *  zostaje globalna ikona z index.html. */
  appleTouchIcon?: string
}

function setOrCreateMeta(name: string, content: string): string | null {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  const prev = el?.content ?? null
  if (!el) {
    el = document.createElement('meta')
    el.name = name
    document.head.appendChild(el)
  }
  el.content = content
  return prev
}

function setManifestLink(href: string): string | null {
  let el = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  const prev = el?.href ?? null
  if (!el) {
    el = document.createElement('link')
    el.rel = 'manifest'
    document.head.appendChild(el)
  }
  el.href = href
  return prev
}

function setAppleTouchIcon(href: string): string | null {
  let el = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  const prev = el?.href ?? null
  if (!el) {
    el = document.createElement('link')
    el.rel = 'apple-touch-icon'
    document.head.appendChild(el)
  }
  el.href = href
  return prev
}

export function usePwaPage({ title, appleTitle, manifestPath, appleTouchIcon }: PwaPageConfig) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title
    const prevAppleTitle = setOrCreateMeta('apple-mobile-web-app-title', appleTitle)
    const prevManifest = setManifestLink(manifestPath)
    const prevIcon = appleTouchIcon ? setAppleTouchIcon(appleTouchIcon) : null
    return () => {
      document.title = prevTitle
      if (prevAppleTitle !== null) setOrCreateMeta('apple-mobile-web-app-title', prevAppleTitle)
      if (prevManifest !== null) setManifestLink(prevManifest)
      if (prevIcon !== null) setAppleTouchIcon(prevIcon)
    }
  }, [title, appleTitle, manifestPath, appleTouchIcon])
}
