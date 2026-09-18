/**
 * Bęben masownicy — jedyna rzecz na ekranie, która się rusza.
 *
 * Hala patrzy na panel z kilku metrów i z tej odległości odliczanie sekund
 * zlewa się w jedną plamę; obracający się bęben mówi „maszyna PRACUJE" bez
 * czytania. Pełny obrót w 3 s, czyli mniej więcej tempo prawdziwej masownicy —
 * szybciej wygląda jak alarm.
 *
 * Obrót napędza Web Animations API, a NIE animacja CSS, i celowo nie ma tu
 * wyjątku na `prefers-reduced-motion`. Pierwsza wersja robiła odwrotnie
 * i na kiosku hali bęben stał: panel PC ma w Windows wyłączone efekty
 * animacji, więc WebView raportuje „ogranicz ruch" i CSS-owa animacja nigdy
 * nie ruszyła („są łopatki, ale stoją", 18.09.2026). Tutaj ruch jest
 * INFORMACJĄ o stanie maszyny, nie ozdobą, więc nie może go wyciszyć
 * systemowe ustawienie wyglądu.
 *
 * Klasa `.beben-obrot` (keyframes w index.css, nie w inline `<style>` — CSP
 * kiosku) zostaje jako zapas dla środowisk bez WAAPI.
 */
import { useEffect, useRef } from 'react'

/** Ile trwa pełny obrót bębna. */
export const OBROT_MS = 3000

export function Beben() {
  // Kręci się WEWNĘTRZNA GRUPA, nie korzeń <svg>: transform na grupie rysuje
  // każdy silnik SVG tak samo, a na korzeniu bywał traktowany jak układ
  // dokumentu. Przy stojącym bębnie na hali nie chcę drugi raz zgadywać, która
  // warstwa nie zadziałała.
  const ref = useRef<SVGGElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: OBROT_MS, iterations: Infinity, easing: 'linear' },
    )
    return () => anim.cancel()
  }, [])

  return (
    <svg data-testid="beben-masownicy" width="34" height="34" viewBox="0 0 34 34"
      aria-hidden="true" style={{ flexShrink: 0, marginBottom: 2 }}>
      {/* Obręcz stoi — kręcą się łopatki w środku, dokładnie jak w maszynie. */}
      <circle cx="17" cy="17" r="14.5" fill="none" stroke="var(--accent)" strokeWidth="2.5" opacity="0.35" />
      <g ref={ref} className="beben-obrot" style={{ transformOrigin: '17px 17px' }}>
        {/* Łopatki — bez nich obracające się koło wygląda na nieruchome. */}
        <path d="M17 4.5 L17 12 M29.5 17 L22 17 M17 29.5 L17 22 M4.5 17 L12 17"
          stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="17" cy="17" r="3.2" fill="var(--accent)" />
      </g>
    </svg>
  )
}
