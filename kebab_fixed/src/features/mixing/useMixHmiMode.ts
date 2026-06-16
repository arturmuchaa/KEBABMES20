/**
 * useMixHmiMode — wybór widoku ekranu masowania (Masownia).
 *   'classic' — oryginalny ekran mobilny (MixingTabletPage)
 *   'v1'      — HMI v1 (panel 21" landscape, Porcelana)
 *   'v2'      — HMI v2 (panel 21" pod mokre rękawice)
 *
 * Analogiczne do useHmiMode (rozbiór). Wszystkie warianty dostępne równolegle
 * do testów, dopóki nie wybierzemy jednego. Trwałe per-urządzenie
 * (localStorage), współdzielone między nagłówkiem TabletLayout (segmentowany
 * przełącznik) a trasą MieszanieRoute przez useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'

export type MixHmiMode = 'classic' | 'v1' | 'v2'
export const MIX_HMI_MODES: MixHmiMode[] = ['classic', 'v1', 'v2']
export const MIX_HMI_LABELS: Record<MixHmiMode, string> = {
  classic: 'Klasyczny',
  v1: 'HMI v1',
  v2: 'HMI v2',
}

const KEY = 'mieszanie_hmi_mode'

function read(): MixHmiMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'classic' || v === 'v1' || v === 'v2') return v
    return 'v1'
  } catch {
    return 'v1'
  }
}

const listeners = new Set<() => void>()
let current: MixHmiMode = read()

function emit() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): MixHmiMode {
  return current
}

export function setMixHmiMode(mode: MixHmiMode) {
  current = mode
  try {
    localStorage.setItem(KEY, mode)
  } catch { /* ignore */ }
  emit()
}

export function useMixHmiMode(): MixHmiMode {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
