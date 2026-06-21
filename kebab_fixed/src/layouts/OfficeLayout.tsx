import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { OfficeSidebar } from './OfficeSidebar'
import { useState, useEffect } from 'react'
import { Menu, X, Bell, ChevronRight, LayoutDashboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import pkg from '../../package.json'
import { ZoomControls } from '@/features/ui/ZoomControls'
import { useZoomInit } from '@/features/ui/useZoom'
import { useAuth } from '@/features/auth/AuthContext'

const APP_VERSION = pkg.version

const PAGE_TITLES: Record<string, { title: string; description?: string }> = {
  '/office/dashboard':             { title: 'Pulpit operacyjny' },
  '/office/dashboard-v2':          { title: 'Pulpit operacyjny', description: 'Nowy układ (v2)' },
  '/office/faktury':               { title: 'Faktury i PZ',                description: 'Dokumenty zakupowe' },
  '/office/dostawcy':              { title: 'Dostawcy',                    description: 'Zarządzanie dostawcami' },
  '/office/kontrahenci':           { title: 'Kontrahenci',                 description: 'Klienci i partnerzy' },
  '/office/zamowienia':            { title: 'Zamówienia',                  description: 'Zamówienia klientów' },
  '/office/raw-batches':           { title: 'Przyjęcie ćwiartki',          description: 'Rejestracja dostaw surowca' },
  '/office/magazyn/surowiec':      { title: 'Magazyn — Surowiec',          description: 'Stan magazynu ćwiartki' },
  '/office/magazyn/przyprawy':     { title: 'Magazyn — Przyprawy',         description: 'Przyprawy i dodatki' },
  '/office/magazyn/gotowe':        { title: 'Magazyn — Wyrób gotowy',      description: 'Gotowe produkty' },
  '/office/magazyn/mieso-przyp':   { title: 'Magazyn — Mięso przyprawione', description: 'Mięso po masowaniu' },
  '/office/magazyn/opakowania':    { title: 'Magazyn — Opakowania',        description: 'Tuleje i opakowania' },
  '/office/deboning':              { title: 'Raporty rozbioru',            description: 'Sesje i wpisy rozbioru' },
  '/office/haccp-report':          { title: 'Raport HACCP',                description: 'Dokumentacja HACCP' },
  '/office/rodzaje-produktow':     { title: 'Rodzaje produktów',           description: 'Katalog produktów' },
  '/office/receptury':             { title: 'Receptury',                   description: 'Składy i receptury' },
  '/office/szablony-etykiet':      { title: 'Szablony etykiet',            description: 'Konfiguracje etykiet per klient i receptura' },
  '/office/planowanie-masowania':  { title: 'Planowanie masowania',        description: 'Zlecenia masowania' },
  '/office/planowanie-produkcji':  { title: 'Planowanie produkcji',        description: 'Harmonogram produkcji' },
  '/office/pracownicy':            { title: 'Pracownicy',                  description: 'Zarządzanie personelem' },
  '/office/rozliczenia':           { title: 'Rozliczenia płac',            description: 'Akord · Tygodniówki · Paski wypłaty' },
  '/office/recall':                { title: 'Wycofanie (Recall)',          description: 'Śledzenie i wycofania' },
  '/office/uzytkownicy':           { title: 'Użytkownicy systemu',         description: 'Konta i uprawnienia' },
  '/office/ustawienia':            { title: 'Ustawienia firmy',            description: 'Dane do nagłówków PZ' },
}

export function OfficeLayout() {
  const { pathname } = useLocation()
  const page = PAGE_TITLES[pathname] ?? { title: 'Kebab MES' }
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [pathname])
  useZoomInit()
  const { user, logout } = useAuth()

  const today = new Date()
  const dateStr = today.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="flex h-full bg-[#F8FAFC]">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        'fixed md:relative z-40 h-full transition-transform duration-200 flex-shrink-0',
        'md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <OfficeSidebar onClose={() => setMobileOpen(false)} />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              onClick={() => setMobileOpen(v => !v)}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              <NavLink to="/office/dashboard" className="text-gray-400 hover:text-gray-600 transition-colors">
                <LayoutDashboard size={14} />
              </NavLink>
              {pathname !== '/office/dashboard' && (
                <>
                  <ChevronRight size={13} className="text-gray-300" />
                  <span className="text-gray-900 font-semibold">{page.title}</span>
                </>
              )}
              {pathname === '/office/dashboard' && (
                <span className="text-gray-900 font-semibold">{page.title}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Date */}
            <span className="hidden sm:block text-[12px] text-gray-400 capitalize">{dateStr}</span>

            {/* Zoom controls */}
            <ZoomControls />

            {/* App version */}
            <span
              className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-mono font-semibold tracking-wide bg-gray-100 text-gray-600 border border-gray-200"
              title="Wersja aplikacji"
            >
              v{APP_VERSION}
            </span>

            {/* Notification bell */}
            <button className="relative p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <Bell size={16} />
            </button>

            {/* User avatar */}
            <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
              <span className="text-sm text-gray-600">{user?.name}</span>
              <button onClick={() => { logout(); location.href = '/login' }}
                      className="text-sm text-red-600">Wyloguj</button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-5 md:p-6 max-w-screen-2xl mx-auto">
            {/* Page title block */}
            {page.description && (
              <div className="mb-6">
                <h1 className="text-xl font-semibold text-gray-900 leading-none">{page.title}</h1>
                <p className="text-sm text-gray-500 mt-1">{page.description}</p>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
