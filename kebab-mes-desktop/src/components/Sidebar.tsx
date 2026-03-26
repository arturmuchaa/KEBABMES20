import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, FlaskConical, GitBranch,
  Package, Settings, ChevronRight,
} from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  badge?: string | number
}

interface NavSection {
  heading?: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: <LayoutDashboard size={15} />,
      },
    ],
  },
  {
    heading: 'Produkcja',
    items: [
      {
        to: '/mixing',
        label: 'Masowanie',
        icon: <FlaskConical size={15} />,
      },
    ],
  },
  {
    heading: 'Jakość',
    items: [
      {
        to: '/traceability',
        label: 'Traceability',
        icon: <GitBranch size={15} />,
      },
    ],
  },
  {
    heading: 'Magazyn',
    items: [
      {
        to: '/stock',
        label: 'Stany magazynowe',
        icon: <Package size={15} />,
      },
    ],
  },
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
