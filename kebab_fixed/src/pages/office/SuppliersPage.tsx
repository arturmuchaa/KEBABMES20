/**
 * SuppliersPage — zarządzanie dostawcami
 */
import { useState, useCallback } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { suppliersApi } from '@/lib/apiClient'
import { GusLookup, type GusCompanyData } from '@/components/ui/GusLookup'
import { ViesLookup, type ViesCompanyData } from '@/components/ui/ViesLookup'
import { Plus, Truck, Phone, Mail, Building2, Globe, Flag } from 'lucide-react'
import type { Supplier, CreateSupplierDto } from '@/types'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function emptyForm(): CreateSupplierDto {
  return { code: '', name: '', nip: '', vetNumber: '', contactName: '', phone: '', email: '' }
}

interface CreateSupplierModalProps {
  open: boolean; onClose: () => void; onSubmit: () => void
  form: CreateSupplierDto; loading: boolean; error: string | null
  onFieldChange: <K extends keyof CreateSupplierDto>(key: K, value: CreateSupplierDto[K]) => void
  onGusFound: (data: GusCompanyData) => void
  onViesFound: (data: ViesCompanyData) => void
}

function CreateSupplierModal({ open, onClose, onSubmit, form, loading, error, onFieldChange, onGusFound, onViesFound }: CreateSupplierModalProps) {
  const [isAbroad, setIsAbroad] = useState(false)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nowy dostawca</DialogTitle>
          <DialogDescription>Dodaj nowego dostawcę do systemu</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Kraj / zagranica */}
          <div className="flex gap-2">
            <Button
              variant={!isAbroad ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsAbroad(false)}
              className="gap-2"
            >
              <Flag size={14} /> Polska (GUS/NIP)
            </Button>
            <Button
              variant={isAbroad ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsAbroad(true)}
              className="gap-2"
            >
              <Globe size={14} /> Zagranica (VIES/VAT-UE)
            </Button>
          </div>

          {/* Lookup */}
          <Card className="bg-muted/40 border-transparent">
            <CardContent className="p-4">
              {isAbroad
                ? <ViesLookup onFound={onViesFound} />
                : <GusLookup  onFound={onGusFound} />
              }
            </CardContent>
          </Card>

          <Separator />

          {/* Dane firmy */}
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Dane firmy</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Kod dostawcy *</Label>
                <Input
                  placeholder="np. DOW-001"
                  value={form.code}
                  onChange={e => onFieldChange('code', e.target.value.toUpperCase())}
                  className="font-mono font-bold text-primary"
                />
                <CardDescription className="text-[10px]">Automatycznie sugerowany</CardDescription>
              </div>
              <div className="space-y-1.5">
                <Label>{isAbroad ? 'Numer VAT-UE' : 'NIP'}</Label>
                <Input
                  placeholder={isAbroad ? 'np. DE123456789' : '0000000000'}
                  value={form.nip || ''}
                  onChange={e => onFieldChange('nip', isAbroad
                    ? e.target.value.toUpperCase()
                    : e.target.value.replace(/\D/g, '').slice(0, 10)
                  )}
                  className="font-mono font-bold tracking-wider"
                />
                <CardDescription className="text-[10px]">
                  {isAbroad ? 'Format: KK + numer (np. DE123456789)' : '10 cyfr'}
                </CardDescription>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Nazwa firmy *</Label>
                <Input
                  placeholder="Pełna nazwa firmy"
                  value={form.name}
                  onChange={e => onFieldChange('name', e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Numer weterynaryjny</Label>
                <Input
                  placeholder="PL00000000WE"
                  value={form.vetNumber || ''}
                  onChange={e => onFieldChange('vetNumber', e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <CardDescription className="text-[10px]">Format: PL00000000WE</CardDescription>
              </div>
            </div>
          </div>

          <Separator />

          {/* Dane kontaktowe */}
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Dane kontaktowe</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Osoba kontaktowa</Label>
                <Input placeholder="Imię i nazwisko" value={form.contactName || ''} onChange={e => onFieldChange('contactName', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <Input placeholder="+48 000 000 000" value={form.phone || ''} onChange={e => onFieldChange('phone', e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="kontakt@firma.pl" value={form.email || ''} onChange={e => onFieldChange('email', e.target.value)} />
              </div>
            </div>
          </div>

          {error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="px-3 py-2">
                <CardDescription className="text-destructive font-medium">{error}</CardDescription>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Anuluj</Button>
          <Button onClick={onSubmit} disabled={loading} className="gap-2">
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Plus size={14} />
            }
            Dodaj dostawcę
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SuppliersPage() {
  const { data: suppliers, loading, refetch } = useApi(() => suppliersApi.list())
  const mutation = useMutation((dto: CreateSupplierDto) => suppliersApi.create(dto))
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<CreateSupplierDto>(emptyForm())

  const openModal = useCallback(async () => {
    const newForm = emptyForm()
    try { newForm.code = await suppliersApi.nextCode() }
    catch { newForm.code = `DOW-${String((suppliers?.length || 0) + 1).padStart(3, '0')}` }
    setForm(newForm); mutation.clearError?.(); setModalOpen(true)
  }, [suppliers, mutation])

  const closeModal = useCallback(() => { setModalOpen(false); mutation.clearError?.() }, [mutation])

  const updateField = useCallback(<K extends keyof CreateSupplierDto>(key: K, value: CreateSupplierDto[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleGusFound = useCallback((d: GusCompanyData) => {
    setForm(prev => ({ ...prev, nip: d.nip, name: d.nazwa }))
  }, [])

  const handleViesFound = useCallback((d: ViesCompanyData) => {
    setForm(prev => ({ ...prev, nip: d.vatNumber, name: d.traderName || prev.name }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!form.code.trim()) { toast.error('Podaj kod dostawcy'); return }
    if (!form.name.trim()) { toast.error('Podaj nazwę firmy'); return }
    try {
      const created = await mutation.mutate(form)
      setModalOpen(false); refetch()
      toast.success(`Dostawca ${created.name} został dodany`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Błąd zapisu') }
  }, [form, mutation, refetch])

  const suppliersList = suppliers ?? []

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Dostawców',  value: suppliersList.length,                           icon: <Truck size={18} className="text-primary" />,        accent: 'bg-primary/5' },
          { label: 'Aktywnych',  value: suppliersList.filter(s => s.active).length,     icon: <Building2 size={18} className="text-green-600" />,  accent: 'bg-green-50' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.accent}`}>
                  {s.icon}
                </div>
                <div>
                  <CardTitle className="text-2xl font-black tabular-nums">{s.value}</CardTitle>
                  <CardDescription className="text-[10px] font-semibold uppercase">{s.label}</CardDescription>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Dostawcy</CardTitle>
            <CardDescription className="mt-0.5">{suppliersList.length} dostawców w systemie</CardDescription>
          </div>
          <Button onClick={openModal}>
            <Plus size={14} className="mr-1.5" /> Dodaj dostawcę
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0,1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : suppliersList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Truck size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak dostawców</CardTitle>
              <CardDescription>Dodaj pierwszego dostawcę klikając przycisk powyżej</CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Kod','Nazwa firmy','Nr wet.','Kontakt','Status'].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliersList.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <code className="font-mono font-bold text-primary text-sm">{s.code}</code>
                    </TableCell>
                    <TableCell>
                      <CardTitle className="text-sm font-semibold">{s.name}</CardTitle>
                      {s.nip && (
                        <code className="text-xs text-muted-foreground font-mono font-semibold">NIP: {s.nip}</code>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs text-muted-foreground">{s.vetNumber || '—'}</code>
                    </TableCell>
                    <TableCell>
                      {s.contactName && <CardTitle className="text-sm font-medium">{s.contactName}</CardTitle>}
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
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.active ? 'success' : 'secondary'}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${s.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {s.active ? 'Aktywny' : 'Nieaktywny'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateSupplierModal
        open={modalOpen}
        onClose={closeModal}
        onSubmit={handleSubmit}
        form={form}
        loading={mutation.loading}
        error={mutation.error}
        onFieldChange={updateField}
        onGusFound={handleGusFound}
        onViesFound={handleViesFound}
      />
    </div>
  )
}
