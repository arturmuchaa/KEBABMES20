/**
 * SpiceStockPage — Magazyn Przypraw i Dodatków
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { ingredientsApi, ingredientReceiptsApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, todayIso } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { FlaskConical, AlertTriangle, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import type { IngredientCategory } from '@/features/ingredients/types'
import { useIngredients } from '@/features/ingredients/hooks'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function ExpiryCell({ date }: { date?: string }) {
  if (!date) return <CardDescription className="text-xs">—</CardDescription>
  const { daysLeft } = getExpiryStatus(date)
  const variant = daysLeft < 0 ? 'danger' : daysLeft <= 30 ? 'warning' : 'success'
  return (
    <Badge variant={variant} className="text-xs">
      {fmtDatePl(date)}{daysLeft < 0 ? ' !' : daysLeft <= 30 ? ` (${daysLeft}d)` : ''}
    </Badge>
  )
}

export function SpiceStockPage() {
  const { ingredients, stock, loading, createIngredient, addReceipt, createLoading, receiptLoading } = useIngredients()
  const { data: receipts, refetch: refetchReceipts } = useApi(() => ingredientReceiptsApi.list())

  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [ingModal,     setIngModal]     = useState(false)
  const [receiptModal, setReceiptModal] = useState(false)
  const [selIngId,     setSelIngId]     = useState('')

  // Nowy składnik
  const [newName, setNewName] = useState('')
  const [newCat,  setNewCat]  = useState<IngredientCategory>('spice_mix')
  const [newUnit, setNewUnit] = useState('kg')

  // Przyjęcie PZ
  const [recQty,     setRecQty]     = useState('')
  const [recPrice,   setRecPrice]   = useState('')
  const [recInvoice, setRecInvoice] = useState('')
  const [recDate,    setRecDate]    = useState(todayIso())
  const [recExpiry,  setRecExpiry]  = useState('')

  const displayIngredients = ingredients.filter(i => !i.isUnlimited)

  const stockMap = useMemo(() => new Map(stock.map(s => [s.ingredientId, s])), [stock])
  const receiptMap = useMemo(() => {
    const m = new Map<string, typeof receipts>()
    ;(receipts ?? []).forEach(r => {
      const arr = m.get(r.ingredientId) ?? []
      m.set(r.ingredientId, [...arr, r])
    })
    return m
  }, [receipts])

  const alerts = useMemo(() => displayIngredients.filter(ing => {
    const s = stockMap.get(ing.id)
    if (!s) return false
    if (s.qtyAvailable <= 0) return true
    const recs = receiptMap.get(ing.id) ?? []
    return recs.some(r => r.expiryDate && getExpiryStatus(r.expiryDate).daysLeft <= 30)
  }), [displayIngredients, stockMap, receiptMap])

  async function handleCreateIng() {
    const err = await createIngredient({ name: newName, category: newCat, unit: newUnit, isUnlimited: false })
    if (err) { toast.error(err); return }
    toast.success(`"${newName}" dodany do magazynu`)
    setIngModal(false); setNewName(''); setNewCat('spice_mix'); setNewUnit('kg')
  }

  async function handleReceipt() {
    const err = await addReceipt({
      ingredientId: selIngId,
      qty:          parseFloat(recQty) || 0,
      pricePerUnit: parseFloat(recPrice) || 0,
      invoiceNo:    recInvoice || undefined,
      receivedDate: recDate,
      notes:        recExpiry ? `Ważność: ${recExpiry}` : undefined,
    })
    if (err) { toast.error(err); return }
    refetchReceipts()
    toast.success('Przyjęcie PZ zapisane')
    setReceiptModal(false)
    setRecQty(''); setRecPrice(''); setRecInvoice(''); setRecExpiry('')
  }

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="grid grid-cols-3 gap-4">
          {[0,1,2].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
        </div>
        <Card><CardContent className="p-4 space-y-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-600" />
              <CardTitle className="text-sm text-amber-700">
                {alerts.length} alertów — niski stan lub bliska data ważności
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1">
              {alerts.map(ing => {
                const s = stockMap.get(ing.id)
                return (
                  <div key={ing.id} className="flex items-center gap-3 text-sm">
                    <CardTitle className="text-sm text-amber-700 w-40 truncate">{ing.name}</CardTitle>
                    <CardDescription className="text-amber-600">
                      {(s?.qtyAvailable ?? 0) <= 0 ? 'Brak stanu!' : `${(s?.qtyAvailable ?? 0).toFixed(2)} ${ing.unit}`}
                    </CardDescription>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Składniki',  val: displayIngredients.length,                                                    accent: 'bg-muted' },
          { label: 'Dostępne',   val: displayIngredients.filter(i => (stockMap.get(i.id)?.qtyAvailable ?? 0) > 0).length, accent: 'bg-green-50' },
          { label: 'Alerty',     val: alerts.length,                                                                accent: alerts.length > 0 ? 'bg-amber-50' : 'bg-muted' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <CardDescription className="text-xs font-semibold uppercase tracking-wide mb-1">{k.label}</CardDescription>
              <CardTitle className="text-2xl font-black tabular-nums">{k.val}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stock table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <FlaskConical size={14} className="text-muted-foreground" />
            <CardTitle className="text-base">Stany magazynowe</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIngModal(true)}>Nowy składnik</Button>
            <Button size="sm" onClick={() => { setSelIngId(''); setReceiptModal(true) }}>
              <Plus size={13} className="mr-1.5" /> Przyjęcie PZ
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {displayIngredients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <FlaskConical size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak składników w magazynie</CardTitle>
              <CardDescription className="text-center max-w-xs">
                Dodaj składniki ręcznie lub przez Faktury (kategoria "Przyprawy i dodatki")
              </CardDescription>
            </div>
          ) : (
            <div className="divide-y">
              {/* Header */}
              <div className="grid grid-cols-[1fr_100px_100px_110px_80px_40px] gap-2 px-4 py-2 bg-muted/40">
                {['Nazwa składnika','Stan','Jedn.','Ost. przyjęcie','Ważność',''].map(h => (
                  <CardDescription key={h} className="text-[10px] font-bold uppercase tracking-wide">{h}</CardDescription>
                ))}
              </div>

              {displayIngredients.map(ing => {
                const s    = stockMap.get(ing.id)
                const recs = (receiptMap.get(ing.id) ?? []).sort((a, b) => b.receivedDate > a.receivedDate ? 1 : -1)
                const last = recs[0]
                const isExp = expanded === ing.id
                const qty   = s?.qtyAvailable ?? 0

                return (
                  <div key={ing.id}>
                    <div
                      className="grid grid-cols-[1fr_100px_100px_110px_80px_40px] gap-2 px-4 py-2.5 items-center hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setExpanded(isExp ? null : ing.id)}
                    >
                      <CardTitle className="text-sm font-semibold truncate">{ing.name}</CardTitle>
                      <CardTitle className={`text-sm tabular-nums ${qty > 0 ? 'text-green-700' : 'text-destructive'}`}>
                        {qty.toFixed(3)}
                      </CardTitle>
                      <CardDescription>{ing.unit}</CardDescription>
                      <CardDescription className="text-xs">{last ? fmtDatePl(last.receivedDate) : '—'}</CardDescription>
                      <div>
                        {last?.notes?.includes('Ważność:')
                          ? <ExpiryCell date={last.notes.replace('Ważność: ', '')} />
                          : <CardDescription className="text-xs">—</CardDescription>
                        }
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px] font-medium text-primary"
                          onClick={e => { e.stopPropagation(); setSelIngId(ing.id); setReceiptModal(true) }}
                        >
                          +PZ
                        </Button>
                        {isExp
                          ? <ChevronUp size={14} className="text-muted-foreground" />
                          : <ChevronDown size={14} className="text-muted-foreground" />
                        }
                      </div>
                    </div>

                    {/* History */}
                    {isExp && (
                      <div className="px-4 pb-3 bg-muted/20 border-t">
                        <CardDescription className="text-[10px] font-bold uppercase tracking-wide py-2">Historia przyjęć</CardDescription>
                        {recs.length === 0 ? (
                          <CardDescription className="text-sm">Brak przyjęć — dodaj przez PZ lub Faktury</CardDescription>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                {['Data','Ilość','Cena/jedn.','FV / PZ','Ważność'].map(h => (
                                  <TableHead key={h} className="text-[10px] uppercase tracking-wide">{h}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {recs.slice(0, 10).map(r => (
                                <TableRow key={r.id}>
                                  <TableCell className="text-xs">{fmtDatePl(r.receivedDate)}</TableCell>
                                  <TableCell className="text-xs font-bold">{r.qty} {r.unit}</TableCell>
                                  <TableCell>
                                    <CardDescription className="text-xs">
                                      {r.pricePerUnit > 0 ? `${r.pricePerUnit.toFixed(2)} zł` : '—'}
                                    </CardDescription>
                                  </TableCell>
                                  <TableCell>
                                    <code className="font-mono text-xs text-muted-foreground">{r.invoiceNo || '—'}</code>
                                  </TableCell>
                                  <TableCell>
                                    {r.notes?.includes('Ważność:')
                                      ? <ExpiryCell date={r.notes.replace('Ważność: ', '')} />
                                      : <CardDescription className="text-xs">—</CardDescription>
                                    }
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal: nowy składnik */}
      <Dialog open={ingModal} onOpenChange={v => { if (!v) setIngModal(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nowy składnik</DialogTitle>
            <DialogDescription>Dodaj składnik do magazynu przypraw</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nazwa *</Label>
              <Input
                placeholder="np. Van Hess Hell, Chiken BKS"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategoria</Label>
              <Select value={newCat} onValueChange={v => setNewCat(v as IngredientCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spice_mix">Mieszanka przyprawowa</SelectItem>
                  <SelectItem value="functional">Dodatek funkcjonalny</SelectItem>
                  <SelectItem value="other">Inne</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Jednostka</Label>
              <Select value={newUnit} onValueChange={setNewUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="l">l</SelectItem>
                  <SelectItem value="szt">szt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIngModal(false)} disabled={createLoading}>Anuluj</Button>
            <Button onClick={handleCreateIng} disabled={createLoading || !newName.trim()} className="gap-2">
              {createLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Plus size={14} />
              }
              Dodaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: przyjęcie PZ */}
      <Dialog open={receiptModal} onOpenChange={v => { if (!v) setReceiptModal(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Przyjęcie PZ</DialogTitle>
            <DialogDescription>Ręczne przyjęcie bez faktury</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Składnik *</Label>
              <Select value={selIngId || '__none'} onValueChange={v => setSelIngId(v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                <SelectContent>
                  {displayIngredients.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.name} [{i.unit}]</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ilość *</Label>
                <Input
                  type="number" min="0" step="0.001" placeholder="0.000"
                  value={recQty} onChange={e => setRecQty(e.target.value)}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cena / jedn.</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={recPrice} onChange={e => setRecPrice(e.target.value)}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Data ważności (zalecana)</Label>
              <Input type="date" value={recExpiry} onChange={e => setRecExpiry(e.target.value)} />
              <CardDescription className="text-[10px]">Zazwyczaj +12 miesięcy od daty produkcji</CardDescription>
            </div>
            <div className="space-y-1.5">
              <Label>Nr PZ / FV</Label>
              <Input placeholder="np. PZ 001/2025" value={recInvoice} onChange={e => setRecInvoice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data przyjęcia</Label>
              <Input type="date" value={recDate} onChange={e => setRecDate(e.target.value)} />
            </div>
            <Card className="bg-muted/40 border-transparent">
              <CardContent className="px-3 py-2">
                <CardDescription className="text-xs">
                  💡 Faktura może zostać powiązana później w module Faktury i PZ
                </CardDescription>
              </CardContent>
            </Card>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReceiptModal(false)} disabled={receiptLoading}>Anuluj</Button>
            <Button
              onClick={handleReceipt}
              disabled={receiptLoading || !selIngId || !recQty || parseFloat(recQty) <= 0}
              className="gap-2"
            >
              {receiptLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Plus size={14} />
              }
              Zatwierdź przyjęcie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
