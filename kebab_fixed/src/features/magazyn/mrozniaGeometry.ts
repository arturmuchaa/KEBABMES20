import type { MiejsceMrozni } from '@/lib/api'

export type Footprint = { xCm: number; yCm: number; rotation: 0 | 90 }
export const ROOM = { widthCm: 560, depthCm: 1080, stepCm: 10 }
export const palletSize = (rotation: 0 | 90) => rotation === 0 ? { width: 120, depth: 80 } : { width: 80, depth: 120 }
export function positioned<T extends { xCm?: number | null; yCm?: number | null; rotation?: 0 | 90 }>(p?: T | null): p is T & Footprint {
  return !!p && Number.isFinite(p.xCm) && Number.isFinite(p.yCm) && (p.rotation === 0 || p.rotation === 90)
}
export function placementProblem(p: Footprint, occupied: Footprint[]): string {
  const { width, depth } = palletSize(p.rotation)
  if (p.xCm < 0 || p.yCm < 0 || p.xCm + width > ROOM.widthCm || p.yCm + depth > ROOM.depthCm)
    return 'Paleta wychodzi poza ścianę mroźni.'
  if (occupied.some(o => {
    const s = palletSize(o.rotation)
    return p.xCm < o.xCm + s.width && p.xCm + width > o.xCm && p.yCm < o.yCm + s.depth && p.yCm + depth > o.yCm
  })) return 'Paleta nachodzi na inny karton lub towar. Przesuń ją albo obróć.'
  return ''
}
export function firstFree(rotation: 0 | 90, occupied: Footprint[]): Footprint | null {
  const { width, depth } = palletSize(rotation)
  for (let yCm = 0; yCm <= ROOM.depthCm - depth; yCm += ROOM.stepCm)
    for (let xCm = 0; xCm <= ROOM.widthCm - width; xCm += ROOM.stepCm) {
      const p = { xCm, yCm, rotation }
      if (!placementProblem(p, occupied)) return p
    }
  return null
}
export function locationText(p?: MiejsceMrozni | null): string {
  return positioned(p) ? `X ${p.xCm} · Y ${p.yCm} cm · bok ${palletSize(p.rotation).width} cm od drzwi`
    : p ? `${p.slot} · położenie do potwierdzenia` : 'BEZ MIEJSCA'
}
