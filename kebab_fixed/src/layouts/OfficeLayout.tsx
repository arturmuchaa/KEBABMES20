import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { OfficeSidebar } from './OfficeSidebar'
import { useState, useEffect } from 'react'
import { Menu, X, Wifi, WifiOff, Plus, Package, Scissors, Factory, Truck, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Page title map ─────────────────────────────────────────────
const PAGE_TITLES: Record<string, string> = {
  '/office/dashboard':                'Dashboard',
  '/office/faktury':                  'Faktury i WZ',
  '/office/dostawcy':                 'Dostawcy',
  '/office/kontrahenci':              'Kontrahenci',
  '/office/zamowienia':               'Zamówienia',
  '/office/raw-batches':              'Przyjęcie ćwiartki',
  '/office/magazyn/surowiec':         'Magazyn — Surowiec',
  '/office/magazyn/przyprawy':        'Magazyn — Przyprawy i dodatki',
  '/office/magazyn/gotowe':           'Magazyn — Wyrób gotowy',
  '/office/magazyn/mieso-przyp':      'Magazyn — Mięso przyprawione',
  '/office/magazyn/opakowania':       'Magazyn — Opakowania',
  '/office/magazyn/produkty-uboczne': 'Magazyn — Produkty uboczne',
  '/office/deboning':                 'Raporty rozbioru',
  '/office/haccp-report':             'Raport HACCP',
  '/office/rodzaje-produktow':        'Rodzaje produktów',
  '/office/receptury':                'Receptury',
  '/office/planowanie-masowania':     'Planowanie masowania',
  '/office/planowanie-produkcji':     'Planowanie produkcji',
  '/office/pracownicy':               'Pracownicy',
  '/office/uzytkownicy':              'Użytkownicy systemu',
  '/office/traceability':             'Śledzenie partii',
}

// ── Quick action definitions ───────────────────────────────────
interface QuickAction {
  label: string
  icon: React.ReactNode
  to: string
  shortcutKey: string
  shortcutHint: string
  external?: boolean
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Nowy kontrahent',    icon: <Building2 size={12} />, to: '/office/kontrahenci',          shortcutKey: 'k', shortcutHint: 'Alt+K' },
  { label: 'Nowy dostawca',      icon: <Truck size={12} />,     to: '/office/dostawcy',              shortcutKey: 'd', shortcutHint: 'Alt+D' },
  { label: 'Przyjęcie ćwiartki', icon: <Package size={12} />,   to: '/office/raw-batches',           shortcutKey: 'p', shortcutHint: 'Alt+P' },
  { label: 'Nowy rozbiór',       icon: <Scissors size={12} />,  to: '/tablet/rozbior',               shortcutKey: 'r', shortcutHint: 'Alt+R', external: true },
  { label: 'Produkcja',          icon: <Factory size={12} />,   to: '/office/planowanie-produkcji',  shortcutKey: 'f', shortcutHint: 'Alt+F' },
]

// ── Quick action bar ───────────────────────────────────────────
function QuickActionBar() {
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey) return
      const key = e.key.toLowerCase()
      const action = QUICK_ACTIONS.find(a => a.shortcutKey === key)
      if (!action) return
      e.preventDefault()
      if (action.external) {
        window.location.href = action.to
      } else {
        navigate(action.to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="h-9 bg-white border-b border-slate-100 flex items-center px-4 gap-0.5 flex-shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-300 pr-3 border-r border-slate-100 mr-1.5 select-none whitespace-nowrap">
        Szybki dostęp
      </span>

      {QUICK_ACTIONS.map((action, i) => (
        <button
          key={i}
          onClick={() => action.external ? (window.location.href = action.to) : navigate(action.to)}
          title={action.shortcutHint}
          className={cn(
            'group inline-flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[11.5px] font-medium',
            'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
            'transition-all duration-150',
          )}
        >
          <span className="text-slate-400 group-hover:text-blue-500 transition-colors">{action.icon}</span>
          <span>{action.label}</span>
          <kbd className={cn(
            'ml-0.5 hidden group-hover:inline-flex items-center',
            'px-1.5 text-[9px] font-mono text-slate-400 bg-slate-100 border border-slate-200 rounded-md',
          )}>
            {action.shortcutHint}
          </kbd>
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => navigate('/office/raw-batches')}
          className="inline-flex items-center gap-1.5 h-6 px-3 rounded-lg text-[11.5px] font-semibold bg-slate-900 text-white hover:bg-slate-700 transition-colors shadow-sm"
        >
          <Plus size={10} />
          Nowe przyjęcie
        </button>
      </div>
    </div>
  )
}

// ── Layout ─────────────────────────────────────────────────────
export function OfficeLayout() {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? 'Kebab MES'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return (
    <div className="flex h-full bg-[#f8fafc] text-slate-900">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        'fixed md:relative z-40 h-full transition-all duration-200 flex-shrink-0',
        'md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        sidebarCollapsed ? 'md:w-[60px]' : 'md:w-[228px]',
      )}>
        <OfficeSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          onClose={() => setMobileOpen(false)}
        />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Topbar */}
        <header className="h-[52px] bg-white border-b border-slate-100 flex items-center justify-between px-5 flex-shrink-0 shadow-[0_1px_0_0_rgba(0,0,0,.04)]">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              onClick={() => setMobileOpen(v => !v)}
            >
              {mobileOpen ? <X size={15} /> : <Menu size={15} />}
            </button>
            <div>
              <h1 className="text-[13.5px] font-semibold text-slate-900 leading-tight">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Connection status */}
            <div className={cn(
              'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border',
              online
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200/60'
                : 'text-red-600 bg-red-50 border-red-200/60'
            )}>
              {online
                ? <><Wifi size={9} /><span>Online</span></>
                : <><WifiOff size={9} /><span>Offline</span></>
              }
            </div>

            {/* Date */}
            <span className="text-[11px] text-slate-400 hidden md:block font-medium tabular-nums">
              {new Date().toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>

            {/* Separator */}
            <div className="w-px h-4 bg-slate-200 hidden sm:block" />

            {/* User avatar */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-[10px] font-bold text-white select-none shadow-sm cursor-default">
              AM
            </div>
          </div>
        </header>

        {/* Desktop quick-action toolbar */}
        <QuickActionBar />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 md:p-7 scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
