import { SearchPicker } from './SearchPicker'

/**
 * IngredientPicker — pole „Składnik" z wyszukiwaniem po wpisaniu.
 *
 * Wyciągnięty z `SpiceStockPage` 30.08.2026, gdy przyjęcie DDFiP dostało
 * własny ekran: dwa miejsca wybierają składnik, więc pole musi być JEDNO.
 * Kopia rozjechałaby się przy pierwszej poprawce.
 *
 * Od 30.08.2026 samo pole siedzi w `SearchPicker` — tę samą listę wybiera
 * też pole opakowań na przyjęciu DDFiP. Tu zostaje tylko to, co składnikowe:
 * stan magazynowy po prawej i zakładanie nowej pozycji kartoteki.
 *
 * Zastępuje rozwijany Select, w który nie dało się nic WPISAĆ (użytkownicy
 * próbowali wpisać nazwę nowego dodatku i pole wyglądało na zablokowane).
 */
export function IngredientPicker({
  ingredients, stockMap, value, onSelect, onCreateNew, emptyText,
}: {
  ingredients: { id: string; name: string; unit: string; category: string }[]
  stockMap: Map<string, any>
  value: string
  onSelect: (id: string) => void
  /** Pominięte = pole tylko WYBIERA; nowej pozycji nie da się wpisać z ręki. */
  onCreateNew?: (name: string) => void
  emptyText?: string
}) {
  return (
    <SearchPicker
      items={ingredients.map(i => {
        const qty = stockMap.get(i.id)?.qtyAvailable ?? 0
        return {
          id: i.id,
          name: i.name,
          rightText: `${qty.toFixed(1)} ${i.unit}`,
          rightStrong: qty > 0,
        }
      })}
      value={value}
      onSelect={onSelect}
      onCreateNew={onCreateNew}
      placeholder="Wpisz nazwę, np. Papryka słodka…"
      emptyText={emptyText ?? 'Brak składnika o tej nazwie'}
      createLabel={nazwa => `Dodaj nowy składnik „${nazwa}"`}
    />
  )
}
