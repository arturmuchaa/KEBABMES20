import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Beef, ClipboardList, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive, AlertTriangle,
  ChevronRight, Banknote, Settings, QrCode, Calculator,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: React.ReactNode }
interface NavSection { heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  { heading: 'Kontrahenci', items: [
    { to: '/office/dostawcy',    label: 'Dostawcy',    icon: <Truck size={14} /> },
    { to: '/office/kontrahenci', label: 'Kontrahenci', icon: <Building2 size={14} /> },
    { to: '/office/zamowienia',  label: 'Zamówienia',  icon: <ShoppingCart size={14} /> },
    { to: '/office/hdi',         label: 'Dokumenty HDI', icon: <FileText size={14} /> },
    { to: '/office/przewoznicy', label: 'Przewoźnicy',   icon: <Truck size={14} /> },
    { to: '/office/cmr',         label: 'Dokumenty CMR', icon: <FileText size={14} /> },
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
    { to: '/office/szablony-etykiet',     label: 'Szablony etykiet',  icon: <QrCode size={14} /> },
    { to: '/office/planowanie-masowania', label: 'Plan. masowania',   icon: <Layers size={14} /> },
    { to: '/office/planowanie-produkcji', label: 'Plan. produkcji',   icon: <Factory size={14} /> },
    { to: '/office/kalkulacja-kosztow',   label: 'Kalkulacja cen', icon: <Calculator size={14} /> },
  ]},
  { heading: 'Jakość', items: [
    { to: '/office/recall', label: 'Wycofanie (Recall)', icon: <AlertTriangle size={14} /> },
  ]},
  { heading: 'Administracja', items: [
    { to: '/office/pracownicy',  label: 'Pracownicy',    icon: <Users size={14} /> },
    { to: '/office/rozliczenia', label: 'Rozliczenia',   icon: <Banknote size={14} /> },
    { to: '/office/samochody',   label: 'Samochody',     icon: <Truck size={14} /> },
    { to: '/office/uzytkownicy', label: 'Użytkownicy',   icon: <UserCog size={14} /> },
    { to: '/office/ustawienia',  label: 'Ustawienia firmy', icon: <Settings size={14} /> },
  ]},
]

const TABLET_LINKS = [
  { to: '/tablet/rozbior',   label: 'Rozbiór',   icon: <Scissors size={13} /> },
  { to: '/tablet/mieszanie', label: 'Masownia',  icon: <Layers size={13} /> },
  { to: '/tablet/produkcja', label: 'Produkcja', icon: <Monitor size={13} /> },
  { to: '/mobile',           label: 'Skan QR palet', icon: <QrCode size={13} /> },
]

export function OfficeSidebar({ onClose }: { onClose?: () => void }) {
  const { pathname } = useLocation()

  return (
    <aside className="w-56 h-full flex flex-col bg-white border-r border-gray-200 overflow-y-auto scrollbar-thin">

      {/* Logo / Brand */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
            <LayoutDashboard size={14} className="text-white" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-gray-900 leading-none">Kebab</div>
            <div className="text-[10px] font-medium text-gray-400 leading-none mt-0.5">MES</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
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
              ? 'bg-black text-white'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
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
                        ? 'bg-black text-white'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <span className={cn(
                      'flex-shrink-0 transition-colors',
                      pathname === item.to ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'
                    )}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Tablet links */}
      <div className="px-3 py-3 border-t border-gray-200 flex-shrink-0">
        <div className="px-3 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Hala produkcyjna</span>
        </div>
        <div className="space-y-0.5">
          {TABLET_LINKS.map(item => (
            <a
              key={item.to}
              href={item.to}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all"
            >
              <span className="text-gray-400">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </aside>
  )
}
