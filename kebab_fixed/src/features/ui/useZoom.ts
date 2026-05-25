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
    // Po zmianie zoom — repozycjonuj już otwarte popper'y (Select/Dropdown/Tooltip)
    applyZoomCompensationToAll()
  }
  _subscribers.forEach(fn => fn())
}

// ─────────────────────────────────────────────────────────────────────────────
// Kompensacja CSS `zoom` na <html> dla Radix Popper (Select/Dropdown/Tooltip)
//
// Problem: Radix popper (floating-ui) liczy pozycję triggera przez
// getBoundingClientRect i wpisuje ją jako transform: translate3d(x, y, 0) na
// popper-wrapperze. Wrapper dziedziczy CSS `zoom` z <html>, więc translate jest
// renderowany ze skalą = effective zoom wrappera. Czy potrzebna jest korekta,
// zależy od tego CO zwraca getBoundingClientRect przy CSS `zoom` — a to różni się
// między silnikami Chromium:
//
//   • "visual" (nowy Chromium / Edge ≥ ~128, WebView2 z nowym runtime):
//     gBCR zwraca współrzędne JUŻ przeskalowane zoomem (np. y=158 przy realnym
//     y=126 i zoom 1.25). translate=158, a wrapper dziedziczy zoom 1.25 →
//     renderuje na 158×1.25 → popover ucieka w prawo/dół. TRZEBA skompensować:
//     wrapper.zoom = 1/zoom (effective zoom → 1, translate trafia w piksel
//     wizualny), content.zoom = zoom (rozmiar zgodny z resztą UI).
//
//   • "layout" (starszy Chromium / starszy WebView2):
//     gBCR zwraca współrzędne NIESKALOWANE (layout px, np. y=126). translate=126,
//     wrapper dziedziczy zoom 1.25 → renderuje na 126×1.25=158 = poprawna pozycja
//     wizualna triggera. Korekta jest NIEPOTRZEBNA — a stała kompensacja 1/zoom
//     właśnie tu PSUŁA pozycję (przesuwała popover do złego miejsca). To był
//     root-cause kolejnych nieudanych poprawek strojonych pod jeden silnik.
//
// Fix: wykrywamy tryb gBCR w runtime (mały element sondujący — patrz
// gbcrScalesWithZoom) i kompensujemy TYLKO w trybie "visual". W trybie "layout"
// nie ruszamy nic — natywne pozycjonowanie jest już poprawne. Dzięki temu kod
// jest poprawny na OBU silnikach bez zakładania wersji przeglądarki.
// ─────────────────────────────────────────────────────────────────────────────
const POPPER_SELECTOR = '[data-radix-popper-content-wrapper]'

function currentHtmlZoom(): number {
  if (typeof document === 'undefined') return 1
  const raw = (document.documentElement.style as any).zoom || ''
  const n = parseFloat(raw)
  if (isNaN(n) || n === 0) return 1
  return n > 10 ? n / 100 : n
}

// Czy getBoundingClientRect skaluje współrzędne przez CSS `zoom`? Zależy od
// silnika — mierzymy empirycznie raz i cache'ujemy (tryb jest stały dla danego
// silnika, nie zależy od konkretnej wartości zoomu).
let _gbcrScalesWithZoom: boolean | null = null
function gbcrScalesWithZoom(zoom: number): boolean {
  if (_gbcrScalesWithZoom !== null) return _gbcrScalesWithZoom
  if (typeof document === 'undefined') return false
  if (zoom === 1) return false // przy zoom=1 nie da się odróżnić — i tak nie kompensujemy
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:100px;height:100px;visibility:hidden;pointer-events:none'
  document.documentElement.appendChild(probe)
  const w = probe.getBoundingClientRect().width
  probe.remove()
  // visual: w ≈ 100×zoom (gBCR skalowane) ; layout: w ≈ 100 (gBCR surowe)
  _gbcrScalesWithZoom = Math.abs(w - 100 * zoom) < Math.abs(w - 100)
  return _gbcrScalesWithZoom
}

function applyZoomCompensation(wrapper: HTMLElement) {
  const zoom = currentHtmlZoom()
  // Content to bezpośrednie dziecko wrappera (Radix tak je opakowuje)
  const content = wrapper.firstElementChild as HTMLElement | null
  // Bez zoomu LUB w trybie "layout" (gBCR surowe) — natywne pozycjonowanie jest
  // poprawne, żadna korekta nie jest potrzebna; czyścimy ewentualne stare style.
  if (zoom === 1 || !gbcrScalesWithZoom(zoom)) {
    ;(wrapper.style as any).zoom = ''
    if (content) (content.style as any).zoom = ''
    return
  }
  // Tryb "visual": anuluj dziedziczony zoom na wrapperze (translate trafia w
  // piksel wizualny) i przywróć skalę na samym Content.
  ;(wrapper.style as any).zoom = String(1 / zoom)
  if (content) (content.style as any).zoom = String(zoom)
}

function applyZoomCompensationToAll() {
  if (typeof document === 'undefined') return
  document.querySelectorAll<HTMLElement>(POPPER_SELECTOR).forEach(applyZoomCompensation)
}

let _observer: MutationObserver | null = null
function ensurePopperObserver() {
  if (_observer || typeof document === 'undefined') return
  _observer = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return
        if (node.matches?.(POPPER_SELECTOR)) {
          applyZoomCompensation(node)
        }
        // Niektóre frameworki opakowują wrapper w dodatkowy node — sprawdź też
        // dzieci dodanego węzła.
        node.querySelectorAll?.<HTMLElement>(POPPER_SELECTOR).forEach(applyZoomCompensation)
      })
    }
  })
  _observer.observe(document.body, { childList: true, subtree: true })
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
    // Apply initial value + włącz globalny obserwator popperów
    ensurePopperObserver()
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
