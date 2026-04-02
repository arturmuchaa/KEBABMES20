/**
 * ClientOrdersPage — Zamówienia od kontrahentów
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, clientsApi, packagingApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, todayIso } from '@/lib/utils'
import { Check, ChevronDown, ChevronUp, Plus, ShoppingCart, Trash2, X } from 'lucide-react'
import { useProductTypes } from '@/features/products/hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import type { ClientOrder, CreateClientOrderDto } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardTitle,
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

interface LineForm {
  qty: string; kgPerUnit: string; productTypeId: string; recipeId: string; packagingId: string; notes: string
}
const emptyLine = (): LineForm => ({ qty: '', kgPerUnit: '', productTypeId: '', recipeId: '', packagingId: '', notes: '' })

const STATUS_LABELS: Record<ClientOrder['status'], string> = {
  draft: 'Szkic', confirmed: 'Potwierdzone', in_production: 'W produkcji', done: 'Zrealizowane', cancelled: 'Anulowane',
}
const STATUS_VARIANT: Record<ClientOrder['status'], 'secondary' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'secondary', confirmed: 'info', in_production: 'warning', done: 'success', cancelled: 'danger',
}

function OrderForm({ onSave, onClose }: { onSave: (dto: CreateClientOrderDto) => Promise<void>; onClose: () => void }) {
  const { data: clientList } = useApi(() => clientsApi.list())
  const { data: pkgList }    = useApi(() => packagingApi.list())
  const { productTypes }     = useProductTypes()
  const { recipes }          = useRecipes()

  const [clientId,     setClientId]     = useState('')
  const [orderDate,    setOrderDate]    = useState(todayIso())
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes,        setNotes]        = useState('')
  const [lines,        setLines]        = useState<LineForm[]>([emptyLine()])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  const clients   = clientList ?? []
  const packaging = pkgList    ?? []

  function setLine(i: number, k: keyof LineForm, v: string) {
    setLines(p => p.map((l, j) => j === i ? { ...l, [k]: v } : l))
  }

  const totals = useMemo(() => ({
    totalUnits: lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0),
    totalKg:    lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.kgPerUnit) || 0), 0),
  }), [lines])

  async function handleSave() {
    if (!clientId) { setError('Wybierz klienta'); return }
    const validLines = lines.filter(l => l.productTypeId && l.recipeId && parseFloat(l.qty) > 0 && parseFloat(l.kgPerUnit) > 0)
    if (validLines.length === 0) { setError('Dodaj przynajmniej jedną pozycję'); return }
    setSaving(true)
    try {
      await onSave({
        clientId, orderDate, deliveryDate: deliveryDate || undefined, notes: notes || undefined,
        lines: validLines.map(l => ({
          qty: parseFloat(l.qty), kgPerUnit: parseFloat(l.kgPerUnit),
          productTypeId: l.productTypeId, recipeId: l.recipeId,
          packagingId: l.packagingId || undefined,
        })),
      })
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
      {/* Nagłówek zamówienia */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Klient *</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger><SelectValue placeholder="Wybierz klienta..." /></SelectTrigger>
            <SelectContent>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Data zamówienia</Label>
          <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Termin dostawy</Label>
          <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
        </div>
      </div>

      <Separator />

      {/* Pozycje */}
      <div className="space-y-3">
        <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pozycje zamówienia</Label>
        {lines.map((line, i) => {
          const totalKg = (parseFloat(line.qty) || 0) * (parseFloat(line.kgPerUnit) || 0)
          const filteredRecipes = recipes.filter(r =>
            !line.productTypeId || !r.productTypeId || r.productTypeId === line.productTypeId
          )
          return (
            <Card key={i} className="border-muted">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-3">
                  <CardDescription className="text-xs font-bold uppercase">Pozycja {i + 1}</CardDescription>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setLines(p => p.filter((_, j) => j !== i))}>
                      <X size={12} />
                    </Button>
                  )}
                </div>
                <div className="grid gap-2" style={{gridTemplateColumns: '80px 80px 1fr 1fr 1fr 90px'}}>
                  <div className="space-y-1">
                    <Label className="text-[9px]">Ilość (szt)</Label>
                    <Input type="number" min="1" step="1" value={line.qty} onChange={e => setLine(i, 'qty', e.target.value)} placeholder="20" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[9px]">kg/szt</Label>
                    <Input type="number" min="0.1" step="0.1" value={line.kgPerUnit} onChange={e => setLine(i, 'kgPerUnit', e.target.value)} placeholder="40" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[9px]">Rodzaj produktu</Label>
                    <Select value={line.productTypeId} onValueChange={v => { setLine(i, 'productTypeId', v); setLine(i, 'recipeId', '') }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Wybierz..." /></SelectTrigger>
                      <SelectContent>
                        {(productTypes ?? []).map(pt => <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
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
                      <span className="text-xs font-bold text-blue-700 tabular-nums whitespace-nowrap">= {fmtKg(totalKg, 0)} kg</span>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
        <Button variant="ghost" size="sm" onClick={() => setLines(p => [...p, emptyLine()])} className="gap-1.5 text-primary">
          <Plus size={13} /> Dodaj pozycję
        </Button>
      </div>

      {/* Suma */}
      <Card className="bg-muted/40 border-transparent">
        <CardContent className="px-4 py-3 flex items-center justify-between">
          <CardDescription className="text-xs font-bold uppercase">Suma zamówienia:</CardDescription>
          <div className="text-right">
            <CardTitle className="text-xl font-black text-primary tabular-nums">{fmtKg(totals.totalKg, 0)} kg</CardTitle>
            <CardDescription className="text-xs">{totals.totalUnits} szt</CardDescription>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1.5">
        <Label>Uwagi</Label>
        <textarea
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="px-3 py-2">
            <CardDescription className="text-destructive font-medium">{error}</CardDescription>
          </CardContent>
        </Card>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Anuluj</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Plus size={14} />
          }
          Zapisz zamówienie
        </Button>
      </DialogFooter>
    </div>
  )
}

export function ClientOrdersPage() {
  const { data: orders, loading, refetch } = useApi(() => clientOrdersApi.list())
  const [modal,        setModal]        = useState(false)
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')

  const filtered = (orders ?? []).filter(o => !filterStatus || o.status === filterStatus)

  async function handleCreate(dto: CreateClientOrderDto) { await clientOrdersApi.create(dto); refetch() }
  async function handleStatus(id: string, status: ClientOrder['status']) { await clientOrdersApi.updateStatus(id, status); refetch() }
  async function handleDelete(id: string) { await clientOrdersApi.delete(id); refetch() }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Filter + action */}
      <div className="flex gap-3">
        <Select value={filterStatus || '__all'} onValueChange={v => setFilterStatus(v === '__all' ? '' : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Wszystkie statusy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Wszystkie statusy</SelectItem>
            {(['draft','confirmed','in_production','done','cancelled'] as ClientOrder['status'][]).map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setModal(true)}>
            <Plus size={14} className="mr-1.5" /> Nowe zamówienie
          </Button>
        </div>
      </div>

      {/* Orders list */}
      <Card>
        <div className="flex items-center gap-2 px-5 py-3 border-b">
          <CardTitle className="text-sm font-semibold">{filtered.length} zamówień</CardTitle>
          <CardDescription className="text-xs">
            · łącznie {fmtKg(filtered.reduce((s, o) => s + o.totalKg, 0), 0)} kg
          </CardDescription>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0,1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShoppingCart size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak zamówień</CardTitle>
              <CardDescription>Dodaj zamówienie od klienta</CardDescription>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(o => {
                const isExp = expanded === o.id
                return (
                  <div key={o.id}>
                    {/* Row */}
                    <div
                      className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setExpanded(isExp ? null : o.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <code className="font-mono font-bold text-primary text-sm">{o.orderNo}</code>
                          <Badge variant={STATUS_VARIANT[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                        </div>
                        <CardTitle className="text-sm font-semibold">{o.clientName}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {fmtDatePl(o.orderDate)} · {o.lines.length} poz. · {fmtKg(o.totalKg, 0)} kg · {o.totalUnits} szt
                          {o.deliveryDate && ` · dostawa: ${fmtDatePl(o.deliveryDate)}`}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1">
                        {o.status === 'draft' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50 gap-1"
                            onClick={e => { e.stopPropagation(); handleStatus(o.id, 'confirmed') }}
                          >
                            <Check size={11} /> Potwierdź
                          </Button>
                        )}
                        {o.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={e => { e.stopPropagation(); handleDelete(o.id) }}
                          >
                            <Trash2 size={12} />
                          </Button>
                        )}
                        {isExp ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Expanded lines */}
                    {isExp && (
                      <div className="px-4 pb-4 bg-muted/20 border-t">
                        <Table className="mt-3">
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              {['Szt','kg/szt','Razem kg','Rodzaj','Receptura','Tuleja'].map(h => (
                                <TableHead key={h} className="text-[9px] uppercase tracking-wide">{h}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {o.lines.map(l => (
                              <TableRow key={l.id}>
                                <TableCell className="font-bold text-xs">{l.qty}</TableCell>
                                <TableCell className="text-xs">{l.kgPerUnit} kg</TableCell>
                                <TableCell>
                                  <CardTitle className="text-xs text-primary tabular-nums">{fmtKg(l.totalKg, 0)} kg</CardTitle>
                                </TableCell>
                                <TableCell className="text-xs">{l.productTypeName}</TableCell>
                                <TableCell className="text-xs">{l.recipeName}</TableCell>
                                <TableCell>
                                  <CardDescription className="text-xs">{l.packagingName || '—'}</CardDescription>
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-bold">
                              <TableCell className="text-xs">{o.totalUnits} szt</TableCell>
                              <TableCell />
                              <TableCell>
                                <CardTitle className="text-xs text-primary">{fmtKg(o.totalKg, 0)} kg</CardTitle>
                              </TableCell>
                              <TableCell colSpan={3} />
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New order modal */}
      <Dialog open={modal} onOpenChange={v => { if (!v) setModal(false) }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Nowe zamówienie od klienta</DialogTitle>
            <DialogDescription>Utwórz zamówienie z pozycjami produktów</DialogDescription>
          </DialogHeader>
          <OrderForm onSave={handleCreate} onClose={() => setModal(false)} />
        </DialogContent>
      </Dialog>

    </div>
  )
}
