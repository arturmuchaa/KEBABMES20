import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

/**
 * IngredientPicker — pole „Składnik" z wyszukiwaniem po wpisaniu.
 *
 * Wyciągnięty z `SpiceStockPage` 30.08.2026, gdy przyjęcie DDFiP dostało
 * własny ekran: dwa miejsca wybierają składnik, więc pole musi być JEDNO.
 * Kopia rozjechałaby się przy pierwszej poprawce.
 *
 * Zastępuje rozwijany Select, w który nie dało się nic WPISAĆ (użytkownicy
 * próbowali wpisać nazwę nowego dodatku i pole wyglądało na zablokowane).
 * Wpisanie nazwy filtruje listę; gdy brak dopasowania — przycisk tworzy
 * nowy składnik bezpośrednio z tego miejsca (onCreateNew).
 */
export function IngredientPicker({ ingredients, stockMap, value, onSelect, onCreateNew }: {
  ingredients: { id: string; name: string; unit: string; category: string }[]
  stockMap: Map<string, any>
  value: string
  onSelect: (id: string) => void
  onCreateNew: (name: string) => void
}) {
  const selected = ingredients.find(i => i.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Zamknij listę przy kliknięciu poza polem
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q = query.toLowerCase().trim()
  const matches = q
    ? ingredients.filter(i => i.name.toLowerCase().includes(q))
    : ingredients
  const exact = ingredients.some(i => i.name.toLowerCase() === q)

  return (
    <div ref={boxRef} className="relative">
      <Input
        placeholder="Wpisz nazwę, np. Papryka słodka…"
        value={open ? query : (selected?.name ?? query)}
        onFocus={() => { setOpen(true); setQuery(selected?.name ?? '') }}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (value) onSelect('') }}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-surface-4 rounded-lg shadow-md max-h-56 overflow-y-auto scrollbar-thin">
          {matches.map(i => {
            const qty = stockMap.get(i.id)?.qtyAvailable ?? 0
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => { onSelect(i.id); setQuery(''); setOpen(false) }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-3/70',
                  i.id === value && 'bg-surface-3 font-semibold',
                )}
              >
                <span className="truncate">{i.name}</span>
                <span className={cn('text-[11px] tabular-nums flex-shrink-0', qty > 0 ? 'text-emerald-700' : 'text-ink-4')}>
                  {qty.toFixed(1)} {i.unit}
                </span>
              </button>
            )
          })}
          {matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-4">Brak składnika o tej nazwie</div>
          )}
          {q && !exact && (
            <button
              type="button"
              onClick={() => { onCreateNew(query.trim()); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-brand border-t border-surface-3 hover:bg-surface-3/70"
            >
              <Plus size={13} /> Dodaj nowy składnik „{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}
