/**
 * RecipesPage — Receptury masowania
 * TYLKO: lista receptur + dodawanie nowej
 * Składniki pobierane z istniejącego magazynu przypraw (ingredientsApi)
 * BEZ zakładki magazyn — jest osobna strona SpiceStockPage
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useIngredients, useRecipes, useRecipeForm } from '@/features/ingredients/hooks'
import { useProductTypes } from '../hooks'
import type { Recipe } from '@/features/ingredients/types'
import { Plus, X, ChevronDown, ChevronUp, BookOpen, AlertTriangle, Pencil } from 'lucide-react'

export function RecipesPage() {
  const { recipes, loading, create, createLoading, update, updateLoading } = useRecipes()
  const { ingredients: ingList } = useIngredients()
  const { productTypes }         = useProductTypes()
  const form = useRecipeForm()

  const [modalOpen,    setModalOpen]    = useState(false)
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [viewRecipe,   setViewRecipe]   = useState<Recipe | null>(null)

  function loadRecipeIntoForm(r: Recipe) {
    form.setName(r.name)
    form.setProductTypeId(r.productTypeId ?? '')
    form.setNotes(r.notes ?? '')
    form.setShelfLifeDays(r.shelfLifeDays ?? 5)
    form.setRows(
      r.ingredients.length > 0
        ? r.ingredients.map(ri => ({ ingredientId: ri.ingredientId, qtyPer100kg: String(ri.qtyPer100kg) }))
        : [{ ingredientId: '', qtyPer100kg: '' }]
    )
  }

  function openCreateModal() {
    setEditingId(null)
    form.reset()
    setModalOpen(true)
  }

  function openEditModal(r: Recipe) {
    setEditingId(r.id)
    loadRecipeIntoForm(r)
    setModalOpen(true)
  }

  async function handleCreate() {
    const dto = form.toDto()
    const err = await create(dto)
    if (err) { toast.error(err); return }
    toast.success(`Receptura "${dto.name}" zapisana`)
    setModalOpen(false); form.reset()
  }

  async function handleUpdate() {
    if (!editingId) return
    const dto = form.toDto()
    const err = await update(editingId, dto)
    if (err) { toast.error(err); return }
    toast.success('Receptura zaktualizowana')
    setModalOpen(false); setEditingId(null); form.reset()
  }

  const ingOptions = ingList.filter(i => i.active)

  return (
    <div className="space-y-4 animate-fade-in">

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Receptury masowania — dawkowanie składników na 100 kg mięsa.
          Składniki pobierane z <strong>magazynu przypraw i dodatków</strong>.
        </p>
        <Button size="sm" onClick={openCreateModal} className="gap-1.5">
          <Plus size={13}/> Nowa receptura
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i=><Skeleton key={i} className="h-14 w-full"/>)}
        </div>
      ) : recipes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground border rounded-lg">
          <BookOpen size={32}/>
          <div className="font-semibold">Brak receptur</div>
          <div className="text-sm">Dodaj pierwszą recepturę masowania</div>
          <Button size="sm" onClick={openCreateModal} className="gap-1.5 mt-1">
            <Plus size={13}/> Dodaj recepturę
          </Button>
        </div>
      ) : (
        <Card className="divide-y">
          {recipes.map(r => (
            <div key={r.id}>
              <div
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {r.ingredients.length} składników ·{' '}
                    <span className="font-semibold text-green-700">{r.totalOutputPer100kg} kg</span>
                    {' '}/ 100 kg mięsa
                    {r.productTypeId && (
                      <span className="ml-2 text-blue-600">
                        · {productTypes.find(p => p.id === r.productTypeId)?.name}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"
                  onClick={e => { e.stopPropagation(); openEditModal(r) }}>
                  <Pencil size={11}/> Edytuj
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={e => { e.stopPropagation(); setViewRecipe(r) }}>
                  Podgląd
                </Button>
                {expanded === r.id
                  ? <ChevronUp size={14} className="text-muted-foreground"/>
                  : <ChevronDown size={14} className="text-muted-foreground"/>}
              </div>

              {expanded === r.id && (
                <div className="px-4 pb-4 bg-muted/30 border-t">
                  <Table className="text-[12px] mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase tracking-wider h-7 px-3">Składnik</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider h-7 px-3 text-right w-28">Na 100 kg mięsa</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider h-7 px-3 text-right w-16">Jedn.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.ingredients.map(ri => (
                        <TableRow key={ri.id}>
                          <TableCell className="py-1.5 font-medium px-3">
                            {ri.ingredientName}
                            {ri.isUnlimited && <span className="ml-1 text-[10px] text-blue-500">(woda)</span>}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-bold px-3">{ri.qtyPer100kg}</TableCell>
                          <TableCell className="py-1.5 text-right text-muted-foreground px-3">{ri.unit}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="py-1.5 font-semibold text-muted-foreground px-3">Mięso (baza)</TableCell>
                        <TableCell className="py-1.5 text-right font-bold px-3">100</TableCell>
                        <TableCell className="py-1.5 text-right text-muted-foreground px-3">kg</TableCell>
                      </TableRow>
                      <TableRow className="bg-green-50 font-bold text-green-700">
                        <TableCell className="py-1.5 px-3">Półprodukt łącznie</TableCell>
                        <TableCell className="py-1.5 text-right px-3">{r.totalOutputPer100kg}</TableCell>
                        <TableCell className="py-1.5 text-right px-3">kg</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  {r.notes && (
                    <div className="mt-2 text-[11px] text-muted-foreground bg-background px-3 py-2 border rounded">
                      {r.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Modal: nowa / edycja receptury */}
      <Dialog open={modalOpen} onOpenChange={open => { if (!open) { setModalOpen(false); setEditingId(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edytuj recepturę' : 'Nowa receptura'}</DialogTitle>
            <DialogDescription>Dawkowanie na 100 kg mięsa</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Nazwa receptury *</Label>
                <Input placeholder="np. Receptura Standard Van Hess"
                  value={form.name} onChange={e => form.setName(e.target.value)}/>
              </div>
              <div>
                <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Rodzaj produktu</Label>
                <Select value={form.productTypeId||'__none'} onValueChange={v => form.setProductTypeId(v==='__none'?'':v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— bez przypisania —</SelectItem>
                    {productTypes.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Dni przydatności (termin)</Label>
                <Input type="number" min="1" step="1" placeholder="5"
                  value={form.shelfLifeDays}
                  onChange={e => form.setShelfLifeDays(Math.max(1, parseInt(e.target.value) || 5))}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Składniki (na 100 kg mięsa) *</Label>
                <Button variant="ghost" size="sm" onClick={form.addRow} className="h-7 gap-1 text-[11px] px-2">
                  <Plus size={11}/> Dodaj składnik
                </Button>
              </div>

              {ingOptions.length === 0 && (
                <div className="flex items-center gap-2 text-[11px] text-amber-600 mb-2">
                  <AlertTriangle size={12}/>
                  Brak składników w magazynie. Dodaj składniki w sekcji Magazyny → Przyprawy i dodatki.
                </div>
              )}

              <div className="grid grid-cols-[1fr_120px_32px] gap-2 mb-1">
                {['Składnik z magazynu','Dawka / 100 kg',''].map(h => (
                  <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</div>
                ))}
              </div>

              <div className="space-y-1.5">
                {form.rows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px_32px] gap-2 items-center">
                    <Select value={row.ingredientId||'__none'} onValueChange={v => form.updateRow(idx, 'ingredientId', v==='__none'?'':v)}>
                      <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Wybierz składnik..."/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Wybierz składnik...</SelectItem>
                        {ingOptions.map(i => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name} {i.isUnlimited ? '(woda ∞)' : `[${i.unit}]`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Input type="number" min="0" step="0.001" placeholder="0.000"
                        value={row.qtyPer100kg}
                        onChange={e => form.updateRow(idx, 'qtyPer100kg', e.target.value)}
                        className="h-8 text-[13px] font-bold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0 w-6">
                        {ingOptions.find(i => i.id === row.ingredientId)?.unit || 'kg'}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => form.removeRow(idx)} disabled={form.rows.length <= 1}>
                      <X size={14}/>
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-3 border rounded bg-muted/30 divide-y text-[12px]">
                <div className="flex justify-between px-3 py-1.5 text-muted-foreground">
                  <span>Mięso (baza)</span><span className="font-bold">100 kg</span>
                </div>
                <div className="flex justify-between px-3 py-1.5 text-muted-foreground">
                  <span>Suma składników</span><span className="font-bold">{form.sumPer100kg} kg</span>
                </div>
                <div className="flex justify-between px-3 py-1.5 font-bold text-green-700 bg-green-50">
                  <span>Półprodukt / 100 kg mięsa</span>
                  <span>{form.totalOutputPer100kg} kg</span>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Uwagi</Label>
              <textarea rows={2} placeholder="Opcjonalne uwagi..."
                value={form.notes} onChange={e => form.setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-none bg-background"/>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setModalOpen(false); setEditingId(null); form.reset() }}>Anuluj</Button>
              <Button
                className="flex-1"
                disabled={(editingId ? updateLoading : createLoading) || !form.name.trim() || !form.toDto().ingredients.length}
                onClick={editingId ? handleUpdate : handleCreate}
              >
                {(editingId ? updateLoading : createLoading) && (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"/>
                )}
                {editingId ? 'Zapisz zmiany' : 'Zapisz recepturę'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal podglądu receptury */}
      <Dialog open={!!viewRecipe} onOpenChange={open => { if (!open) setViewRecipe(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{viewRecipe?.name}</DialogTitle>
            <DialogDescription>Podgląd receptury</DialogDescription>
          </DialogHeader>
          {viewRecipe && (
            <>
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider h-8 px-3">Składnik</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider h-8 px-3 text-right">Na 100 kg</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider h-8 px-3 text-right">Jedn.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewRecipe.ingredients.map(ri => (
                    <TableRow key={ri.id}>
                      <TableCell className="py-2 font-medium px-3">
                        {ri.ingredientName}
                        {ri.isUnlimited && <span className="ml-1 text-[10px] text-blue-500">∞</span>}
                      </TableCell>
                      <TableCell className="py-2 text-right font-bold px-3">{ri.qtyPer100kg}</TableCell>
                      <TableCell className="py-2 text-right text-muted-foreground px-3">{ri.unit}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-green-50 font-bold text-green-700">
                    <TableCell className="py-2 px-3">Półprodukt łącznie (+ mięso)</TableCell>
                    <TableCell className="py-2 text-right px-3">{viewRecipe.totalOutputPer100kg}</TableCell>
                    <TableCell className="py-2 text-right px-3">kg</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {viewRecipe.notes && (
                <div className="mt-3 text-[12px] text-muted-foreground bg-muted/30 px-3 py-2 border rounded">
                  {viewRecipe.notes}
                </div>
              )}
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setViewRecipe(null)}>Zamknij</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
