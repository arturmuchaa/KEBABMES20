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
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'

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

  const rawList = items ?? []
  const totalAvail = rawList.reduce((s, i) => s + i.kgAvailable, 0)

  async function handleReceive(dto: CreatePackagingDto) {
    await packagingApi.receive(dto)
    refetch()
  }

  usePageHeaderActions(
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Pozycji: <span className="text-ink font-bold">{rawList.length}</span></span>
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Dostępne: <span className="text-emerald-700 font-bold">{totalAvail.toFixed(0)}</span></span>
      <Button size="sm" className="gap-1.5" onClick={() => setModal(true)}><Plus size={14}/> Przyjmij</Button>
    </div>,
    [rawList.length, totalAvail]
  )

  return (
    <div className="animate-fade-in">
      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 space-y-2">
          {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rawList.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <Archive size={36} className="text-muted-foreground opacity-20" />
          <div className="text-sm font-medium text-muted-foreground">Brak opakowań</div>
          <div className="text-xs text-muted-foreground">Przyjmij opakowania przyciskiem „Przyjmij"</div>
        </div>
      ) : (
        <DataTable
          rows={rawList} rowKey={i => i.id}
          searchText={i => `${i.name || ''} ${i.code || ''} ${i.supplierName || ''} ${TYPE_LABELS[i.type]}`}
          searchPlaceholder="Filtruj: nazwa, typ, dostawca…"
          initialSort={{ key: 'name' }}
          footer={rows => {
            const sum = rows.reduce((s, i) => s + i.kgAvailable, 0)
            return <><span>Suma · {rows.length} pozycji</span><span className="ml-auto">Dostępne: <span className="text-emerald-700 font-bold">{sum.toFixed(0)}</span></span></>
          }}
          columns={[
            { key: 'name', header: 'Nazwa', sortable: true, sortValue: i => i.name || '',
              cell: i => <span className="text-ink font-medium">{i.name}</span> },
            { key: 'type', header: 'Typ', sortable: true, sortValue: i => TYPE_LABELS[i.type],
              cell: i => TYPE_LABELS[i.type] },
            { key: 'available', header: 'Dostępne', align: 'right', sortable: true, sortValue: i => i.kgAvailable,
              cell: i => <><span className={i.kgAvailable > 0 ? 'text-emerald-700 font-bold' : 'text-muted-foreground'}>{i.kgAvailable}</span><span className="text-muted-foreground font-normal text-[10px]"> {i.unit}</span></> },
            { key: 'used', header: 'Zużyte', align: 'right', sortable: true, sortValue: i => i.kgUsed,
              cell: i => <span className="text-ink-2">{i.kgUsed}<span className="text-muted-foreground font-normal text-[10px]"> {i.unit}</span></span> },
            { key: 'supplierName', header: 'Dostawca', sortable: true, sortValue: i => i.supplierName || '',
              cell: i => <span className="truncate block max-w-[260px]" title={i.supplierName || ''}>{i.supplierName || <span className="text-muted-foreground">—</span>}</span> },
          ]}
        />
      )}

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
