import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import {
  LayoutDashboard, Package, Beef, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive, GitBranch,
  ChevronLeft, ChevronRight, ChevronDown, Bone,
} from 'lucide-react'

interface NavItem    { to: string; label: string; icon: React.ReactNode }
interface NavSection { id: string; heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    id: 'kontrahenci', heading: 'Kontrahenci', items: [
      { to: '/office/dostawcy',    label: 'Dostawcy',    icon: <Truck size={13} /> },
      { to: '/office/kontrahenci', label: 'Kontrahenci', icon: <Building2 size={13} /> },
      { to: '/office/zamowienia',  label: 'Zamówienia',  icon: <ShoppingCart size={13} /> },
    ],
  },
  {
    id: 'zakupy', heading: 'Zakupy', items: [
      { to: '/office/faktury', label: 'Faktury zakupowe', icon: <CreditCard size={13} /> },
    ],
  },
  {
    id: 'magazyny', heading: 'Magazyny', items: [
      { to: '/office/raw-batches',              label: 'Przyjęcie ćwiartki', icon: <Package size={13} /> },
      { to: '/office/magazyn/surowiec',         label: 'Surowiec',           icon: <Beef size={13} /> },
      { to: '/office/magazyn/przyprawy',        label: 'Przyprawy',          icon: <FlaskConical size={13} /> },
      { to: '/office/magazyn/mieso-przyp',      label: 'Mięso przypr.',      icon: <Beef size={13} /> },
      { to: '/office/magazyn/opakowania',       label: 'Opakowania',         icon: <Archive size={13} /> },
      { to: '/office/magazyn/gotowe',           label: 'Wyrób gotowy',       icon: <ShoppingBag size={13} /> },
      { to: '/office/magazyn/produkty-uboczne', label: 'Prod. uboczne',      icon: <Bone size={13} /> },
    ],
  },
  {
    id: 'rozbior', heading: 'Rozbiór', items: [
      { to: '/office/deboning',     label: 'Raporty rozbioru', icon: <BarChart2 size={13} /> },
      { to: '/office/haccp-report', label: 'Raport HACCP',     icon: <FileText size={13} /> },
    ],
  },
  {
    id: 'produkcja', heading: 'Produkcja', items: [
      { to: '/office/rodzaje-produktow',    label: 'Rodzaje produktów', icon: <Package size={13} /> },
      { to: '/office/receptury',            label: 'Receptury',         icon: <BookOpen size={13} /> },
      { to: '/office/planowanie-masowania', label: 'Plan. masowania',   icon: <Layers size={13} /> },
      { to: '/office/planowanie-produkcji', label: 'Plan. produkcji',   icon: <Factory size={13} /> },
    ],
  },
  {
    id: 'traceability', heading: 'Traceability', items: [
      { to: '/office/traceability', label: 'Śledzenie partii', icon: <GitBranch size={13} /> },
    ],
  },
  {
    id: 'administracja', heading: 'Administracja', items: [
      { to: '/office/pracownicy',  label: 'Pracownicy',  icon: <Users size={13} /> },
      { to: '/office/uzytkownicy', label: 'Użytkownicy', icon: <UserCog size={13} /> },
    ],
  },
]

const TABLET_LINKS = [
  { to: '/tablet/rozbior',   label: 'Rozbiór',   icon: <Scissors size={13} /> },
  { to: '/tablet/mieszanie', label: 'Masownia',  icon: <Layers size={13} /> },
  { to: '/tablet/produkcja', label: 'Produkcja', icon: <Monitor size={13} /> },
]

// Sections open by default
const DEFAULT_OPEN = new Set(['magazyny', 'produkcja'])

interface OfficeSidebarProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
  onClose?: () => void
}

export function OfficeSidebar({ collapsed = false, onToggleCollapse, onClose }: OfficeSidebarProps) {
  const { pathname } = useLocation()

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set(DEFAULT_OPEN)
    for (const s of NAV) {
      if (s.items.some(i => pathname.startsWith(i.to))) initial.add(s.id)
    }
    return initial
  })

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <aside className={cn(
      'h-full flex flex-col bg-white border-r border-slate-100',
      'overflow-y-auto overflow-x-hidden scrollbar-thin transition-all duration-200',
      collapsed ? 'w-14' : 'w-[220px]',
    )}>

      {/* Logo row */}
      <div className={cn(
        'h-12 flex items-center justify-between flex-shrink-0 px-4',
        'border-b border-slate-100',
      )}>
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 bg-slate-900 rounded-lg flex items-center justify-center flex-shrink-0">
                <LayoutDashboard size={13} className="text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-[13px] font-bold text-slate-900 tracking-tight leading-none block">
                  Kebab <span className="text-brand">MES</span>
                </span>
                <span className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">v2.3.0</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {onClose && (
                <button onClick={onClose} className="md:hidden p-1 text-slate-400 hover:text-slate-700 rounded transition-colors">
                  <X size={14} />
                </button>
              )}
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  title="Zwiń panel"
                  className="hidden md:flex p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="w-full flex items-center justify-center gap-1">
            <div className="w-7 h-7 bg-slate-900 rounded-lg flex items-center justify-center">
              <LayoutDashboard size={13} className="text-white" />
            </div>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                title="Rozwiń panel"
                className="hidden md:flex p-0.5 text-slate-400 hover:text-brand transition-colors"
              >
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dashboard */}
      <div className="px-3 pt-3 pb-1">
        <NavLink
          to="/office/dashboard"
          title={collapsed ? 'Dashboard' : undefined}
          className={({ isActive }) => cn(
            'flex items-center rounded-lg text-[12.5px] font-medium transition-all',
            collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 py-2',
            isActive
              ? 'bg-slate-900 text-white'
              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
          )}
        >
          <LayoutDashboard size={14} className="flex-shrink-0" />
          {!collapsed && <span>Dashboard</span>}
        </NavLink>
      </div>

      {/* Accordion sections */}
      <nav className="flex-1 px-3 pb-2">
        {NAV.map(section => {
          const isOpen = openSections.has(section.id)
          const hasActive = section.items.some(i => pathname.startsWith(i.to))

          return (
            <div key={section.id} className="mt-1">
              {/* Section heading — clickable toggle */}
              {!collapsed ? (
                <button
                  onClick={() => toggleSection(section.id)}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md',
                    'text-[10px] font-bold uppercase tracking-widest transition-colors',
                    hasActive ? 'text-slate-700' : 'text-slate-400',
                    'hover:bg-slate-50 hover:text-slate-700',
                  )}
                >
                  <span>{section.heading}</span>
                  <ChevronDown
                    size={11}
                    className={cn('transition-transform duration-200 text-slate-400', isOpen ? 'rotate-0' : '-rotate-90')}
                  />
                </button>
              ) : (
                <div className="my-2 mx-2 border-t border-slate-100" />
              )}

              {/* Section items */}
              {(isOpen || collapsed) && (
                <ul className="space-y-0.5 mt-0.5">
                  {section.items.map(item => {
                    const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          title={collapsed ? item.label : undefined}
                          className={cn(
                            'flex items-center rounded-lg text-[12px] transition-all',
                            collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 py-1.5',
                            isActive
                              ? 'bg-slate-900 text-white font-semibold'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium',
                          )}
                        >
                          <span className="flex-shrink-0">{item.icon}</span>
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      {/* Tablet / Hala links */}
      <div className="px-3 py-3 border-t border-slate-100 flex-shrink-0">
        {!collapsed && (
          <div className="px-2.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Hala produkcyjna</span>
          </div>
        )}
        {TABLET_LINKS.map(item => (
          <a
            key={item.to}
            href={item.to}
            title={collapsed ? item.label : undefined}
            className={cn(
              'flex items-center rounded-lg text-[12px] font-medium text-slate-400 hover:text-brand hover:bg-slate-50 transition-colors',
              collapsed ? 'justify-center h-9 w-9 mx-auto my-0.5' : 'gap-2.5 px-2.5 py-1.5',
            )}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </a>
        ))}
      </div>
    </aside>
  )
}
