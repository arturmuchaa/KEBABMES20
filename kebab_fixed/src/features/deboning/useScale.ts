/**
 * useScale — odczyt wagi najazdowej na żywo (HMI rozbiór v10).
 *
 * W kiosku Tauri nasłuchuje eventów `scale://weight` z mostu RS232 (Rust,
 * src-tauri/src/scale.rs). Poza Tauri (web/dev) waga jest niedostępna i HMI
 * działa jak dotychczas — chyba że test/dev włączy symulator:
 *   window.__scaleSim(170.0)        // brutto 170,0; stable=true
 *   window.__scaleSim(93.2, false)  // ważenie w toku
 *   window.__scaleSim(null)         // wyłącz symulator
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ScaleReading {
  gross: number
  stable: boolean
  connected: boolean
}

export interface ScaleState extends ScaleReading {
  available: boolean
  /** Wyślij do wagi komendę tarowania/zerowania (fizycznie, przez RS232). */
  tare: () => void
}

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const OFF: ScaleReading = { gross: 0, stable: false, connected: false }

/** Watchdog: brak nowego eventu z mostu RS232 przez tyle ms = waga przestała
 * nadawać (kabel, wyłączona transmisja) → BRAK POŁĄCZENIA zamiast wiecznie
 * zamrożonego ostatniego odczytu (ryzyko zapisania wagi poprzedniego wózka). */
const STALE_AFTER_MS = 3000

export function useScale(): ScaleState {
  const [reading, setReading] = useState<ScaleReading>(OFF)
  const [simActive, setSimActive] = useState(false)
  const simRef = useRef(false)
  const lastEventRef = useRef(0)
  // Fizyczne tarowanie: wysyła komendę do wagi przez RS232 (most Rust). Gdy ktoś
  // zostawił wagę wytarowaną, operator kładzie pustą wagę i taruje z HMI.
  const tare = useCallback(() => {
    if (!IS_TAURI) return
    import('@tauri-apps/api/core').then(({ invoke }) => invoke('scale_tare')).catch(e => console.error('scale_tare', e))
  }, [])

  useEffect(() => {
    ;(window as any).__scaleSim = (gross: number | null, stable = true) => {
      if (gross == null) {
        simRef.current = false
        setSimActive(false)
        setReading(OFF)
        return
      }
      simRef.current = true
      setSimActive(true)
      setReading({ gross, stable, connected: true })
    }
    return () => {
      delete (window as any).__scaleSim
    }
  }, [])

  useEffect(() => {
    if (!IS_TAURI) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<ScaleReading>('scale://weight', e => {
        lastEventRef.current = Date.now()
        if (!simRef.current) setReading(e.payload)
      }),
    ).then(fn => {
      if (cancelled) fn()
      else unlisten = fn
    })
    // Watchdog stęchłego odczytu — patrz STALE_AFTER_MS.
    const stale = setInterval(() => {
      if (simRef.current) return
      if (lastEventRef.current && Date.now() - lastEventRef.current > STALE_AFTER_MS) {
        setReading(prev => (prev.connected ? { ...prev, stable: false, connected: false } : prev))
      }
    }, 1000)
    return () => {
      cancelled = true
      unlisten?.()
      clearInterval(stale)
    }
  }, [])

  return { ...reading, available: IS_TAURI || simActive, tare }
}
