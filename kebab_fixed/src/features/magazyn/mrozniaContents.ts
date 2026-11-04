import type { KartonNaPlanie, PozycjaSkladu } from '@/lib/api'
import { rozmiarTulei, TULEJA_STD_MIN, TULEJA_STD_MAX } from '@/features/orders/orderLineSort'
import { kgTxt } from './pula'

export const compactCartonNo = (value: string) => value.replace(/^0+(?=\d)/, '')

/** Scanned legacy pieces can say "METAL 80" instead of "METAL 80CM".
 * An unrecognised name is shown as-is, never silently called standard. */
export function freezerTube(name?: string) {
  const legacy = /^(?:(?:METAL|PAPIER|KARTON|TULEJA)\s*)?(\d+)$/i.exec((name ?? '').trim())
  const cm = rozmiarTulei(name) ?? (legacy ? Number(legacy[1]) : null)
  return { cm, nonstandard: cm !== null && (cm < TULEJA_STD_MIN || cm > TULEJA_STD_MAX) }
}

const normalize = (text: string) => text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l')
export function findFreezerCartons(cartons: KartonNaPlanie[], query: string): KartonNaPlanie[] {
  const needle = normalize(query.trim())
  if (!needle) return cartons
  if (/^\d+$/.test(needle)) {
    const exact = cartons.filter(c => compactCartonNo(c.cartonNo) === compactCartonNo(needle))
    if (exact.length) return exact
  }
  const words = needle.split(/\s+/)
  return cartons.filter(c => {
    const text = normalize([c.cartonNo, c.clientName, c.orderNo,
      ...c.lines.flatMap(p => [p.recipeName, p.productTypeName, p.packagingName ?? ''])].join(' '))
    return words.every(word => text.includes(word))
  })
}

/** Map overview signals mixed cartons; it must never label all contents with
 * the first recipe/weight. Full, unmerged lines are shown in the adjacent card. */
export function freezerTileSummary(lines: PozycjaSkladu[]) {
  const recipes = [...new Set(lines.map(p => p.recipeName.trim() || 'Brak receptury'))]
  return {
    recipe: recipes.length === 1 ? recipes[0] : recipes.length ? `MIX · ${recipes.length} receptury` : 'Brak składu',
    quantity: lines.length === 1 ? `${lines[0].qty}×${kgTxt(lines[0].kgPerUnit)} kg`
      : lines.length ? `${lines.reduce((sum, p) => sum + p.qty, 0)} szt · ${lines.length} poz.` : '',
    tubes: [...new Set(lines.filter(p => freezerTube(p.packagingName).nonstandard).map(p => freezerTube(p.packagingName).cm!))],
  }
}
