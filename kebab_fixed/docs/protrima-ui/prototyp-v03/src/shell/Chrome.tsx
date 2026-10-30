import React, { useCallback, useEffect, useState } from 'react'
import { Search, Bell, X, LayoutGrid, Database, Minus, Square, ChevronDown, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { NAV_SECTIONS, moduleDef } from './modules'
import { Menu, useApp, type MenuItem } from './context'
import { DEMO_STAMP } from '../data/model'
import { Logo } from '../brand/Logo'

export interface WTab { id: string; kind: 'module' | 'order' | 'new-order'; key: string; title: string; icon?: LucideIcon }
export interface MenuDef { key: string; label: string; access: string; items: MenuItem[] }

const windowToast = (app: ReturnType<typeof useApp>) => app.toast({ kind: 'info', title: 'Przyciski okna działają w aplikacji Tauri', detail: 'W przeglądarce okno należy do przeglądarki.' })

// ─── Pas 1: pasek tytułu ──────────────────────────────────────────────────
export function TitleBar({ onPalette }: { onPalette: () => void }) {
  const app = useApp()
  return (
    <header className="titlebar">
      <div className="tb-brand" data-tip={'PROTRIMA — Production under control\nZnak z paczki grafika (Koncepcja 02)'}>
        <Logo height={26} />
        <span className="mes">MES</span>
      </div>
      <div className="tb-center">
        <button className="search-trigger" onClick={onPalette} aria-label="Szukaj lub wykonaj polecenie (Ctrl+K)">
          <Search size={15} /><span>Szukaj zamówienia, klienta, wyrobu, partii, polecenia…</span><span className="kbd">Ctrl K</span>
        </button>
      </div>
      <div className="tb-right">
        <button className="mb-plant hide-s" onClick={() => app.toast({ kind: 'info', title: 'Jeden zakład w demo', detail: 'PROTRIMA obsługuje wiele zakładów — tu przełącza się kontekst danych.' })} data-tip="Zakład i bieżąca zmiana">
          <span className="live" />Zakład główny<span className="muted hide-m">· Zmiana I</span><ChevronDown size={14} />
        </button>
        <button className="tb-btn" data-tip="Powiadomienia: 3 nowe (demo)" aria-label="Powiadomienia"><Bell size={18} /><span className="dot">3</span></button>
        <button className="tb-btn" data-tip="Użytkownik demonstracyjny" aria-label="Konto użytkownika"><span className="avatar">AN</span><span className="who hide-m"><b>Anna Nowak</b><small>Biuro</small></span></button>
        <div className="win" aria-label="Przyciski okna">
          <button onClick={() => windowToast(app)} aria-label="Minimalizuj" data-tip="Minimalizuj"><Minus size={16} /></button>
          <button onClick={() => windowToast(app)} aria-label="Maksymalizuj" data-tip="Maksymalizuj"><Square size={13} /></button>
          <button className="x" onClick={() => windowToast(app)} aria-label="Zamknij" data-tip="Zamknij"><X size={17} /></button>
        </div>
      </div>
    </header>
  )
}

/** Podkreśla literę skrótu Alt w etykiecie menu (widoczne po wciśnięciu Alt). */
function accessLabel(label: string, access: string) {
  const i = label.toLowerCase().indexOf(access.toLowerCase())
  if (i < 0) return label
  return <>{label.slice(0, i)}<u>{label[i]}</u>{label.slice(i + 1)}</>
}

// ─── Pas 2: menu ──────────────────────────────────────────────────────────
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const [altHeld, setAltHeld] = useState(false)
  const btns = React.useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    let altAlone = false
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !e.ctrlKey) { altAlone = true; setAltHeld(true); return }
      altAlone = false
      // Alt + litera otwiera menu (AltGr = Ctrl+Alt zostaje dla polskich znaków)
      if (e.altKey && !e.ctrlKey && /^[a-z]$/i.test(e.key)) {
        const i = menus.findIndex(m => m.access.toLowerCase() === e.key.toLowerCase())
        if (i >= 0) { e.preventDefault(); setOpen(i) }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAltHeld(false)
        if (altAlone && !document.querySelector('.dialog-wrap, .overlay')) { e.preventDefault(); btns.current[0]?.focus() }
        altAlone = false
      }
    }
    const blur = () => setAltHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [menus])

  const move = useCallback((d: number) => setOpen(o => o === null ? null : (o + d + menus.length) % menus.length), [menus.length])

  return (
    <nav className={`menubar${altHeld ? ' alt-held' : ''}`} role="menubar" aria-label="Menu główne">
      {menus.map((m, i) => (
        <button key={m.key} ref={el => { btns.current[i] = el }} role="menuitem" className="mb-item" aria-haspopup="menu" aria-expanded={open === i}
          onClick={() => setOpen(o => o === i ? null : i)} onMouseEnter={() => { if (open !== null && open !== i) setOpen(i) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(i) }
            if (e.key === 'ArrowRight') { e.preventDefault(); btns.current[(i + 1) % menus.length]?.focus() }
            if (e.key === 'ArrowLeft') { e.preventDefault(); btns.current[(i - 1 + menus.length) % menus.length]?.focus() }
          }}>
          {accessLabel(m.label, m.access)}
        </button>
      ))}
      {open !== null && btns.current[open] && (
        <Menu key={open} anchor={btns.current[open]!} items={menus[open].items} onClose={() => setOpen(null)} onLeft={() => move(-1)} onRight={() => move(1)} />
      )}
    </nav>
  )
}

// ─── Pas 3: klasyczny pasek narzędzi ──────────────────────────────────────
export interface ToolItem {
  id: string
  label?: string
  icon?: React.ReactNode
  kbd?: string
  tip?: string
  run?: () => void
  /** Menu rozwijane; z `split` główny przycisk wykonuje `run`, strzałka otwiera menu. */
  menu?: MenuItem[]
  split?: boolean
  primary?: boolean
  disabled?: boolean
  sep?: boolean
  grow?: boolean
}

export function MainToolbar({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState<{ id: string; el: Element } | null>(null)
  const toggle = (id: string, el: Element) => setOpen(o => o?.id === id ? null : { id, el })
  return (
    <div className="toolbar-main" role="toolbar" aria-label="Pasek narzędzi">
      {items.map(it => {
        if (it.sep) return <span key={it.id} className="tool-sep" />
        if (it.grow) return <span key={it.id} className="tool-grow" />
        const tip = [it.tip ?? it.label, it.kbd].filter(Boolean).join(' · ')
        const cls = `tbtn${it.primary ? ' primary' : ''}`
        if (it.split && it.menu) return (
          <span key={it.id} className="tsplit">
            <button className={cls} onClick={it.run} data-tip={tip} aria-label={it.label}>{it.icon}<span className="lbl">{it.label}</span></button>
            <button className={`${cls} arrow`} aria-label={`${it.label}: więcej`} aria-haspopup="menu" onClick={e => toggle(it.id, e.currentTarget)} data-tip="Więcej opcji"><ChevronDown size={14} /></button>
          </span>
        )
        return (
          <button key={it.id} className={cls} aria-disabled={it.disabled || undefined} data-tip={tip} aria-label={it.label} aria-haspopup={it.menu ? 'menu' : undefined}
            onClick={e => { if (it.disabled) return; if (it.menu) toggle(it.id, e.currentTarget); else it.run?.() }}>
            {it.icon}{it.label && <span className="lbl">{it.label}</span>}{it.menu && <ChevronDown size={14} className="chev" />}
          </button>
        )
      })}
      {open && <Menu anchor={open.el} align={items.findIndex(i => i.id === open.id) > items.findIndex(i => i.grow) && items.some(i => i.grow) ? 'right' : 'left'}
        items={items.find(i => i.id === open.id)?.menu ?? []} onClose={() => setOpen(null)} />}
    </div>
  )
}

// ─── Karty okien ──────────────────────────────────────────────────────────
export function TabStrip({ tabs, active, onActivate, onClose }: { tabs: WTab[]; active: string; onActivate: (id: string) => void; onClose: (id: string) => void }) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Otwarte okna">
      {tabs.map((t, i) => {
        const Icon = t.icon
        const closable = t.id !== 'pulpit'
        return (
          <div key={t.id} role="tab" tabIndex={0} aria-selected={t.id === active} className={`wtab${closable ? '' : ' pinned'}`}
            onClick={() => onActivate(t.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onActivate(t.id) }}
            onAuxClick={e => { if (e.button === 1 && closable) onClose(t.id) }}
            data-tip={`${t.title}${i < 9 ? `  ·  Ctrl+${i + 1}` : ''}${closable ? '\nZamknij: Ctrl+W lub środkowy przycisk' : ''}`}>
            {Icon && <Icon size={15} />}
            <span className="t">{t.title}</span>
            {closable && <button className="close" aria-label={`Zamknij ${t.title}`} onClick={e => { e.stopPropagation(); onClose(t.id) }}><X size={13} /></button>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Nawigacja ────────────────────────────────────────────────────────────
export function Nav({ current, onOpen, badges, collapsed, onToggle }: {
  current: string; onOpen: (key: string) => void; badges: Record<string, { n: number; level: 'crit' | 'warn' }>; collapsed: boolean; onToggle: () => void
}) {
  const Item = ({ k }: { k: string }) => {
    const m = moduleDef(k)!
    const Icon = m.icon
    const b = badges[k]
    return (
      <button className="nav-item" aria-current={current === k ? 'page' : undefined} onClick={() => onOpen(k)} data-tip={collapsed ? m.label : undefined}>
        <Icon size={17} /><span className="t">{m.label}</span>
        {b && <span className={`badge ${b.level}`}>{b.n}</span>}
      </button>
    )
  }
  return (
    <aside className="nav" aria-label="Moduły">
      <div className="nav-scroll">
        <button className="nav-item" aria-current={current === 'pulpit' ? 'page' : undefined} onClick={() => onOpen('pulpit')} data-tip={collapsed ? 'Pulpit zakładu' : undefined}>
          <LayoutGrid size={17} /><span className="t">Pulpit zakładu</span>
        </button>
        {NAV_SECTIONS.map(s => (
          <React.Fragment key={s.label}>
            <div className="nav-cap">{s.label}</div>
            {s.keys.map(k => <Item key={k} k={k} />)}
          </React.Fragment>
        ))}
      </div>
      <div className="nav-plant" data-tip="Zakład pracuje · zmiana I · 06:00–14:00">
        <div className="l1"><i /><span>Zakład pracuje</span></div>
        <div className="l2">Zmiana I · 06:00–14:00</div>
      </div>
      <button className="nav-toggle" onClick={onToggle} data-tip={collapsed ? 'Rozwiń panel (Ctrl+B)' : 'Zwiń panel (Ctrl+B)'} aria-label={collapsed ? 'Rozwiń panel nawigacji' : 'Zwiń panel nawigacji'}>
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span className="t">Zwiń panel</span>
      </button>
    </aside>
  )
}

// ─── Pasek stanu ──────────────────────────────────────────────────────────
export function StatusBar({ ctx, density, onDensity }: { ctx: React.ReactNode; density: 'comfortable' | 'compact'; onDensity: () => void }) {
  return (
    <footer className="statusbar">
      <span className="demo" data-tip={'Wszystkie dane są przykładowe i zamrożone w czasie.\nDemo nie łączy się z KEBABMES20 ani z bazą danych.'}><Database size={12} />Dane demonstracyjne</span>
      <span className="conn hide-s" data-tip="Integracja z API KEBABMES20 nie jest częścią demo"><i />Brak połączenia z serwerem — tryb podglądu</span>
      <span className="sep" />
      <span className="ctx">{ctx}</span>
      <span className="right">
        <span className="hide-m">Stan na {DEMO_STAMP}</span>
        <button className="hint" onClick={onDensity} data-tip="Gęstość dobierana do rozdzielczości. Kliknij, aby przełączyć ręcznie.">Gęstość: <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{density === 'compact' ? 'kompaktowa' : 'komfortowa'}</b></button>
        <span className="hide-m">PROTRIMA v0.3 demo</span>
      </span>
    </footer>
  )
}
