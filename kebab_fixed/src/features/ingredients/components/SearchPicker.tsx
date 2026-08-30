import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export interface PozycjaListy {
  id: string
  name: string
  /** Prawa strona wiersza — zwykle stan magazynowy z jednostką. */
  rightText?: string
  /** Czy prawą stronę podświetlić na zielono (stan > 0). */
  rightStrong?: boolean
}

/**
 * SearchPicker — pole z wyszukiwaniem po wpisaniu i furtką „dodaj nowy".
 *
 * Wyciągnięte z `IngredientPicker` 30.08.2026, gdy przyjęcie DDFiP dostało
 * drugą listę do wyboru (opakowania). Zachowanie MUSI być jedno: to samo
 * pole, ta sama obsługa klawiatury, to samo zamykanie kliknięciem obok.
 * Dwie kopie rozjechałyby się przy pierwszej poprawce — a raz już tak było,
 * gdy zamiast pola stał Select, w który nie dało się nic wpisać.
 */
export function SearchPicker({
  items, value, freeText = '', onSelect, onCreateNew,
  placeholder, emptyText, createLabel,
}: {
  items: PozycjaListy[]
  /** Identyfikator wybranej pozycji z listy ('' gdy wpisano nazwę z ręki). */
  value: string
  /** Nazwa wpisana z ręki, gdy pozycji nie ma jeszcze na liście. */
  freeText?: string
  onSelect: (id: string) => void
  onCreateNew?: (name: string) => void
  placeholder: string
  emptyText: string
  createLabel: (nazwa: string) => string
}) {
  const wybrana = items.find(i => i.id === value)
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
  const trafienia = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items
  const dokladne = items.some(i => i.name.toLowerCase() === q)
  const etykieta = wybrana?.name ?? (freeText || query)

  return (
    <div ref={boxRef} className="relative">
      <Input
        placeholder={placeholder}
        value={open ? query : etykieta}
        onFocus={() => { setOpen(true); setQuery(wybrana?.name ?? freeText ?? '') }}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (value) onSelect('') }}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-surface-4 rounded-lg shadow-md max-h-56 overflow-y-auto scrollbar-thin">
          {trafienia.map(i => (
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
              {i.rightText && (
                <span className={cn('text-[11px] tabular-nums flex-shrink-0',
                  i.rightStrong ? 'text-emerald-700' : 'text-ink-4')}>
                  {i.rightText}
                </span>
              )}
            </button>
          ))}
          {trafienia.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-4">{emptyText}</div>
          )}
          {q && !dokladne && onCreateNew && (
            <button
              type="button"
              onClick={() => { onCreateNew(query.trim()); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-brand border-t border-surface-3 hover:bg-surface-3/70"
            >
              <Plus size={13} /> {createLabel(query.trim())}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
