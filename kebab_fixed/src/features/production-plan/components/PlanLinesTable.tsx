/**
 * PlanLinesTable — pozycje planu produkcji w stałych kolumnach.
 *
 * Stary ekran rozpisywał pozycję na kilka wierszy pól formularza. Przy
 * dziesięciu pozycjach — tyle mają realne plany — nie dawało się rzucić okiem,
 * co jest czym ani czego brakuje. Ten sam idiom, co lista pozycji zamówienia:
 * stałe szerokości, nagłówek wyrównany z wierszami.
 *
 * Pozycja rozpoczęta na hali (`frozen`) nie ma kosza: jej mięso już poszło
 * w produkcję, a usunięcie rozjechałoby plan z tym, co realnie zrobiono.
 */
import { cn, fmtKgTrim } from '@/lib/utils'
import { Pencil, Trash2 } from 'lucide-react'

export interface PlanLineRow {
  qty:              string
  kgPerUnit:        string
  productTypeName:  string
  recipeName:       string
  clientName:       string
  /** Numery partii przypisanych do pozycji, w kolejności pobierania. */
  batchNos:         string[]
  /** Pozycja rozpoczęta na hali — zamrożona. */
  frozen:           boolean
}

const num = (v: string): number => {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const lineKg = (r: PlanLineRow): number => num(r.qty) * num(r.kgPerUnit)

/** Kolumny — szerokości MUSZĄ być te same w nagłówku i w wierszu. */
const COL = {
  lp:     'w-5 shrink-0',
  ilosc:  'w-[104px] shrink-0',
  rodzaj: 'min-w-0 flex-[3]',
  recept: 'min-w-0 flex-[3]',
  klient: 'min-w-0 flex-[2]',
  partie: 'min-w-0 flex-[2]',
  razem:  'w-[92px] shrink-0 text-right',
  akcje:  'w-[52px] shrink-0',
}

export function PlanLinesTable({ rows, editingIdx, onEdit, onRemove }: {
  rows:       PlanLineRow[]
  editingIdx: number | null
  onEdit:     (i: number) => void
  onRemove:   (i: number) => void
}) {
  const sumaKg = rows.reduce((s, r) => s + lineKg(r), 0)

  return (
    <div className="flex min-h-0 flex-col">
      <div data-testid="plan-head"
        className="flex items-center gap-2.5 border-b border-surface-3 bg-surface-2/60 px-4 py-1
                   font-display text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-4">
        <span className={COL.lp} />
        <span className={COL.ilosc}>Ilość</span>
        <span className={COL.rodzaj}>Rodzaj</span>
        <span className={COL.recept}>Receptura</span>
        <span className={COL.klient}>Klient</span>
        <span className={COL.partie}>Partie</span>
        <span className={COL.razem}>Razem</span>
        <span className={COL.akcje} />
      </div>

      <div className="oe-scroll min-h-0 flex-1 overflow-y-auto">
        {rows.map((r, i) => {
          const edytowana = editingIdx === i
          return (
            <div key={i} data-testid="plan-line"
              onDoubleClick={() => onEdit(i)}
              className={cn(
                'group flex h-8 items-center gap-2.5 px-4 text-[12.5px]',
                edytowana ? 'bg-ink text-white' : 'hover:bg-surface-2',
              )}>
              <span className={cn(COL.lp, 'text-right font-mono text-[11px] tabular-nums',
                edytowana ? 'text-white/50' : 'text-ink-5')}>{i + 1}</span>

              <span data-testid="plan-ilosc"
                className={cn(COL.ilosc, 'font-mono text-[12.5px] font-bold tabular-nums')}>
                {num(r.qty)}<span className={cn('mx-1 font-sans text-[10px] font-normal',
                  edytowana ? 'text-white/50' : 'text-ink-4')}>×</span>{fmtKgTrim(num(r.kgPerUnit))}
              </span>

              <span className={cn(COL.rodzaj, 'truncate font-medium')} title={r.productTypeName}>
                {r.productTypeName || '—'}
              </span>
              <span className={cn(COL.recept, 'truncate', edytowana ? 'text-white/70' : 'text-ink-2')}
                title={r.recipeName}>{r.recipeName || '—'}</span>
              <span data-testid="plan-klient"
                className={cn(COL.klient, 'truncate', edytowana ? 'text-white/70' : 'text-ink-3')}
                title={r.clientName || undefined}>{r.clientName || '—'}</span>

              {/* Partie: myślnik znaczy „jeszcze nieprzypisane" — pozycja bez
                  mięsa nie może wyglądać jak gotowa. */}
              <span data-testid="plan-partie"
                className={cn(COL.partie, 'truncate font-mono text-[11.5px]',
                  r.batchNos.length === 0
                    ? (edytowana ? 'text-white/50' : 'text-danger')
                    : (edytowana ? 'text-white/70' : 'text-ink-2'))}
                title={r.batchNos.join(', ') || undefined}>
                {r.batchNos.length > 0 ? r.batchNos.join(', ') : '—'}
              </span>

              <span data-testid="plan-razem"
                className={cn(COL.razem, 'font-mono text-[13px] font-bold tabular-nums')}>
                {fmtKgTrim(lineKg(r))}<span className={cn('ml-1 font-sans text-[10px] font-normal',
                  edytowana ? 'text-white/50' : 'text-ink-4')}>kg</span>
              </span>

              <span className={cn(COL.akcje, 'flex justify-end gap-0.5 opacity-0 transition-opacity',
                'group-hover:opacity-100 focus-within:opacity-100')}>
                <button onClick={() => onEdit(i)} title="Popraw pozycję (dwuklik)"
                  className={cn('grid h-6 w-6 place-items-center',
                    edytowana ? 'text-white/70 hover:text-white' : 'text-ink-4 hover:bg-surface-3 hover:text-ink')}>
                  <Pencil size={12} />
                </button>
                {!r.frozen && (
                  <button onClick={() => onRemove(i)} title="Usuń pozycję"
                    className={cn('grid h-6 w-6 place-items-center',
                      edytowana ? 'text-white/70 hover:text-white' : 'text-ink-4 hover:bg-danger-light hover:text-danger')}>
                    <Trash2 size={12} />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div data-testid="plan-suma"
        className="flex items-baseline gap-2 border-t border-surface-4 bg-surface-2/60 px-4 py-1.5">
        <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-4">
          Razem plan
        </span>
        <span className="ml-auto font-mono text-[15px] font-bold tabular-nums text-ink">
          {fmtKgTrim(sumaKg)}<span className="ml-1 font-sans text-[10px] font-normal text-ink-4">kg</span>
        </span>
      </div>
    </div>
  )
}
