import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, FlaskConical, GitBranch, ChevronRight,
  Package, Settings, Truck, Building2, ShoppingCart, CreditCard,
  Beef, Archive, ShoppingBag, Bone, Scissors, FileText,
  Box, BookOpen, Layers, Factory, Users, UserCog,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: React.ReactNode; badge?: string | number }
interface NavSection { heading?: string; items: NavItem[] }

const NAV: NavSection[] = [
  { items: [{ to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> }] },
  { heading: 'Kontrahenci', items: [
    { to: '/suppliers', label: 'Dostawcy',     icon: <Truck size={13} /> },
    { to: '/clients',   label: 'Kontrahenci',  icon: <Building2 size={13} /> },
    { to: '/orders',    label: 'Zamówienia',   icon: <ShoppingCart size={13} /> },
  ]},
  { heading: 'Zakupy', items: [
    { to: '/invoices',  label: 'Faktury zakupowe', icon: <CreditCard size={13} /> },
  ]},
  { heading: 'Magazyny', items: [
    { to: '/raw-batches',    label: 'Przyjęcie ćwiartki',  icon: <Package size={13} /> },
    { to: '/stock',          label: 'Surowiec',             icon: <Beef size={13} /> },
    { to: '/spice-stock',    label: 'Przyprawy i dodatki',  icon: <FlaskConical size={13} /> },
    { to: '/seasoned-meat',  label: 'Mięso przyprawione',   icon: <Beef size={13} /> },
    { to: '/packaging',      label: 'Opakowania/Tuleje',    icon: <Archive size={13} /> },
    { to: '/finished-goods', label: 'Wyrób gotowy',         icon: <ShoppingBag size={13} /> },
    { to: '/byproducts',     label: 'Produkty uboczne',     icon: <Bone size={13} /> },
  ]},
  { heading: 'Rozbiór', items: [
    { to: '/deboning',  label: 'Raporty rozbioru', icon: <Scissors size={13} /> },
    { to: '/haccp',     label: 'Raport HACCP',     icon: <FileText size={13} /> },
  ]},
  { heading: 'Produkcja', items: [
    { to: '/product-types',    label: 'Rodzaje produktów', icon: <Box size={13} /> },
    { to: '/recipes',          label: 'Receptury',         icon: <BookOpen size={13} /> },
    { to: '/mixing',           label: 'Plan. masowania',   icon: <Layers size={13} /> },
    { to: '/production-plans', label: 'Plan. produkcji',   icon: <Factory size={13} /> },
  ]},
  { heading: 'Traceability', items: [
    { to: '/traceability', label: 'Śledzenie partii', icon: <GitBranch size={13} /> },
  ]},
  { heading: 'Administracja', items: [
    { to: '/workers', label: 'Pracownicy',  icon: <Users size={13} /> },
    { to: '/users',   label: 'Użytkownicy', icon: <UserCog size={13} /> },
  ]},
]

export function Sidebar() {
  return (
    <aside className="w-56 h-full flex flex-col bg-sidebar-bg border-r border-sidebar-border shrink-0">
      {/* ── Brand block ──────────────────────────────────── */}
      <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-mes-accent flex items-center justify-center shadow-mes-glow">
            <span className="text-[12px] font-black text-white leading-none">M</span>
          </div>
          <div>
            <div className="text-[13px] font-bold text-white leading-tight">Kebab MES</div>
            <div className="text-[10px] text-sidebar-text leading-tight">Wersja 1.0.0</div>
          </div>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────── */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map((section, si) => (
          <div key={si} className={cn('mb-1', si > 0 && 'mt-4')}>
            {section.heading && (
              <div className="px-4 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-heading">
                  {section.heading}
                </span>
              </div>
            )}
            {section.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150',
                    isActive
                      ? 'bg-mes-accent/15 text-mes-accent-l ring-1 ring-mes-accent/20'
                      : 'text-sidebar-text hover:bg-sidebar-active hover:text-white'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn(
                      'shrink-0 transition-colors',
                      isActive ? 'text-mes-accent-l' : 'text-sidebar-heading group-hover:text-white'
                    )}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge != null && (
                      <span className="ml-auto text-[10px] bg-mes-accent text-white rounded-full px-1.5 py-0.5 font-bold">
                        {item.badge}
                      </span>
                    )}
                    {isActive && <ChevronRight size={12} className="text-mes-accent-l shrink-0" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* ── Bottom: settings link ────────────────────────── */}
      <div className="px-2 pb-3 border-t border-sidebar-border pt-3 shrink-0">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-mes-elevated text-white'
                : 'text-sidebar-heading hover:bg-sidebar-active hover:text-white'
            )
          }
        >
          <Settings size={14} /> Ustawienia
        </NavLink>
      </div>
    </aside>
  )
}
