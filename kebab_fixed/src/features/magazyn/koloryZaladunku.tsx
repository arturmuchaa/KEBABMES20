import type { VehicleStateOrder } from '@/lib/api'

// Light fills + dark edges keep carton numbers legible on a small HMI map.
// Green remains the search/scan signal. K-number also works without colour vision.
const PALETTE = [
  ['Niebieski', '#1d4ed8', '#bfdbfe'],
  ['Pomarańczowy', '#9a3412', '#fed7aa'],
  ['Fioletowy', '#7e22ce', '#e9d5ff'],
  ['Turkusowy', '#0e7490', '#a5f3fc'],
  ['Różowy', '#be185d', '#fbcfe8'],
  ['Żółty', '#854d0e', '#fef08a'],
  ['Brązowy', '#713f12', '#d6b99b'],
  ['Indygo', '#3730a3', '#c7d2fe'],
] as const

export type KolorZaladunku = { index: number; label: string; name: string; edge: string; fill: string }
export type ZamowienieKolorowe = Pick<VehicleStateOrder, 'id' | 'orderNo' | 'clientName' | 'pallets'> & { color: KolorZaladunku }

export function kolorZaladunku(index: number): KolorZaladunku {
  const hue = Math.round(index * 137.508) % 360
  const [name, edge, fill] = PALETTE[index] ?? [`Kolor ${index + 1}`, `hsl(${hue} 65% 30%)`, `hsl(${hue} 75% 82%)`]
  return { index, label: `K${index + 1}`, name, edge, fill }
}

export function koloryZamowien(orders: VehicleStateOrder[]): ZamowienieKolorowe[] {
  const used = new Set(orders.flatMap(o => Number.isInteger(o.colorIndex) && o.colorIndex! >= 0 ? [o.colorIndex!] : []))
  // Older servers: deterministic fallback by ID, never by client name/list position.
  const fallback = new Map<string, number>()
  for (const o of [...orders].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (Number.isInteger(o.colorIndex) && o.colorIndex! >= 0) continue
    let index = 0
    while (used.has(index)) index++
    used.add(index); fallback.set(o.id, index)
  }
  return orders.map(o => ({ ...o, color: kolorZaladunku(fallback.get(o.id) ?? o.colorIndex!) }))
}

export function ZnacznikZamowienia({ color }: { color: KolorZaladunku }) {
  return <span data-loading-color={color.index} aria-label={`${color.label} · ${color.name}`}
    className="inline-flex min-w-9 shrink-0 items-center justify-center rounded-md border-2 px-1.5 py-0.5 text-sm font-extrabold"
    style={{ background: color.fill, borderColor: color.edge, color: '#172033' }}>{color.label}</span>
}
