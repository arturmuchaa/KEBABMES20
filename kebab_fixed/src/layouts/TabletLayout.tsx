/**
 * TabletLayout — minimalistyczny header, BEZ nawigacji między tabletami.
 * Każdy tablet widzi tylko swoją stronę.
 * Header: biały/szary, dyskretny, czytelny — żadnych kolorowych pasków.
 */
import { Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { MonitorSmartphone } from 'lucide-react'
import { useHmiMode, toggleHmiMode } from '@/features/deboning/useHmiMode'

// Przełącznik trybu rozbioru (klasyk ↔ HMI v2). Widoczny tylko na /tablet/rozbior.
function HmiToggle() {
  const mode = useHmiMode()
  return (
    <button type="button" onClick={toggleHmiMode}
      className={cn('flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold border-2 transition-colors active:scale-95',
        mode === 'v2'
          ? 'bg-brand text-white border-brand'
          : 'bg-white text-ink-2 border-surface-4 hover:border-brand-border')}>
      <MonitorSmartphone size={16} />
      {mode === 'v2' ? 'HMI' : 'Klasyczny'}
    </button>
  )
}

const PAGE_META: Record<string, { title: string; sub: string }> = {
  '/tablet/rozbior':   { title: 'Rozbiór',   sub: 'Panel rozbioru ćwiartki' },
  '/tablet/mieszanie': { title: 'Masownia',  sub: 'Panel masowania'         },
  '/tablet/produkcja': { title: 'Produkcja', sub: 'Panel produkcji'         },
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const clock = time.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
  const date  = time.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit' })
  return (
    <div className="text-right leading-tight">
      <div className="text-base font-bold font-mono text-ink tabular-nums">{clock}</div>
      <div className="text-[11px] text-ink-3 font-medium">{date}</div>
    </div>
  )
}

export function TabletLayout() {
  const { pathname } = useLocation()
  const meta = PAGE_META[pathname] ?? { title: 'Hala', sub: '' }

  return (
    <div className="flex flex-col h-full bg-surface-2 overflow-hidden">

      {/* Header — biały, lekki, bez emoji, bez kolorów */}
      <header className="flex items-center justify-between px-5 py-3 bg-white border-b border-surface-4 flex-shrink-0 shadow-card">
        <div className="flex items-center gap-3">
          {/* Mały niebieski akcent zamiast kolorowego bloku */}
          <div className="w-1 h-8 bg-brand rounded-full" />
          <div>
            <div className="text-base font-bold text-ink leading-tight">{meta.title}</div>
            <div className="text-[11px] text-ink-3 font-medium">{meta.sub}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {pathname === '/tablet/rozbior' && <HmiToggle />}
          <Clock />
        </div>
      </header>

      {/* Strona tabletu — bez zakładek nawigacyjnych */}
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <Outlet />
      </main>
    </div>
  )
}
