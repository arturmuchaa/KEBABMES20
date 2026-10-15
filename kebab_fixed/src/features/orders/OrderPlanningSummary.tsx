import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { coveragePercent, kgText, percentNumber, type PlanningTotals, type summarizeOrders } from './orderPlanning'

export function CoverageBar({ totals }: { totals: PlanningTotals }) {
  const pct = coveragePercent(totals)
  if (pct === null) return <span className="text-xs text-ink-3">Brak danych</span>
  return <div className="flex min-w-[100px] items-center gap-2">
    <div role="progressbar" aria-label="Realizacja według pokrycia MES" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Number(pct.toFixed(1))} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-4">
      <div className={cn('h-full rounded-full bg-ink', pct >= 100 && 'bg-emerald-600')} style={{ width: `${pct}%` }} />
    </div>
    <span className="w-12 text-right text-xs tabular-nums">{percentNumber.format(pct)}%</span>
  </div>
}

export function OrderPlanningSummary({ summary, count, hiddenCount, onClear }: {
  summary: ReturnType<typeof summarizeOrders>; count: number; hiddenCount: number; onClear: () => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [showRecipes, setShowRecipes] = useState(true)
  const { totals, recipes, excludedCount, closedCount, draftCount, unknownCount } = summary
  return <section aria-label="Podsumowanie zaznaczonych zamówień" className="order-planning rounded-xl border border-surface-4 bg-white">
    <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Podsumowanie zaznaczonych zamówień <span className="ml-1 text-ink-3">({count})</span></h2>
        <p className="mt-1 text-xs text-ink-3">{hiddenCount > 0 ? `${hiddenCount} zaznaczonych poza widoczną listą · ` : ''}Zaznaczenia pozostają po zmianie filtrów.</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onClear}><X size={14} aria-hidden="true" className="mr-1" />Odznacz wszystkie</Button>
    </header>
    <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3" aria-live="polite" aria-atomic="true">
      <div className="rounded-lg bg-ink p-3 text-white">
        <p className="text-xs font-medium">Pozostało do wyprodukowania</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{kgText(totals.remainingKg)}</p>
        <p className="mt-1 text-xs text-white/80">Według pokrycia MES</p>
      </div>
      <div className="py-2 sm:px-3">
        <p className="text-xs text-ink-3">Łączna masa zamówiona</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{kgText(totals.orderedKg)}</p>
        <p className="mt-2 text-xs text-ink-3">{recipes.length} receptur · bez anulowanych</p>
      </div>
      <div className="py-2 sm:px-3">
        <p className="text-xs text-ink-3">Pokryte wyrobem · magazyn + wydania</p>
        <p className="mb-3 mt-1 text-2xl font-semibold tabular-nums">{kgText(totals.coveredKg)}</p>
        <CoverageBar totals={totals} />
      </div>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-surface-3 px-4 py-2 text-xs text-ink-2">
      <span>W magazynie, do wydania: <b className="tabular-nums">{kgText(totals.stockKg)}</b></span>
      <span>Wydane wg MES: <b className="tabular-nums">{kgText(totals.deliveredKg)}</b></span>
    </div>
    {(excludedCount > 0 || closedCount > 0 || draftCount > 0 || unknownCount > 0) &&
      <div className="space-y-1 border-t border-surface-3 px-4 py-3 text-xs text-amber-800" role="status">
        {excludedCount > 0 && <p>Pominięto anulowane zamówienia: {excludedCount}. Nie zwiększają zapotrzebowania ani sum receptur.</p>}
        {closedCount > 0 && <p>Zamówienia zamknięte: {closedCount}. Ich pokrycie wynika z zamknięcia zamówienia, nie z pomiaru produkcji.</p>}
        {draftCount > 0 && <p>Szkice: {draftCount}. Przed planowaniem produkcji wymagają potwierdzenia.</p>}
        {unknownCount > 0 && <p>Brak wiarygodnych danych pokrycia dla {unknownCount} zamówień. Nie zastępujemy ich zerem.</p>}
      </div>}
    <details className="border-t border-surface-3 px-4 py-2 text-xs text-ink-3">
      <summary className="cursor-pointer font-medium text-ink-2">Jak liczymy kilogramy?</summary>
      <p className="mt-2 max-w-4xl leading-relaxed">Masa = liczba sztuk × masa sztuki. Pokrycie wyrobem to stan magazynowy przydzielony przez MES oraz wydania do klienta.
        Nie jest to pomiar produkcji brutto: MES rozdziela również wspólny zapas, a zamkniętym zamówieniom przypisuje pełne wydanie.
        Palety, kartony i raporty planów nie są dodawane ponownie. Pozostało = suma braków poszczególnych pozycji.
        Ta ilość może już występować w aktywnych planach — nie oznacza automatycznie ilości do nowego planu.
        Długość zachowujemy w nazwie tulei / opakowania; nie zgadujemy brakujących parametrów.</p>
    </details>
    <button type="button" className="flex w-full items-center gap-2 border-t border-surface-4 px-4 py-2.5 text-left text-sm font-semibold hover:bg-surface-2"
      aria-expanded={showRecipes} aria-controls="selected-recipe-demand" onClick={() => setShowRecipes(v => !v)}>
      {showRecipes ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      Zapotrzebowanie według receptur <span className="ml-auto hidden text-xs font-normal text-ink-3 sm:inline">Największe braki na początku</span>
    </button>
    {showRecipes && <div id="selected-recipe-demand" className="max-h-[280px] overflow-auto rounded-b-xl" tabIndex={0} role="region" aria-label="Zestawienie receptur">
      <table className="w-full min-w-[600px] text-sm tabular-nums">
        <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-ink-3"><tr>
          <th scope="col" className="px-4 py-3 text-left">Receptura</th>
          <th scope="col" className="px-4 py-3 text-right">Zamówiono</th>
          <th scope="col" className="px-4 py-3 text-right">Pokryte wyrobem</th>
          <th scope="col" className="px-4 py-3 text-right">Pozostało</th>
        </tr></thead>
        <tbody>{recipes.map(recipe => <Fragment key={recipe.key}>
          <tr className="border-t border-surface-3 hover:bg-surface-2">
            <th scope="row" className="max-w-[400px] px-4 py-3 text-left font-medium">
              <button type="button" className="flex w-full items-start gap-2 text-left" aria-expanded={open.has(recipe.key)}
                aria-controls={`recipe-${recipe.key}`} onClick={() => setOpen(prev => {
                  const next = new Set(prev); next.has(recipe.key) ? next.delete(recipe.key) : next.add(recipe.key); return next
                })}>
                {open.has(recipe.key) ? <ChevronDown size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
                <span className="break-words">{recipe.name}<span className="mt-1 block text-xs font-normal text-ink-3">{recipe.details.length} pozycji</span></span>
              </button>
            </th>
            <td className="px-4 py-3 text-right whitespace-nowrap">{kgText(recipe.totals.orderedKg)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap text-ink-2">{kgText(recipe.totals.coveredKg)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">{kgText(recipe.totals.remainingKg)}</td>
          </tr>
          {open.has(recipe.key) && <tr id={`recipe-${recipe.key}`}><td colSpan={4} className="bg-surface-2 px-4 py-3">
            <div className="overflow-auto"><table className="w-full min-w-[850px] text-xs">
              <thead><tr>{['Zamówienie / klient', 'Rodzaj', 'Tuleja / długość / opakowanie', 'Masa × sztuki', 'Zamówiono', 'Pokryte', 'Pozostało'].map(label =>
                <th scope="col" key={label} className="px-2 py-2 text-left font-medium text-ink-3">{label}</th>)}</tr></thead>
              <tbody>{recipe.details.map(({ order, line }) => <tr key={`${order.id}:${line.id}`} className="border-t border-surface-4">
                <td className="px-2 py-3"><span className="font-medium">{order.orderNo}</span><span className="block text-ink-3">{order.clientName}</span></td>
                <td className="px-2 py-3">{line.productTypeName || 'Nie podano'}</td>
                <td className="max-w-64 break-words px-2 py-3">{line.packagingName || 'Nie podano'}{line.notes && <span className="block text-ink-3">{line.notes}</span>}</td>
                <td className="px-2 py-3 whitespace-nowrap">{kgText(line.kgPerUnit)} × {line.qty} szt.</td>
                <td className="px-2 py-3 whitespace-nowrap">{kgText(line.fulfillment?.orderedKg ?? line.qty * line.kgPerUnit)}</td>
                <td className="px-2 py-3 whitespace-nowrap">{kgText(line.fulfillment?.coveredKg ?? null)}</td>
                <td className="px-2 py-3 whitespace-nowrap font-semibold">{kgText(line.fulfillment?.remainingKg ?? null)}</td>
              </tr>)}</tbody>
            </table></div>
          </td></tr>}
        </Fragment>)}</tbody>
        <tfoot className="border-t border-surface-4 bg-surface-2 font-semibold"><tr>
          <th scope="row" className="px-4 py-3 text-left">RAZEM</th>
          <td className="px-4 py-3 text-right whitespace-nowrap">{kgText(totals.orderedKg)}</td>
          <td className="px-4 py-3 text-right whitespace-nowrap">{kgText(totals.coveredKg)}</td>
          <td className="px-4 py-3 text-right whitespace-nowrap">{kgText(totals.remainingKg)}</td>
        </tr></tfoot>
      </table>
    </div>}
  </section>
}
