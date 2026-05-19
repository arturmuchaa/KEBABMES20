/**
 * useZoom — globalne skalowanie UI z pamięcią w localStorage.
 *
 * - Wartości: 75 / 85 / 100 / 110 / 125 / 150 / 175 / 200 (%)
 * - Pierwsze wejście — auto-dobór na podstawie szerokości okna.
 * - Wartość trzymana w localStorage pod kluczem 'kebab.zoom' — per
 *   stanowisko (biuro szefa, tablet operatora, laptop księgowej mają
 *   swoje niezależne ustawienia).
 * - Aplikowana przez `document.documentElement.style.zoom` — Tauri
 *   WebView2 (Chromium) wspiera natywnie, brak rozmycia, scrollbary OK.
 *
 * Skróty klawiszowe: Ctrl + = / Ctrl + − / Ctrl + 0 (reset).
 */
import { useEffect, useCallback, useSyncExternalStore } from 'react'

const KEY = 'kebab.zoom'

export const ZOOM_STEPS = [75, 85, 100, 110, 125, 150, 175, 200] as const
export type ZoomStep = (typeof ZOOM_STEPS)[number]

function autoDetect(): ZoomStep {
  if (typeof window === 'undefined') return 100
  const w = window.innerWidth
  if (w >= 3400) return 150
  if (w >= 2400) return 125
  if (w >= 2000) return 110
  if (w <  1300) return 90 as ZoomStep // 90 nie jest na liście; clamp niżej
  return 100
}

function clampToStep(v: number): ZoomStep {
  // wybiera najbliższy krok z ZOOM_STEPS
  let best: ZoomStep = 100
  let bestDiff = Infinity
  for (const s of ZOOM_STEPS) {
    const d = Math.abs(s - v)
    if (d < bestDiff) { bestDiff = d; best = s }
  }
  return best
}

function readInitial(): ZoomStep {
  if (typeof localStorage === 'undefined') return 100
  const raw = localStorage.getItem(KEY)
  if (raw) {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) return clampToStep(n)
  }
  return clampToStep(autoDetect())
}

// ── Store (prosty pub/sub żeby useSyncExternalStore działał) ──
let _value: ZoomStep | null = null
const _subscribers = new Set<() => void>()

function getValue(): ZoomStep {
  if (_value === null) _value = readInitial()
  return _value
}

function setValueInternal(v: ZoomStep) {
  _value = v
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, String(v))
  if (typeof document !== 'undefined') {
    // `zoom` jest niestandardowy ale wspierany przez wszystkie Chromium-based
    // (Tauri WebView2, Chrome, Edge). Bez rozmycia, scrollbary działają.
    ;(document.documentElement.style as any).zoom = v === 100 ? '' : `${v}%`
  }
  _subscribers.forEach(fn => fn())
}

function subscribe(fn: () => void) {
  _subscribers.add(fn)
  return () => _subscribers.delete(fn)
}

export function useZoom() {
  const value = useSyncExternalStore(subscribe, getValue, getValue)

  const setZoom = useCallback((v: number) => {
    setValueInternal(clampToStep(v))
  }, [])

  const step = useCallback((dir: 1 | -1) => {
    const cur = getValue()
    const idx = ZOOM_STEPS.indexOf(cur)
    const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir))
    setValueInternal(ZOOM_STEPS[nextIdx])
  }, [])

  const reset = useCallback(() => setValueInternal(100), [])

  return { value, setZoom, step, reset }
}

/**
 * useZoomInit — montować raz w głównym layoucie. Aplikuje wartość z
 * localStorage przy starcie + rejestruje skróty Ctrl + = / Ctrl + − / Ctrl + 0.
 */
export function useZoomInit() {
  useEffect(() => {
    // Apply initial value
    setValueInternal(getValue())

    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const inForm = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      if (inForm) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        const cur = getValue()
        const idx = ZOOM_STEPS.indexOf(cur)
        setValueInternal(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, idx + 1)])
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        const cur = getValue()
        const idx = ZOOM_STEPS.indexOf(cur)
        setValueInternal(ZOOM_STEPS[Math.max(0, idx - 1)])
      } else if (e.key === '0') {
        e.preventDefault()
        setValueInternal(100)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
