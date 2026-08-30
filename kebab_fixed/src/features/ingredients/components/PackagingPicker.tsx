import { SearchPicker } from './SearchPicker'
import type { PackagingItem } from '@/lib/mockApi'

/**
 * PackagingPicker — pole „Opakowanie" na przyjęciu DDFiP (karta 1.3.1).
 *
 * Pole tylko WYBIERA — nazwy nie da się wpisać z ręki. Magazyn opakowań
 * scala pozycje po `LOWER(name)`, więc literówka („Folia strech") nie
 * podniosłaby alarmu, tylko po cichu założyła DRUGĄ pozycję o prawie tej
 * samej nazwie, a stan rozjechałby się na dwa wiersze. Pozycję zakłada się
 * raz, na Magazynie tulei i opakowań, i od tej pory tylko się ją wybiera.
 */
export function PackagingPicker({ items, value, onSelect }: {
  items: PackagingItem[]
  value: string
  onSelect: (id: string) => void
}) {
  return (
    <SearchPicker
      items={items.map(p => ({
        id: p.id,
        name: p.name,
        code: p.code,
        rightText: `${p.kgAvailable.toFixed(0)} ${p.unit}`,
        rightStrong: p.kgAvailable > 0,
      }))}
      value={value}
      onSelect={onSelect}
      placeholder="Wpisz, żeby wyszukać…"
      emptyText="Brak takiej pozycji — załóż ją na Magazynie tulei i opakowań" 
    />
  )
}
