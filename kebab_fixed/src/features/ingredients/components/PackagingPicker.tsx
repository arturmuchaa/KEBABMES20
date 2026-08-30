import { SearchPicker } from './SearchPicker'
import type { PackagingItem } from '@/lib/mockApi'

/**
 * PackagingPicker — pole „Opakowanie" na przyjęciu DDFiP (karta 1.3.1).
 *
 * Różnica wobec składnika jest jedna, ale istotna: magazyn opakowań NIE ma
 * kartoteki, do której trzeba najpierw coś dopisać. Pozycje scalają się po
 * nazwie, więc wpisanie nowej nazwy nie zakłada niczego z góry — nazwa
 * jedzie na dokumencie, a magazyn założy pozycję dopiero przy kwalifikacji
 * „K". Odmowa przyjęcia nie zostawia po sobie pustej pozycji magazynu.
 */
export function PackagingPicker({ items, value, freeText, onSelect, onFreeText }: {
  items: PackagingItem[]
  value: string
  freeText: string
  onSelect: (id: string) => void
  onFreeText: (name: string) => void
}) {
  return (
    <SearchPicker
      items={items.map(p => ({
        id: p.id,
        name: p.name,
        rightText: `${p.kgAvailable.toFixed(0)} ${p.unit}`,
        rightStrong: p.kgAvailable > 0,
      }))}
      value={value}
      freeText={freeText}
      onSelect={id => { onSelect(id); if (id) onFreeText('') }}
      onCreateNew={onFreeText}
      placeholder="Wpisz nazwę, np. Folia stretch 500…"
      emptyText="Brak takiego opakowania na magazynie"
      createLabel={nazwa => `Przyjmij nowe opakowanie „${nazwa}"`}
    />
  )
}
