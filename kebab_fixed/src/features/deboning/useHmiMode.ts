/**
 * useHmiMode — wybór widoku ekranu rozbioru.
 *   'classic' — oryginalny ekran (mobilny, nietknięty)
 *   'v2'      — HMI v2 (Clinical Light, landscape)
 *   'v3'      — HMI v3 (Control Room, ciemny przemysłowy)
 *
 * Wszystkie warianty zostają dostępne równolegle do testów. Trwały
 * per-urządzenie (localStorage), współdzielony między nagłówkiem TabletLayout
 * (segmentowany przełącznik) a trasą RozbiorRoute przez useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'

export type HmiMode = 'classic' | 'v2' | 'v3'
export const HMI_MODES: HmiMode[] = ['classic', 'v2', 'v3']
export const HMI_LABELS: Record<HmiMode, string> = {
  classic: 'Klasyczny',
  v2: 'HMI v2',
  v3: 'HMI v3',
}

const KEY = 'rozbior_hmi_mode'
const LEGACY_KEY = 'rozbior_hmi_v2'

function read(): HmiMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'classic' || v === 'v2' || v === 'v3') return v
    // migracja ze starego klucza binarnego
    if (localStorage.getItem(LEGACY_KEY) === '1') return 'v2'
    return 'classic'
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
  try {
    localStorage.setItem(KEY, mode)
    localStorage.removeItem(LEGACY_KEY)
  } catch { /* ignore */ }
  emit()
}

export function useHmiMode(): HmiMode {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
