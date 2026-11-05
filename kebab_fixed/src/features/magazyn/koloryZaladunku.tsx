import type { VehicleStateOrder } from '@/lib/api'

// Soft fills that still differ at a glance; the darker edge is the side bar on a tile.
// Green remains the search/scan signal. K-number also works without colour vision.
const PALETTE = [
  ['Błękit', '#3b6fb6', '#dce8f8'],
  ['Morela', '#b26a2c', '#fbe4ce'],
  ['Lawenda', '#7c5cc0', '#e9e0fa'],
  ['Turkus', '#2a8577', '#d4efe9'],
  ['Róż', '#b5506f', '#f8dce5'],
  ['Oliwka', '#6c8726', '#e6efcd'],
  ['Piasek', '#94741f', '#f3e8c8'],
  ['Indygo', '#4c59a0', '#dfe3f4'],
] as const

export type KolorZaladunku = { index: number; label: string; name: string; edge: string; fill: string }
export type ZamowienieKolorowe = Pick<VehicleStateOrder, 'id' | 'orderNo' | 'clientName' | 'clientShortName' | 'pallets'> & { color: KolorZaladunku }

export function kolorZaladunku(index: number): KolorZaladunku {
  const hue = Math.round(index * 137.508) % 360
  const [name, edge, fill] = PALETTE[index] ?? [`Kolor ${index + 1}`, `hsl(${hue} 45% 36%)`, `hsl(${hue} 60% 90%)`]
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
