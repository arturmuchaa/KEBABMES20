import { Outlet, useLocation } from 'react-router-dom'
import { OfficeSidebar } from './OfficeSidebar'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'

const PAGE_TITLES: Record<string, string> = {
  '/office/dashboard':             'Dashboard',
  '/office/faktury':               'Faktury i WZ',
  '/office/dostawcy':              'Dostawcy',
  '/office/kontrahenci':           'Kontrahenci',
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
  '/office/magazyn/mieso-przyp':    'Magazyn — Mięso przyprawione',
  '/office/pracownicy':            'Pracownicy',
  '/office/uzytkownicy':           'Użytkownicy systemu',
}

export function OfficeLayout() {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? 'Kebab MES'
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [pathname])
  return (
    <div className="flex h-full bg-surface-2">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setMobileOpen(false)} />}
      <div className={['fixed md:relative z-40 h-full transition-transform duration-200', 'md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full'].join(' ')}>
        <OfficeSidebar onClose={() => setMobileOpen(false)} />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-11 bg-white border-b border-surface-4 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button className="md:hidden p-1 text-ink-3 hover:text-ink" onClick={() => setMobileOpen(v => !v)}>
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <h1 className="text-sm font-semibold text-ink">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-ink-3 hidden sm:block">
              {new Date().toLocaleDateString('pl-PL', { weekday:'short', day:'numeric', month:'short' })}
            </span>
            <div className="w-6 h-6 rounded bg-brand flex items-center justify-center text-[10px] font-bold text-white">AM</div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-5 scrollbar-thin"><Outlet /></main>
      </div>
    </div>
  )
}
