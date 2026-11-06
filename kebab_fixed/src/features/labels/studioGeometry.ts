/** Legacy storage stays in percent. mm are a view, not a lossy migration. */
export const A4_MM = { x: 210, y: 297 } as const
export const percentToMm = (value: number, axis: 'x' | 'y') => value * A4_MM[axis] / 100
export function mmToPercent(value: number, axis: 'x' | 'y'): number {
  if (!Number.isFinite(value)) throw new Error('Współrzędna musi być skończoną liczbą')
  return Math.max(0, Math.min(100, value / A4_MM[axis] * 100))
}
export function moveField(
  position: { x: number; y: number }, dxPercent: number, dyPercent: number, snapMm = 0,
): { x: number; y: number } {
  const axis = (name: 'x' | 'y', delta: number) => {
    const mm = percentToMm(position[name] + delta, name)
    return mmToPercent(snapMm > 0 ? Math.round(mm / snapMm) * snapMm : mm, name)
  }
  return { x: axis('x', dxPercent), y: axis('y', dyPercent) }
}
