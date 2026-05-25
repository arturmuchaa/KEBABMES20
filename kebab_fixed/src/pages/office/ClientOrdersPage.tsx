/**
 * ClientOrdersPage — Zamówienia od kontrahentów (lista, styl Subiekt GT).
 */
import { Fragment, useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, clientsApi, packagingApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, todayIso, cn } from '@/lib/utils'
import {
  Check, CheckCircle2, ChevronDown, ChevronUp, ChevronsUpDown, Clock,
  Pencil, Plus, Printer, ShoppingCart, Trash2, X, Search, Download,
} from 'lucide-react'
import { PalletsEditor } from '@/components/orders/PalletsEditor'
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
import { LinesEditor } from '@/features/orders/order-form/LinesEditor'
import { emptyLine, type LineForm, type OrderLineVariant } from '@/features/orders/order-form/types'

const STATUS_LABELS: Record<ClientOrder['status'], string> = {
  draft: 'Szkic', confirmed: 'Potwierdzone', in_production: 'W produkcji', done: 'Zrealizowane', cancelled: 'Anulowane',
}
const STATUS_VARIANT: Record<ClientOrder['status'], 'secondary' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'secondary', confirmed: 'info', in_production: 'warning', done: 'success', cancelled: 'danger',
}

interface OrderFormProps {
  onSave:       (dto: CreateClientOrderDto) => Promise<void>
  onClose:      () => void
  initialData?: ClientOrder
  variant?:     OrderLineVariant
}

function OrderForm({ onSave, onClose, initialData, variant = 'cards' }: OrderFormProps) {
  const { data: clientList } = useApi(() => clientsApi.list())
  const { data: pkgList }    = useApi(() => packagingApi.list())
  const { productTypes }     = useProductTypes()
  const { recipes }          = useRecipes()

  const [clientId,     setClientId]     = useState(initialData?.clientId ?? '')
  const [orderDate,    setOrderDate]    = useState(initialData?.orderDate ?? todayIso())
  const [deliveryDate, setDeliveryDate] = useState(initialData?.deliveryDate ?? '')
  const [notes,        setNotes]        = useState(initialData?.notes ?? '')
  const [lines,        setLines]        = useState<LineForm[]>(
    initialData?.lines.map(l => ({
      qty: String(l.qty), kgPerUnit: String(l.kgPerUnit),
      productTypeId: l.productTypeId, recipeId: l.recipeId,
      packagingId: l.packagingId ?? '', notes: l.notes ?? '',
    })) ?? [emptyLine()]
  )
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  const clients   = clientList ?? []
  const packaging = pkgList    ?? []

  function setLine(i: number, k: keyof LineForm, v: string) {
    setLines(p => p.map((l, j) => j === i ? { ...l, [k]: v } : l))
  }
  const addLine = () => setLines(p => [...p, emptyLine()])
  const removeLine = (i: number) => setLines(p => p.filter((_, j) => j !== i))

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
          productTypeId: l.productTypeId,
          productTypeName: (productTypes ?? []).find((pt: any) => pt.id === l.productTypeId)?.name
                        || (recipes ?? []).find((r: any) => r.id === l.recipeId)?.productTypeName
                        || '',
          recipeId: l.recipeId,
          recipeName: (recipes ?? []).find((r: any) => r.id === l.recipeId)?.name || '',
          packagingId: l.packagingId || undefined,
          packagingName: l.packagingId ? (packaging.find((p: any) => p.id === l.packagingId)?.name || '') : undefined,
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
              {clients.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.displayName || c.name}
                  {c.displayName && c.displayName !== c.name && (
                    <span className="text-muted-foreground"> · {c.name}</span>
                  )}
                </SelectItem>
              ))}
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
        <LinesEditor
          variant={variant}
          lines={lines}
          setLine={setLine}
          setLines={setLines}
          addLine={addLine}
          removeLine={removeLine}
          productTypes={productTypes ?? []}
          recipes={recipes ?? []}
          packaging={packaging}
        />
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

type SortCol = 'orderNo' | 'clientName' | 'orderDate' | 'deliveryDate' | 'status' | 'totalUnits' | 'totalKg' | 'progress'

function progressOf(o: ClientOrder): number {
  if (!o.totalUnits) return 0
  const done = o.lines.reduce((s, l) => s + ((l as any).qtyDone ?? 0), 0)
  return Math.min(100, Math.round((done / o.totalUnits) * 100))
}

function exportCsv(rows: ClientOrder[]) {
  const headers = ['Nr zam.','Klient','Data zam.','Dostawa','Status','Szt','Razem kg','% wykonania','Uwagi']
  const csv = [headers.join(';')].concat(rows.map(o => [
    o.orderNo, o.clientName,
    o.orderDate, o.deliveryDate || '',
    STATUS_LABELS[o.status],
    String(o.totalUnits),
    String(o.totalKg).replace('.', ','),
    String(progressOf(o)),
    o.notes || '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'))).join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `zamowienia-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export function ClientOrdersPage({ variant = 'cards' }: { variant?: OrderLineVariant }) {
  const { data: orders, loading, refetch } = useApi(() => clientOrdersApi.list())
  const [modal,        setModal]        = useState(false)
  const [editOrder,    setEditOrder]    = useState<ClientOrder | null>(null)
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [search,       setSearch]       = useState('')
  const [sortCol,      setSortCol]      = useState<SortCol>('orderDate')
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('desc')

  const rawList = orders ?? []

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let result = rawList
    if (filterStatus) result = result.filter(o => o.status === filterStatus)
    if (q) {
      result = result.filter(o =>
        (o.orderNo || '').toLowerCase().includes(q)
        || (o.clientName || '').toLowerCase().includes(q)
        || (o.notes || '').toLowerCase().includes(q)
        || (o.lines || []).some(l =>
          (l.recipeName || '').toLowerCase().includes(q)
          || (l.productTypeName || '').toLowerCase().includes(q)
          || (l.packagingName || '').toLowerCase().includes(q)
        )
      )
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'orderNo')      cmp = a.orderNo.localeCompare(b.orderNo)
      if (sortCol === 'clientName')   cmp = a.clientName.localeCompare(b.clientName)
      if (sortCol === 'orderDate')    cmp = (a.orderDate    || '').localeCompare(b.orderDate    || '')
      if (sortCol === 'deliveryDate') cmp = (a.deliveryDate || '').localeCompare(b.deliveryDate || '')
      if (sortCol === 'status')       cmp = a.status.localeCompare(b.status)
      if (sortCol === 'totalUnits')   cmp = a.totalUnits - b.totalUnits
      if (sortCol === 'totalKg')      cmp = a.totalKg - b.totalKg
      if (sortCol === 'progress')     cmp = progressOf(a) - progressOf(b)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawList, filterStatus, search, sortCol, sortDir])

  const totalKg    = filtered.reduce((s, o) => s + o.totalKg, 0)
  const totalUnits = filtered.reduce((s, o) => s + o.totalUnits, 0)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  async function handleCreate(dto: CreateClientOrderDto) { await clientOrdersApi.create(dto); refetch() }
  async function handleUpdate(dto: CreateClientOrderDto) {
    if (!editOrder) return
    await clientOrdersApi.update(editOrder.id, dto)
    refetch()
  }
  async function handleStatus(id: string, status: ClientOrder['status']) { await clientOrdersApi.updateStatus(id, status); refetch() }
  async function handleDelete(id: string) {
    if (!confirm('Usunąć to zamówienie?')) return
    await clientOrdersApi.delete(id); refetch()
  }

  const STATUS_BADGE_CLS: Record<ClientOrder['status'], string> = {
    draft:         'bg-gray-50 text-gray-700 border-gray-200',
    confirmed:     'bg-blue-50 text-blue-700 border-blue-200',
    in_production: 'bg-amber-50 text-amber-700 border-amber-200',
    done:          'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled:     'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Toolbar */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 pr-8 text-sm"
                placeholder="Filtruj: nr zam., klient, receptura, tuleja, uwagi…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                  <X size={14}/>
                </button>
              )}
            </div>
            <Select value={filterStatus || '__all'} onValueChange={v => setFilterStatus(v === '__all' ? '' : v)}>
              <SelectTrigger className="h-9 w-48 text-sm">
                <SelectValue placeholder="Wszystkie statusy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Wszystkie statusy</SelectItem>
                {(['draft','confirmed','in_production','done','cancelled'] as ClientOrder['status'][]).map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Zamówień:</CardDescription>
              <span className="font-bold">{filtered.length}{filtered.length !== rawList.length && <span className="text-muted-foreground">/{rawList.length}</span>}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Szt:</CardDescription>
              <span className="font-bold">{totalUnits}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Kg:</CardDescription>
              <span className="font-bold text-emerald-700">{fmtKg(totalKg, 0)}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <button onClick={() => exportCsv(filtered)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-surface-4 hover:bg-surface-2 text-xs font-medium" title="Eksportuj CSV">
              <Download size={12}/> CSV
            </button>
            <Button size="sm" className="h-7 px-2.5 text-xs gap-1" onClick={() => setModal(true)}>
              <Plus size={12}/> Nowe
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <ShoppingCart size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak zamówień</CardTitle>
            <CardDescription>Dodaj pierwsze zamówienie od klienta</CardDescription>
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  <th className="w-6" />
                  {[
                    { col: 'orderNo'      as SortCol, label: 'Nr zam.',   align: 'left'  },
                    { col: 'clientName'   as SortCol, label: 'Klient',    align: 'left'  },
                    { col: 'orderDate'    as SortCol, label: 'Data',      align: 'left'  },
                    { col: 'deliveryDate' as SortCol, label: 'Dostawa',   align: 'left'  },
                    { col: 'status'       as SortCol, label: 'Status',    align: 'left'  },
                    { col: 'totalUnits'   as SortCol, label: 'Szt',       align: 'right' },
                    { col: 'totalKg'      as SortCol, label: 'Razem kg',  align: 'right' },
                    { col: 'progress'     as SortCol, label: 'Postęp',    align: 'left'  },
                  ].map(h => (
                    <th
                      key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className={cn(
                        'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                        h.align === 'right' && 'text-right',
                      )}
                    >
                      <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                        {h.label}
                        <SortIcon col={h.col} />
                      </span>
                    </th>
                  ))}
                  <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Akcja</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o, idx) => {
                  const isExp = expanded === o.id
                  const qtyDone = o.lines.reduce((s, l) => s + ((l as any).qtyDone ?? 0), 0)
                  const kgDone  = o.lines.reduce((s, l) => s + ((l as any).qtyDone ?? 0) * l.kgPerUnit, 0)
                  const pct     = progressOf(o)
                  const isDue   = o.deliveryDate
                    ? new Date(o.deliveryDate).getTime() - Date.now() < 1000 * 60 * 60 * 48
                    : false

                  return (
                    <Fragment key={o.id}>
                      <tr
                        onClick={() => setExpanded(isExp ? null : o.id)}
                        className={cn(
                          'cursor-pointer border-b border-surface-3 transition-colors',
                          idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                          isExp ? 'bg-blue-50/40' : 'hover:bg-blue-50/60',
                        )}
                      >
                        <td className="px-1 py-2 text-center text-muted-foreground">
                          {isExp ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <code className="font-mono font-bold text-primary text-[13px]">{o.orderNo}</code>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink font-medium max-w-[240px] truncate" title={o.clientName}>
                          {o.clientName}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                          {fmtDatePl(o.orderDate)}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          {o.deliveryDate ? (
                            <span className={isDue && o.status !== 'done' && o.status !== 'cancelled' ? 'text-red-600 font-semibold' : 'text-ink-2'}>
                              {fmtDatePl(o.deliveryDate)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <Badge variant="outline" className={cn('text-[10px] font-medium', STATUS_BADGE_CLS[o.status])}>
                            {STATUS_LABELS[o.status]}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-right">
                          {qtyDone > 0 ? (
                            <>
                              <span className={pct >= 100 ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                                {qtyDone}
                              </span>
                              <span className="text-muted-foreground">/{o.totalUnits}</span>
                            </>
                          ) : (
                            <span className="font-bold">{o.totalUnits}</span>
                          )}
                          <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold text-emerald-700">
                          {fmtKg(o.totalKg, 0)}<span className="font-normal text-[11px]"> kg</span>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap min-w-[140px]">
                          {qtyDone > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden flex-1 max-w-[100px]">
                                <div
                                  className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-orange-400')}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className={cn('text-[11px] font-semibold tabular-nums', pct >= 100 ? 'text-emerald-700' : 'text-amber-700')}>
                                {pct}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                const url = `/office/zamowienia/${o.id}/druk`
                                const win = window.open(url, '_blank')
                                if (!win || win.closed || typeof win.closed === 'undefined') {
                                  window.location.href = url
                                }
                              }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                              title="Drukuj"
                            >
                              <Printer size={13}/>
                            </button>
                            {o.status === 'draft' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleStatus(o.id, 'confirmed') }}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                title="Potwierdź"
                              >
                                <Check size={13}/>
                              </button>
                            )}
                            {(o.status === 'draft' || o.status === 'confirmed') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditOrder(o) }}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                                title="Edytuj"
                              >
                                <Pencil size={13}/>
                              </button>
                            )}
                            {(o.status === 'draft' || o.status === 'confirmed') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(o.id) }}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Usuń"
                              >
                                <Trash2 size={13}/>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Rozwinięcie: pozycje + palety */}
                      {isExp && (
                        <tr>
                          <td colSpan={10} className="bg-blue-50/20 border-b border-surface-3 px-4 py-3">
                            {o.notes && (
                              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs">
                                <span className="font-bold text-amber-700">Uwagi: </span>
                                <span className="text-amber-900">{o.notes}</span>
                              </div>
                            )}

                            {/* Lines */}
                            <div className="mb-3">
                              <CardDescription className="text-[11px] font-bold uppercase tracking-wide mb-1.5">
                                Pozycje zamówienia ({o.lines.length})
                              </CardDescription>
                              <div className="overflow-x-auto rounded border border-surface-3 bg-white">
                                <table className="w-full text-xs tabular-nums">
                                  <thead className="bg-surface-2">
                                    <tr>
                                      {['Status','Szt','kg','Razem kg','Rodzaj','Receptura','Tuleja'].map(h => (
                                        <th key={h} className="px-2.5 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-ink-2 whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {o.lines.map((l, li) => {
                                      const lineDone = (l as any).qtyDone ?? 0
                                      const isLineDone    = lineDone >= l.qty
                                      const isLinePartial = lineDone > 0 && !isLineDone
                                      return (
                                        <tr key={l.id} className={li % 2 === 0 ? 'bg-white' : 'bg-surface-2/40'}>
                                          <td className="px-2.5 py-2 whitespace-nowrap">
                                            {isLineDone ? (
                                              <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                                                <CheckCircle2 size={10}/> {lineDone}/{l.qty}
                                              </Badge>
                                            ) : isLinePartial ? (
                                              <Badge variant="outline" className="text-[10px] gap-1 bg-amber-50 text-amber-700 border-amber-200">
                                                <Clock size={10}/> {lineDone}/{l.qty}
                                              </Badge>
                                            ) : (
                                              <span className="text-muted-foreground text-[11px]">—</span>
                                            )}
                                          </td>
                                          <td className="px-2.5 py-2 font-bold">{l.qty}<span className="text-muted-foreground font-normal text-[11px]"> szt</span></td>
                                          <td className="px-2.5 py-2 text-ink-2">{l.kgPerUnit}<span className="text-muted-foreground text-[11px]"> kg</span></td>
                                          <td className="px-2.5 py-2 font-bold text-emerald-700">{fmtKg(l.totalKg, 0)}<span className="font-normal text-[11px]"> kg</span></td>
                                          <td className="px-2.5 py-2 text-ink">{l.productTypeName || <span className="text-muted-foreground">—</span>}</td>
                                          <td className="px-2.5 py-2 text-ink-2">{l.recipeName || <span className="text-muted-foreground">—</span>}</td>
                                          <td className="px-2.5 py-2 text-ink-2">{l.packagingName || <span className="text-muted-foreground">—</span>}</td>
                                        </tr>
                                      )
                                    })}
                                    <tr className="border-t-2 border-surface-4 bg-surface-2/60 font-bold">
                                      <td className="px-2.5 py-2 text-[11px] uppercase tracking-wider text-ink-2">Suma</td>
                                      <td className="px-2.5 py-2">{o.totalUnits}<span className="text-muted-foreground font-normal text-[11px]"> szt</span></td>
                                      <td />
                                      <td className="px-2.5 py-2 text-emerald-700">{fmtKg(o.totalKg, 0)}<span className="font-normal text-[11px]"> kg</span></td>
                                      <td colSpan={3} />
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Progress (jeśli jakikolwiek) */}
                            {kgDone > 0 && (
                              <div className="mb-3 px-3 py-2 bg-white rounded border border-surface-3">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className={cn('text-xs font-semibold', pct >= 100 ? 'text-emerald-700' : 'text-amber-700')}>
                                    Wyprodukowano {fmtKg(kgDone, 0)} kg z {fmtKg(o.totalKg, 0)} kg
                                  </span>
                                  <span className={cn('text-xs font-bold', pct >= 100 ? 'text-emerald-700' : 'text-amber-700')}>{pct}%</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-orange-400')}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Palety */}
                            <PalletsEditor orderId={o.id} lines={o.lines} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                <tr>
                  <td className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2" colSpan={6}>
                    Suma · {filtered.length} zamówień
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-ink">
                    {totalUnits}<span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                    {fmtKg(totalKg, 0)} kg
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* New order modal */}
      <Dialog open={modal} onOpenChange={v => { if (!v) setModal(false) }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Nowe zamówienie od klienta</DialogTitle>
            <DialogDescription>Utwórz zamówienie z pozycjami produktów</DialogDescription>
          </DialogHeader>
          <OrderForm variant={variant} onSave={handleCreate} onClose={() => setModal(false)} />
        </DialogContent>
      </Dialog>

      {/* Edit order modal */}
      <Dialog open={!!editOrder} onOpenChange={v => { if (!v) setEditOrder(null) }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Edycja zamówienia {editOrder?.orderNo}</DialogTitle>
            <DialogDescription>Zmień pozycje lub dane zamówienia</DialogDescription>
          </DialogHeader>
          {editOrder && (
            <OrderForm
              variant={variant}
              initialData={editOrder}
              onSave={handleUpdate}
              onClose={() => setEditOrder(null)}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
