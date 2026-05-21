/**
 * ClientsPage — Kontrahenci
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientsApi } from '@/lib/apiClient'
import { GusLookup, type GusCompanyData } from '@/components/ui/GusLookup'
import { ViesLookup, type ViesCompanyData } from '@/components/ui/ViesLookup'
import {
  Building2, Pencil, Plus, Search, Globe, Flag, Trash2, CheckCircle,
  X, ChevronDown, ChevronUp, ChevronsUpDown, Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Client, CreateClientDto } from '@/lib/mockApi'

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

function emptyForm(): CreateClientDto {
  return { name: '', displayName: '', nip: '', regon: '', address: '', postalCode: '', city: '', contactName: '', phone: '', email: '' }
}

interface AddressParts { address: string; postalCode: string; city: string }

function gusAddress(d: GusCompanyData): AddressParts {
  const streetBase = [d.ulica, d.numer_budynku].filter(Boolean).join(' ').trim()
  const street = d.numer_lokalu ? `${streetBase}/${d.numer_lokalu}` : streetBase
  return { address: street, postalCode: d.kod_pocztowy ?? '', city: d.miasto ?? '' }
}

function splitPostalCity(line: string): { postalCode: string; city: string } {
  const m = line.match(/^([0-9][0-9\s-]{1,9})\s+(.+)$/)
  if (m) return { postalCode: m[1].trim(), city: m[2].trim() }
  return { postalCode: '', city: line }
}

function viesAddress(raw: string, country: string): AddressParts {
  if (!raw) return { address: '', postalCode: '', city: '' }
  const lines = raw.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)
  if (lines.length === 0) return { address: '', postalCode: '', city: '' }
  const stripCountry = (s: string) =>
    country ? s.replace(new RegExp(`^${country}\\s*-\\s*`, 'i'), '') : s
  if (lines.length === 1) {
    const m = lines[0].match(/^(.*?)[,\s]+((?:[A-Z]{1,2}\s*-\s*)?\d[\d\s-]{2,}\s+.+)$/)
    if (m) {
      const { postalCode, city } = splitPostalCity(stripCountry(m[2].trim()))
      return { address: m[1].trim(), postalCode, city }
    }
    return { address: lines[0], postalCode: '', city: '' }
  }
  const cityLine = stripCountry(lines[lines.length - 1])
  const street = lines.slice(0, -1).join(', ')
  const { postalCode, city } = splitPostalCity(cityLine)
  return { address: street, postalCode, city }
}

interface ImportedData {
  source: 'GUS' | 'VIES'
  name?: string
  vatId?: string
  regon?: string
  address?: string
  postalCode?: string
  city?: string
}

function ImportedBanner({ data }: { data: ImportedData }) {
  return (
    <Card className="border-2 border-green-300 bg-green-50">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
          <span className="text-[12px] font-bold text-green-700">
            Dane pobrane z {data.source} — sprawdź i uzupełnij brakujące
          </span>
        </div>
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          {data.name && <><span className="text-slate-500 font-semibold">Nazwa</span><span className="font-semibold text-slate-900">{data.name}</span></>}
          {data.vatId && <><span className="text-slate-500 font-semibold">{data.source === 'GUS' ? 'NIP' : 'VAT-UE'}</span><span className="font-mono text-slate-900">{data.vatId}</span></>}
          {data.regon && <><span className="text-slate-500 font-semibold">REGON</span><span className="font-mono text-slate-900">{data.regon}</span></>}
          {data.address && <><span className="text-slate-500 font-semibold">Adres</span><span className="text-slate-900">{data.address}</span></>}
          {data.postalCode && <><span className="text-slate-500 font-semibold">Kod pocztowy</span><span className="font-mono text-slate-900">{data.postalCode}</span></>}
          {data.city && <><span className="text-slate-500 font-semibold">Miasto</span><span className="text-slate-900">{data.city}</span></>}
        </div>
      </CardContent>
    </Card>
  )
}

function ClientForm({ initial, onSave, onClose }: {
  initial?: Client | null; onSave: (dto: CreateClientDto) => Promise<void>; onClose: () => void
}) {
  const [form, setForm] = useState<CreateClientDto>(
    initial
      ? { name: initial.name, displayName: initial.displayName, nip: initial.nip, regon: initial.regon, address: initial.address, postalCode: initial.postalCode, city: initial.city, contactName: initial.contactName, phone: initial.phone, email: initial.email }
      : emptyForm()
  )
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [mode,     setMode]     = useState<'gus'|'vies'|'manual'>(initial ? 'manual' : 'gus')
  const [isAbroad, setIsAbroad] = useState(false)
  const [imported, setImported] = useState<ImportedData | null>(null)

  function applyGus(d: GusCompanyData) {
    const parts = gusAddress(d)
    setForm(p => ({
      ...p,
      name: d.nazwa ?? p.name,
      nip: d.nip ?? p.nip,
      regon: d.regon ?? p.regon,
      address: parts.address || p.address,
      postalCode: parts.postalCode || p.postalCode,
      city: parts.city || p.city,
    }))
    setImported({ source: 'GUS', name: d.nazwa, vatId: d.nip, regon: d.regon, ...parts })
    setMode('manual')
  }

  function applyVies(d: ViesCompanyData) {
    const parts = viesAddress(d.traderAddress, d.countryCode)
    setForm(p => ({
      ...p,
      name: d.traderName || p.name,
      nip: d.vatNumber || p.nip,
      address: parts.address || p.address,
      postalCode: parts.postalCode || p.postalCode,
      city: parts.city || p.city,
    }))
    setImported({ source: 'VIES', name: d.traderName, vatId: d.vatNumber, ...parts })
    setMode('manual')
  }

  function switchAbroad(abroad: boolean) {
    setIsAbroad(abroad)
    setMode(abroad ? 'vies' : 'gus')
    setError('')
  }

  const set = (k: keyof CreateClientDto, v: string) => setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setError('Podaj nazwę klienta'); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      {/* Kraj / zagranica */}
      {!initial && (
        <div className="flex gap-2">
          <Button variant={!isAbroad ? 'default' : 'outline'} size="sm" onClick={() => switchAbroad(false)} className="gap-2">
            <Flag size={14} /> Polska (GUS/NIP)
          </Button>
          <Button variant={isAbroad ? 'default' : 'outline'} size="sm" onClick={() => switchAbroad(true)} className="gap-2">
            <Globe size={14} /> Zagranica (VIES/VAT-UE)
          </Button>
        </div>
      )}

      {/* Lookup */}
      {mode === 'gus' && !initial && (
        <Card className="bg-muted/40 border-transparent">
          <CardContent className="p-4 space-y-2">
            <GusLookup onFound={applyGus} />
            <Button variant="ghost" size="sm" onClick={() => setMode('manual')} className="text-xs">
              → Wpisz ręcznie
            </Button>
          </CardContent>
        </Card>
      )}
      {mode === 'vies' && !initial && (
        <Card className="bg-muted/40 border-transparent">
          <CardContent className="p-4 space-y-2">
            <ViesLookup onFound={applyVies} />
            <Button variant="ghost" size="sm" onClick={() => setMode('manual')} className="text-xs">
              → Wpisz ręcznie
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Formularz */}
      {(mode === 'manual' || initial) && (
        <>
          {imported && <ImportedBanner data={imported} />}
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: 'name',        label: 'Nazwa oficjalna *',          ph: '' },
              { k: 'displayName', label: 'Nazwa wyświetlana',          ph: '' },
              { k: 'nip',         label: isAbroad ? 'VAT-UE' : 'NIP', ph: '' },
              { k: 'regon',       label: 'REGON',                      ph: '' },
              { k: 'address',     label: 'Adres',                      ph: '' },
              { k: 'postalCode',  label: 'Kod pocztowy',               ph: '' },
              { k: 'city',        label: 'Miasto',                     ph: '' },
              { k: 'contactName', label: 'Osoba kontaktowa',           ph: '' },
              { k: 'phone',       label: 'Telefon',                    ph: '' },
              { k: 'email',       label: 'E-mail',                     ph: '' },
            ].map(f => (
              <div key={f.k} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input
                  value={(form as any)[f.k] ?? ''}
                  onChange={e => {
                    const v = f.k === 'displayName' ? e.target.value.toUpperCase() : e.target.value
                    set(f.k as keyof CreateClientDto, v)
                  }}
                  placeholder={f.ph}
                  className={f.k === 'displayName' ? 'uppercase' : undefined}
                />
              </div>
            ))}
          </div>
          {!initial && (
            <Button variant="ghost" size="sm" onClick={() => setMode(isAbroad ? 'vies' : 'gus')} className="text-xs text-primary">
              ← Wróć do wyszukiwania {isAbroad ? 'VIES' : 'GUS'}
            </Button>
          )}
        </>
      )}

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
          {initial ? 'Zapisz' : 'Dodaj kontrahenta'}
        </Button>
      </DialogFooter>
    </div>
  )
}

type SortCol = 'name' | 'nip' | 'city' | 'phone' | 'email'

function exportCsv(rows: Client[]) {
  const headers = ['Nazwa','NIP','REGON','Adres','Kod pocztowy','Miasto','Osoba kontaktowa','Telefon','E-mail']
  const csv = [headers.join(';')].concat(rows.map(c => [
    c.displayName || c.name, c.nip || '', c.regon || '',
    c.address || '', c.postalCode || '', c.city || '',
    c.contactName || '', c.phone || '', c.email || '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'))).join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `kontrahenci-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export function ClientsPage() {
  const { data: clientList, loading, refetch } = useApi(() => clientsApi.list())
  const [modal,  setModal]  = useState(false)
  const [edit,   setEdit]   = useState<Client | null>(null)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [sortCol, setSortCol] = useState<SortCol>('name')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')

  const rawList = (clientList ?? []).filter(c => c.active)

  const clients = useMemo(() => {
    const q = search.toLowerCase().trim()
    let result = rawList
    if (q) {
      result = rawList.filter(c =>
        c.name.toLowerCase().includes(q)
        || (c.displayName ?? '').toLowerCase().includes(q)
        || (c.nip ?? '').toLowerCase().includes(q)
        || (c.city ?? '').toLowerCase().includes(q)
        || (c.phone ?? '').toLowerCase().includes(q)
        || (c.email ?? '').toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      const an = (a.displayName || a.name || '').toLowerCase()
      const bn = (b.displayName || b.name || '').toLowerCase()
      if (sortCol === 'name')  cmp = an.localeCompare(bn)
      if (sortCol === 'nip')   cmp = (a.nip || '').localeCompare(b.nip || '')
      if (sortCol === 'city')  cmp = (a.city || '').localeCompare(b.city || '')
      if (sortCol === 'phone') cmp = (a.phone || '').localeCompare(b.phone || '')
      if (sortCol === 'email') cmp = (a.email || '').localeCompare(b.email || '')
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

  async function handleSave(dto: CreateClientDto) {
    if (edit) await clientsApi.update(edit.id, dto)
    else await clientsApi.create(dto)
    refetch()
  }

  function openAdd()       { setEdit(null); setModal(true) }
  function openEdit(c: Client) { setEdit(c); setModal(true) }
  function closeModal()    { setModal(false); setEdit(null) }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await clientsApi.delete(deleteTarget.id)
      toast.success(`Kontrahent ${deleteTarget.displayName || deleteTarget.name} usunięty`)
      setDeleteTarget(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie można usunąć kontrahenta')
    } finally {
      setDeleting(false)
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
                placeholder="Filtruj: nazwa, NIP, miasto, telefon, e-mail…"
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
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Kontrahentów:</CardDescription>
              <span className="font-bold">{clients.length}{clients.length !== rawList.length && <span className="text-muted-foreground">/{rawList.length}</span>}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <button onClick={() => exportCsv(clients)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-surface-4 hover:bg-surface-2 text-xs font-medium" title="Eksportuj CSV">
              <Download size={12}/> CSV
            </button>
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
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <Building2 size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak kontrahentów</CardTitle>
            <CardDescription>Dodaj pierwszego klienta przyciskiem powyżej</CardDescription>
          </CardContent>
        ) : clients.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników dla „{search}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  {[
                    { col: 'name'  as SortCol, label: 'Nazwa',   align: 'left' },
                    { col: 'nip'   as SortCol, label: 'NIP',     align: 'left' },
                    { col: 'city'  as SortCol, label: 'Miasto',  align: 'left' },
                    { col: 'phone' as SortCol, label: 'Telefon', align: 'left' },
                    { col: 'email' as SortCol, label: 'E-mail',  align: 'left' },
                  ].map(h => (
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
                  <th className="w-20 px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Akcja</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, idx) => (
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
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink truncate" title={c.displayName || c.name}>
                          {c.displayName || c.name}
                        </span>
                        {c.code && <code className="font-mono text-[10px] font-bold text-muted-foreground">{c.code}</code>}
                      </div>
                      {c.displayName && c.displayName !== c.name && (
                        <div className="text-[10px] text-muted-foreground italic truncate" title={c.name}>{c.name}</div>
                      )}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                      {c.nip ? <code className="font-mono">{c.nip}</code> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[200px] truncate" title={[c.postalCode, c.city].filter(Boolean).join(' ')}>
                      {(c.postalCode || c.city)
                        ? [c.postalCode, c.city].filter(Boolean).join(' ')
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                      {c.phone || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[260px] truncate" title={c.email || ''}>
                      {c.email || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Edytuj"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(c) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Usuń"
                        >
                          <Trash2 size={13} />
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

      {/* Modal */}
      <Dialog open={modal} onOpenChange={v => { if (!v) closeModal() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit ? 'Edytuj kontrahenta' : 'Dodaj kontrahenta'}</DialogTitle>
            <DialogDescription>
              {edit ? 'Zaktualizuj dane kontrahenta' : 'Dodaj nowego kontrahenta do systemu'}
            </DialogDescription>
          </DialogHeader>
          <ClientForm initial={edit} onSave={handleSave} onClose={closeModal} />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v && !deleting) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Usunąć kontrahenta?</DialogTitle>
            <DialogDescription>
              Czy na pewno chcesz usunąć kontrahenta{' '}
              <span className="font-semibold">{deleteTarget?.displayName || deleteTarget?.name}</span>?
              Operacja jest możliwa tylko gdy klient nie ma żadnych zamówień.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-2">
              {deleting
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Trash2 size={14} />
              }
              Usuń
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
