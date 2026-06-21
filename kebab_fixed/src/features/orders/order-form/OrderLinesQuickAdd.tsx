/**
 * Wariant C — pasek szybkiego dodawania + lista (styl kasy/POS).
 * Wypełniasz pola w pasku u góry, Enter (lub „Dodaj") dopisuje pozycję do listy
 * poniżej i czyści pasek pod kolejną. Dobre, gdy pozycje wbija się pojedynczo.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Trash2, CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtKg, cn } from '@/lib/utils'
import { lineKg, filterRecipesFor, isLineComplete, emptyLine, type LinesEditorProps, type LineForm } from './types'
import { MaterialRequirementsPanel } from './MaterialRequirementsPanel'
import type { PreviewItem } from '@/lib/api'

const hasData = (l: LineForm) => !!(l.qty || l.kgPerUnit || l.productTypeId || l.recipeId || l.packagingId)

export function OrderLinesQuickAdd({ lines, setLines, removeLine, productTypes, recipes, packaging }: LinesEditorProps) {
  const [draft, setDraft] = useState<LineForm>(emptyLine())
  const [hint, setHint] = useState('')
  const qtyRef = useRef<HTMLInputElement | null>(null)

  // Indeksy realnych (niepustych) pozycji — pomijamy startowy pusty wiersz.
  const committed = lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => hasData(l))

  const totalKg = committed.reduce((s, { l }) => s + lineKg(l), 0)
  const totalUnits = committed.reduce((s, { l }) => s + (parseFloat(l.qty) || 0), 0)

  // Pozycje do podglądu zapotrzebowania: zatwierdzone + draft (gdy kompletny w kluczowych polach).
  const previewItems: PreviewItem[] = [
    ...committed.map(({ l }) => ({
      qty: parseFloat(l.qty) || 0,
      kgPerUnit: parseFloat(l.kgPerUnit) || 0,
      recipeId: l.recipeId, productTypeId: l.productTypeId,
    })),
    ...(draft.qty && draft.kgPerUnit && draft.recipeId
      ? [{ qty: parseFloat(draft.qty) || 0, kgPerUnit: parseFloat(draft.kgPerUnit) || 0,
           recipeId: draft.recipeId, productTypeId: draft.productTypeId }]
      : []),
  ]

  const setDraftField = (k: keyof LineForm, v: string) =>
    setDraft(d => k === 'productTypeId' ? { ...d, productTypeId: v, recipeId: '' } : { ...d, [k]: v })

  function commit() {
    if (!isLineComplete(draft)) {
      setHint('Uzupełnij ilość, kg, rodzaj i recepturę')
      return
    }
    setLines(prev => [...prev.filter(hasData), { ...draft }])
    setDraft(emptyLine())
    setHint('')
    requestAnimationFrame(() => qtyRef.current?.focus())
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
  }

  useEffect(() => { qtyRef.current?.focus() }, [])

  const draftRecipes = filterRecipesFor(recipes, draft)
  const ptName = (id: string) => productTypes.find(p => p.id === id)?.name || '—'
  const rcName = (id: string) => recipes.find(r => r.id === id)?.name || '—'
  const pkName = (id: string) => packaging.find(p => p.id === id)?.name || '—'

  return (
    <div className="space-y-2">
      {/* Pasek dodawania */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
        <div className="grid items-end gap-1.5" style={{ gridTemplateColumns: '70px 70px 1fr 1fr 1fr auto' }}>
          <Input ref={qtyRef} type="number" min="1" step="1" value={draft.qty} onChange={e => setDraftField('qty', e.target.value)} onKeyDown={onKeyDown} placeholder="szt" className="h-8 text-sm px-2" />
          <Input type="number" min="0.1" step="0.1" value={draft.kgPerUnit} onChange={e => setDraftField('kgPerUnit', e.target.value)} onKeyDown={onKeyDown} placeholder="kg" className="h-8 text-sm px-2" />
          <Select value={draft.productTypeId} onValueChange={v => setDraftField('productTypeId', v)}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Rodzaj..." /></SelectTrigger>
            <SelectContent>
              {productTypes.map(pt => <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={draft.recipeId} onValueChange={v => setDraftField('recipeId', v)}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Receptura..." /></SelectTrigger>
            <SelectContent>
              {draftRecipes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={draft.packagingId || '__none'} onValueChange={v => setDraftField('packagingId', v === '__none' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="— brak —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— brak —</SelectItem>
              {packaging.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.kgAvailable} {p.unit})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={commit} size="sm" className="h-8 gap-1.5"><CornerDownLeft size={13} /> Dodaj</Button>
        </div>
        {hint && <p className="mt-1 text-[11px] text-destructive font-medium">{hint}</p>}
      </div>

      {/* Zapotrzebowanie na surowiec (live) */}
      <MaterialRequirementsPanel items={previewItems} />

      {/* Lista dodanych pozycji */}
      {committed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-4 py-6 text-center text-xs text-muted-foreground">
          Brak pozycji — dodaj pierwszą powyżej (wypełnij i naciśnij Enter)
        </div>
      ) : (
        <div className="rounded-lg border border-surface-3 bg-white divide-y divide-surface-3">
          {committed.map(({ l, idx }, n) => (
            <div key={idx} className={cn('flex items-center gap-3 px-3 py-1.5 text-xs', n % 2 === 1 && 'bg-surface-2/30')}>
              <span className="w-5 text-center text-muted-foreground font-medium">{n + 1}</span>
              <span className="tabular-nums font-bold whitespace-nowrap">{l.qty}× {l.kgPerUnit}kg</span>
              <span className="flex-1 truncate text-ink">
                {ptName(l.productTypeId)} <span className="text-muted-foreground">/</span> {rcName(l.recipeId)}
                {l.packagingId && <span className="text-muted-foreground"> · {pkName(l.packagingId)}</span>}
              </span>
              <span className="font-bold text-blue-700 tabular-nums whitespace-nowrap">{fmtKg(lineKg(l), 0)} kg</span>
              <button onClick={() => removeLine(idx)} title="Usuń pozycję"
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2/60 text-[11px] font-bold uppercase tracking-wider text-ink-2">
            <span>Suma · {committed.length} poz. · {totalUnits} szt</span>
            <span className="text-primary font-black">{fmtKg(totalKg, 0)} kg</span>
          </div>
        </div>
      )}
    </div>
  )
}
