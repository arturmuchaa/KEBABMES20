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
import { fmtKgTrim } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

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

      <div className="flex flex-col gap-2 px-3 pb-3">
        {grupy.length === 0 && (
          <span className="py-4 text-center text-[11.5px] text-ink-4">
            Brak przyprawionego mięsa — pojawi się po masowaniu.
          </span>
        )}

        {grupy.map(g => {
          const brakKg = Math.max(0, g.potrzebaKg - g.wolneKg)
          return (
            <div key={g.recipeId} data-testid={`grupa-${g.recipeId}`} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 border-b border-surface-3 pb-0.5">
                <span className="truncate text-[12.5px] font-bold text-ink">{g.recipeName}</span>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-3">
                  {fmtKgTrim(g.wolneKg)} kg wolne
                  {g.potrzebaKg > 0 && <> · plan {fmtKgTrim(g.potrzebaKg)} kg</>}
                </span>
              </div>

              {brakKg > 0 && (
                <div data-testid={`brak-${g.recipeId}`}
                  className="rounded-[3px] bg-danger-light px-2 py-1 text-[11px] font-bold text-danger">
                  Brakuje {fmtKgTrim(brakKg)} kg
                </div>
              )}

              {g.partie.map(p => (
                <div key={p.id} data-testid={`partia-${p.id}`}
                  className="flex items-baseline justify-between gap-2 py-0.5 text-[11.5px]">
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <code className="font-mono font-bold text-ink">{p.batchNo}</code>
                    {p.productionDay && (
                      <span className="shrink-0 text-[10px] text-ink-4">
                        {p.productionDay.slice(8, 10)}.{p.productionDay.slice(5, 7)}
                      </span>
                    )}
                    {/* Pozycje planu biorące z tej partii. Pusto = partia
                        nietknięta; myślnika NIE stawiamy, żeby nie sugerować
                        pustego przydziału tam, gdzie po prostu nic nie poszło. */}
                    {p.usedByLines.length > 0 && (
                      <span className="truncate text-[10.5px] font-semibold text-primary">
                        → poz. {p.usedByLines.join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-ink-2">
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
