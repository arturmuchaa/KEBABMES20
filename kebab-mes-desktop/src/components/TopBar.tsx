import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { WifiOff, RefreshCw, Sun, Moon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { checkHealth } from '@/api/client'
import { cn } from '@/lib/utils'
import { getTheme, setTheme, type Theme } from '@/store/theme'

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard':        'Dashboard',
  '/mixing':           'Masowanie / Produkcja',
  '/traceability':     'Traceability',
  '/stock':            'Stany magazynowe',
  '/settings':         'Ustawienia',
  '/suppliers':        'Dostawcy',
  '/clients':          'Kontrahenci',
  '/orders':           'Zamówienia klientów',
  '/invoices':         'Faktury zakupowe',
  '/raw-batches':      'Przyjęcie ćwiartek',
  '/spice-stock':      'Przyprawy i dodatki',
  '/seasoned-meat':    'Mięso przyprawione',
  '/packaging':        'Opakowania / Tuleje',
  '/finished-goods':   'Wyrób gotowy',
  '/byproducts':       'Produkty uboczne',
  '/deboning':         'Raporty rozbioru',
  '/haccp':            'Raport HACCP',
  '/product-types':    'Rodzaje produktów',
  '/recipes':          'Receptury',
  '/production-plans': 'Plan produkcji',
  '/workers':          'Pracownicy',
  '/users':            'Użytkownicy',
}

export function TopBar() {
  const { pathname } = useLocation()
  const label = ROUTE_LABELS[pathname] ?? pathname.substring(1)

  const [theme, setThemeState] = React.useState<Theme>(getTheme)

  const { data: online, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn:  checkHealth,
    refetchInterval: 10_000,
    staleTime: 8_000,
    retry: false,
  })

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  return (
    <header className="h-12 flex items-center justify-between px-6 bg-mes-surface border-b border-mes-border shrink-0">
      {/* ── Page title ───────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-200">{label}</h1>
      </div>

      {/* ── Right side ───────────────────────────────────── */}
      <div className="flex items-center gap-4">
        {/* Date / time */}
        <Clock />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-mes-elevated transition-colors"
          title={theme === 'dark' ? 'Przełącz na jasny motyw' : 'Przełącz na ciemny motyw'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* Connection indicator */}
        <ConnectionPill online={online} fetching={isFetching} />
      </div>
    </header>
  )
}

function Clock() {
  const [time, setTime] = React.useState(new Date())
  React.useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="text-xs text-slate-500 font-mono tabular-nums">
      {time.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

function ConnectionPill({ online, fetching }: { online?: boolean; fetching: boolean }) {
  if (fetching && online === undefined) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <RefreshCw size={11} className="animate-spin" />
        <span>Łączenie…</span>
      </div>
    )
  }

  if (online) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span>Online</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-red-400">
      <WifiOff size={12} />
      <span>Brak połączenia</span>
    </div>
  )
}
