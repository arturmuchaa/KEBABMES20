import type { A4Placement, LabelRenderUnit } from '@/lib/api'

/** Keep original sheet/slot on a partial reprint; never populate missing slots
 * with neighbour units, and never allocate an array indexed by a source sheet. */
export function groupA4Units(units: LabelRenderUnit[], perSheet: number, placements?: A4Placement[]) {
  if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > 20 || (placements && placements.length !== units.length)) {
    throw new Error('Nieprawidłowy układ arkusza A4')
  }
  const pages = new Map<number, Array<{ unit: LabelRenderUnit; slot: number }>>()
  const occupied = new Set<string>()
  units.forEach((unit, index) => {
    const { sheet, slot } = placements?.[index] ?? { sheet: Math.floor(index / perSheet), slot: index % perSheet }
    if (!Number.isSafeInteger(sheet) || sheet < 0 || !Number.isInteger(slot) || slot < 0 || slot >= perSheet || occupied.has(`${sheet}:${slot}`)) {
      throw new Error('Nieprawidłowy lub powtórzony slot historycznej etykiety')
    }
    occupied.add(`${sheet}:${slot}`)
    const entries = pages.get(sheet) ?? []
    entries.push({ unit, slot }); pages.set(sheet, entries)
  })
  return [...pages].sort(([a], [b]) => a - b).map(([, entries]) => entries.sort((a, b) => a.slot - b.slot))
}
