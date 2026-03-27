import { Outlet, useLocation } from 'react-router-dom'
import { OfficeSidebar } from './OfficeSidebar'
import { useState, useEffect } from 'react'
import { Menu, X, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/office/dashboard':              'Dashboard',
  '/office/faktury':                'Faktury i WZ',
  '/office/dostawcy':               'Dostawcy',
  '/office/kontrahenci':            'Kontrahenci',
  '/office/zamowienia':             'Zamówienia',
  '/office/raw-batches':            'Przyjęcie ćwiartki',
  '/office/magazyn/surowiec':       'Magazyn — Surowiec',
  '/office/magazyn/przyprawy':      'Magazyn — Przyprawy i dodatki',
  '/office/magazyn/gotowe':         'Magazyn — Wyrób gotowy',
  '/office/magazyn/mieso-przyp':    'Magazyn — Mięso przyprawione',
  '/office/magazyn/opakowania':     'Magazyn — Opakowania',
  '/office/magazyn/produkty-uboczne': 'Magazyn — Produkty uboczne',
  '/office/deboning':               'Raporty rozbioru',
  '/office/haccp-report':           'Raport HACCP',
  '/office/rodzaje-produktow':      'Rodzaje produktów',
  '/office/receptury':              'Receptury',
  '/office/planowanie-masowania':   'Planowanie masowania',
  '/office/planowanie-produkcji':   'Planowanie produkcji',
  '/office/pracownicy':             'Pracownicy',
  '/office/uzytkownicy':            'Użytkownicy systemu',
  '/office/traceability':           'Śledzenie partii',
}

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
    <div className="flex h-full bg-surface-2 text-ink">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        'fixed md:relative z-40 h-full transition-all duration-200 flex-shrink-0',
        'md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        sidebarCollapsed ? 'md:w-14' : 'md:w-56',
      )}>
        <OfficeSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          onClose={() => setMobileOpen(false)}
        />
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="h-12 bg-surface border-b border-surface-4 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              className="md:hidden p-1.5 text-ink-3 hover:text-ink hover:bg-surface-3 rounded transition-colors"
              onClick={() => setMobileOpen(v => !v)}
            >
              {mobileOpen ? <X size={16} /> : <Menu size={16} />}
            </button>

            {/* Page title */}
            <h1 className="text-[13px] font-semibold text-ink tracking-tight">{title}</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection status */}
            <div className={cn(
              'hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium',
              online
                ? 'text-green-400 bg-green-500/10'
                : 'text-red-400 bg-red-500/10'
            )}>
              {online
                ? <><Wifi size={11} /><span>Online</span></>
                : <><WifiOff size={11} /><span>Offline</span></>
              }
            </div>

            {/* Date */}
            <span className="text-[11px] font-medium text-ink-4 hidden sm:block">
              {new Date().toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>

            {/* User avatar */}
            <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 select-none">
              AM
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-5 scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
