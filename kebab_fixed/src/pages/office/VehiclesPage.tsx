/**
 * VehiclesPage — zarządzanie samochodami do załadunku.
 */
import { useState } from 'react'
import { Plus, Truck, Pencil, Trash2, Building2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useApi, useMutation } from '@/hooks/useApi'
import {
  vehiclesApi,
  type Vehicle,
  type VehicleInput,
  type VehicleKind,
  type VehicleType,
} from '@/lib/api'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const KIND_LABEL: Record<VehicleKind, string> = {
  own: 'Firmowy',
  external: 'Spedycja',
}

const TYPE_LABEL: Record<VehicleType, string> = {
  dostawczy: 'Dostawczy',
  tir: 'TIR',
  solo: 'SOLO',
  inny: 'Inny',
}

function emptyForm(): VehicleInput {
  return {
    name: '',
    plate: '',
    kind: 'own',
    vehicleType: 'dostawczy',
    sortOrder: 0,
    notes: '',
    active: true,
  }
}

interface VehicleModalProps {
  open: boolean
  mode: 'create' | 'edit'
  form: VehicleInput
  loading: boolean
  error: string | null
  onClose: () => void
  onSubmit: () => void
  onField: <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) => void
}

function VehicleModal({ open, mode, form, loading, error, onClose, onSubmit, onField }: VehicleModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edytuj samochód' : 'Nowy samochód'}</DialogTitle>
          <DialogDescription>
            Pojazdy używane przy załadunku — dostępne na liście /mobile/zaladunek.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nazwa *</Label>
            <Input
              placeholder="np. Samochód dostawczy / TIR spedycja"
              value={form.name}
              onChange={(e) => onField('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Numer rejestracyjny</Label>
              <Input
                placeholder="np. KRA621AK"
                value={form.plate}
                onChange={(e) => onField('plate', e.target.value)}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kolejność na liście</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => onField('sortOrder', Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Przynależność</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.kind}
                onChange={(e) => onField('kind', e.target.value as VehicleKind)}
              >
                <option value="own">Firmowy</option>
                <option value="external">Spedycja zewnętrzna</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Typ</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.vehicleType}
                onChange={(e) => onField('vehicleType', e.target.value as VehicleType)}
              >
                <option value="dostawczy">Dostawczy</option>
                <option value="tir">TIR</option>
                <option value="solo">SOLO</option>
                <option value="inny">Inny</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notatki</Label>
            <Input
              placeholder="np. nazwa firmy spedycyjnej"
              value={form.notes}
              onChange={(e) => onField('notes', e.target.value)}
            />
          </div>

          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active ?? true}
                onChange={(e) => onField('active', e.target.checked)}
              />
              Aktywny
            </label>
          )}

          {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Anuluj</Button>
          <Button onClick={onSubmit} disabled={loading || !form.name.trim()}>
            {mode === 'edit' ? 'Zapisz' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function VehiclesPage() {
  const res = useApi(() => vehiclesApi.list(true), [])
  const items = res.data ?? []

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<VehicleInput>(emptyForm())

  const createMut = useMutation(vehiclesApi.create)
  const updateMut = useMutation((p: { id: string; dto: VehicleInput }) => vehiclesApi.update(p.id, p.dto))
  const deleteMut = useMutation(vehiclesApi.remove)

  function openCreate() {
    setMode('create')
    setEditId(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(v: Vehicle) {
    setMode('edit')
    setEditId(v.id)
    setForm({
      name: v.name,
      plate: v.plate,
      kind: v.kind,
      vehicleType: v.vehicleType,
      sortOrder: v.sortOrder,
      notes: v.notes,
      active: v.active,
    })
    setOpen(true)
  }

  async function submit() {
    try {
      if (mode === 'edit' && editId) {
        await updateMut.mutate({ id: editId, dto: form })
        toast.success('Zapisano')
      } else {
        await createMut.mutate(form)
        toast.success('Dodano samochód')
      }
      setOpen(false)
      res.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd')
    }
  }

  async function remove(v: Vehicle) {
    if (!confirm(`Usunąć samochód "${v.name}"?`)) return
    try {
      await deleteMut.mutate(v.id)
      toast.success('Usunięto')
      res.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd')
    }
  }

  const error = mode === 'edit' ? updateMut.error : createMut.error
  const loading = mode === 'edit' ? updateMut.loading : createMut.loading

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Truck size={22} /> Samochody do załadunku
          </h1>
          <p className="text-sm text-muted-foreground">
            Lista pojazdów dostępnych w widoku skanowania /mobile/zaladunek.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={14} /> Dodaj samochód
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {res.loading && <div className="py-6 text-center text-sm text-muted-foreground">Ładowanie…</div>}
          {!res.loading && items.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Brak samochodów</div>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Nazwa</TableHead>
                  <TableHead>Rejestracja</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Przynależność</TableHead>
                  <TableHead>Notatki</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((v) => (
                  <TableRow key={v.id} className={v.active ? '' : 'opacity-50'}>
                    <TableCell className="font-mono">{v.sortOrder}</TableCell>
                    <TableCell className="font-semibold">
                      {v.name}
                      {!v.active && <Badge variant="outline" className="ml-2">Nieaktywny</Badge>}
                    </TableCell>
                    <TableCell className="font-mono">{v.plate || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Badge variant="outline">{TYPE_LABEL[v.vehicleType] ?? v.vehicleType}</Badge></TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-sm">
                        {v.kind === 'own' ? <Building2 size={13} /> : <Users size={13} />}
                        {KIND_LABEL[v.kind]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.notes}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(v)} aria-label="Edytuj">
                        <Pencil size={14} />
                      </Button>
                      {v.active && (
                        <Button variant="ghost" size="icon" onClick={() => remove(v)} aria-label="Usuń">
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <VehicleModal
        open={open}
        mode={mode}
        form={form}
        loading={loading}
        error={error}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        onField={(k, v) => setForm((prev) => ({ ...prev, [k]: v }))}
      />
    </div>
  )
}
