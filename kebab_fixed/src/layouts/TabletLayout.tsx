/**
 * TabletLayout — minimalistyczny header, BEZ nawigacji między tabletami.
 * Każdy tablet widzi tylko swoją stronę.
 * Header: biały/szary, dyskretny, czytelny — żadnych kolorowych pasków.
 */
import { Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useHmiMode, setHmiMode, HMI_MODES, HMI_LABELS } from '@/features/deboning/useHmiMode'
import { useMixHmiMode, setMixHmiMode, MIX_HMI_MODES, MIX_HMI_LABELS } from '@/features/mixing/useMixHmiMode'
import { useAuth } from '@/features/auth/AuthContext'

// Segmentowany przełącznik widoku rozbioru (Klasyczny / HMI v2 / HMI v3).
// Wszystkie warianty dostępne do testów. Widoczny tylko na /tablet/rozbior.
function HmiToggle() {
  const mode = useHmiMode()
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-3 border border-surface-4">
      {HMI_MODES.map(m => (
        <button key={m} type="button" onClick={() => setHmiMode(m)}
          className={cn('h-8 px-3 rounded-lg text-[13px] font-bold transition-colors active:scale-95',
            mode === m ? 'bg-brand text-white shadow-sm' : 'text-ink-3 hover:text-ink')}>
          {HMI_LABELS[m]}
        </button>
      ))}
    </div>
  )
}

// Segmentowany przełącznik widoku masowania (Klasyczny / HMI v1 / HMI v2).
// Wszystkie warianty dostępne do testów. Widoczny tylko na /tablet/mieszanie.
function MixHmiToggle() {
  const mode = useMixHmiMode()
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-3 border border-surface-4">
      {MIX_HMI_MODES.map(m => (
        <button key={m} type="button" onClick={() => setMixHmiMode(m)}
          className={cn('h-8 px-3 rounded-lg text-[13px] font-bold transition-colors active:scale-95',
            mode === m ? 'bg-brand text-white shadow-sm' : 'text-ink-3 hover:text-ink')}>
          {MIX_HMI_LABELS[m]}
        </button>
      ))}
    </div>
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
  const { user, logout } = useAuth()

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
          {pathname === '/tablet/mieszanie' && <MixHmiToggle />}
          <Clock />
          <div className="flex items-center gap-2">
            <span>{user?.name}</span>
            <button onClick={() => { logout(); location.href = '/panel' }}
                    className="px-3 py-1 bg-gray-700 rounded">Wyloguj / zmień operatora</button>
          </div>
        </div>
      </header>

      {/* Strona tabletu — bez zakładek nawigacyjnych */}
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <Outlet />
      </main>
    </div>
  )
}
