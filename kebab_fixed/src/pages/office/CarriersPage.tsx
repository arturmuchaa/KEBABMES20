/**
 * CarriersPage — Słownik Przewoźnicy
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { carriersApi } from '@/lib/api'
import type { Carrier, CarrierInput } from '@/lib/api'
import {
  Truck, Pencil, Plus, Search, X,
  ChevronDown, ChevronUp, ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

// ─── helpers ─────────────────────────────────────────────────────────────────

function emptyForm(): CarrierInput {
  return {
    name: '', address: '', postal_code: '', city: '', country: '',
    nip: '', vat_eu: '', default_plate: '', phone: '', notes: '',
  }
}

function carrierToInput(c: Carrier): CarrierInput {
  return {
    name:          c.name,
    address:       c.address,
    postal_code:   c.postalCode,
    city:          c.city,
    country:       c.country,
    nip:           c.nip,
    vat_eu:        c.vatEu,
    default_plate: c.defaultPlate,
    phone:         c.phone,
    notes:         c.notes,
  }
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function CarrierForm({ initial, onSave, onClose }: {
  initial?: Carrier | null
  onSave: (dto: CarrierInput) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<CarrierInput>(
    initial ? carrierToInput(initial) : emptyForm()
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (k: keyof CarrierInput, v: string) =>
    setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setError('Podaj nazwę przewoźnika'); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Błąd') }
    finally { setSaving(false) }
  }

  const fields: { k: keyof CarrierInput; label: string }[] = [
    { k: 'name',          label: 'Nazwa *' },
    { k: 'address',       label: 'Adres' },
    { k: 'postal_code',   label: 'Kod pocztowy' },
    { k: 'city',          label: 'Miasto' },
    { k: 'country',       label: 'Kraj' },
    { k: 'nip',           label: 'NIP' },
    { k: 'vat_eu',        label: 'VAT UE' },
    { k: 'default_plate', label: 'Domyślny nr rej.' },
    { k: 'phone',         label: 'Telefon' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(f => (
          <div key={f.k} className="space-y-1.5">
            <Label>{f.label}</Label>
            <Input
              value={(form[f.k] as string) ?? ''}
              onChange={e => set(f.k, e.target.value)}
            />
          </div>
        ))}
        <div className="col-span-2 space-y-1.5">
          <Label>Uwagi</Label>
          <Input
            value={form.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
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
        <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="gap-2">
          {saving
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Plus size={14} />
          }
          {initial ? 'Zapisz' : 'Dodaj przewoźnika'}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type SortCol = 'name' | 'city' | 'nip' | 'defaultPlate'

export function CarriersPage() {
  const { data: carrierList, loading, refetch } = useApi(() => carriersApi.list())
  const [modal,         setModal]         = useState(false)
  const [edit,          setEdit]          = useState<Carrier | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Carrier | null>(null)
  const [deactivating,     setDeactivating]     = useState(false)

  const rawList = carrierList ?? []

  async function handleSave(dto: CarrierInput) {
    if (edit) await carriersApi.update(edit.id, dto)
    else await carriersApi.create(dto)
    refetch()
  }

  function openAdd()            { setEdit(null); setModal(true) }
  function openEdit(c: Carrier) { setEdit(c);    setModal(true) }
  function closeModal()         { setModal(false); setEdit(null) }

  async function handleDeactivate() {
    if (!deactivateTarget) return
    setDeactivating(true)
    try {
      await carriersApi.deactivate(deactivateTarget.id)
      toast.success(`Przewoźnik ${deactivateTarget.name} dezaktywowany`)
      setDeactivateTarget(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie można dezaktywować przewoźnika')
    } finally {
      setDeactivating(false)
    }
  }

  usePageHeaderActions(
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Przewoźników: <span className="text-ink font-bold">{rawList.length}</span></span>
      <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus size={14}/> Dodaj przewoźnika</Button>
    </div>,
    [rawList.length]
  )

  return (
    <div className="animate-fade-in">
      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 space-y-2">
          {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rawList.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <Truck size={36} className="text-muted-foreground opacity-20" />
          <div className="text-sm font-medium text-muted-foreground">Brak przewoźników</div>
          <div className="text-xs text-muted-foreground">Dodaj pierwszego przewoźnika przyciskiem powyżej</div>
        </div>
      ) : (
        <DataTable
          rows={rawList} rowKey={c => c.id}
          searchText={c => `${c.name} ${c.city || ''} ${c.nip || ''} ${c.vatEu || ''} ${c.defaultPlate || ''} ${c.phone || ''}`}
          searchPlaceholder="Filtruj: nazwa, miasto, NIP/VAT, nr rej…"
          initialSort={{ key: 'name' }}
          onRowClick={c => openEdit(c)}
          columns={[
            { key: 'name', header: 'Nazwa', sortable: true, sortValue: c => c.name,
              cell: c => <span className="font-semibold text-ink truncate block max-w-[280px]" title={c.name}>{c.name}</span> },
            { key: 'city', header: 'Miasto', sortable: true, sortValue: c => c.city || '',
              cell: c => (c.postalCode || c.city) ? [c.postalCode, c.city].filter(Boolean).join(' ') : <span className="text-muted-foreground">—</span> },
            { key: 'nip', header: 'NIP / VAT UE', sortable: true, sortValue: c => c.nip || c.vatEu || '',
              cell: c => c.nip ? <code className="font-mono">{c.nip}</code> : c.vatEu ? <code className="font-mono">{c.vatEu}</code> : <span className="text-muted-foreground">—</span> },
            { key: 'plate', header: 'Nr rej.', sortable: true, sortValue: c => c.defaultPlate || '',
              cell: c => c.defaultPlate ? <code className="font-mono font-semibold">{c.defaultPlate}</code> : <span className="text-muted-foreground">—</span> },
            { key: 'act', header: 'Akcja', align: 'right',
              cell: c => (
                <div className="inline-flex items-center gap-0.5">
                  <button onClick={e => { e.stopPropagation(); openEdit(c) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Edytuj"><Pencil size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); setDeactivateTarget(c) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Dezaktywuj"><Truck size={13} className="opacity-60"/></button>
                </div>
              ) },
          ]}
        />
      )}

      {/* Modal dodaj/edytuj */}
      <Dialog open={modal} onOpenChange={v => { if (!v) closeModal() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit ? 'Edytuj przewoźnika' : 'Dodaj przewoźnika'}</DialogTitle>
            <DialogDescription>
              {edit ? 'Zaktualizuj dane przewoźnika' : 'Dodaj nowego przewoźnika do słownika'}
            </DialogDescription>
          </DialogHeader>
          <CarrierForm initial={edit} onSave={handleSave} onClose={closeModal} />
        </DialogContent>
      </Dialog>

      {/* Potwierdzenie dezaktywacji */}
      <Dialog open={!!deactivateTarget} onOpenChange={v => { if (!v && !deactivating) setDeactivateTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dezaktywować przewoźnika?</DialogTitle>
            <DialogDescription>
              Czy na pewno chcesz dezaktywować przewoźnika{' '}
              <span className="font-semibold">{deactivateTarget?.name}</span>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeactivateTarget(null)} disabled={deactivating}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleDeactivate} disabled={deactivating} className="gap-2">
              {deactivating
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Truck size={14} />
              }
              Dezaktywuj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
