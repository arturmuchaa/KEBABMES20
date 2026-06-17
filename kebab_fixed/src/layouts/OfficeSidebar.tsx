import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/AuthContext'
import {
  LayoutDashboard, Package, Beef, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive,
  Banknote, Settings, QrCode, Calculator, GitBranch, History, ChevronRight, ShieldCheck,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: React.ReactNode }
interface NavSection { heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  { heading: 'Kontrahenci', items: [
    { to: '/office/dostawcy',    label: 'Dostawcy',    icon: <Truck size={15} /> },
    { to: '/office/kontrahenci', label: 'Kontrahenci', icon: <Building2 size={15} /> },
    { to: '/office/zamowienia',  label: 'Zamówienia',  icon: <ShoppingCart size={15} /> },
    { to: '/office/hdi',         label: 'Dokumenty HDI', icon: <FileText size={15} /> },
    { to: '/office/wz',          label: 'Dokumenty WZ',  icon: <FileText size={15} /> },
    { to: '/office/przewoznicy', label: 'Przewoźnicy',   icon: <Truck size={15} /> },
    { to: '/office/cmr',              label: 'Dokumenty CMR',    icon: <FileText size={15} /> },
    { to: '/office/cmr-konfigurator', label: 'Konfigurator CMR', icon: <Settings size={15} /> },
  ]},
  { heading: 'Zakupy', items: [
    { to: '/office/faktury', label: 'Faktury zakupowe', icon: <CreditCard size={15} /> },
  ]},
  { heading: 'Magazyny', items: [
    { to: '/office/raw-batches',         label: 'Przyjęcie surowca',  icon: <Package size={15} /> },
    { to: '/office/magazyn/surowiec',    label: 'Surowiec',            icon: <Beef size={15} /> },
    { to: '/office/magazyn/przyprawy',   label: 'Przyprawy i dodatki', icon: <FlaskConical size={15} /> },
    { to: '/office/magazyn/mieso-przyp', label: 'Mięso przyprawione',  icon: <Beef size={15} /> },
    { to: '/office/magazyn/opakowania',  label: 'Opakowania/Tuleje',   icon: <Archive size={15} /> },
    { to: '/office/magazyn/gotowe',      label: 'Wyrób gotowy',        icon: <ShoppingBag size={15} /> },
  ]},
  { heading: 'Rozbiór', items: [
    { to: '/office/deboning',     label: 'Raporty rozbioru', icon: <BarChart2 size={15} /> },
    { to: '/office/haccp-report', label: 'Raport HACCP',     icon: <FileText size={15} /> },
  ]},
  { heading: 'Produkcja', items: [
    { to: '/office/rodzaje-produktow',    label: 'Rodzaje produktów', icon: <Package size={15} /> },
    { to: '/office/receptury',            label: 'Receptury',         icon: <BookOpen size={15} /> },
    { to: '/office/szablony-etykiet',     label: 'Szablony etykiet',  icon: <QrCode size={15} /> },
    { to: '/office/planowanie-masowania', label: 'Plan. masowania',   icon: <Layers size={15} /> },
    { to: '/office/historia-masowania',   label: 'Historia masowania', icon: <History size={15} /> },
    { to: '/office/historia-produkcji',   label: 'Historia produkcji', icon: <History size={15} /> },
    { to: '/office/planowanie-produkcji', label: 'Plan. produkcji',   icon: <Factory size={15} /> },
    { to: '/office/kalkulacja-kosztow',   label: 'Kalkulacja cen', icon: <Calculator size={15} /> },
  ]},
  { heading: 'Jakość', items: [
    { to: '/office/sledzenie', label: 'Śledzenie surowca', icon: <GitBranch size={15} /> },
  ]},
  { heading: 'Administracja', items: [
    { to: '/office/pracownicy',  label: 'Pracownicy',    icon: <Users size={15} /> },
    { to: '/office/rozliczenia', label: 'Rozliczenia',   icon: <Banknote size={15} /> },
    { to: '/office/samochody',   label: 'Samochody',     icon: <Truck size={15} /> },
    { to: '/office/uzytkownicy', label: 'Użytkownicy',   icon: <UserCog size={15} /> },
    { to: '/office/audyt',       label: 'Dziennik audytu', icon: <ShieldCheck size={15} /> },
    { to: '/office/ustawienia',  label: 'Ustawienia firmy', icon: <Settings size={15} /> },
  ]},
]

const TABLET_LINKS: NavItem[] = [
  { to: '/tablet/rozbior',   label: 'Rozbiór',   icon: <Scissors size={14} /> },
  { to: '/tablet/mieszanie', label: 'Masownia',  icon: <Layers size={14} /> },
  { to: '/tablet/produkcja', label: 'Produkcja', icon: <Monitor size={14} /> },
  { to: '/mobile',           label: 'Skan QR palet', icon: <QrCode size={14} /> },
]

// ─── Pozycja nawigacji z brandowym stanem aktywnym (pasek boczny) ───────
function SideItem({ to, icon, label }: NavItem) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        'group relative flex items-center gap-2.5 pl-3.5 pr-2.5 py-2 rounded-lg text-[13px] transition-colors duration-150',
        isActive
          ? 'bg-brand-light text-brand-dark font-semibold'
          : 'text-ink-3 font-medium hover:bg-surface-2 hover:text-ink',
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-brand transition-all duration-150',
            isActive ? 'h-5 opacity-100' : 'h-0 opacity-0',
          )} />
          <span className={cn('flex-shrink-0 transition-colors', isActive ? 'text-brand' : 'text-ink-4 group-hover:text-ink-2')}>
            {icon}
          </span>
          <span className="flex-1 truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

export function OfficeSidebar({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth()

  return (
    <aside className="w-56 h-full flex flex-col bg-white border-r border-surface-4 overflow-y-auto scrollbar-thin">

      {/* Brand */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-surface-4 flex-shrink-0 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center flex-shrink-0 shadow-sm">
            <Beef size={16} className="text-white" />
          </div>
          <div>
            <div className="text-[14px] font-extrabold text-ink leading-none tracking-tight">
              Kebab <span className="text-brand">MES</span>
            </div>
            <div className="text-[10px] font-medium text-ink-4 leading-none mt-1">System produkcji</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Zamknij menu"
            className="md:hidden p-1.5 rounded-md text-ink-4 hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Dashboard */}
      <div className="px-3 pt-3">
        <SideItem to="/office/dashboard" icon={<LayoutDashboard size={15} />} label="Dashboard" />
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 pt-1 pb-3">
        {NAV.map(section => (
          <div key={section.heading} className="mt-5 first:mt-4">
            <div className="px-3.5 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-4">
                {section.heading}
              </span>
            </div>
            <ul className="space-y-0.5">
              {section.items
                .filter(item => !['/office/uzytkownicy', '/office/audyt'].includes(item.to) || user?.role === 'admin')
                .map(item => <li key={item.to}><SideItem {...item} /></li>)}
            </ul>
          </div>
        ))}
      </nav>

      {/* Hala produkcyjna */}
      <div className="px-3 py-3 border-t border-surface-4 flex-shrink-0">
        <div className="px-3.5 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-4">Hala produkcyjna</span>
        </div>
        <div className="space-y-0.5">
          {TABLET_LINKS.map(item => (
            <a key={item.to} href={item.to}
              className="group flex items-center gap-2.5 pl-3.5 pr-2.5 py-2 rounded-lg text-[12.5px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
              <span className="text-ink-4 group-hover:text-ink-2 transition-colors flex-shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              <ChevronRight size={13} className="text-ink-5 group-hover:text-ink-3 transition-colors" />
            </a>
          ))}
        </div>
      </div>

      {/* Użytkownik */}
      {user && (
        <div className="px-3 py-3 border-t border-surface-4 flex-shrink-0">
          <div className="flex items-center gap-2.5 px-1.5">
            <div className="w-8 h-8 rounded-full bg-brand-light border border-brand-border text-brand flex items-center justify-center text-[12px] font-bold flex-shrink-0">
              {initialsOf(user.name)}
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-ink truncate leading-tight">{user.name}</div>
              <div className="text-[10px] text-ink-4 capitalize leading-tight">{user.role === 'admin' ? 'Administrator' : (user.role || 'Biuro')}</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
