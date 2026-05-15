/**
 * SuppliersPage — Dostawcy
 * Wygląd i UX zgodny z ClientsPage (formularz, GUS/VIES, delete).
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { suppliersApi } from '@/lib/apiClient'
import { GusLookup, type GusCompanyData } from '@/components/ui/GusLookup'
import { ViesLookup, type ViesCompanyData } from '@/components/ui/ViesLookup'
import { Truck, Mail, Pencil, Phone, Plus, Search, Globe, Flag, Trash2, CheckCircle } from 'lucide-react'
import type { Supplier, CreateSupplierDto } from '@/types'
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

function emptyForm(): CreateSupplierDto {
  return {
    code: '', name: '', displayName: '',
    nip: '', regon: '', vetNumber: '',
    address: '', postalCode: '', city: '',
    contactName: '', phone: '', email: '',
  }
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

function SupplierForm({ initial, onSave, onClose }: {
  initial?: Supplier | null; onSave: (dto: CreateSupplierDto) => Promise<void>; onClose: () => void
}) {
  const [form, setForm] = useState<CreateSupplierDto>(
    initial
      ? {
          code: initial.code,
          name: initial.name,
          displayName: initial.displayName ?? '',
          nip: initial.nip ?? '',
          regon: initial.regon ?? '',
          vetNumber: initial.vetNumber ?? '',
          address: initial.address ?? '',
          postalCode: initial.postalCode ?? '',
          city: initial.city ?? '',
          contactName: initial.contactName ?? '',
          phone: initial.phone ?? '',
          email: initial.email ?? '',
        }
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

  const set = (k: keyof CreateSupplierDto, v: string) => setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setError('Podaj nazwę dostawcy'); return }
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
              { k: 'name',        label: 'Nazwa oficjalna *',          ph: 'OKAY TEKIN SP. Z O.O.' },
              { k: 'displayName', label: 'Nazwa wyświetlana',          ph: 'Zagros (skrócona, do dokumentów)' },
              { k: 'nip',         label: isAbroad ? 'VAT-UE' : 'NIP', ph: isAbroad ? 'DE123456789' : '1234567890' },
              { k: 'regon',       label: 'REGON',                      ph: '123456789' },
              { k: 'vetNumber',   label: 'Numer weterynaryjny',        ph: 'PL00000000WE' },
              { k: 'address',     label: 'Adres',                      ph: 'ul. Przykładowa 1' },
              { k: 'postalCode',  label: 'Kod pocztowy',               ph: '00-526' },
              { k: 'city',        label: 'Miasto',                     ph: 'Warszawa' },
              { k: 'contactName', label: 'Osoba kontaktowa',           ph: 'Jan Kowalski' },
              { k: 'phone',       label: 'Telefon',                    ph: '+48 123 456 789' },
              { k: 'email',       label: 'E-mail',                     ph: 'kontakt@firma.pl' },
            ].map(f => (
              <div key={f.k} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input
                  value={(form as any)[f.k] ?? ''}
                  onChange={e => set(f.k as keyof CreateSupplierDto, e.target.value)}
                  placeholder={f.ph}
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
          {initial ? 'Zapisz' : 'Dodaj dostawcę'}
        </Button>
      </DialogFooter>
    </div>
  )
}

export function SuppliersPage() {
  const { data: supplierList, loading, refetch } = useApi(() => suppliersApi.list())
  const [modal,        setModal]        = useState(false)
  const [edit,         setEdit]         = useState<Supplier | null>(null)
  const [search,       setSearch]       = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const [deleting,     setDeleting]     = useState(false)

  const suppliers = (supplierList ?? []).filter(s => {
    if (!s.active) return false
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q)
      || (s.displayName ?? '').toLowerCase().includes(q)
      || (s.nip ?? '').includes(search)
  })

  async function handleSave(dto: CreateSupplierDto) {
    if (edit) await suppliersApi.update(edit.id, dto)
    else await suppliersApi.create(dto)
    refetch()
  }

  function openAdd()             { setEdit(null); setModal(true) }
  function openEdit(s: Supplier) { setEdit(s); setModal(true) }
  function closeModal()          { setModal(false); setEdit(null) }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await suppliersApi.delete(deleteTarget.id)
      toast.success(`Dostawca ${deleteTarget.displayName || deleteTarget.name} usunięty`)
      setDeleteTarget(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie można usunąć dostawcy')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Search + action */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Szukaj dostawcy..."
            className="pl-9"
          />
        </div>
        <Button onClick={openAdd}>
          <Plus size={14} className="mr-1.5" /> Dodaj dostawcę
        </Button>
      </div>

      {/* List card */}
      <Card>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <CardTitle className="text-sm font-semibold">{suppliers.length} dostawców</CardTitle>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0,1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Truck size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak dostawców</CardTitle>
              <CardDescription>Dodaj pierwszego dostawcę klikając przycisk powyżej</CardDescription>
            </div>
          ) : (
            <div className="divide-y">
              {suppliers.map(s => (
                <div key={s.id} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-black text-sm">{(s.displayName || s.name)[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm font-semibold">{s.displayName || s.name}</CardTitle>
                      <code className="text-[10px] font-bold text-muted-foreground">{s.code}</code>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {s.displayName && s.displayName !== s.name && (
                        <CardDescription className="text-xs italic">{s.name}</CardDescription>
                      )}
                      {s.nip && <CardDescription className="text-xs">NIP: {s.nip}</CardDescription>}
                      {s.vetNumber && <CardDescription className="text-xs">Wet: {s.vetNumber}</CardDescription>}
                      {(s.postalCode || s.city) && (
                        <CardDescription className="text-xs">{[s.postalCode, s.city].filter(Boolean).join(' ')}</CardDescription>
                      )}
                      {s.phone && (
                        <CardDescription className="flex items-center gap-1 text-xs">
                          <Phone size={10} />{s.phone}
                        </CardDescription>
                      )}
                      {s.email && (
                        <CardDescription className="flex items-center gap-1 text-xs">
                          <Mail size={10} />{s.email}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(s)} className="h-8 w-8">
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(s)}
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal */}
      <Dialog open={modal} onOpenChange={v => { if (!v) closeModal() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit ? 'Edytuj dostawcę' : 'Dodaj dostawcę'}</DialogTitle>
            <DialogDescription>
              {edit ? 'Zaktualizuj dane dostawcy' : 'Dodaj nowego dostawcę do systemu'}
            </DialogDescription>
          </DialogHeader>
          <SupplierForm initial={edit} onSave={handleSave} onClose={closeModal} />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v && !deleting) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Usunąć dostawcę?</DialogTitle>
            <DialogDescription>
              Czy na pewno chcesz usunąć dostawcę{' '}
              <span className="font-semibold">{deleteTarget?.displayName || deleteTarget?.name}</span>?
              Operacja jest możliwa tylko gdy dostawca nie ma żadnych partii surowca.
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
