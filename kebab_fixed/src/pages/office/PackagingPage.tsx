/**
 * PackagingPage — Magazyn tulei i opakowań
 * Przyjęcie przez FV/WZ, lista stanów
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { packagingApi, suppliersApi } from '@/lib/apiClient'
import { fmtDatePl } from '@/lib/utils'
import { Archive, Package, Plus } from 'lucide-react'
import type { CreatePackagingDto, PackagingType } from '@/lib/mockApi'

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
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'

const TYPE_LABELS: Record<PackagingType, string> = {
  tuleja: 'Tuleja', opakowanie: 'Opakowanie', inne: 'Inne',
}

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
          <Input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="np. Tuleja metal 65cm"
          />
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
          <Input
            type="number" min="0" step="1"
            value={form.qty || ''}
            onChange={e => set('qty', parseFloat(e.target.value) || 0)}
          />
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
          <Input
            type="date"
            value={form.expiryDate}
            onChange={e => set('expiryDate', e.target.value)}
          />
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

export function PackagingPage() {
  const { data: items, loading, refetch } = useApi(() => packagingApi.all())
  const [modal, setModal] = useState(false)
  const [tab,   setTab]   = useState<'all'|'tuleja'|'opakowanie'>('all')

  const filtered    = (items ?? []).filter(i => tab === 'all' || i.type === tab)
  const totalAvail  = filtered.reduce((s, i) => s + i.kgAvailable, 0)

  async function handleReceive(dto: CreatePackagingDto) {
    await packagingApi.receive(dto)
    refetch()
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Tabs + action */}
      <div className="flex items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">Wszystkie</TabsTrigger>
            <TabsTrigger value="tuleja">Tuleje</TabsTrigger>
            <TabsTrigger value="opakowanie">Opakowania</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setModal(true)}>
          <Plus size={14} className="mr-1.5" /> Przyjmij
        </Button>
      </div>

      {/* Table card */}
      <Card>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <CardTitle className="text-sm font-semibold">{filtered.length} pozycji</CardTitle>
          <CardDescription className="text-xs">Łącznie: {totalAvail.toFixed(0)} szt/kg dostępne</CardDescription>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Archive size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak opakowań</CardTitle>
              <CardDescription>Przyjmij opakowania przez przycisk Przyjmij</CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Kod','Nazwa','Typ','Dostępne','Zużyte','Dostawca'].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <code className="font-mono text-xs text-muted-foreground">{item.code}</code>
                    </TableCell>
                    <TableCell>
                      <CardTitle className="text-sm font-semibold">{item.name}</CardTitle>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">{TYPE_LABELS[item.type]}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`font-bold text-sm tabular-nums ${item.kgAvailable > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {item.kgAvailable} {item.unit}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CardDescription className="tabular-nums">{item.kgUsed} {item.unit}</CardDescription>
                    </TableCell>
                    <TableCell>
                      <CardDescription>{item.supplierName || '—'}</CardDescription>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Receive modal */}
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
