/**
 * PrintReportDialog — wybór okresu raportu rozbioru do druku.
 *
 * Filtr na ekranie („7 dni", „miesiąc" = od 1. do dziś) służy do podglądu i
 * prawie nigdy nie pokrywa się z pełnym okresem kalendarzowym. Raport dla
 * zarządu musi mieć granice, których da się bronić — dlatego druk ma własny
 * wybór: dzień / tydzień / miesiąc / kwartał / rok, przewijany strzałkami.
 *
 * Zawartość dokumentu wynika z okresu (patrz `scopeSections`), więc dialog
 * mówi wprost, co się wydrukuje — żeby nikt nie szukał premii w raporcie
 * dziennym.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  periodLabel, periodRange, scopeSections, scopeTitle, shiftPeriod, type PeriodKind,
} from './reportPeriod'

const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'day', label: 'Dzień' },
  { key: 'week', label: 'Tydzień' },
  { key: 'month', label: 'Miesiąc' },
  { key: 'quarter', label: 'Kwartał' },
  { key: 'year', label: 'Rok' },
]

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const fmtD = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/** Co znajdzie się w dokumencie — jednym zdaniem, językiem biura. */
function contentNote(kind: PeriodKind): string {
  const s = scopeSections(kind)
  if (!s.brief) {
    return 'Raport operacyjny: bilans masy, koszt 1 kg mięsa, partie i pracownicy. '
      + 'Bez podsumowania dla zarządu, trendów i premii — z jednej zmiany nie wyciąga się wniosków kadrowych.'
  }
  return s.bonus
    ? 'Raport zarządczy: podsumowanie, bilans masy, koszt, odchylenia partii w złotówkach, trend, pracownicy i rozdział o premii za uzysk.'
    : 'Raport zarządczy: podsumowanie, bilans masy, koszt, odchylenia partii w złotówkach, trend i pracownicy. Premia liczy się dopiero od pełnego miesiąca.'
}

export function PrintReportDialog({ open, onClose, initialKind, initialRef }: {
  open: boolean
  onClose: () => void
  /** Okres podpowiedziany z filtra ekranu (dziś → dzień, miesiąc → miesiąc…). */
  initialKind: PeriodKind
  initialRef: string
}) {
  const [kind, setKind] = useState<PeriodKind>(initialKind)
  const [ref, setRef] = useState(initialRef)

  // Otwarcie dialogu zaczyna od tego, na co biuro patrzy — a nie od tego,
  // co zostało po poprzednim wydruku.
  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    setRef(initialRef)
  }, [open, initialKind, initialRef])

  const today = ymd(new Date())
  const range = useMemo(() => periodRange(kind, ref), [kind, ref])
  // Przód blokujemy dopiero za okresem, w którym jesteśmy — pusty raport
  // z przyszłości to tylko mylące zero.
  const nextStart = periodRange(kind, shiftPeriod(kind, ref, 1)).from
  const canNext = nextStart <= today
  const ongoing = range.to >= today && range.from <= today && kind !== 'day'

  const move = (step: number) => setRef(r => shiftPeriod(kind, r, step))

  const print = () => {
    window.open(`/office/rozbior-raport/druk?from=${range.from}&to=${range.to}`, '_blank')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand/10 text-brand"><Printer size={15} /></span>
            Raport rozbioru do druku
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="inline-flex w-full items-center rounded-lg border border-surface-4 bg-white p-0.5">
            {KINDS.map(k => (
              <button key={k.key} type="button" onClick={() => setKind(k.key)}
                className={cn(
                  'flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors',
                  kind === k.key ? 'bg-brand text-white shadow-sm' : 'text-ink-3 hover:text-ink hover:bg-surface-2',
                )}>
                {k.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-4 bg-surface-1 px-2 py-2">
            <button type="button" onClick={() => move(-1)} aria-label="Poprzedni okres"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-surface-4 bg-white text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors">
              <ChevronLeft size={16} />
            </button>
            <div className="text-center leading-tight">
              <div className="text-sm font-bold text-ink first-letter:uppercase">{periodLabel(kind, range.from, range.to)}</div>
              <div className="text-[11px] text-ink-4 [font-variant-numeric:tabular-nums]">
                {range.from === range.to ? fmtD(range.from) : `${fmtD(range.from)} – ${fmtD(range.to)}`}
              </div>
            </div>
            <button type="button" onClick={() => move(1)} disabled={!canNext} aria-label="Następny okres"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-surface-4 bg-white text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-40 disabled:hover:bg-white">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="rounded-lg border border-surface-4 bg-surface-1 px-3 py-2.5 space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-4">{scopeTitle(kind)}</div>
            <p className="text-xs text-ink-2 leading-relaxed">{contentNote(kind)}</p>
            {ongoing && (
              <p className="text-xs text-amber-700 leading-relaxed">
                Okres jeszcze trwa — raport obejmie dni do dziś.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="h-9 px-3 rounded-lg border border-surface-4 bg-white text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors">
              Anuluj
            </button>
            <button type="button" onClick={print}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90 transition-opacity">
              <Printer size={14} />
              Drukuj
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
