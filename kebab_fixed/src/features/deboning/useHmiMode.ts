/**
 * useHmiMode — przełącznik trybu ekranu rozbioru (klasyk ↔ HMI v2).
 *
 * Trwały per-urządzenie (localStorage), współdzielony między nagłówkiem
 * TabletLayout (przycisk) a trasą RozbiorRoute (render) przez useSyncExternalStore.
 * Zmiana w jednym miejscu natychmiast aktualizuje wszystkie subskrypcje —
 * bez prop-drillingu i bez globalnego store'a.
 */
import { useSyncExternalStore } from 'react'

export type HmiMode = 'classic' | 'v2'
const KEY = 'rozbior_hmi_v2'

function read(): HmiMode {
  try {
    return localStorage.getItem(KEY) === '1' ? 'v2' : 'classic'
  } catch {
    return 'classic'
  }
}

const listeners = new Set<() => void>()
let current: HmiMode = read()

function emit() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): HmiMode {
  return current
}

export function setHmiMode(mode: HmiMode) {
  current = mode
  try { localStorage.setItem(KEY, mode === 'v2' ? '1' : '0') } catch { /* ignore */ }
  emit()
}

export function toggleHmiMode() {
  setHmiMode(current === 'v2' ? 'classic' : 'v2')
}

export function useHmiMode(): HmiMode {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
