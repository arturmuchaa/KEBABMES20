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
import { useEffect, useRef, useState } from 'react'

export interface ScaleReading {
  gross: number
  stable: boolean
  connected: boolean
}

export interface ScaleState extends ScaleReading {
  available: boolean
}

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const OFF: ScaleReading = { gross: 0, stable: false, connected: false }

export function useScale(): ScaleState {
  const [reading, setReading] = useState<ScaleReading>(OFF)
  const [simActive, setSimActive] = useState(false)
  const simRef = useRef(false)

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
        if (!simRef.current) setReading(e.payload)
      }),
    ).then(fn => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return { ...reading, available: IS_TAURI || simActive }
}
