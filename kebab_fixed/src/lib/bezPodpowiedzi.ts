/**
 * Bez podpowiedzi przeglądarki w formularzach.
 *
 * Właściciel 27.11.2026: „formularze zapamiętują sztuki i automatycznie się
 * wklepują — chcę 1 × 50, a zapamiętane jest 10 i robi się 10 × 50 w
 * zamówieniu”, i to samo w temperaturach. Przeglądarka (WebView2 w aplikacji)
 * pamięta wpisy pól po nazwie/id i podsuwa je przy następnym wpisywaniu.
 * W programie zakładu to szkodzi: liczba sprzed tygodnia to nie dzisiejsza.
 *
 * Każde pole i formularz bez jawnego `autocomplete` dostaje `off` — także
 * te dodane później (okna, wiersze edytora), przez MutationObserver.
 * Pola z jawnym `autocomplete` (logowanie: username, current-password)
 * zostają nietknięte.
 */
const SELEKTOR = 'input:not([autocomplete]), textarea:not([autocomplete]), form:not([autocomplete])'

function oznacz(root: ParentNode | Element): void {
  if (root instanceof Element && root.matches(SELEKTOR)) root.setAttribute('autocomplete', 'off')
  root.querySelectorAll?.(SELEKTOR).forEach(el => el.setAttribute('autocomplete', 'off'))
}

/** Włącza na całym dokumencie; zwraca funkcję wyłączającą obserwację. */
export function wylaczPodpowiedziPrzegladarki(doc: Document = document): () => void {
  oznacz(doc)
  if (typeof MutationObserver === 'undefined') return () => {}
  const obs = new MutationObserver(zmiany => {
    for (const z of zmiany) z.addedNodes.forEach(n => { if (n instanceof Element) oznacz(n) })
  })
  obs.observe(doc.documentElement, { childList: true, subtree: true })
  return () => obs.disconnect()
}
