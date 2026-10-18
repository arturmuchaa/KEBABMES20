import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { coveragePercent, kgText, meatKgText, roundedMeatTotal, mixingTotals, progressTotals, percentNumber, type PlanningTotals, type summarizeOrders } from './orderPlanning'
import { OrderKpis, OrderProgress } from './OrderUI'

export function CoverageBar({ totals }: { totals: PlanningTotals }) {
  const pct = coveragePercent(totals)
  if (pct === null) return <span className="text-xs text-ink-3">Brak danych</span>
  return <div className="flex min-w-[100px] items-center gap-2 text-emerald-700">
    <div role="progressbar" aria-label="Postęp według magazynu i wydań" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Number(pct.toFixed(1))} className="order-progress-track flex-1 !mt-0"><span style={{ width: `${pct}%` }} /></div>
    <span className="w-12 text-right text-xs tabular-nums">{percentNumber.format(pct)}%</span>
  </div>
}

export function OrderPlanningSummary({ summary, count, hiddenCount, onClear }: {
  summary: ReturnType<typeof summarizeOrders>; count: number; hiddenCount: number; onClear: () => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [demandOpen, setDemandOpen] = useState(false)
  const { totals, recipes, excludedCount, closedCount, draftCount, unknownCount } = summary
  const lines = recipes.flatMap(r => r.details.map(d => d.line))
  const progress = progressTotals(lines)
  const visible = recipes.filter(r => r.name.toLocaleLowerCase('pl').includes(query.trim().toLocaleLowerCase('pl')))
  return <section aria-label="Podsumowanie zaznaczonych zamówień" className="order-planning order-panel">
    <header className="order-selection-head">
      <div>
        <h2>Podsumowanie zaznaczonych zamówień ({count})</h2>
        <p>{hiddenCount > 0 ? `${hiddenCount} zaznaczonych poza widoczną listą · ` : ''}Zmiana filtrów nie zmienia zakresu obliczeń.</p></div>
      <Button variant="ghost" size="sm" onClick={onClear}><X size={14} aria-hidden="true" className="mr-1" />Odznacz wszystkie</Button>
    </header>
    <OrderKpis progress={progress} orderedKg={totals.orderedKg} label="Wybrane zamówienia" hint={`receptury: ${recipes.length}`} />
    {(excludedCount > 0 || closedCount > 0 || draftCount > 0 || unknownCount > 0) && <div className="order-info order-warning" role="status">
      {excludedCount > 0 && <p>Pominięto anulowane zamówienia: {excludedCount}.</p>}
      {closedCount > 0 && <p>Zamówienia zamknięte: {closedCount}. Nie wymagają nowego mieszania; pełne wydanie jest konwencją MES, nie pomiarem produkcji.</p>}
      {draftCount > 0 && <p>Szkice: {draftCount}. Potwierdź je przed uruchomieniem produkcji.</p>}
      {unknownCount > 0 && <p>Brak wiarygodnych danych pokrycia dla {unknownCount} zamówień.</p>}
    </div>}
    <button type="button" className="order-demand-toggle" aria-expanded={demandOpen} aria-controls="selected-meat-demand" onClick={() => setDemandOpen(value => !value)}>
      <span>{demandOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}Zapotrzebowanie na mięso</span>
      <small>{demandOpen ? 'Zwiń szczegóły' : 'Rozwiń receptury i ilości'}</small>
    </button>
    {demandOpen && <div id="selected-meat-demand" role="region" aria-label="Zapotrzebowanie na mięso">
    <header className="order-section-head">
      <div><h2>Mięso bazowe: {meatKgText(roundedMeatTotal(recipes))}</h2>
        <p>Pełne kilogramy w górę dla każdej receptury. Suma obejmuje te zaokrąglone ilości, bez zaokrąglania do partii mieszalnika.</p></div>
      <Input aria-label="Filtruj receptury" placeholder="Znajdź recepturę…" value={query} onChange={e => setQuery(e.target.value)} className="h-9 max-w-60 bg-white" />
    </header>
    <div id="selected-recipe-demand" className="max-h-[560px] overflow-auto" tabIndex={0} role="region" aria-label="Zestawienie receptur">
      <table className="order-table min-w-[890px]">
        <thead className="sticky top-0 z-10"><tr>
          <th scope="col">Receptura</th><th scope="col" className="numeric">Zamówiono</th><th scope="col" className="numeric">Magazyn / wydano</th>
          <th scope="col" className="numeric">Brak wyrobu¹</th><th scope="col" className="numeric">Przyrost masy²</th><th scope="col" className="numeric">Mięso bazowe</th>
        </tr></thead>
        <tbody>{visible.map(recipe => {
          const detailLines = recipe.details.map(d => d.line), p = progressTotals(detailLines), m = mixingTotals(detailLines)
          const yields = [...new Set(detailLines.map(l => l.mixing?.growthPct))]
          const growth = yields.length === 1 ? yields[0] : null
          const reasons = [...new Set(detailLines.map(l => l.mixing?.reason || (!l.mixing ? 'Brak danych kalkulacji MES.' : '')).filter(Boolean))]
          return <Fragment key={recipe.key}>
            <tr>
              <th scope="row" className="recipe-name !bg-transparent max-w-[320px]">
                <button type="button" aria-expanded={open.has(recipe.key)} aria-controls={`recipe-${recipe.key}`} onClick={() => setOpen(prev => {
                  const next = new Set(prev); next.has(recipe.key) ? next.delete(recipe.key) : next.add(recipe.key); return next
                })}>{open.has(recipe.key) ? <ChevronDown size={16} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0" aria-hidden="true" />}{recipe.name}</button>
                <small className="pl-6">{recipe.details.length} pozycji{m.remainingKg === 0 ? ' · Nie wymaga mieszania' : ' · Do przygotowania'}</small>
              </th>
              <td className="numeric">{kgText(recipe.totals.orderedKg)}</td><td className="numeric"><span>Magazyn: {kgText(p.stockKg)}</span><small>Wydano: {kgText(p.deliveredKg)}</small></td>
              <td className="numeric font-semibold">{kgText(m.remainingKg)}{m.remainingKg === null && <small className="order-warning">Uzgodnij dane</small>}</td>
              <td className="numeric">{growth == null ? '—' : `+${percentNumber.format(growth)}%`}<small>{growth == null ? 'Brak pewnego uzysku' : `${percentNumber.format(100 + growth)} kg / 100 kg mięsa`}</small></td>
              <td className="numeric"><span className="mixing-value">{meatKgText(m.meatKg)}</span><small>{m.meatKg === null ? 'Nie można obliczyć' : `Dodatki: ${kgText(m.additivesKg)}`}</small></td>
            </tr>
            {reasons.length > 0 && <tr><td colSpan={6} className="!pt-0 !border-0 text-xs order-warning">{recipe.name}: {reasons.join(' ')}</td></tr>}
            {open.has(recipe.key) && <tr id={`recipe-${recipe.key}`}><td colSpan={6} className="!p-0 bg-slate-50">
              <table className="order-table"><thead><tr>{['Zamówienie / klient', 'Rodzaj / opakowanie / długość', 'Gramatura', 'Magazyn / wydano', 'Brak wyrobu / mięso'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{recipe.details.map(({ order, line }) => <tr key={`${order.id}:${line.id}`}>
                  <td><b>{order.orderNo}</b><small>{order.clientName}</small></td>
                  <td>{line.productTypeName || 'Nie podano'}<small>{line.packagingName || 'Bez opakowania'}</small>{line.notes && <small>{line.notes}</small>}</td>
                  <td className="whitespace-nowrap">{line.qty} × {kgText(line.kgPerUnit)}</td>
                  <td><OrderProgress line={line} compact /></td>
                  <td className="numeric"><b>{kgText(line.mixing?.remainingKg ?? null)}</b><small>Mięso: {meatKgText(line.mixing?.meatKg ?? null)}</small></td>
                </tr>)}</tbody>
              </table>
            </td></tr>}
          </Fragment>
        })}</tbody>
      </table>
      {!visible.length && <p className="p-6 text-center text-sm text-slate-600">Brak receptur w tym zakresie.</p>}
    </div>
    <div className="order-info">¹ Brak wyrobu uwzględnia globalnie przydzielony magazyn i wydania. Raporty planów nie zmniejszają zapotrzebowania.
      ² Przyrost masy z receptury, nie wydajność rozbioru. Mięso = brak wyrobu ÷ (1 + przyrost / 100). Bez zaokrąglania do partii mieszalnika.</div>
    <details className="order-info">
      <summary className="cursor-pointer font-semibold">Jak liczymy kilogramy?</summary>
      <p className="mt-2">W magazynie pokazujemy tylko towar nadal na stanie, a wydany osobno. Do wysłania = zamówiono − wydano.
        Brak wyrobu = zamówiono − wydano − magazyn. Wysyłka do tego klienta zmniejsza stan i ilość do wysłania, ale nie tworzy ponownej potrzeby produkcji.
        Sprzedaż zapasu innemu klientowi nie realizuje zamówienia jego pierwotnego właściciela. Magazyn jest rozdzielany globalnie, bez ponownego przydzielania po zmianie filtrów lub zaznaczeń.
        To pokrycie zamówienia, nie pomiar produkcji brutto. Raportów planów, palet i kartonów nie doliczamy drugi raz.
        Wskaźnik procentowy jest ważony kilogramami; nadwyżka jednego wariantu nie pokrywa drugiego.
        Po pełnym uruchomieniu skanowania każdej sztuki źródłem nadrzędnym będą zweryfikowane skany produkcji — ten tryb nie jest jeszcze włączony.
        Uzysk pochodzi ze składników na 100 kg mięsa, zgodnie z kalkulacją masowni; woda w litrach jest liczona 1:1 jak w MES.
        Niespójny lub niepełny skład blokuje kalkulację. Potrzeba technologiczna nie odejmuje mięsa przyprawionego, surowca ani rezerwacji aktywnych planów — sprawdź je przed kolejnym mieszaniem.</p>
    </details>
    </div>}
  </section>
}
