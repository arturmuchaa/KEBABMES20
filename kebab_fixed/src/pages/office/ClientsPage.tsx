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

const _CC_LANG: Record<string, string> = { PL: 'pl', DE: 'de', AT: 'de', SK: 'sk', CZ: 'cs', SI: 'sl', FR: 'fr' }
function langFromNip(nip?: string): string {
  const s = (nip || '').trim().toUpperCase()
  const cc = s.length >= 2 && /^[A-Z]{2}/.test(s) ? s.slice(0, 2) : ''
  if (!cc) return 'pl'
  return _CC_LANG[cc] || 'en'
}

function emptyForm(): CreateClientDto {
  return { name: '', displayName: '', nip: '', regon: '', address: '', postalCode: '', city: '', contactName: '', phone: '', email: '', language: '', destName: '', destAddress: '', destCity: '', halalSupervision: false }
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
      ? { name: initial.name, displayName: initial.displayName, nip: initial.nip, regon: initial.regon, address: initial.address, postalCode: initial.postalCode, city: initial.city, contactName: initial.contactName, phone: initial.phone, email: initial.email, language: initial.language, destName: initial.destName, destAddress: initial.destAddress, destCity: initial.destCity, halalSupervision: initial.halalSupervision }
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
                    if (f.k === 'nip' && !form.language) set('language', langFromNip(v))
                  }}
                  placeholder={f.ph}
                  className={f.k === 'displayName' ? 'uppercase' : undefined}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Język HDI</Label>
              <select
                value={form.language || ''}
                onChange={e => set('language', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— auto z NIP —</option>
                <option value="pl">Polski</option>
                <option value="de">Niemiecki</option>
                <option value="sk">Słowacki</option>
                <option value="cs">Czeski</option>
                <option value="sl">Słoweński</option>
                <option value="fr">Francuski</option>
                <option value="en">Angielski</option>
              </select>
            </div>
          </div>

          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Miejsce przeznaczenia <span className="font-normal normal-case text-slate-400">(zostaw puste = adres klienta)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Nazwa</Label><Input value={form.destName ?? ''} onChange={e => set('destName', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Adres</Label><Input value={form.destAddress ?? ''} onChange={e => set('destAddress', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Miasto</Label><Input value={form.destCity ?? ''} onChange={e => set('destCity', e.target.value)} /></div>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
            <input type="checkbox" checked={!!form.halalSupervision}
              onChange={e => setForm(p => ({ ...p, halalSupervision: e.target.checked }))} />
            <span className="font-semibold">Nadzór HALAL</span>
            <span className="text-xs text-slate-500">— etykieta dostaje pole „kod nadzoru" (wpisywany przy druku, inny co zamówienie)</span>
          </label>
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
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null)
  const [deleting,     setDeleting]     = useState(false)

  const rawList = (clientList ?? []).filter(c => c.active)

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

  usePageHeaderActions(
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Kontrahentów: <span className="text-ink font-bold">{rawList.length}</span></span>
      <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus size={14}/> Dodaj kontrahenta</Button>
    </div>,
    [rawList.length]
  )

  return (
    <div className="animate-fade-in">
      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 space-y-2">
          {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rawList.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <Building2 size={36} className="text-muted-foreground opacity-20" />
          <div className="text-sm font-medium text-muted-foreground">Brak kontrahentów</div>
          <div className="text-xs text-muted-foreground">Dodaj pierwszego klienta przyciskiem powyżej</div>
        </div>
      ) : (
        <DataTable
          rows={rawList} rowKey={c => c.id}
          searchText={c => `${c.displayName || ''} ${c.name} ${c.nip || ''} ${c.city || ''} ${c.phone || ''} ${c.email || ''}`}
          searchPlaceholder="Filtruj: nazwa, NIP, miasto, telefon, e-mail…"
          initialQuery={new URLSearchParams(window.location.search).get('q') ?? undefined}
          initialSort={{ key: 'name' }}
          onRowClick={c => openEdit(c)}
          columns={[
            { key: 'name', header: 'Nazwa', sortable: true, sortValue: c => (c.displayName || c.name || '').toLowerCase(),
              cell: c => (
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink truncate" title={c.displayName || c.name}>{c.displayName || c.name}</span>
                    {c.code && <code className="font-mono text-[10px] font-bold text-muted-foreground">{c.code}</code>}
                  </div>
                  {c.displayName && c.displayName !== c.name && <div className="text-[10px] text-muted-foreground italic truncate" title={c.name}>{c.name}</div>}
                </div>
              ) },
            { key: 'nip', header: 'NIP', sortable: true, sortValue: c => c.nip || '',
              cell: c => c.nip ? <code className="font-mono">{c.nip}</code> : <span className="text-muted-foreground">—</span> },
            { key: 'city', header: 'Miasto', sortable: true, sortValue: c => c.city || '',
              cell: c => (c.postalCode || c.city) ? [c.postalCode, c.city].filter(Boolean).join(' ') : <span className="text-muted-foreground">—</span> },
            { key: 'phone', header: 'Telefon', sortable: true, sortValue: c => c.phone || '',
              cell: c => c.phone || <span className="text-muted-foreground">—</span> },
            { key: 'email', header: 'E-mail', sortable: true, sortValue: c => c.email || '',
              cell: c => <span className="truncate block max-w-[260px]" title={c.email || ''}>{c.email || <span className="text-muted-foreground">—</span>}</span> },
            { key: 'act', header: 'Akcja', align: 'right',
              cell: c => (
                <div className="inline-flex items-center gap-0.5">
                  <button onClick={e => { e.stopPropagation(); openEdit(c) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Edytuj"><Pencil size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); setDeleteTarget(c) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Usuń"><Trash2 size={13}/></button>
                </div>
              ) },
          ]}
        />
      )}

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
