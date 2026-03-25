import { Outlet, useLocation } from 'react-router-dom'
import { OfficeSidebar } from './OfficeSidebar'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'

const PAGE_TITLES: Record<string, string> = {
  '/office/dashboard':             'Dashboard',
  '/office/faktury':               'Faktury i WZ',
  '/office/dostawcy':              'Dostawcy',
  '/office/kontrahenci':           'Kontrahenci',
  '/office/zamowienia':            'Zamówienia',
  '/office/raw-batches':           'Przyjęcie ćwiartki',
  '/office/magazyn/surowiec':      'Magazyn — Surowiec',
  '/office/magazyn/przyprawy':     'Magazyn — Przyprawy i dodatki',
  '/office/magazyn/gotowe':        'Magazyn — Wyrób gotowy',
  '/office/deboning':              'Raporty rozbioru',
  '/office/haccp-report':          'Raport HACCP',
  '/office/rodzaje-produktow':     'Rodzaje produktów',
  '/office/receptury':             'Receptury',
  '/office/planowanie-masowania':  'Planowanie masowania',
  '/office/planowanie-produkcji':  'Planowanie produkcji',
  '/office/magazyn/mieso-przyp':   'Magazyn — Mięso przyprawione',
  '/office/magazyn/opakowania':    'Magazyn — Opakowania i tuleje',
  '/office/pracownicy':            'Pracownicy',
  '/office/uzytkownicy':           'Użytkownicy systemu',
}

export function OfficeLayout() {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? 'Kebab MES'
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const today = new Date()
  const dateStr = today.toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="flex h-full bg-surface-2">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={[
        'fixed md:relative z-40 h-full transition-transform duration-200',
        'md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>
        <OfficeSidebar onClose={() => setMobileOpen(false)} />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top header */}
        <header className="h-12 bg-white border-b border-surface-4 flex items-center justify-between px-5 flex-shrink-0 shadow-header">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors"
              onClick={() => setMobileOpen(v => !v)}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <h1 className="text-[15px] font-semibold text-ink leading-none">{title}</h1>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[12px] font-medium text-ink-3 hidden md:block capitalize">
              {dateStr}
            </span>
            <div className="h-4 w-px bg-surface-4 hidden md:block" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center text-[11px] font-bold text-white shadow-sm flex-shrink-0">
                AM
              </div>
              <span className="text-[12px] font-medium text-ink-2 hidden lg:block">Admin</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-5 xl:p-6 scrollbar-thin">
          <div className="max-w-[1680px]">
            <Outlet />
          </div>
        </main>

      </div>
    </div>
  )
}
