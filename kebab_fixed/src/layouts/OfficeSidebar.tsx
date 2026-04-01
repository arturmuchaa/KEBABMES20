import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Beef, ClipboardList, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive, AlertTriangle,
  ChevronRight,
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
  { heading: 'Jakość', items: [
    { to: '/office/recall', label: 'Wycofanie (Recall)', icon: <AlertTriangle size={14} /> },
  ]},
  { heading: 'Administracja', items: [
    { to: '/office/pracownicy',  label: 'Pracownicy',  icon: <Users size={14} /> },
    { to: '/office/uzytkownicy', label: 'Użytkownicy', icon: <UserCog size={14} /> },
  ]},
]

const TABLET_LINKS = [
  { to: '/tablet/rozbior',   label: 'Rozbiór',   icon: <Scissors size={13} /> },
  { to: '/tablet/mieszanie', label: 'Masownia',  icon: <Layers size={13} /> },
  { to: '/tablet/produkcja', label: 'Produkcja', icon: <Monitor size={13} /> },
]

export function OfficeSidebar({ onClose }: { onClose?: () => void }) {
  const { pathname } = useLocation()

  return (
    <aside className="w-56 h-full flex flex-col bg-[#0F172A] border-r border-[#1E293B] overflow-y-auto scrollbar-thin">

      {/* Logo / Brand */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-[#1E293B] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <LayoutDashboard size={14} className="text-white" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-white leading-none">Kebab</div>
            <div className="text-[10px] font-medium text-blue-400 leading-none mt-0.5">MES v2.3</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#1E293B] transition-colors">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Dashboard link */}
      <div className="px-3 pt-3">
        <NavLink
          to="/office/dashboard"
          className={({ isActive }) => cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all',
            isActive
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-300 hover:bg-[#1E293B] hover:text-white'
          )}
        >
          <LayoutDashboard size={14} className="flex-shrink-0" />
          Dashboard
        </NavLink>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 pt-2 pb-3">
        {NAV.map(section => (
          <div key={section.heading} className="mt-5 first:mt-3">
            <div className="px-3 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {section.heading}
              </span>
            </div>
            <ul className="space-y-0.5">
              {section.items.map(item => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) => cn(
                      'group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all',
                      isActive
                        ? 'bg-[#1E3A5F] text-blue-300'
                        : 'text-slate-400 hover:bg-[#1E293B] hover:text-slate-200'
                    )}
                  >
                    <span className={cn(
                      'flex-shrink-0 transition-colors',
                      pathname === item.to ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
                    )}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {pathname === item.to && (
                      <ChevronRight size={11} className="text-blue-400 flex-shrink-0" />
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Tablet links */}
      <div className="px-3 py-3 border-t border-[#1E293B] flex-shrink-0">
        <div className="px-3 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Hala produkcyjna</span>
        </div>
        <div className="space-y-0.5">
          {TABLET_LINKS.map(item => (
            <a
              key={item.to}
              href={item.to}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium text-slate-500 hover:bg-[#1E293B] hover:text-slate-300 transition-all"
            >
              <span className="text-slate-600">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </aside>
  )
}
