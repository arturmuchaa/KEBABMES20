/**
 * PageHeader — jeden, spójny nagłówek strony biura: tytuł + podtytuł + slot na
 * akcje/liczniki po prawej. Renderowany CENTRALNIE w OfficeLayout na podstawie
 * mapy PAGE_TITLES, więc KAŻDA strona (i każda nowa) dostaje go automatycznie,
 * bez edycji per-strona.
 *
 * Strona, która chce dołożyć po prawej licznik/przyciski, woła hook
 * `usePageHeaderActions(<...>, [deps])` — treść ląduje w slocie nagłówka.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// ── Prezentacja ──
export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode
}) {
  return (
    <div className="flex items-start gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="font-display text-[19px] font-bold text-ink leading-tight tracking-[-0.01em] truncate">{title}</h1>
        {subtitle && <p className="text-[13px] text-ink-3 mt-1 leading-snug">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2 flex-shrink-0 pt-0.5">{actions}</div>}
    </div>
  )
}

// ── Slot na akcje/liczniki (wstrzykiwane przez stronę) ──
interface Ctx { setActions: (node: ReactNode) => void }
const PageHeaderCtx = createContext<Ctx | null>(null)

export function PageHeaderProvider({ children }: { children: (actions: ReactNode) => ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  return (
    <PageHeaderCtx.Provider value={{ setActions }}>
      {children(actions)}
    </PageHeaderCtx.Provider>
  )
}

/** Wstrzyknij treść (licznik + przyciski) do slotu nagłówka strony.
 *  `deps` — jak w useEffect: podaj wartości, od których zależy treść. */
export function usePageHeaderActions(node: ReactNode, deps: ReadonlyArray<unknown>) {
  const ctx = useContext(PageHeaderCtx)
  useEffect(() => {
    ctx?.setActions(node)
    return () => ctx?.setActions(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
