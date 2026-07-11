/**
 * SearchSelect — pole wyboru z listy z wyszukiwaniem po wpisaniu.
 *
 * Zastępuje rozwijany <Select>, w który nie dało się nic wpisać — przy
 * długich listach (np. odbiorcy WZ) trzeba było przewijać całą listę,
 * żeby znaleźć jedną pozycję. Tu wpisanie fragmentu nazwy filtruje listę
 * (dowolne dopasowanie podciągu, nie tylko od początku).
 */
import { useEffect, useRef, useState } from 'react'
import { Input } from './input'
import { cn } from '@/lib/utils'

export interface SearchSelectItem {
  id: string
  label: string
  sublabel?: string
  /** Dodatkowy tekst brany pod uwagę przy filtrowaniu (np. NIP, miasto) */
  searchText?: string
}

export function SearchSelect({
  items, value, onSelect, placeholder, className,
}: {
  items: SearchSelectItem[]
  value: string
  onSelect: (id: string) => void
  placeholder?: string
  className?: string
}) {
  const selected = items.find(i => i.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q = query.toLowerCase().trim()
  const matches = q
    ? items.filter(i => `${i.label} ${i.sublabel ?? ''} ${i.searchText ?? ''}`.toLowerCase().includes(q))
    : items

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <Input
        placeholder={placeholder ?? 'Wpisz, aby wyszukać…'}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-surface-4 rounded-lg shadow-md max-h-64 overflow-y-auto scrollbar-thin">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-4">Brak wyników</div>
          ) : matches.map(i => (
            <button
              key={i.id}
              type="button"
              onClick={() => { onSelect(i.id); setQuery(''); setOpen(false) }}
              className={cn(
                'w-full flex flex-col items-start px-3 py-2 text-left text-sm hover:bg-blue-50/70',
                i.id === value && 'bg-blue-50 font-semibold',
              )}>
              <span className="truncate w-full">{i.label}</span>
              {i.sublabel && <span className="text-[11px] text-ink-4 truncate w-full">{i.sublabel}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
