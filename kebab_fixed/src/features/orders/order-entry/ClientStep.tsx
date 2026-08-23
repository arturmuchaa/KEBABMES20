/**
 * ClientStep — krok 1: KLIENT.
 *
 * Klient wybierany jest RAZ, na wejściu, i potem wisi na listwie u góry —
 * nie powtarza się przy każdej pozycji, bo w jednym zamówieniu jest jeden.
 * Cały krok obsługuje się z klawiatury: piszesz fragment nazwy, ↑↓, ⏎.
 * Nad listą siedzą ostatnio obsługiwani kontrahenci — w praktyce to oni
 * wracają najczęściej, więc zwykle wystarczy jedno ⏎.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Client } from '@/lib/mockApi'

export function ClientStep({
  clients, recentIds, onPick, onCancel,
}: {
  clients: Client[]
  recentIds: string[]
  onPick: (clientId: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  const nameOf = (c: Client) => c.displayName || c.name

  const recent = useMemo(
    () => recentIds.map(id => clients.find(c => c.id === id)).filter(Boolean).slice(0, 6) as Client[],
    [recentIds, clients],
  )

  const q = query.toLowerCase().trim()
  const list = useMemo(() => {
    const match = q
      ? clients.filter(c => `${c.name} ${c.displayName} ${c.city ?? ''} ${c.nip ?? ''} ${c.code}`.toLowerCase().includes(q))
      : clients
    // Bez filtra: najpierw ci, do których wracamy najczęściej.
    if (q) return match
    const rank = new Map(recentIds.map((id, i) => [id, i]))
    return [...match].sort((a, b) => {
      const ra = rank.get(a.id) ?? 999, rb = rank.get(b.id) ?? 999
      return ra !== rb ? ra - rb : nameOf(a).localeCompare(nameOf(b), 'pl')
    })
  }, [clients, q, recentIds])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setHi(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [hi, q])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter')     { e.preventDefault(); if (list[hi]) onPick(list[hi].id) }
    else if (e.key === 'Escape')    { e.preventDefault(); query ? setQuery('') : onCancel() }
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="border border-surface-4 bg-white shadow-card">

        {/* Nagłówek kartoteki */}
        <div className="flex items-baseline gap-3 border-b border-surface-4 bg-surface-2 px-5 py-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-4">Krok 1 z 2</span>
          <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.06em] text-ink">Klient</h2>
          <span className="ml-auto text-[11px] text-ink-4">
            <kbd className="oe-key">↑</kbd> <kbd className="oe-key">↓</kbd> wybór · <kbd className="oe-key">⏎</kbd> dalej
          </span>
        </div>

        {/* Szukanie */}
        <div className="relative border-b border-surface-4">
          <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            placeholder="Wpisz nazwę, miasto lub NIP…"
            className="h-14 w-full bg-transparent pl-12 pr-4 font-display text-[17px] font-semibold text-ink outline-none placeholder:font-sans placeholder:text-[15px] placeholder:font-normal placeholder:text-ink-5"
          />
        </div>

        {/* Ostatnio obsługiwani */}
        {!q && recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-3 bg-surface-2/60 px-4 py-2.5">
            <span className="mr-1 font-display text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-4">Ostatnio</span>
            {recent.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                className="oe-noselect max-w-[220px] truncate border border-surface-4 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-ink hover:bg-ink hover:text-white"
              >
                {nameOf(c)}
              </button>
            ))}
          </div>
        )}

        {/* Lista */}
        <div ref={listRef} className="oe-scroll max-h-[46vh] min-h-[180px] overflow-y-auto">
          {list.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-ink-4">
              Brak kontrahenta pasującego do „{query}"
            </div>
          ) : list.map((c, n) => (
            <button
              key={c.id}
              type="button"
              data-hi={n === hi ? '1' : undefined}
              onMouseEnter={() => setHi(n)}
              onClick={() => onPick(c.id)}
              className={cn(
                'oe-noselect flex w-full items-center gap-3 border-b border-surface-3 px-5 py-2.5 text-left last:border-b-0',
                n === hi ? 'bg-ink text-white' : 'text-ink hover:bg-surface-2',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{nameOf(c)}</span>
                {(c.city || c.nip) && (
                  <span className={cn('block truncate text-[11px]', n === hi ? 'text-white/60' : 'text-ink-4')}>
                    {[c.city, c.nip && `NIP ${c.nip}`].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {n === hi && <CornerDownLeft size={15} className="shrink-0 opacity-70" />}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2.5 text-center text-[11px] text-ink-4">
        <kbd className="oe-key">Esc</kbd> wraca do listy zamówień
      </p>
    </div>
  )
}
