/**
 * ProcessStatusBadge — kompaktowy badge statusu procesu do nagłówka karty.
 *
 *   session.status='closed' → "Do potwierdzenia" (amber) + przycisk "Potwierdź"
 *   session.status='open'   → "Na żywo" (niebieski pulse)
 *   todayApproved=true      → "Zakończony" (zielony, bez pulse) — biuro już
 *                              zatwierdziło dzisiejszą sesję; statystyki
 *                              dzisiejsze nadal widoczne do końca dnia
 *   dataActive (fallback)   → "Na żywo" — tablet nie używa production_sessions
 *                              (mixing/produkcja sterowane przez status zleceń)
 *   inaczej                 → "Oczekuje" (szare)
 */
import { Loader2, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useProcessSession, type ProcessType } from './useProcessSession'

interface Props {
  processType: ProcessType
  dataActive: boolean
}

export function ProcessStatusBadge({ processType, dataActive }: Props) {
  const { session, todayApproved, approve, closeAndApprove, busy } = useProcessSession(processType)

  // Operator zakończył na tablecie — biuro musi potwierdzić
  if (session?.status === 'closed') {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant="outline" className="gap-1.5 font-medium text-amber-700 border-amber-300 bg-amber-50">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
          Do potwierdzenia
        </Badge>
        <button
          onClick={async () => {
            if (!confirm('Potwierdzić zakończenie tego procesu? Dzień zostanie zamknięty.')) return
            const err = await approve()
            if (err) alert(err)
          }}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
        >
          {busy
            ? <><Loader2 size={11} className="animate-spin" /> …</>
            : <><CheckCircle2 size={11} /> Potwierdź</>
          }
        </button>
      </div>
    )
  }

  // Sesja open (operator pracuje) — biuro może domknąć dzień, gdy tablet
  // zapomniał kliknąć "Zakończ dzień" (sesja wisi jako "Na żywo" mimo
  // zakończonej pracy).
  if (session?.status === 'open') {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant="info" className="gap-1.5 font-medium">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          Na żywo
        </Badge>
        <button
          onClick={async () => {
            if (!confirm('Zamknąć dzień za tablet? Sesja zostanie zakończona i potwierdzona przez biuro.')) return
            const err = await closeAndApprove()
            if (err) alert(err)
          }}
          disabled={busy}
          title="Tablet nie zakończył sesji — zamknij i potwierdź dzień z biura"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-surface-4 bg-white text-[11px] font-semibold text-ink-3 hover:text-ink hover:border-ink-3 transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : 'Zamknij dzień'}
        </button>
      </div>
    )
  }

  // Biuro już zatwierdziło dzisiejszą sesję — dzień domknięty
  if (todayApproved) {
    return (
      <Badge variant="outline" className="flex-shrink-0 gap-1.5 font-medium text-green-700 border-green-300 bg-green-50">
        <CheckCircle2 size={11} />
        Zakończony
      </Badge>
    )
  }

  // Brak sesji ale są aktywne dane domenowe (np. tablet bez sesji, ale są zlecenia in_progress)
  if (dataActive) {
    return (
      <Badge variant="info" className="flex-shrink-0 gap-1.5 font-medium">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
        Na żywo
      </Badge>
    )
  }

  // Brak aktywności
  return (
    <Badge variant="outline" className="flex-shrink-0 gap-1.5 font-medium text-gray-500 border-gray-300">
      Oczekuje
    </Badge>
  )
}
