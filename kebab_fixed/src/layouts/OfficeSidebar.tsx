import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Beef, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: React.ReactNode }
interface NavSection { heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  { heading: 'Kontrahenci', items: [
    { to: '/office/dostawcy',    label: 'Dostawcy',    icon: <Truck size={14} /> },
    { to: '/office/kontrahenci', label: 'Kontrahenci', icon: <Building2 size={14} /> },
    { to: '/office/zamowienia',  label: 'Zamówienia',  icon: <ShoppingCart size={14} /> },
  ]},
  { heading: 'Zakupy', items: [
    { to: '/office/faktury', label: 'Faktury zakupowe', icon: <CreditCard size={14} /> },
  ]},
  { heading: 'Magazyny', items: [
    { to: '/office/raw-batches',         label: 'Przyjęcie ćwiartki',  icon: <Package size={14} /> },
    { to: '/office/magazyn/surowiec',    label: 'Surowiec',            icon: <Beef size={14} /> },
    { to: '/office/magazyn/przyprawy',   label: 'Przyprawy i dodatki', icon: <FlaskConical size={14} /> },
    { to: '/office/magazyn/mieso-przyp', label: 'Mięso przyprawione',  icon: <Beef size={14} /> },
    { to: '/office/magazyn/opakowania',  label: 'Opakowania/Tuleje',   icon: <Archive size={14} /> },
    { to: '/office/magazyn/gotowe',      label: 'Wyrób gotowy',        icon: <ShoppingBag size={14} /> },
  ]},
  { heading: 'Rozbiór', items: [
    { to: '/office/deboning',     label: 'Raporty rozbioru', icon: <BarChart2 size={14} /> },
    { to: '/office/haccp-report', label: 'Raport HACCP',     icon: <FileText size={14} /> },
  ]},
  { heading: 'Produkcja', items: [
    { to: '/office/rodzaje-produktow',    label: 'Rodzaje produktów', icon: <Package size={14} /> },
    { to: '/office/receptury',            label: 'Receptury',         icon: <BookOpen size={14} /> },
    { to: '/office/planowanie-masowania', label: 'Plan. masowania',   icon: <Layers size={14} /> },
    { to: '/office/planowanie-produkcji', label: 'Plan. produkcji',   icon: <Factory size={14} /> },
  ]},
  { heading: 'Administracja', items: [
    { to: '/office/pracownicy',  label: 'Pracownicy',  icon: <Users size={14} /> },
    { to: '/office/uzytkownicy', label: 'Użytkownicy', icon: <UserCog size={14} /> },
  ]},
]

const TABLET_LINKS = [
  { to: '/tablet/rozbior',   label: 'Tablet — Rozbiór',   icon: <Scissors size={13} /> },
  { to: '/tablet/mieszanie', label: 'Tablet — Masownia',  icon: <Layers size={13} /> },
  { to: '/tablet/produkcja', label: 'Tablet — Produkcja', icon: <Monitor size={13} /> },
]

export function OfficeSidebar({ onClose }: { onClose?: () => void }) {
  const { pathname } = useLocation()

  return (
    <aside className="w-56 h-full flex flex-col bg-sidebar-bg border-r border-sidebar-border overflow-y-auto scrollbar-sidebar">

      {/* ── Brand header ──────────────────────────────────── */}
      <div className="h-13 px-4 py-3 flex items-center justify-between border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 bg-gradient-to-br from-brand to-brand-dark rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
            <LayoutDashboard size={13} className="text-white" />
          </div>
          <div className="leading-none min-w-0">
            <div className="text-[13.5px] font-bold text-sidebar-text tracking-tight">
              Kebab <span className="text-brand">MES</span>
            </div>
            <div className="text-[9px] text-sidebar-heading font-semibold uppercase tracking-[0.07em] mt-[3px]">
              System produkcji
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-md hover:bg-sidebar-active text-sidebar-heading hover:text-sidebar-text transition-colors flex-shrink-0"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Dashboard ─────────────────────────────────────── */}
      <div className="px-3 pt-2.5">
        <NavLink
          to="/office/dashboard"
          className={({ isActive }) => cn(
            'relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
            isActive
              ? 'bg-brand text-white font-semibold shadow-sm'
              : 'text-sidebar-text hover:bg-sidebar-active hover:text-sidebar-text'
          )}
        >
          <LayoutDashboard size={14} className="flex-shrink-0" />
          <span>Dashboard</span>
        </NavLink>
      </div>

      {/* ── Navigation sections ───────────────────────────── */}
      <nav className="flex-1 px-3 pt-1 pb-2">
        {NAV.map(section => (
          <div key={section.heading} className="mt-5 first:mt-3">

            {/* Section heading with divider */}
            <div className="px-2 mb-1.5 flex items-center gap-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-sidebar-heading whitespace-nowrap">
                {section.heading}
              </span>
              <div className="flex-1 h-px bg-sidebar-border" />
            </div>

            <ul className="space-y-px">
              {section.items.map(item => {
                const isActive = pathname === item.to
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive: a }) => cn(
                        'relative flex items-center gap-2.5 pl-3 pr-2.5 py-[7px] rounded-lg text-[13px] transition-all duration-150',
                        a
                          ? 'bg-sidebar-active text-sidebar-text font-semibold'
                          : 'text-sidebar-text/80 hover:bg-sidebar-active hover:text-sidebar-text font-medium'
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 inset-y-0 w-[3px] bg-brand rounded-r-full my-1.5" />
                      )}
                      <span className={cn(
                        'flex-shrink-0 transition-colors',
                        isActive ? 'text-brand' : 'text-sidebar-heading'
                      )}>
                        {item.icon}
                      </span>
                      <span className="truncate leading-none">{item.label}</span>
                      {isActive && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Hala produkcyjna ──────────────────────────────── */}
      <div className="px-3 pb-3 pt-2.5 border-t border-sidebar-border flex-shrink-0">
        <div className="px-2 mb-1.5 flex items-center gap-2">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-sidebar-heading whitespace-nowrap">
            Hala produkcyjna
          </span>
          <div className="flex-1 h-px bg-sidebar-border" />
        </div>
        {TABLET_LINKS.map(item => (
          <a
            key={item.to}
            href={item.to}
            className="flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[12.5px] font-medium text-sidebar-heading hover:text-brand hover:bg-sidebar-active transition-all duration-150"
          >
            <span className="flex-shrink-0">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </a>
        ))}
      </div>

    </aside>
  )
}
