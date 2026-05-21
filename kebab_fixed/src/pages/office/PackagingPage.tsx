/**
 * PackagingPage — Magazyn tulei i opakowań (lista, styl Subiekt GT).
 * Przyjęcie przez modal "Przyjmij na magazyn".
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { packagingApi, suppliersApi } from '@/lib/apiClient'
import { Archive, Package, Plus, Search, X, ChevronDown, ChevronUp, ChevronsUpDown, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CreatePackagingDto, PackagingType } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const TYPE_LABELS: Record<PackagingType, string> = {
  tuleja: 'Tuleja', opakowanie: 'Opakowanie', inne: 'Inne',
}

type SortCol = 'name' | 'type' | 'available' | 'used' | 'supplierName'

function ReceiveForm({ onSave, onClose }: { onSave: (dto: CreatePackagingDto) => Promise<void>; onClose: () => void }) {
  const { data: suppliers } = useApi(() => suppliersApi.list())
  const [form, setForm] = useState<CreatePackagingDto>({
    name: '', type: 'tuleja', unit: 'szt', qty: 0, supplierId: '', expiryDate: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (k: keyof CreatePackagingDto, v: any) => setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.name.trim() || form.qty <= 0) { setError('Podaj nazwę i ilość'); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch(e) { setError(e instanceof Error ? e.message : 'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>Nazwa *</Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="np. Tuleja metal 65cm" />
        </div>
        <div className="space-y-1.5">
          <Label>Typ</Label>
          <Select value={form.type} onValueChange={v => set('type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['tuleja','opakowanie','inne'] as PackagingType[]).map(t => (
                <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Jednostka</Label>
          <Select value={form.unit} onValueChange={v => set('unit', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['szt','kg','rolka','karton'].map(u => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Ilość *</Label>
          <Input type="number" min="0" step="1" value={form.qty || ''} onChange={e => set('qty', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="space-y-1.5">
          <Label>Dostawca</Label>
          <Select value={form.supplierId || '__none'} onValueChange={v => set('supplierId', v === '__none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="— bez dostawcy —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— bez dostawcy —</SelectItem>
              {(suppliers ?? []).map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label>Data ważności</Label>
          <Input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} />
        </div>
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
            : <Package size={14} />
          }
          Przyjmij na magazyn
        </Button>
      </DialogFooter>
    </div>
  )
}

function exportCsv(rows: any[]) {
  const headers = ['Nazwa','Typ','Dostępne','Zużyte','Jedn.','Dostawca']
  const csv = [headers.join(';')].concat(rows.map(r => [
    r.name, TYPE_LABELS[r.type as PackagingType] || r.type,
    String(r.kgAvailable).replace('.', ','),
    String(r.kgUsed).replace('.', ','),
    r.unit, r.supplierName || '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'))).join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `magazyn-opakowan-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export function PackagingPage() {
  const { data: items, loading, refetch } = useApi(() => packagingApi.all())
  const [modal, setModal] = useState(false)
  const [filter, setFilter] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('name')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')

  const rawList = items ?? []

  const list = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = rawList
    if (q) {
      result = rawList.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.code || '').toLowerCase().includes(q) ||
        (i.supplierName || '').toLowerCase().includes(q) ||
        TYPE_LABELS[i.type].toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'name')         cmp = (a.name || '').localeCompare(b.name || '')
      if (sortCol === 'type')         cmp = TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type])
      if (sortCol === 'available')    cmp = a.kgAvailable - b.kgAvailable
      if (sortCol === 'used')         cmp = a.kgUsed - b.kgUsed
      if (sortCol === 'supplierName') cmp = (a.supplierName || '').localeCompare(b.supplierName || '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawList, filter, sortCol, sortDir])

  const totalAvail = list.reduce((s, i) => s + i.kgAvailable, 0)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  async function handleReceive(dto: CreatePackagingDto) {
    await packagingApi.receive(dto)
    refetch()
  }

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Toolbar */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 pr-8 text-sm"
                placeholder="Filtruj: nazwa, typ, dostawca…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                autoFocus
              />
              {filter && (
                <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                  <X size={13}/>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Pozycji:</CardDescription>
              <span className="font-bold">{list.length}{list.length !== rawList.length && <span className="text-muted-foreground">/{rawList.length}</span>}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Dostępne:</CardDescription>
              <span className="font-bold text-emerald-700">{totalAvail.toFixed(0)}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <button onClick={() => exportCsv(list)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-surface-4 hover:bg-surface-2 text-[11px] font-medium" title="Eksportuj CSV">
              <Download size={11}/> CSV
            </button>
            <Button size="sm" className="h-7 px-2.5 text-xs gap-1" onClick={() => setModal(true)}>
              <Plus size={12}/> Przyjmij
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <Archive size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak opakowań</CardTitle>
            <CardDescription>Przyjmij opakowania przyciskiem „Przyjmij"</CardDescription>
          </CardContent>
        ) : list.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników dla „{filter}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  {[
                    { col: 'name'         as SortCol, label: 'Nazwa',     align: 'left'  },
                    { col: 'type'         as SortCol, label: 'Typ',       align: 'left'  },
                    { col: 'available'    as SortCol, label: 'Dostępne',  align: 'right' },
                    { col: 'used'         as SortCol, label: 'Zużyte',    align: 'right' },
                    { col: 'supplierName' as SortCol, label: 'Dostawca',  align: 'left'  },
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
                </tr>
              </thead>
              <tbody>
                {list.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={cn(
                      'border-b border-surface-3 transition-colors',
                      idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                      'hover:bg-blue-50/60'
                    )}
                  >
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink font-medium">
                      {item.name}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                      {TYPE_LABELS[item.type]}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold">
                      <span className={item.kgAvailable > 0 ? 'text-emerald-700' : 'text-muted-foreground'}>
                        {item.kgAvailable}
                      </span>
                      <span className="text-muted-foreground font-normal text-[10px]"> {item.unit}</span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-right text-ink-2">
                      {item.kgUsed}
                      <span className="text-muted-foreground font-normal text-[10px]"> {item.unit}</span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[260px] truncate" title={item.supplierName || ''}>
                      {item.supplierName || <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                <tr>
                  <td colSpan={2} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2">
                    Suma · {list.length} pozycji
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                    {totalAvail.toFixed(0)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={modal} onOpenChange={v => { if (!v) setModal(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Przyjmij opakowania / tuleje</DialogTitle>
            <DialogDescription>Zarejestruj przyjęcie opakowań lub tulei na magazyn</DialogDescription>
          </DialogHeader>
          <ReceiveForm onSave={handleReceive} onClose={() => setModal(false)} />
        </DialogContent>
      </Dialog>

    </div>
  )
}
