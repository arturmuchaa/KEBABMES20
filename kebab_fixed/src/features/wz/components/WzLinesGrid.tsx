/**
 * WzLinesGrid — siatka pozycji dokumentu WZ.
 *
 * Ekran wystawiania czyta się jak w programie do fakturowania: JEDNA tabela
 * pozycji z Lp, a towar dokłada się przyciskiem „Dodaj pozycję" (klawisz
 * Insert). Wcześniej ekran trzymał dwie listy naraz — magazyn do przeglądania
 * i pozycje dokumentu — i przy kilku partiach kości nie dało się ogarnąć
 * wzrokiem, co właściwie jedzie na dokument.
 *
 * Komponent jest PREZENTACYJNY: cały stan trzyma strona, tutaj są tylko
 * pola i sumy. Matematyka siedzi w `rowMath`.
 */
import { useEffect } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  fmtKgPl, fmtMoneyPl, rowKg, rowPrice, rowQty, rowValue, sanitizeDecimal, sanitizeInt,
  type WzRow,
} from '../rowMath'

export interface WzLinesGridProps {
  rows: WzRow[]
  valued: boolean
  /** Symbol waluty dokumentu („zł" / „€"). */
  sym: string
  onChange: (index: number, key: 'qtyStr' | 'priceStr' | 'containersStr', value: string) => void
  onDelete: (index: number) => void
  onAdd: () => void
}

export function WzLinesGrid({ rows, valued, sym, onChange, onDelete, onAdd }: WzLinesGridProps) {
  // Insert dokłada pozycję — odruch przeniesiony z Subiekta/Comarcha, gdzie
  // biuro wystawia dokumenty z klawiatury, nie myszą.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Insert') { e.preventDefault(); onAdd() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAdd])

  const sumaKg = rows.reduce((s, r) => s + rowKg(r), 0)
  const sumaPoj = rows.reduce((s, r) => s + (parseInt(r.containersStr || '') || 0), 0)
  const sumaWart = rows.reduce((s, r) => s + rowValue(r), 0)

  return (
    <div className="border border-surface-4 rounded-md overflow-hidden bg-surface-2">
      <div className="px-3 py-2 border-b border-surface-4 flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-3">Pozycje</span>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 ml-auto text-[11px]"
                aria-label="Dodaj pozycję" onClick={onAdd}>
          <Plus size={13} /> Dodaj pozycję <kbd className="ml-1 opacity-60">Insert</kbd>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-1.5 text-ink-4">
          <span className="text-sm font-semibold text-ink-3">Dokument nie ma jeszcze pozycji</span>
          <span className="text-xs">Dodaj towar przyciskiem powyżej albo klawiszem Insert</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 text-left text-[9px] uppercase tracking-wider text-ink-4">
                <th className="h-8 px-2 w-10 text-right">Lp</th>
                <th className="h-8 px-2">Towar</th>
                <th className="h-8 px-2 w-20">Partia</th>
                <th className="h-8 px-2 w-32">Ilość</th>
                <th className="h-8 px-2 w-16">Poj.</th>
                <th className="h-8 px-2 w-24 text-right">Waga</th>
                {valued && <th className="h-8 px-2 w-24">Cena</th>}
                {valued && <th className="h-8 px-2 w-28 text-right">Wartość</th>}
                <th className="h-8 px-2 w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {rows.map((r, i) => {
                const nadStan = rowQty(r) > r.available
                const lp = i + 1
                return (
                  <tr key={`${r.stockId}-${i}`} className="hover:bg-surface-2">
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-4" aria-label={`Lp ${lp}`}>{lp}</td>
                    <td className="px-2 py-1.5 font-medium text-ink">{r.name}</td>
                    <td className="px-2 py-1.5 font-mono text-ink-2" aria-label={`Partia ${lp}`}>
                      {r.batchNo || '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="text" inputMode={r.unit === 'szt' ? 'numeric' : 'decimal'}
                          aria-label={`Ilość ${lp}`}
                          value={r.qtyStr}
                          className={cn('h-7 w-20 font-mono text-[12px]', nadStan && 'border-red-500')}
                          onFocus={e => e.target.select()}
                          onChange={e => onChange(i, 'qtyStr',
                            r.unit === 'szt' ? sanitizeInt(e.target.value) : sanitizeDecimal(e.target.value))}
                        />
                        <span className="text-[10px] text-ink-4">{r.unit}</span>
                        {nadStan && (
                          <span aria-label={`Ilość ponad stan ${lp}`}
                                title={`Na stanie tylko ${r.available} ${r.unit}`}>
                            <AlertTriangle size={13} className="text-red-600" />
                          </span>
                        )}
                      </div>
                      <div className={cn('text-[10px] mt-0.5', nadStan ? 'text-red-600 font-semibold' : 'text-ink-4')}>
                        stan {fmtKgPl(r.available)} {r.unit}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.stockType === 'fg' ? (
                        <span className="text-ink-4">—</span>
                      ) : (
                        <Input
                          type="text" inputMode="numeric" placeholder="—"
                          aria-label={`Pojemniki ${lp}`}
                          value={r.containersStr ?? ''}
                          className="h-7 w-14 font-mono text-[12px]"
                          onFocus={e => e.target.select()}
                          onChange={e => onChange(i, 'containersStr', sanitizeInt(e.target.value))}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap"
                        aria-label={`Waga ${lp}`}>
                      {rowKg(r) > 0 ? `${fmtKgPl(rowKg(r))} kg` : '—'}
                      {r.kgPerUnit
                        ? <div className="text-[10px] text-ink-4">{fmtKgPl(r.kgPerUnit)} kg/szt</div>
                        : null}
                    </td>
                    {valued && (
                      <td className="px-2 py-1.5">
                        <Input
                          type="text" inputMode="decimal" placeholder="0,00"
                          aria-label={`Cena ${lp}`}
                          value={r.priceStr}
                          className="h-7 w-20 font-mono text-[12px]"
                          onFocus={e => e.target.select()}
                          onChange={e => onChange(i, 'priceStr', sanitizeDecimal(e.target.value))}
                        />
                        {rowPrice(r) > 0 && rowKg(r) > 0 && (
                          <div className="text-[10px] text-ink-4">za kg</div>
                        )}
                      </td>
                    )}
                    {valued && (
                      <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap"
                          aria-label={`Wartość ${lp}`}>
                        {fmtMoneyPl(rowValue(r))} {sym}
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <Button variant="ghost" size="icon"
                              className="h-6 w-6 text-ink-4 hover:text-red-600"
                              aria-label={`Usuń pozycję ${lp}`} onClick={() => onDelete(i)}>
                        <Trash2 size={12} />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pasek sum — jak stopka dokumentu w Subiekcie: zawsze pod siatką. */}
      <div className="px-3 py-2 border-t border-surface-4 bg-surface-2 flex items-center gap-4 flex-wrap text-[11px]">
        <span className="text-ink-3">
          Pozycje <span className="font-bold text-ink tabular-nums" aria-label="Suma pozycji">{rows.length}</span>
        </span>
        <span className="text-ink-3">
          Waga <span className="font-bold text-ink tabular-nums" aria-label="Suma kg">{fmtKgPl(sumaKg)}</span> kg
        </span>
        <span className="text-ink-3">
          Pojemniki <span className="font-bold text-ink tabular-nums" aria-label="Suma pojemników">{sumaPoj}</span>
        </span>
        {valued && (
          <span className="ml-auto text-ink-3">
            RAZEM{' '}
            <span className="font-bold text-ink text-[15px] tabular-nums" aria-label="Razem wartość">
              {fmtMoneyPl(sumaWart)}
            </span>{' '}
            {sym}
          </span>
        )}
      </div>
    </div>
  )
}
