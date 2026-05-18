/**
 * ProductTypesPage — TYLKO definicja rodzajów produktów (skład mięsny %)
 * Bez zakładek — jeden widok, czysta lista + dodawanie
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { useProductTypes, useProductTypeForm } from '../hooks'
import type { ProductType } from '../types'
import { Plus, Pencil, X, ChevronDown, ChevronUp, Trash2, AlertTriangle, CheckCircle } from 'lucide-react'

export function ProductTypesPage() {
  const { productTypes, loading, create, update, deactivate, createLoading } = useProductTypes()
  const [modalOpen, setModalOpen] = useState(false)
  const [editItem,  setEditItem]  = useState<ProductType | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)

  const form = useProductTypeForm(editItem ?? undefined)

  function openCreate() { form.reset(); setEditItem(null); setModalOpen(true) }
  function openEdit(p: ProductType) { setEditItem(p); setModalOpen(true) }

  async function handleSubmit() {
    const dto = form.toDto()
    const err = editItem ? await update(editItem.id, dto) : await create(dto)
    if (err) { toast.error(err); return }
    toast.success(editItem ? 'Produkt zaktualizowany' : `Produkt "${dto.name}" dodany`)
    setModalOpen(false)
  }

  async function handleDeactivate(id: string, name: string) {
    const err = await deactivate(id)
    if (err) toast.error(err)
    else toast.success(`"${name}" usunięty`)
  }

  const SOURCE_LABELS: Record<string, string> = {
    meat_stock: 'Mięso z/s (rozbiór)',
    purchase:   'Zakup (FV/PZ)',
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          Definicja składu mięsnego kebabu (% udział surowców). Suma udziałów = 100%.
        </p>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus size={13}/> Nowy rodzaj produktu
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i=><Skeleton key={i} className="h-14 w-full"/>)}
        </div>
      ) : productTypes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground border rounded-lg">
          <div className="font-semibold">Brak rodzajów produktów</div>
          <div className="text-sm">Dodaj pierwszy rodzaj kebabu klikając przycisk powyżej</div>
          <Button size="sm" onClick={openCreate} className="gap-1.5 mt-1">
            <Plus size={13}/> Dodaj produkt
          </Button>
        </div>
      ) : (
        <Card className="divide-y">
          {productTypes.map(p => (
            <div key={p.id}>
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{p.name}</div>
                  {p.description && <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {p.components.map(c => (
                    <Badge key={c.id} variant="secondary" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                      {c.pct}% {c.name}
                    </Badge>
                  ))}
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-1"
                    onClick={e => { e.stopPropagation(); openEdit(p) }}>
                    <Pencil size={13}/>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={e => { e.stopPropagation(); handleDeactivate(p.id, p.name) }}>
                    <Trash2 size={13}/>
                  </Button>
                  {expanded === p.id
                    ? <ChevronUp size={14} className="text-muted-foreground"/>
                    : <ChevronDown size={14} className="text-muted-foreground"/>}
                </div>
              </div>

              {expanded === p.id && (
                <div className="px-4 pb-3 bg-muted/30 border-t">
                  <Table className="text-[12px] mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] uppercase tracking-wider h-7 px-3">Składnik</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider h-7 px-3 text-center w-20">Udział %</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider h-7 px-3">Źródło</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.components.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="py-1.5 font-medium px-3">{c.name}</TableCell>
                          <TableCell className="py-1.5 text-center font-bold text-primary px-3">{c.pct}%</TableCell>
                          <TableCell className="py-1.5 text-muted-foreground px-3">{SOURCE_LABELS[c.sourceType]}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t font-bold">
                        <TableCell className="py-1 px-3">SUMA</TableCell>
                        <TableCell className={`py-1 text-center font-black px-3 ${p.components.reduce((s,c)=>s+c.pct,0)===100?'text-green-600':'text-destructive'}`}>
                          {p.components.reduce((s,c)=>s+c.pct,0)}%
                        </TableCell>
                        <TableCell className="px-3"/>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      <Dialog open={modalOpen} onOpenChange={open => { if (!open) setModalOpen(false) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edytuj rodzaj produktu' : 'Nowy rodzaj produktu'}</DialogTitle>
            <DialogDescription>Zdefiniuj skład mięsny (% udziały, suma = 100%)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Nazwa produktu *</Label>
              <Input placeholder="np. Kebab MIX 70/30, Kebab 100% udo"
                value={form.name} onChange={e => form.setName(e.target.value)}/>
            </div>
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Opis (opcjonalnie)</Label>
              <Input placeholder="np. Udo z kurczaka + filet z indyka"
                value={form.description} onChange={e => form.setDescription(e.target.value)}/>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Skład mięsny *</Label>
                <Button variant="ghost" size="sm" onClick={form.addComponent} className="h-7 gap-1 text-[11px] px-2">
                  <Plus size={11}/> Dodaj składnik
                </Button>
              </div>
              <div className="grid grid-cols-[1fr_90px_140px_32px] gap-2 mb-1">
                {['Nazwa składnika','Udział %','Źródło',''].map(h => (
                  <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</div>
                ))}
              </div>
              <div className="space-y-1.5">
                {form.components.map((c, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_90px_140px_32px] gap-2 items-center">
                    <Input placeholder="np. Mięso z/s, Filet z kurczaka"
                      value={c.name} onChange={e => form.updateComponent(idx, 'name', e.target.value)}
                      className="h-8 text-[13px]"/>
                    <div className="flex items-center gap-1">
                      <Input type="number" min="0" max="100" step="0.1" placeholder="0"
                        value={c.pct || ''}
                        onChange={e => form.updateComponent(idx, 'pct', parseFloat(e.target.value) || 0)}
                        className="h-8 text-[13px] font-bold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">%</span>
                    </div>
                    <Select value={c.sourceType} onValueChange={v => form.updateComponent(idx, 'sourceType', v as any)}>
                      <SelectTrigger className="h-8 text-[12px]"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meat_stock">Mięso z/s (rozbiór)</SelectItem>
                        <SelectItem value="purchase">Zakup (FV/PZ)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => form.removeComponent(idx)} disabled={form.components.length <= 1}>
                      <X size={14}/>
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">Suma:</span>
                  <span className={`text-[13px] font-bold ${form.validation.sumPct === 100 ? 'text-green-600' : 'text-destructive'}`}>
                    {Math.round(form.validation.sumPct * 100) / 100}%
                  </span>
                  {form.validation.sumPct === 100 && <CheckCircle size={14} className="text-green-600"/>}
                </div>
                {form.components.length >= 2 && form.validation.sumPct !== 100 && (
                  <Button variant="ghost" size="sm" onClick={form.autoFillLastPct} className="h-7 text-[11px] px-2">
                    Auto-uzupełnij ostatni
                  </Button>
                )}
              </div>
              {!form.validation.ok && form.validation.message && (
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-destructive">
                  <AlertTriangle size={12}/> {form.validation.message}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Anuluj</Button>
              <Button className="flex-1" disabled={createLoading || !form.validation.ok || !form.name.trim()} onClick={handleSubmit}>
                {createLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"/>}
                {editItem ? 'Zapisz zmiany' : 'Dodaj produkt'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
