import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Beef, ClipboardList, BookOpen,
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
      { to: '/office/dostawcy',    label: 'Dostawcy',    icon: <Truck size={15} /> },
      { to: '/office/kontrahenci', label: 'Kontrahenci', icon: <Building2 size={15} /> },
      { to: '/office/zamowienia',  label: 'Zamówienia',  icon: <ShoppingCart size={15} /> },
    ],
  },
  {
    heading: 'Zakupy', items: [
      { to: '/office/faktury', label: 'Faktury zakupowe', icon: <CreditCard size={15} /> },
    ],
  },
  {
    heading: 'Magazyny', items: [
      { to: '/office/raw-batches',               label: 'Przyjęcie ćwiartki',  icon: <Package size={15} /> },
      { to: '/office/magazyn/surowiec',          label: 'Surowiec',            icon: <Beef size={15} /> },
      { to: '/office/magazyn/przyprawy',         label: 'Przyprawy',           icon: <FlaskConical size={15} /> },
      { to: '/office/magazyn/mieso-przyp',       label: 'Mięso przyprawione',  icon: <Beef size={15} /> },
      { to: '/office/magazyn/opakowania',        label: 'Opakowania',          icon: <Archive size={15} /> },
      { to: '/office/magazyn/gotowe',            label: 'Wyrób gotowy',        icon: <ShoppingBag size={15} /> },
      { to: '/office/magazyn/produkty-uboczne',  label: 'Produkty uboczne',    icon: <Bone size={15} /> },
    ],
  },
  {
    heading: 'Rozbiór', items: [
      { to: '/office/deboning',     label: 'Raporty rozbioru', icon: <BarChart2 size={15} /> },
      { to: '/office/haccp-report', label: 'Raport HACCP',     icon: <FileText size={15} /> },
    ],
  },
  {
    heading: 'Produkcja', items: [
      { to: '/office/rodzaje-produktow',    label: 'Rodzaje produktów', icon: <Package size={15} /> },
      { to: '/office/receptury',            label: 'Receptury',         icon: <BookOpen size={15} /> },
      { to: '/office/planowanie-masowania', label: 'Plan. masowania',   icon: <Layers size={15} /> },
      { to: '/office/planowanie-produkcji', label: 'Plan. produkcji',   icon: <Factory size={15} /> },
    ],
  },
  {
    heading: 'Traceability', items: [
      { to: '/office/traceability', label: 'Śledzenie partii', icon: <GitBranch size={15} /> },
    ],
  },
  {
    heading: 'Administracja', items: [
      { to: '/office/pracownicy',  label: 'Pracownicy',  icon: <Users size={15} /> },
      { to: '/office/uzytkownicy', label: 'Użytkownicy', icon: <UserCog size={15} /> },
    ],
  },
]

const TABLET_LINKS = [
  { to: '/tablet/rozbior',   label: 'Rozbiór',  icon: <Scissors size={14} /> },
  { to: '/tablet/mieszanie', label: 'Masownia', icon: <Layers size={14} /> },
  { to: '/tablet/produkcja', label: 'Produkcja', icon: <Monitor size={14} /> },
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
      'h-full flex flex-col bg-sidebar-bg border-r border-sidebar-border overflow-y-auto overflow-x-hidden scrollbar-thin transition-all duration-200',
      collapsed ? 'w-14' : 'w-56',
    )}>
      {/* Logo + collapse toggle */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-sidebar-border flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 bg-brand rounded-lg flex items-center justify-center flex-shrink-0">
              <LayoutDashboard size={12} className="text-white" />
            </div>
            <div className="min-w-0">
              <span className="text-[13px] font-bold text-white tracking-tight leading-none block">
                Kebab <span className="text-brand">MES</span>
              </span>
              <span className="text-[9px] font-medium text-sidebar-heading uppercase tracking-widest">v2.2.0</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-6 h-6 bg-brand rounded-lg flex items-center justify-center mx-auto">
            <LayoutDashboard size={12} className="text-white" />
          </div>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Mobile close */}
          {onClose && (
            <button onClick={onClose} className="md:hidden p-1 text-sidebar-heading hover:text-white rounded transition-colors">
              <X size={15} />
            </button>
          )}
          {/* Desktop collapse toggle */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="hidden md:flex p-1 text-sidebar-heading hover:text-white hover:bg-sidebar-active rounded transition-colors"
              title={collapsed ? 'Rozwiń panel' : 'Zwiń panel'}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Dashboard link */}
      <div className="px-2 pt-2 pb-1">
        <NavLink
          to="/office/dashboard"
          title={collapsed ? 'Dashboard' : undefined}
          className={({ isActive }) => cn(
            'flex items-center rounded-lg text-[13px] font-medium transition-colors relative group',
            collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 py-1.5',
            isActive
              ? 'bg-brand/15 text-brand border-l-2 border-brand pl-[9px]'
              : 'text-sidebar-text hover:bg-sidebar-active hover:text-white border-l-2 border-transparent',
          )}
        >
          <LayoutDashboard size={15} className="flex-shrink-0" />
          {!collapsed && <span>Dashboard</span>}
        </NavLink>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-2 pb-2">
        {NAV.map(section => (
          <div key={section.heading} className="mt-4 first:mt-1">
            {!collapsed && (
              <div className="px-2.5 mb-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-sidebar-heading">
                  {section.heading}
                </span>
              </div>
            )}
            {collapsed && <div className="my-2 border-t border-sidebar-border" />}
            <ul className="space-y-0.5">
              {section.items.map(item => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) => cn(
                      'flex items-center rounded-lg text-[12px] transition-colors relative group',
                      collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2.5 py-1.5',
                      isActive
                        ? 'bg-brand/15 text-brand font-semibold border-l-2 border-brand pl-[9px]'
                        : 'text-sidebar-text hover:bg-sidebar-active hover:text-white font-medium border-l-2 border-transparent',
                    )}
                  >
                    <span className={cn('flex-shrink-0', pathname === item.to ? 'text-brand' : '')}>
                      {item.icon}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Tablet links */}
      <div className="px-2 py-3 border-t border-sidebar-border flex-shrink-0">
        {!collapsed && (
          <div className="px-2.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-sidebar-heading">Hala</span>
          </div>
        )}
        {collapsed && <div className="mb-1 border-t border-sidebar-border" />}
        {TABLET_LINKS.map(item => (
          <a
            key={item.to}
            href={item.to}
            title={collapsed ? item.label : undefined}
            className={cn(
              'flex items-center rounded-lg text-[12px] font-medium text-sidebar-heading hover:text-brand hover:bg-sidebar-active transition-colors',
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
