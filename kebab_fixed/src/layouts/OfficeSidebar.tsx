import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Beef, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive, GitBranch,
  ChevronLeft, ChevronRight, Bone,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: React.ReactNode }
interface NavSection { heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    heading: 'Kontrahenci', items: [
      { to: '/office/dostawcy',    label: 'Dostawcy',    icon: <Truck size={14} /> },
      { to: '/office/kontrahenci', label: 'Kontrahenci', icon: <Building2 size={14} /> },
      { to: '/office/zamowienia',  label: 'Zamówienia',  icon: <ShoppingCart size={14} /> },
    ],
  },
  {
    heading: 'Zakupy', items: [
      { to: '/office/faktury', label: 'Faktury zakupowe', icon: <CreditCard size={14} /> },
    ],
  },
  {
    heading: 'Magazyny', items: [
      { to: '/office/raw-batches',              label: 'Przyjęcie ćwiartki', icon: <Package size={14} /> },
      { to: '/office/magazyn/surowiec',         label: 'Surowiec',           icon: <Beef size={14} /> },
      { to: '/office/magazyn/przyprawy',        label: 'Przyprawy',          icon: <FlaskConical size={14} /> },
      { to: '/office/magazyn/mieso-przyp',      label: 'Mięso przypr.',      icon: <Beef size={14} /> },
      { to: '/office/magazyn/opakowania',       label: 'Opakowania',         icon: <Archive size={14} /> },
      { to: '/office/magazyn/gotowe',           label: 'Wyrób gotowy',       icon: <ShoppingBag size={14} /> },
      { to: '/office/magazyn/produkty-uboczne', label: 'Prod. uboczne',      icon: <Bone size={14} /> },
    ],
  },
  {
    heading: 'Rozbiór', items: [
      { to: '/office/deboning',     label: 'Raporty rozbioru', icon: <BarChart2 size={14} /> },
      { to: '/office/haccp-report', label: 'Raport HACCP',     icon: <FileText size={14} /> },
    ],
  },
  {
    heading: 'Produkcja', items: [
      { to: '/office/rodzaje-produktow',    label: 'Rodzaje produktów', icon: <Package size={14} /> },
      { to: '/office/receptury',            label: 'Receptury',         icon: <BookOpen size={14} /> },
      { to: '/office/planowanie-masowania', label: 'Plan. masowania',   icon: <Layers size={14} /> },
      { to: '/office/planowanie-produkcji', label: 'Plan. produkcji',   icon: <Factory size={14} /> },
    ],
  },
  {
    heading: 'Traceability', items: [
      { to: '/office/traceability', label: 'Śledzenie partii', icon: <GitBranch size={14} /> },
    ],
  },
  {
    heading: 'Administracja', items: [
      { to: '/office/pracownicy',  label: 'Pracownicy',  icon: <Users size={14} /> },
      { to: '/office/uzytkownicy', label: 'Użytkownicy', icon: <UserCog size={14} /> },
    ],
  },
]

const TABLET_LINKS = [
  { to: '/tablet/rozbior',   label: 'Rozbiór',   icon: <Scissors size={13} /> },
  { to: '/tablet/mieszanie', label: 'Masownia',  icon: <Layers size={13} /> },
  { to: '/tablet/produkcja', label: 'Produkcja', icon: <Monitor size={13} /> },
]

interface OfficeSidebarProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
  onClose?: () => void
}

export function OfficeSidebar({ collapsed = false, onToggleCollapse, onClose }: OfficeSidebarProps) {
  const { pathname } = useLocation()

  return (
    <aside className={cn(
      'h-full flex flex-col bg-sidebar-bg border-r border-sidebar-border',
      'overflow-y-auto overflow-x-hidden scrollbar-thin transition-all duration-200',
      collapsed ? 'w-14' : 'w-56',
    )}>

      {/* Logo row */}
      <div className="h-11 px-3 flex items-center justify-between border-b border-sidebar-border flex-shrink-0">
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 bg-brand rounded-lg flex items-center justify-center flex-shrink-0">
                <LayoutDashboard size={12} className="text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-[13px] font-bold text-ink tracking-tight leading-none block">
                  Kebab <span className="text-brand">MES</span>
                </span>
                <span className="text-[9px] font-medium text-ink-4 uppercase tracking-widest">v2.2.0</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {onClose && (
                <button onClick={onClose} className="md:hidden p-1 text-ink-4 hover:text-ink rounded transition-colors">
                  <X size={14} />
                </button>
              )}
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  title="Zwiń panel"
                  className="hidden md:flex p-1 text-ink-4 hover:text-ink hover:bg-surface-3 rounded transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="w-full flex items-center justify-center gap-1">
            <div className="w-6 h-6 bg-brand rounded-lg flex items-center justify-center">
              <LayoutDashboard size={12} className="text-white" />
            </div>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                title="Rozwiń panel"
                className="hidden md:flex p-0.5 text-ink-4 hover:text-brand transition-colors"
              >
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dashboard */}
      <div className="px-2 pt-2 pb-1">
        <NavLink
          to="/office/dashboard"
          title={collapsed ? 'Dashboard' : undefined}
          className={({ isActive }) => cn(
            'flex items-center rounded-lg text-[13px] font-medium transition-colors',
            collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 py-1.5',
            isActive
              ? 'bg-sidebar-active text-brand font-semibold'
              : 'text-sidebar-text hover:bg-surface-3 hover:text-ink',
          )}
        >
          <LayoutDashboard size={14} className={cn('flex-shrink-0', pathname === '/office/dashboard' ? 'text-brand' : '')} />
          {!collapsed && <span>Dashboard</span>}
        </NavLink>
      </div>

      {/* Sections */}
      <nav className="flex-1 px-2 pb-2">
        {NAV.map(section => (
          <div key={section.heading} className="mt-3 first:mt-1">
            {!collapsed ? (
              <div className="px-2.5 mb-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-ink-4">
                  {section.heading}
                </span>
              </div>
            ) : (
              <div className="my-1.5 mx-2 border-t border-surface-4" />
            )}
            <ul className="space-y-0.5">
              {section.items.map(item => {
                const isActive = pathname === item.to
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) => cn(
                        'flex items-center rounded-lg text-[12px] transition-colors',
                        collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 py-1.5',
                        isActive
                          ? 'bg-sidebar-active text-brand font-semibold'
                          : 'text-sidebar-text hover:bg-surface-3 hover:text-ink font-medium',
                      )}
                    >
                      <span className={cn('flex-shrink-0', isActive ? 'text-brand' : '')}>{item.icon}</span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Tablet links */}
      <div className="px-2 py-3 border-t border-sidebar-border flex-shrink-0">
        {!collapsed && (
          <div className="px-2.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-ink-4">Hala</span>
          </div>
        )}
        {TABLET_LINKS.map(item => (
          <a
            key={item.to}
            href={item.to}
            title={collapsed ? item.label : undefined}
            className={cn(
              'flex items-center rounded-lg text-[12px] font-medium text-ink-4 hover:text-brand hover:bg-brand-light transition-colors',
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
