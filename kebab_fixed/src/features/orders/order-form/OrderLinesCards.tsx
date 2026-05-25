/**
 * Wariant bazowy (obecny): każda pozycja jako osobna karta.
 * Zachowany jako fallback, gdyby żaden z nowych wariantów się nie sprawdził.
 */
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtKg } from '@/lib/utils'
import { lineKg, filterRecipesFor, type LinesEditorProps } from './types'

export function OrderLinesCards({ lines, setLine, addLine, removeLine, productTypes, recipes, packaging }: LinesEditorProps) {
  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const filteredRecipes = filterRecipesFor(recipes, line)
        return (
          <Card key={i} className="border-muted">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-3">
                <CardDescription className="text-xs font-bold uppercase">Pozycja {i + 1}</CardDescription>
                {lines.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeLine(i)}>
                    <X size={12} />
                  </Button>
                )}
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: '80px 80px 1fr 1fr 1fr 90px' }}>
                <div className="space-y-1">
                  <Label className="text-[9px]">Ilość (szt)</Label>
                  <Input type="number" min="1" step="1" value={line.qty} onChange={e => setLine(i, 'qty', e.target.value)} placeholder="20" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px]">kg</Label>
                  <Input type="number" min="0.1" step="0.1" value={line.kgPerUnit} onChange={e => setLine(i, 'kgPerUnit', e.target.value)} placeholder="40" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px]">Rodzaj produktu</Label>
                  <Select value={line.productTypeId} onValueChange={v => { setLine(i, 'productTypeId', v); setLine(i, 'recipeId', '') }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                    <SelectContent>
                      {productTypes.map(pt => <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px]">Receptura</Label>
                  <Select value={line.recipeId} onValueChange={v => setLine(i, 'recipeId', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                    <SelectContent>
                      {filteredRecipes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px]">Tuleja / opak.</Label>
                  <Select value={line.packagingId || '__none'} onValueChange={v => setLine(i, 'packagingId', v === '__none' ? '' : v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="— brak —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— brak —</SelectItem>
                      {packaging.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.kgAvailable} {p.unit})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <Card className="bg-blue-50 border-blue-200 h-8 flex items-center px-3">
                    <span className="text-xs font-bold text-blue-700 tabular-nums whitespace-nowrap">= {fmtKg(lineKg(line), 0)} kg</span>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
      <Button variant="ghost" size="sm" onClick={addLine} className="gap-1.5 text-primary">
        <Plus size={13} /> Dodaj pozycję
      </Button>
    </div>
  )
}
