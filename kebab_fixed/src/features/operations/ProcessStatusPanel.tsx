/**
 * ProcessStatusPanel — 3 karty statusu procesów operacyjnych
 * (Rozbiór · Masowanie · Produkcja) z 4-stanowym workflow:
 *
 *   null           → Oczekuje      (gray)
 *   status=open    → Live          (animated green)
 *   status=closed  → Do potwierdzenia przez biuro (amber) + przycisk "Potwierdź"
 *   po approve     → karta wraca do Oczekuje (lub do następnej sesji)
 *
 * Polluje active() co 7s dla każdego z 3 procesów.
 */
import { useEffect, useState, useCallback } from 'react'
import { Scissors, Soup, Factory, CheckCircle2, Loader2, Clock } from 'lucide-react'
import { productionSessionsApi } from '@/lib/apiClient'

const POLL_MS = 7000

type Session = {
  id: string
  status: 'open' | 'closed' | 'approved'
  sessionDate: string
  startedAt: string
  endedAt?: string | null
}

type Process = {
  key: 'deboning' | 'mixing' | 'production'
  label: string
  icon: typeof Scissors
  iconBg: string  // klasy tailwind statyczne
}

const PROCESSES: Process[] = [
  { key: 'deboning',   label: 'Rozbiór',   icon: Scissors, iconBg: 'bg-amber-50 text-amber-600'   },
  { key: 'mixing',     label: 'Masowanie', icon: Soup,     iconBg: 'bg-purple-50 text-purple-600' },
  { key: 'production', label: 'Produkcja', icon: Factory,  iconBg: 'bg-blue-50 text-blue-600'     },
]

function ProcessCard({ proc }: { proc: Process }) {
  const [session, setSession] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)
  const Icon = proc.icon

  const refetch = useCallback(async () => {
    try {
      const data = await productionSessionsApi.active(proc.key)
      setSession(data && data.id ? data : null)
    } catch {
      setSession(null)
    }
  }, [proc.key])

  useEffect(() => {
    refetch()
    const t = setInterval(refetch, POLL_MS)
    return () => clearInterval(t)
  }, [refetch])

  async function handleApprove() {
    if (!session) return
    if (!confirm(`Potwierdzić zakończenie dnia: ${proc.label}?`)) return
    setBusy(true)
    try {
      await productionSessionsApi.approve(session.id, { approvedBy: 'office' })
      await refetch()
    } catch (e) {
      alert(`Błąd zatwierdzania: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setBusy(false)
    }
  }

  // ── State machine ──
  let label: string
  let chipCls: string
  let dotCls: string | null = null
  let action: React.ReactNode = null

  if (!session) {
    label = 'Oczekuje'
    chipCls = 'bg-gray-100 text-gray-600 border-gray-200'
  } else if (session.status === 'open') {
    label = 'Live'
    chipCls = 'bg-green-100 text-green-700 border-green-300'
    dotCls  = 'bg-green-500'
  } else if (session.status === 'closed') {
    label = 'Do potwierdzenia'
    chipCls = 'bg-amber-100 text-amber-800 border-amber-300'
    action = (
      <button
        onClick={handleApprove}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
      >
        {busy
          ? <><Loader2 size={13} className="animate-spin" /> Potwierdzanie…</>
          : <><CheckCircle2 size={13} /> Potwierdź zakończenie</>
        }
      </button>
    )
  } else {
    // approved — sesja już zatwierdzona; pokazujemy ją chwilę nim refetch ją odfiltruje
    label = 'Zakończone'
    chipCls = 'bg-blue-100 text-blue-700 border-blue-300'
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-lg ${proc.iconBg} grid place-items-center`}>
            <Icon size={18} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Proces</div>
            <div className="text-sm font-semibold text-gray-900 leading-tight">{proc.label}</div>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide border ${chipCls}`}>
          {dotCls && <span className={`w-1.5 h-1.5 rounded-full ${dotCls} animate-pulse`} />}
          {label}
        </span>
      </div>

      {session ? (
        <div className="text-[11.5px] text-gray-500 leading-relaxed">
          <span className="font-medium text-gray-700">Sesja:</span> {session.sessionDate}
          {session.startedAt && (
            <> · start: <span className="font-mono">{new Date(session.startedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span></>
          )}
          {session.endedAt && (
            <> · koniec: <span className="font-mono">{new Date(session.endedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span></>
          )}
        </div>
      ) : (
        <div className="text-[11.5px] text-gray-400 italic flex items-center gap-1.5">
          <Clock size={11} /> brak aktywnej sesji
        </div>
      )}

      {action && <div>{action}</div>}
    </div>
  )
}

export function ProcessStatusPanel() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      {PROCESSES.map(p => <ProcessCard key={p.key} proc={p} />)}
    </div>
  )
}
