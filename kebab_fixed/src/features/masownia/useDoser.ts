/**
 * Dozownik wody DW-1C (ELEKTRON s.c., Zielona Góra) — hook o tym samym
 * kształcie co waga.
 *
 * Urządzenie stoi na hali i samo zamyka elektrozawór po zadanej dawce, ale
 * modułu RS-485 jeszcze nie ma (dokupywany). Do tego czasu most Rust
 * (`src-tauri/src/doser.rs`) melduje `connected: false`, a panel przyjmuje
 * litry z klawiatury w oknie ±3% — tyle wynosi dokładność urządzenia, więc
 * węższego okna nie ma sensu stawiać.
 *
 * Po dokupieniu modułu zmienia się WYŁĄCZNIE `doser.rs`. Ten hook i ekran
 * zostają bez zmian.
 *
 * Symulator do testów i dev:
 *   window.__doserSim(108)          // dozownik podłączony, nalane 108 L
 *   window.__doserSim(54, true)     // dozowanie w toku
 *   window.__doserSim(null)         // brak urządzenia
 */
import { useCallback, useEffect, useState } from 'react'

export interface DoserState {
  connected: boolean
  dosedL: number
  running: boolean
  /** Zadaj dawkę urządzeniu (gdy podłączone). */
  start: (liters: number) => void
}

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const OFF = { connected: false, dosedL: 0, running: false }

export function useDoser(): DoserState {
  const [stan, setStan] = useState(OFF)

  useEffect(() => {
    ;(window as any).__doserSim = (dosedL: number | null, running = false) => {
      setStan(dosedL == null ? OFF : { connected: true, dosedL, running })
    }
    return () => { delete (window as any).__doserSim }
  }, [])

  useEffect(() => {
    if (!IS_TAURI) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ connected: boolean; dosedL: number; running: boolean }>('doser://state', e => setStan(e.payload)),
    ).then(fn => {
      if (cancelled) fn()
      else unlisten = fn
    }).catch(e => console.error('doser://state', e))
    return () => { cancelled = true; unlisten?.() }
  }, [])

  const start = useCallback((liters: number) => {
    if (!IS_TAURI) return
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('doser_dose', { liters }))
      .catch(e => console.error('doser_dose', e))
  }, [])

  return { ...stan, start }
}
