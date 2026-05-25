/**
 * Wariant B — tabela zoptymalizowana pod klawiaturę (styl Subiekt GT).
 * - Tab przechodzi między polami (natywnie).
 * - Enter w polach liczbowych ostatniego wiersza dodaje nową pozycję i ustawia fokus.
 * - Typeahead w listach (Rodzaj/Receptura/Tuleja) — wbudowany w Radix Select
 *   (po otwarciu listy wpisz pierwsze litery, by skoczyć do pozycji).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Trash2, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtKg, cn } from '@/lib/utils'
import { lineKg, filterRecipesFor, isLineComplete, type LinesEditorProps } from './types'

const TH = 'px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-ink-2 whitespace-nowrap'

export function OrderLinesKeyboard({ lines, setLine, addLine, removeLine, productTypes, recipes, packaging }: LinesEditorProps) {
  const totalKg = lines.reduce((s, l) => s + lineKg(l), 0)
  const totalUnits = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0)

  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const [focusIdx, setFocusIdx] = useState<number | null>(null)

  // Po dodaniu wiersza — ustaw fokus na polu "Ilość" nowej pozycji.
  useEffect(() => {
    if (focusIdx == null) return
    const el = qtyRefs.current[focusIdx]
    if (el) { el.focus(); el.select() }
    setFocusIdx(null)
  }, [lines.length, focusIdx])

  function addAndFocus() {
    setFocusIdx(lines.length) // indeks nowo dodanego wiersza
    addLine()
  }

  function onNumberKeyDown(e: KeyboardEvent<HTMLInputElement>, rowIdx: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const isLast = rowIdx === lines.length - 1
    if (isLast) {
      // Z ostatniego wiersza Enter tworzy kolejną pozycję (jak w Subiekcie).
      addAndFocus()
    } else {
      // Ze środka listy — przejdź do "Ilość" następnego wiersza.
      const next = qtyRefs.current[rowIdx + 1]
      if (next) { next.focus(); next.select() }
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Keyboard size={13} />
        <span><b>Tab</b> = następne pole · <b>Enter</b> = nowa pozycja · w liście wpisz litery, by znaleźć</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-surface-3 bg-white">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-surface-2 border-b border-surface-3">
            <tr>
              <th className={cn(TH, 'w-8 text-center')}>#</th>
              <th className={cn(TH, 'w-[72px]')}>Ilość</th>
              <th className={cn(TH, 'w-[72px]')}>kg/szt</th>
              <th className={TH}>Rodzaj produktu</th>
              <th className={TH}>Receptura</th>
              <th className={TH}>Tuleja / opak.</th>
              <th className={cn(TH, 'w-[90px] text-right')}>= kg</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const filteredRecipes = filterRecipesFor(recipes, line)
              const complete = isLineComplete(line)
              return (
                <tr key={i} className={cn('border-b border-surface-3 last:border-0', i % 2 === 1 && 'bg-surface-2/30')}>
                  <td className="px-2 py-1 text-center font-medium">
                    <span className={complete ? 'text-emerald-600' : 'text-muted-foreground'}>{i + 1}</span>
                  </td>
                  <td className="px-1.5 py-1">
                    <Input
                      ref={el => { qtyRefs.current[i] = el }}
                      type="number" min="1" step="1" value={line.qty}
                      onChange={e => setLine(i, 'qty', e.target.value)}
                      onKeyDown={e => onNumberKeyDown(e, i)}
                      placeholder="20" className="h-8 text-sm px-2"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <Input
                      type="number" min="0.1" step="0.1" value={line.kgPerUnit}
                      onChange={e => setLine(i, 'kgPerUnit', e.target.value)}
                      onKeyDown={e => onNumberKeyDown(e, i)}
                      placeholder="40" className="h-8 text-sm px-2"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <Select value={line.productTypeId} onValueChange={v => { setLine(i, 'productTypeId', v); setLine(i, 'recipeId', '') }}>
                      <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                      <SelectContent>
                        {productTypes.map(pt => <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-1.5 py-1">
                    <Select value={line.recipeId} onValueChange={v => setLine(i, 'recipeId', v)}>
                      <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                      <SelectContent>
                        {filteredRecipes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-1.5 py-1">
                    <Select value={line.packagingId || '__none'} onValueChange={v => setLine(i, 'packagingId', v === '__none' ? '' : v)}>
                      <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="— brak —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— brak —</SelectItem>
                        {packaging.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.kgAvailable} {p.unit})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-right font-bold text-blue-700 whitespace-nowrap">
                    {lineKg(line) > 0 ? `${fmtKg(lineKg(line), 0)} kg` : <span className="text-muted-foreground font-normal">—</span>}
                  </td>
                  <td className="px-1 py-1 text-center">
                    {lines.length > 1 && (
                      <button onClick={() => removeLine(i)} title="Usuń pozycję"
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-surface-4 bg-surface-2/60">
            <tr>
              <td colSpan={6} className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-2">
                Suma · {lines.length} poz. · {totalUnits} szt
              </td>
              <td className="px-2 py-1.5 text-right font-black text-primary whitespace-nowrap">{fmtKg(totalKg, 0)} kg</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <Button variant="ghost" size="sm" onClick={addAndFocus} className="gap-1.5 text-primary">
        <Plus size={13} /> Dodaj pozycję <span className="text-[10px] text-muted-foreground">(lub Enter)</span>
      </Button>
    </div>
  )
}
