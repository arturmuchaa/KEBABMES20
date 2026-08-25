/**
 * BatchPanel — żywy stan partii przyprawionego obok planu produkcji.
 *
 * Stary panel mięsa mówił tylko, ile czego zostało. Planista potrzebuje
 * jeszcze jednej rzeczy: KTÓRA partia poszła na którą pozycję — bez tego
 * ręczna zmiana przydziału jest zgadywanką, a to ona jest tu najczęstszą
 * czynnością (FEFO tylko proponuje).
 *
 * Braki pokazujemy PRZED zapisem: nagłówek grupy zestawia wolne kilogramy
 * z zapotrzebowaniem planu, więc „nie starczy mięsa" widać przy wpisywaniu,
 * a nie dopiero przy odmowie zapisu.
 *
 * Receptury komponentowe (70/30) świadomie NIE trafiają do `demandByRecipe` —
 * ich partie dobiera backend per komponent i liczenie ich tutaj pokazywałoby
 * fałszywy brak.
 */
import { cn, fmtKgTrim } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export interface BatchPanelRow {
  id:             string
  recipeId:       string
  recipeName:     string
  batchNo:        string
  productionDay?: string
  /** Wolne kilogramy PO przydziale pozycji bieżącego szkicu — do wiersza
   *  partii, bo po nich widać, co plan zjadł. */
  kgFreeLive:     number
  /** Wolne kilogramy PRZED przydziałem tego szkicu — do liczenia braku.
   *  Porównanie zapotrzebowania z `kgFreeLive` odejmowałoby plan DWA RAZY
   *  (KIRMIZI 498, 24.08.2026: „3,8 kg wolne, brakuje 4476,2" przy realnych
   *  3524 kg i braku 956). */
  kgFreeRaw:      number
  /** Numery pozycji planu (1-based), które biorą z tej partii. */
  usedByLines:    number[]
}

export interface BatchPanelProps {
  rows:           BatchPanelRow[]
  /** Zapotrzebowanie szkicu per receptura — także dla receptur bez mięsa. */
  demandByRecipe: Record<string, { name: string; kg: number }>
  onRecalc:       () => void
}

interface Grupa {
  recipeId:   string
  recipeName: string
  /** Surowe wolne kg grupy — mianownik dla braku. */
  wolneKg:    number
  potrzebaKg: number
  partie:     BatchPanelRow[]
}

function grupuj(rows: BatchPanelRow[], demand: BatchPanelProps['demandByRecipe']): Grupa[] {
  const map = new Map<string, Grupa>()
  for (const r of rows) {
    const g = map.get(r.recipeId)
      ?? { recipeId: r.recipeId, recipeName: r.recipeName, wolneKg: 0, potrzebaKg: 0, partie: [] }
    g.wolneKg += r.kgFreeRaw
    g.partie.push(r)
    map.set(r.recipeId, g)
  }
  // Receptura, na którą plan czegoś chce, ale mięsa nie ma wcale, MUSI być
  // widoczna — inaczej brak 300 kg objawiałby się pustym miejscem.
  for (const [rid, d] of Object.entries(demand)) {
    const g = map.get(rid)
      ?? { recipeId: rid, recipeName: d.name, wolneKg: 0, potrzebaKg: 0, partie: [] }
    g.potrzebaKg = d.kg
    map.set(rid, g)
  }
  return [...map.values()].sort((a, b) => b.wolneKg - a.wolneKg)
}

export function BatchPanel({ rows, demandByRecipe, onRecalc }: BatchPanelProps) {
  const grupy = grupuj(rows, demandByRecipe)

  return (
    <div className="flex flex-col gap-2 border border-surface-4 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-surface-3 bg-surface-2 px-3 py-1.5">
        <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Partie przyprawionego
        </span>
        <Button size="sm" variant="ghost" className="h-6 gap-1 text-[10.5px]" onClick={onRecalc}>
          <RefreshCw size={11} />
          Przelicz FEFO od nowa
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-3">
        {grupy.length === 0 && (
          <span className="py-4 text-center text-[11.5px] text-ink-4">
            Brak przyprawionego mięsa — pojawi się po masowaniu.
          </span>
        )}

        {grupy.map(g => {
          const brakKg = Math.max(0, g.potrzebaKg - g.wolneKg)
          return (
            <div key={g.recipeId} data-testid={`grupa-${g.recipeId}`}
              className="flex flex-col rounded-[3px] border border-surface-3 px-2 py-1.5">
              {/* Nagłówek grupy: nazwa receptury niesie hierarchię rozmiarem,
                  nie kolorem. Liczby ≥12 px — panel ma 300 px, ale 10 px robiło
                  z niego szarą masę (zgłoszenie z biura 25.08.2026). */}
              <div className="flex items-baseline justify-between gap-2 pb-1">
                <span className="truncate text-[13.5px] font-bold leading-tight text-ink">{g.recipeName}</span>
                <span data-testid={`grupa-wolne-${g.recipeId}`}
                  className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-ink">
                  {fmtKgTrim(g.wolneKg)} kg
                </span>
              </div>

              {/* Pasek pokrycia: ile planu stoi za mięsem — widać na oko,
                  zanim ktokolwiek przeczyta liczby. */}
              {g.potrzebaKg > 0 && (
                <div className="flex items-center gap-2 pb-1">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-surface-3">
                    <div data-testid={`pokrycie-${g.recipeId}`}
                      className={cn('h-full', brakKg > 0 ? 'bg-danger' : 'bg-ink')}
                      style={{ width: `${Math.min(100, Math.round((g.wolneKg / g.potrzebaKg) * 100))}%` }} />
                  </div>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
                    plan {fmtKgTrim(g.potrzebaKg)} kg
                  </span>
                </div>
              )}

              {brakKg > 0 && (
                <div data-testid={`brak-${g.recipeId}`}
                  className="flex items-center gap-1.5 rounded-[3px] border border-danger/30 bg-danger-light px-2 py-1 text-[12px] font-bold text-danger">
                  <AlertTriangle size={12} className="shrink-0" />
                  Brakuje {fmtKgTrim(brakKg)} kg
                </div>
              )}

              {g.partie.map(p => (
                <div key={p.id} data-testid={`partia-${p.id}`}
                  className="flex items-baseline gap-2 border-t border-surface-2 py-1 first:border-t-0">
                  {/* Numer partii = to, czego planista szuka wzrokiem, więc
                      jest największy w wierszu. */}
                  <code data-testid={`partia-nr-${p.id}`}
                    className="font-mono text-[13.5px] font-bold leading-tight text-ink">
                    {p.batchNo}
                  </code>
                  {p.productionDay && (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-4">
                      {p.productionDay.slice(8, 10)}.{p.productionDay.slice(5, 7)}
                    </span>
                  )}
                  {/* Pozycje planu biorące z tej partii — ZNACZNIK, nie sam
                      kolor. Pusto = partia nietknięta; myślnika NIE stawiamy,
                      żeby nie sugerować pustego przydziału. */}
                  {p.usedByLines.length > 0 && (
                    <span data-testid={`partia-uzycie-${p.id}`}
                      className="shrink-0 rounded-[3px] border border-ink-4/40 px-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                      poz. {p.usedByLines.join(', ')}
                    </span>
                  )}
                  <span data-testid={`partia-kg-${p.id}`}
                    className="ml-auto shrink-0 font-mono text-[12.5px] font-semibold tabular-nums text-ink">
                    {fmtKgTrim(p.kgFreeLive)} kg
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
