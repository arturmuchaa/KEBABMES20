import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, CheckCircle2, Info, AlertTriangle } from 'lucide-react'

export type ViewKey = 'active' | 'urgent' | 'risk' | 'ready' | 'drafts' | 'closed'
export type DetailTab = 'overview' | 'lines' | 'production' | 'coverage' | 'pallets' | 'shipping' | 'documents' | 'history'

export interface OrdersCmd { n: number; view?: ViewKey; select?: string; tab?: DetailTab; bucket?: string }

export interface Toast { id: number; title: string; detail?: string; kind?: 'ok' | 'info' | 'warn' }

export interface AppApi {
  openOrder(id: string): void
  gotoOrders(cmd?: Omit<OrdersCmd, 'n'>): void
  gotoStock(select?: string): void
  openModule(key: string): void
  newOrder(): void
  toast(t: Omit<Toast, 'id'>): void
  setStatusCtx(node: React.ReactNode): void
  appRef: React.RefObject<HTMLDivElement>
  scale: number
  /** Widok prosty: mniej przycisków, kolumn i zakładek (domyślny). */
  prosty: boolean
  /** Gdzie stoi panel szczegółów pod listą: na dole albo z boku (po rozstrzygnięciu „automatycznie”). */
  panel: 'dol' | 'bok'
  panelWybor: PanelWybor
  setPanel(p: PanelWybor): void
}
export type PanelWybor = 'auto' | 'dol' | 'bok'

export const AppCtx = createContext<AppApi>(null as unknown as AppApi)
export const useApp = () => useContext(AppCtx)

/** Pozycja względem okna aplikacji (działa też, gdy aplikacja jest skalowana). */
export function relRect(el: Element, app: HTMLElement | null, scale: number) {
  const r = el.getBoundingClientRect()
  const a = app?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
  return {
    left: (r.left - a.left) / scale, top: (r.top - a.top) / scale,
    right: (r.right - a.left) / scale, bottom: (r.bottom - a.top) / scale,
    width: r.width / scale, height: r.height / scale,
    appW: a.width / scale, appH: a.height / scale,
  }
}

// ─── Menu kontekstowe / rozwijane ─────────────────────────────────────────
export interface MenuItem { label?: React.ReactNode; icon?: React.ReactNode; kbd?: string; danger?: boolean; onSelect?: () => void; header?: string; sep?: boolean; disabled?: boolean; checked?: boolean }

export function Menu({ anchor, items, onClose, align = 'left', onLeft, onRight }: { anchor: Element; items: MenuItem[]; onClose: () => void; align?: 'left' | 'right'; onLeft?: () => void; onRight?: () => void }) {
  const { appRef, scale } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const r = relRect(anchor, appRef.current, scale)
    const w = ref.current?.offsetWidth ?? 240
    const h = ref.current?.offsetHeight ?? 200
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, r.appW - w - 8))
    let top = r.bottom + 4
    if (top + h > r.appH - 8) top = Math.max(8, r.top - h - 4)
    setPos({ left, top })
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [anchor, align, appRef, scale])
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'ArrowLeft' && onLeft) { e.preventDefault(); e.stopPropagation(); onLeft() }
      if (e.key === 'ArrowRight' && onRight) { e.preventDefault(); e.stopPropagation(); onRight() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]
        const i = bs.indexOf(document.activeElement as HTMLButtonElement)
        bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus()
      }
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [anchor, onClose, onLeft, onRight])
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos?.left ?? -999, top: pos?.top ?? -999 }}>
      {items.map((it, i) => it.sep ? <hr key={i} /> : it.header ? <div key={i} className="mh">{it.header}</div> : (
        <button key={i} role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} disabled={it.disabled} className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.onSelect?.() }}>
          {it.checked !== undefined && <span className="ck">{it.checked ? '✓' : ''}</span>}{it.icon}{it.label}{it.kbd && <span className="kbd">{it.kbd}</span>}
        </button>
      ))}
    </div>
  )
}

/** Prawy przycisk na wierszu listy: id wiersza (`data-id`) i komórka jako zaczep menu. */
export function wierszMenu(e: React.MouseEvent): { id: string; anchor: Element } | null {
  const tr = (e.target as Element).closest('tr[data-id]')
  if (!tr) return null
  e.preventDefault()
  return { id: tr.getAttribute('data-id') ?? '', anchor: (e.target as Element).closest('td') ?? tr }
}

/** Hook: przycisk + menu. */
export function useMenu() {
  const [anchor, setAnchor] = useState<Element | null>(null)
  return {
    anchor,
    open: (e: React.MouseEvent | { currentTarget: Element }) => { const t = e.currentTarget as Element; setAnchor(a => a === t ? null : t) },
    close: () => setAnchor(null),
  }
}

// ─── Okno dialogowe ───────────────────────────────────────────────────────
export function Dialog({ title, icon, children, footer, onClose, wide, labelledBy }: {
  title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void; wide?: boolean; labelledBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('.dialog-f .btn.primary, .dialog-f .btn')
    first?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.hasAttribute('disabled'))
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus() }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); prev?.focus?.() }
  }, [onClose])
  const id = labelledBy ?? 'dlg-title'
  return (
    <div className="dialog-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="dialog-h">{icon}<h2 id={id}>{title}</h2><button className="btn ghost icon x" onClick={onClose} aria-label="Zamknij (Esc)"><X size={18} /></button></div>
        <div className="dialog-b">{children}</div>
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>
  )
}

// ─── Powiadomienia ────────────────────────────────────────────────────────
export function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className="toast">
          {t.kind === 'warn' ? <AlertTriangle size={18} color="var(--warn)" /> : t.kind === 'info' ? <Info size={18} color="var(--accent)" /> : <CheckCircle2 size={18} color="var(--ok)" />}
          <div><div className="ti">{t.title}</div>{t.detail && <div className="td">{t.detail}</div>}</div>
          <button className="x" onClick={() => dismiss(t.id)} aria-label="Zamknij powiadomienie"><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}

// ─── Podpowiedzi: atrybut data-tip na dowolnym elemencie ──────────────────
export function TooltipLayer() {
  const { appRef, scale } = useApp()
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer = 0
    const show = (e: Event) => {
      const el = (e.target as Element)?.closest?.('[data-tip]')
      window.clearTimeout(timer)
      if (!el) { setTip(null); return }
      timer = window.setTimeout(() => {
        const r = relRect(el, appRef.current, scale)
        setTip({ text: el.getAttribute('data-tip') ?? '', left: r.left, top: r.bottom + 6 })
      }, 380)
    }
    const hide = () => { window.clearTimeout(timer); setTip(null) }
    document.addEventListener('mouseover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('mousedown', hide)
    document.addEventListener('keydown', hide)
    return () => { document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show); document.removeEventListener('mousedown', hide); document.removeEventListener('keydown', hide) }
  }, [appRef, scale])
  useLayoutEffect(() => {
    if (!tip || !ref.current) return
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight
    const appW = (appRef.current?.getBoundingClientRect().width ?? window.innerWidth) / scale
    const appH = (appRef.current?.getBoundingClientRect().height ?? window.innerHeight) / scale
    const left = Math.max(8, Math.min(tip.left, appW - w - 8))
    const top = tip.top + h > appH - 8 ? tip.top - h - 30 : tip.top
    if (left !== tip.left || top !== tip.top) setTip({ ...tip, left, top })
  }, [tip, appRef, scale])
  if (!tip?.text) return null
  return <div ref={ref} className="tip" role="tooltip" style={{ left: tip.left, top: tip.top, whiteSpace: 'pre-line' }}>{tip.text}</div>
}


// ─── Pasek narzędzi modułu ────────────────────────────────────────────────
/**
 * Polecenie istnieje raz: ten sam obiekt trafia na pasek narzędzi modułu,
 * do menu modułu w pasku menu i pod skrót klawiszowy.
 */
export interface Cmd {
  id: string
  label: string
  icon?: React.ReactNode
  kbd?: string
  run?: () => void
  disabled?: boolean
  tip?: string
  primary?: boolean
  /** Etykieta chowa się przy gęstości kompaktowej (zostaje ikona z podpowiedzią). */
  opt?: boolean
  menu?: MenuItem[]
  group: number
  /** Tylko w menu, nie na pasku. */
  menuOnly?: boolean
  danger?: boolean
}

export function CommandBar({ title, count, icon, cmds, right }: { title: string; count?: React.ReactNode; icon?: React.ReactNode; cmds: Cmd[]; right?: React.ReactNode }) {
  const [open, setOpen] = useState<{ id: string; el: Element } | null>(null)
  const { prosty } = useApp()
  // Widok prosty: na pasku tylko główne polecenia; reszta zostaje w menu modułu i pod skrótami.
  const visible = cmds.filter(c => !c.menuOnly && !(prosty && c.opt))
  return (
    <div className="cmdbar" role="toolbar" aria-label={`Polecenia: ${title}`}>
      <div className="cmd-title">{icon}<h1>{title}</h1>{count !== undefined && <small>{count}</small>}</div>
      {visible.map((c, i) => (
        <React.Fragment key={c.id}>
          {i > 0 && visible[i - 1].group !== c.group && <span className="cmd-sep" />}
          <button className={`cmd${c.primary ? ' primary' : ''}`} aria-disabled={c.disabled || undefined}
            data-tip={c.disabled ? `${c.label}: ${c.tip ?? 'wybierz pozycję na liście'}` : [c.opt ? c.label : null, c.tip, c.kbd].filter(Boolean).join(' · ') || undefined}
            aria-haspopup={c.menu ? 'menu' : undefined} aria-label={c.label}
            onClick={e => { if (c.disabled) return; if (c.menu) { const el = e.currentTarget; setOpen(o => o?.id === c.id ? null : { id: c.id, el }) } else c.run?.() }}>
            {c.icon}<span className={`lbl${c.opt ? ' opt' : ''}`}>{c.label}</span>{c.menu && <ChevronDownSmall />}
          </button>
        </React.Fragment>
      ))}
      <span className="cmd-grow" />
      {right}
      {open && <Menu anchor={open.el} items={cmds.find(c => c.id === open.id)?.menu ?? []} onClose={() => setOpen(null)} />}
    </div>
  )
}
const ChevronDownSmall = () => <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
