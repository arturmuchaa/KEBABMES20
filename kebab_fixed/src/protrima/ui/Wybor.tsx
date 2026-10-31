import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { relRect, useApp } from '../shell/context'

export interface WyborItem { id: string; label: string; sub?: string }

/** Najwęższa lista — nazwy receptur i klientów bywają dłuższe niż pole w tabeli. */
const MIN_LISTA = 240

/** Trafiony fragment podkreślony — widać, dlaczego pozycja pasuje. */
function Trafienie({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

/**
 * Pole wyboru z wpisywaniem — tam, gdzie biuro wbija serie (pozycje zamówienia,
 * klient): wpisz „bey”, Enter — wybrane, kursor idzie dalej. W natywnym
 * <select> nie da się pisać ani sterować przeskokiem.
 *
 * Wybór (Enter albo klik) woła `onChange`, potem `onDalej` — dokąd skoczyć,
 * wie wołający. Enter na zwiniętym, wypełnionym polu = „zostaw i dalej”.
 * Puste pole + Enter najpierw rozwija listę — wybór w ciemno pierwszej pozycji
 * byłby cichym wpisaniem złego rodzaju. Tab z wpisanym tekstem bierze
 * podświetloną pozycję, bez tekstu niczego nie zmienia. Esc porzuca wpisywanie.
 * Lista wisi w oknie aplikacji (jak menu), więc nie ucina jej przewijana tabela.
 */
export function Wybor({ id, label, items, value, onChange, onDalej, noneLabel, placeholder, invalid, disabled, pusto, autoFocus }: {
  id: string
  /** Nazwa dla czytnika ekranu i testów (pole w tabeli nie ma widocznej etykiety). */
  label: string
  items: WyborItem[]
  value: string
  onChange: (id: string) => void
  onDalej?: () => void
  /** Gdy podane — pusta wartość jest legalna i ma swoją pozycję na liście. */
  noneLabel?: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** Tekst pustej listy (np. „Najpierw wybierz rodzaj”). */
  pusto?: string
  autoFocus?: boolean
}) {
  const { appRef, scale } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const swiezyFocus = useRef(false)
  // null = pole pokazuje wybraną pozycję; tekst = operator właśnie wpisuje.
  const [q, setQ] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null)

  const all = useMemo<WyborItem[]>(() => (noneLabel ? [{ id: '', label: noneLabel }, ...items] : items), [items, noneLabel])
  const sel = all.find(i => i.id === value)
  const fraza = (q ?? '').trim().toLowerCase()
  const lista = useMemo(() => (fraza ? all.filter(i => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(fraza)) : all), [all, fraza])

  const rozwin = () => { if (disabled) return; setHi(Math.max(0, all.findIndex(i => i.id === value))); setOpen(true) }
  const zwin = () => { setOpen(false); setQ(null); setPos(null) }
  const wybierz = (it: WyborItem | undefined) => { if (!it) return; zwin(); onChange(it.id); onDalej?.() }

  useLayoutEffect(() => {
    if (!open) return
    const zmierz = () => {
      const el = inputRef.current
      if (!el) return
      const r = relRect(el, appRef.current, scale)
      const pod = r.appH - r.bottom - 12, nad = r.top - 12
      const wGore = pod < 180 && nad > pod
      const maxH = Math.max(120, Math.min(320, wGore ? nad : pod))
      const width = Math.max(r.width, MIN_LISTA)
      const h = Math.min(listRef.current?.scrollHeight ?? maxH, maxH)
      setPos({ left: Math.max(8, Math.min(r.left, r.appW - width - 8)), top: wGore ? r.top - 4 - h : r.bottom + 4, width, maxH })
    }
    zmierz()
    // Przewinięcie pod rozwiniętą listą zostawiłoby ją w powietrzu.
    window.addEventListener('scroll', zmierz, true)
    window.addEventListener('resize', zmierz)
    return () => { window.removeEventListener('scroll', zmierz, true); window.removeEventListener('resize', zmierz) }
  }, [open, lista.length, appRef, scale])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[data-hi]')?.scrollIntoView?.({ block: 'nearest' })
  }, [hi, open, fraza])

  const klawisz = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (!open) { rozwin(); break }
        const d = e.key === 'ArrowDown' ? 1 : -1
        setHi(h => Math.max(0, Math.min(lista.length - 1, h + d)))
        break
      }
      case 'Enter':
        if (e.ctrlKey || e.metaKey) return // Ctrl+Enter zapisuje cały formularz
        e.preventDefault()
        if (open) wybierz(lista[hi])
        else if (sel) onDalej?.()
        else rozwin()
        break
      case 'Escape':
        if (open || q !== null) { e.preventDefault(); e.stopPropagation(); zwin() }
        break
      case 'Tab':
        if (open && fraza && lista[hi]) onChange(lista[hi].id)
        zwin()
        break
    }
  }

  const listaId = `${id}-lista`
  return (
    <div className="wybor">
      <input ref={inputRef} id={id} className={`field${invalid ? ' invalid' : ''}`} role="combobox" aria-label={label}
        aria-expanded={open} aria-controls={listaId} aria-autocomplete="list" aria-invalid={invalid || undefined}
        aria-activedescendant={open && lista[hi] ? `${id}-o-${hi}` : undefined}
        autoComplete="off" spellCheck={false} autoFocus={autoFocus} disabled={disabled} placeholder={placeholder}
        value={q ?? sel?.label ?? ''} title={sel?.label}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true) }}
        onFocus={e => { e.currentTarget.select(); swiezyFocus.current = true }}
        // Klik w pole bez fokusu: zaznaczenie zostaje, więc pisanie zastępuje wybór zamiast dopisywać.
        onMouseUp={e => { if (swiezyFocus.current) e.preventDefault(); swiezyFocus.current = false }}
        onClick={() => (open ? zwin() : rozwin())}
        onBlur={zwin}
        onKeyDown={klawisz} />
      <ChevronDown size={15} className="wybor-ch" aria-hidden />
      {open && createPortal(
        <div ref={listRef} id={listaId} role="listbox" aria-label={label} className="wybor-lista"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width ?? MIN_LISTA, maxHeight: pos?.maxH ?? 320 }}>
          {lista.length ? lista.map((it, i) => (
            // Nazwa jawnie: podświetlenie (<mark>) rozbija tekst i czytnik czytałby „TES T”.
            <div key={it.id || '∅'} id={`${id}-o-${i}`} role="option" aria-label={it.sub ? `${it.label}, ${it.sub}` : it.label} aria-selected={it.id === value} data-hi={i === hi ? '' : undefined}
              onMouseDown={e => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => wybierz(it)}>
              <span className="wl"><Trafienie text={it.label} q={fraza} /></span>
              {it.sub && <span className="ws"><Trafienie text={it.sub} q={fraza} /></span>}
            </div>
          )) : <div className="wybor-pusto">{fraza ? 'Nic nie pasuje do wpisanego tekstu' : (pusto ?? 'Lista jest pusta')}</div>}
        </div>,
        appRef.current ?? document.body,
      )}
    </div>
  )
}
