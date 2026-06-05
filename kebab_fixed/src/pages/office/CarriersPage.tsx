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
  const [search,        setSearch]        = useState('')
  const [deactivateTarget, setDeactivateTarget] = useState<Carrier | null>(null)
  const [deactivating,     setDeactivating]     = useState(false)
  const [sortCol, setSortCol] = useState<SortCol>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const rawList = carrierList ?? []

  const carriers = useMemo(() => {
    const q = search.toLowerCase().trim()
    let result = rawList
    if (q) {
      result = rawList.filter(c =>
        c.name.toLowerCase().includes(q)
        || (c.city ?? '').toLowerCase().includes(q)
        || (c.nip ?? '').toLowerCase().includes(q)
        || (c.vatEu ?? '').toLowerCase().includes(q)
        || (c.defaultPlate ?? '').toLowerCase().includes(q)
        || (c.phone ?? '').toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'name')         cmp = a.name.localeCompare(b.name)
      if (sortCol === 'city')         cmp = (a.city || '').localeCompare(b.city || '')
      if (sortCol === 'nip')          cmp = (a.nip || a.vatEu || '').localeCompare(b.nip || b.vatEu || '')
      if (sortCol === 'defaultPlate') cmp = (a.defaultPlate || '').localeCompare(b.defaultPlate || '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawList, search, sortCol, sortDir])

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

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
                placeholder="Filtruj: nazwa, miasto, NIP, nr rej., telefon…"
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
          </div>

          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Przewoźników:</CardDescription>
              <span className="font-bold">
                {carriers.length}
                {carriers.length !== rawList.length && (
                  <span className="text-muted-foreground">/{rawList.length}</span>
                )}
              </span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <Button size="sm" className="h-7 px-2.5 text-xs gap-1" onClick={openAdd}>
              <Plus size={12}/> Dodaj
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
            <Truck size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak przewoźników</CardTitle>
            <CardDescription>Dodaj pierwszego przewoźnika przyciskiem powyżej</CardDescription>
          </CardContent>
        ) : carriers.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników dla „{search}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  {([
                    { col: 'name'         as SortCol, label: 'Nazwa' },
                    { col: 'city'         as SortCol, label: 'Miasto' },
                    { col: 'nip'          as SortCol, label: 'NIP / VAT UE' },
                    { col: 'defaultPlate' as SortCol, label: 'Nr rej.' },
                  ] as { col: SortCol; label: string }[]).map(h => (
                    <th
                      key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className="group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap text-left"
                    >
                      <span className="inline-flex items-center gap-1">
                        {h.label}
                        <SortIcon col={h.col} />
                      </span>
                    </th>
                  ))}
                  <th className="w-24 px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Akcja</th>
                </tr>
              </thead>
              <tbody>
                {carriers.map((c, idx) => (
                  <tr
                    key={c.id}
                    onClick={() => openEdit(c)}
                    className={cn(
                      'cursor-pointer border-b border-surface-3 transition-colors',
                      idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                      'hover:bg-blue-50/60'
                    )}
                  >
                    <td className="px-2.5 py-2 whitespace-nowrap max-w-[280px]">
                      <span className="font-semibold text-ink truncate" title={c.name}>
                        {c.name}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[200px] truncate"
                        title={[c.postalCode, c.city].filter(Boolean).join(' ')}>
                      {(c.postalCode || c.city)
                        ? [c.postalCode, c.city].filter(Boolean).join(' ')
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                      {c.nip
                        ? <code className="font-mono">{c.nip}</code>
                        : c.vatEu
                          ? <code className="font-mono">{c.vatEu}</code>
                          : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                      {c.defaultPlate
                        ? <code className="font-mono font-semibold">{c.defaultPlate}</code>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); openEdit(c) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Edytuj"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setDeactivateTarget(c) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Dezaktywuj"
                        >
                          <Truck size={13} className="opacity-60" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
