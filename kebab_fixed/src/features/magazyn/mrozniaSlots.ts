import type { MiejsceMrozni } from '@/lib/api'

export const positioned = (location?: MiejsceMrozni | null): location is MiejsceMrozni =>
  !!location && /^[A-I][1-7]$/.test(location.slot)

export const locationText = (location?: MiejsceMrozni | null) => positioned(location)
  ? `Miejsce ${location.slot} · ${location.rotation === 90 ? 'krótszym' : 'dłuższym'} bokiem od drzwi`
  : 'Bez przypisanego miejsca'
