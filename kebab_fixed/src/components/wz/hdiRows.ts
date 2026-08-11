import { WzLine } from '@/lib/api'

/** Wiersze sekcji „Identyfikacja partii surowca (HDI)" na dokumencie WZ.
 *
 *  Trzy reguły, wszystkie z realnego wydruku (WZ/16/08/26 miał 14 wierszy
 *  wymieszanych i wychodził na dwie strony):
 *   1. tylko pozycje surowcowe z numerem partii (wyrób gotowy ma osobny HDI),
 *   2. ten sam towar z tej samej partii (i tych samych dat) = JEDNA linia —
 *      kg i pojemniki sumujemy, żeby nie dublować wiersza partii,
 *   3. kolejność: GRUPAMI TOWARU w kolejności pozycji dokumentu (np. najpierw
 *      wszystkie grzbiety, potem kości), a w grupie partie OD NAJSTARSZEJ
 *      (rosnąco po numerze partii).
 *
 *  Wejściowe linie nie są modyfikowane — zwracamy kopie. */
export function buildHdiRows(lines: WzLine[]): WzLine[] {
  const raw = lines.filter(l => l.stock_type && l.stock_type !== 'fg' && l.batch_no)
  if (!raw.length) return []

  // Kolejność grup = pierwsze wystąpienie towaru w dokumencie (ta sama, w jakiej
  // scalone pozycje trafiają do głównej tabeli WZ).
  const nameOrder = new Map<string, number>()
  lines.forEach(l => { if (!nameOrder.has(l.name)) nameOrder.set(l.name, nameOrder.size) })

  const byBatch = new Map<string, WzLine>()
  const rows: WzLine[] = []
  for (const l of raw) {
    const kg = Number(l.total_kg ?? (l.unit === 'kg' ? l.qty : 0) ?? 0)
    const key = [l.name, l.batch_no, l.slaughter_date, l.production_date, l.expiry_date].join('|')
    const seen = byBatch.get(key)
    if (seen) {
      seen.total_kg = Number(seen.total_kg ?? 0) + kg
      seen.containers = Number(seen.containers ?? 0) + Number(l.containers ?? 0)
    } else {
      const copy: WzLine = { ...l, total_kg: kg }
      byBatch.set(key, copy)
      rows.push(copy)
    }
  }

  return rows.sort((a, b) =>
    (nameOrder.get(a.name) ?? 999) - (nameOrder.get(b.name) ?? 999) ||
    String(a.batch_no ?? '').localeCompare(String(b.batch_no ?? ''), 'pl', { numeric: true }))
}
