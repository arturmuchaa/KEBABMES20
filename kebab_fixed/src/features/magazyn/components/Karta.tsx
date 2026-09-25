/**
 * Karta z nagłówkiem — ta sama co „Card" w masowni: szary pasek tytułu
 * wersalikami, biała treść. Wydzielona, bo magazyn ma jej kilkanaście.
 */
import type { ReactNode } from 'react'

export function Karta({ tytul, prawo, children, className = '', tresc = true }: {
  tytul: string
  prawo?: ReactNode
  children: ReactNode
  className?: string
  /** false = dzieci bez wewnętrznego odstępu (listy wierszy od krawędzi). */
  tresc?: boolean
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl ${className}`}
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="flex h-11 shrink-0 items-center gap-2.5 px-4"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
        <h2 className="m-0 text-[11px] font-extrabold uppercase tracking-[0.1em]"
          style={{ color: 'var(--mut)' }}>{tytul}</h2>
        {prawo ? <div className="ml-auto flex items-center gap-2 text-[12px]"
          style={{ color: 'var(--mut)' }}>{prawo}</div> : null}
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${tresc ? 'p-4' : ''}`}>{children}</div>
    </section>
  )
}

export function Znacznik({ ton, children }: {
  ton: 'ok' | 'uwaga' | 'akcja' | 'szary'
  children: ReactNode
}) {
  const s = ton === 'ok' ? { background: 'var(--successSoft)', color: '#15803D', border: '1px solid var(--successLine)' }
    : ton === 'uwaga' ? { background: 'var(--ambSoft)', color: 'var(--amb)', border: '1px solid var(--ambLine)' }
    : ton === 'akcja' ? { background: 'var(--accentSoft)', color: '#4338CA', border: '1px solid var(--accentLine)' }
    : { background: 'var(--bg)', color: 'var(--mut)', border: '1px solid var(--line)' }
  return (
    <span className="whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em]"
      style={s}>{children}</span>
  )
}
