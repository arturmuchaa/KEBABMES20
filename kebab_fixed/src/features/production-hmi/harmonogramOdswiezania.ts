/**
 * Harmonogram odświeżania planu i postępu skanów na HMI produkcji.
 *
 * Zastępuje dla tych dwóch źródeł niezależne `useLiveRefresh` (co 5 s) ORAZ
 * odświeżenie po każdym skanie. `utworzOdswiezanieZbiorcze` ograniczało tylko
 * nakładanie się odczytów — przy szybkim API seria 100 skanów nadal dawała
 * ~100 par GET. Tu jedna instancja decyduje o WSZYSTKICH odczytach tych
 * źródeł:
 *   - najwyżej JEDNO odświeżenie w locie; prośba w jego trakcie = jedno
 *     dodatkowe PO nim,
 *   - okresowo co `okresMs` od końca poprzedniego — zmiany z biura przychodzą
 *     także wtedy, gdy nikt nie skanuje,
 *   - po udanym zapisie: jedno odświeżenie po `ciszaMs` ciszy, ale nie
 *     częściej niż co `minOdstepMs` od poprzedniego startu i NIE PÓŹNIEJ niż
 *     `okresMs` od pierwszego nieodświeżonego zapisu — stała seria nie
 *     przesuwa go w nieskończoność,
 *   - zapis, który przyszedł W TRAKCIE odczytu, nie jest nim pokryty
 *     (odczyt mógł wyjść wcześniej) — dostaje własne odświeżenie końcowe.
 *
 * Moduł czysty (zegar i timery wstrzykiwane) — testowany bez Reacta.
 */
export interface HarmonogramOpcje {
  odswiez: () => Promise<unknown>
  okresMs?: number
  ciszaMs?: number
  minOdstepMs?: number
  zegar?: () => number
}

export interface Harmonogram {
  /** Uruchamia cykl okresowy (pierwszy odczyt robi `useApi` przy montowaniu). */
  start: () => void
  /** Udany zapis — dane na serwerze się zmieniły. */
  poZapisie: () => void
  /** Odśwież teraz (np. po zmianie planu); w locie = jedno dodatkowe po nim. */
  teraz: () => void
  /** Sprzątanie: żadnych timerów ani nowych odczytów. */
  zatrzymaj: () => void
}

export const OKRES_MS = 5000
export const CISZA_MS = 600
export const MIN_ODSTEP_MS = 1500

export function utworzHarmonogramOdswiezania(o: HarmonogramOpcje): Harmonogram {
  const okres = o.okresMs ?? OKRES_MS
  const cisza = o.ciszaMs ?? CISZA_MS
  const minOdstep = o.minOdstepMs ?? MIN_ODSTEP_MS
  const zegar = o.zegar ?? (() => Date.now())

  let zatrzymany = true
  let wToku = false
  let ponow = false
  let ostatniStart = Number.NEGATIVE_INFINITY
  /** Pierwszy zapis niepokryty odczytem, który ruszył PO nim; null = brak. */
  let brudnyOd: number | null = null
  let ostatniZapis = 0
  let timerOkres: ReturnType<typeof setTimeout> | null = null
  let timerZapis: ReturnType<typeof setTimeout> | null = null

  const skasuj = () => {
    if (timerOkres) { clearTimeout(timerOkres); timerOkres = null }
    if (timerZapis) { clearTimeout(timerZapis); timerZapis = null }
  }

  const zaplanujOkres = () => {
    if (timerOkres) clearTimeout(timerOkres)
    timerOkres = setTimeout(() => { timerOkres = null; uruchom() }, okres)
  }

  const zaplanujPoZapisie = () => {
    if (zatrzymany || wToku || brudnyOd === null) return
    const termin = Math.min(
      Math.max(ostatniZapis + cisza, ostatniStart + minOdstep),
      brudnyOd + okres,
    )
    if (timerZapis) clearTimeout(timerZapis)
    timerZapis = setTimeout(() => { timerZapis = null; uruchom() }, Math.max(0, termin - zegar()))
  }

  function uruchom() {
    if (zatrzymany) return
    if (wToku) { ponow = true; return }
    skasuj()
    wToku = true
    brudnyOd = null
    ostatniStart = zegar()
    void (async () => {
      // `useApi.refetch` połyka błędy — gdyby jednak rzuciło, cykl ma trwać.
      try { await o.odswiez() } catch { /* stan pokaże następny odczyt */ }
      wToku = false
      if (zatrzymany) return
      if (ponow) { ponow = false; uruchom(); return }
      zaplanujOkres()
      zaplanujPoZapisie()
    })()
  }

  return {
    start() {
      if (!zatrzymany) return
      zatrzymany = false
      zaplanujOkres()
    },
    poZapisie() {
      if (zatrzymany) return
      const t = zegar()
      if (brudnyOd === null) brudnyOd = t
      ostatniZapis = t
      zaplanujPoZapisie()
    },
    teraz() { uruchom() },
    zatrzymaj() {
      zatrzymany = true
      ponow = false
      skasuj()
    },
  }
}
