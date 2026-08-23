/**
 * fields.tsx — pola wsadu w idiomie KARTOTEKI.
 *
 * Każde pole ma nad sobą małą zakładkę z nazwą. Zakładka aktywnego pola jest
 * odwrócona (czerń/biel) i pole dostaje czarną ramkę — operator wie „gdzie
 * jestem" kątem oka, bez czytania i bez polowania na obwódkę focusa.
 *
 * ComboField zastępuje tu Radix <Select> z reszty biura z jednego powodu:
 * w Select NIE DA SIĘ PISAĆ. Na tym ekranie ma się dać wpisać „kur" i wcisnąć
 * ⏎ — bez sięgania po mysz. Reszta (Input, tokeny, ikony) to ten sam system
 * komponentów co wszędzie.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Ramka z zakładką ──────────────────────────────────────────────
export function FieldShell({
  label, active, hint, inherited, className, children,
}: {
  label: string
  active: boolean
  hint?: ReactNode
  inherited?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <span
        className={cn(
          'self-start rounded-t-[3px] border border-b-0 px-1.5 py-px font-display text-[9.5px] font-bold uppercase leading-[1.5] tracking-[0.13em]',
          active ? 'border-ink bg-ink text-white' : 'border-surface-4 bg-surface-3 text-ink-3',
        )}
      >
        {label}
        {inherited && <RotateCcw size={8} className="ml-1 inline-block -translate-y-px" aria-label="dziedziczone" />}
      </span>
      <div className={cn('relative -mt-px min-w-0', active && 'z-20')}>{children}</div>
      {hint && <span className="mt-0.5 text-[10px] leading-tight text-ink-4">{hint}</span>}
    </div>
  )
}

const boxCls = (active: boolean) =>
  cn(
    'h-10 w-full rounded-b-[3px] rounded-tr-[3px] bg-white px-2.5 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-100',
    active
      ? 'border-2 border-ink shadow-[0_1px_0_rgba(0,0,0,.06)]'
      : 'border border-surface-4 hover:border-ink-5',
  )

// ── Pole liczbowe ─────────────────────────────────────────────────
export function NumberField({
  label, value, onChange, active, onActivate, onNext, onPrev, suffix, placeholder, width,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  active: boolean
  onActivate: () => void
  onNext: () => void
  onPrev: () => void
  suffix?: string
  placeholder?: string
  width?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (active && document.activeElement !== ref.current) { ref.current?.focus(); ref.current?.select() }
  }, [active])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')                  { e.preventDefault(); onNext() }
    else if (e.key === 'Tab' && !e.shiftKey){ e.preventDefault(); onNext() }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); onPrev() }
  }

  return (
    <FieldShell label={label} active={active} className={width}>
      <div className="relative">
        <input
          ref={ref}
          value={value}
          aria-label={label}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          onFocus={onActivate}
          onChange={e => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          onKeyDown={onKeyDown}
          className={cn(boxCls(active), 'pr-8 text-right font-mono text-[19px] font-bold tabular-nums')}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-display text-[10px] font-bold uppercase tracking-wider text-ink-4">
            {suffix}
          </span>
        )}
      </div>
    </FieldShell>
  )
}

// ── Pole wyboru z listy ───────────────────────────────────────────
export interface ComboItem { id: string; label: string; sub?: string; search?: string }

/** Podświetlenie trafionego fragmentu — widać, DLACZEGO pozycja pasuje.
 *  Na wierszu pod kursorem (czarnym) zaznaczenie musi się odwrócić, inaczej
 *  czerń na czerni zjada właśnie to, co operator wpisał. */
function Highlight({ text, q, on }: { text: string; q: string; on: boolean }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className={cn('px-px', on ? 'bg-white text-ink' : 'bg-ink text-white')}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function ComboField({
  label, items, value, onPick, active, onActivate, onNext, onPrev,
  placeholder, noneLabel, inherited, width, emptyHint,
}: {
  label: string
  items: ComboItem[]
  value: string
  /** Wybrano wartość. Przeskok na kolejne pole należy do wołającego — to on
   *  wie, czy któryś slot da się pominąć (np. jedyna pasująca receptura). */
  onPick: (id: string) => void
  active: boolean
  onActivate: () => void
  /** Idziemy dalej BEZ zmiany wartości (⏎/⇥ na już wypełnionym polu). */
  onNext: () => void
  onPrev: () => void
  placeholder?: string
  /** Gdy podane — pusta wartość jest legalna i ma swoją pozycję na liście. */
  noneLabel?: string
  inherited?: boolean
  width?: string
  emptyHint?: string
}) {
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  const all = useMemo<ComboItem[]>(
    () => (noneLabel ? [{ id: '', label: noneLabel }, ...items] : items),
    [items, noneLabel],
  )
  const q = query.toLowerCase().trim()
  const matches = useMemo(
    () => (q ? all.filter(i => `${i.label} ${i.sub ?? ''} ${i.search ?? ''}`.toLowerCase().includes(q)) : all),
    [all, q],
  )
  const selected = all.find(i => i.id === value)

  // Wejście w pole: czyścimy zapytanie i stajemy na aktualnym wyborze.
  useLayoutEffect(() => {
    if (!active) { setQuery(''); return }
    if (document.activeElement !== inputRef.current) inputRef.current?.focus()
    setQuery('')
    const idx = all.findIndex(i => i.id === value)
    setHi(idx >= 0 ? idx : 0)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setHi(0) }, [q])

  // Kursor listy zawsze w polu widzenia.
  useEffect(() => {
    if (!active) return
    listRef.current?.querySelector<HTMLElement>('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [hi, active, q])

  function pick(item: ComboItem | undefined) {
    if (!item) return
    setQuery('')
    onPick(item.id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)); break
      case 'ArrowUp':   e.preventDefault(); setHi(h => Math.max(h - 1, 0)); break
      case 'Home':      e.preventDefault(); setHi(0); break
      case 'End':       e.preventDefault(); setHi(matches.length - 1); break
      case 'Enter':
        e.preventDefault()
        // Nic nie wpisano i wybór już jest → ⏎ znaczy „zostaw i leć dalej".
        if (!q && value) onNext()
        else pick(matches[hi])
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) { onPrev(); break }
        if (q) pick(matches[hi])
        else onNext()
        break
      case 'Escape':
        e.preventDefault()
        if (q) setQuery('')
        else inputRef.current?.blur()
        break
    }
  }

  return (
    <FieldShell label={label} active={active} inherited={inherited} className={width}>
      <div className="relative">
        <input
          ref={inputRef}
          value={active ? query : (selected?.label ?? '')}
          aria-label={label}
          onFocus={onActivate}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          placeholder={active ? (selected?.label || placeholder) : placeholder}
          className={cn(
            boxCls(active),
            'truncate pr-7 font-medium',
            inherited && !active && 'oe-inherit',
            !selected && !active && 'text-ink-4',
          )}
        />
        <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-4" />

        {active && (
          <div
            ref={listRef}
            className="oe-drop oe-scroll absolute left-0 top-[calc(100%+3px)] z-30 max-h-[276px] w-full min-w-[220px] overflow-y-auto border-2 border-ink bg-white shadow-modal"
          >
            {matches.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-[11px] text-ink-4">
                {emptyHint ?? 'Brak pasujących pozycji'}
              </div>
            ) : (
              matches.map((it, n) => (
                <button
                  key={it.id || '__none'}
                  type="button"
                  data-hi={n === hi ? '1' : undefined}
                  onMouseDown={e => { e.preventDefault(); pick(it) }}
                  onMouseEnter={() => setHi(n)}
                  className={cn(
                    'oe-noselect flex w-full items-baseline gap-2 border-b border-surface-3 px-2.5 py-1.5 text-left text-[12.5px] last:border-b-0',
                    n === hi ? 'bg-ink text-white' : 'text-ink hover:bg-surface-3',
                    !it.id && 'italic',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={it.label} q={q} on={n === hi} />
                  </span>
                  {it.sub && (
                    <span className={cn('shrink-0 font-mono text-[10.5px] tabular-nums', n === hi ? 'text-white/65' : 'text-ink-4')}>
                      {it.sub}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </FieldShell>
  )
}
