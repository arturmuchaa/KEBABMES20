/**
 * SuppliersPage — zarządzanie dostawcami
 * Roboto font, opcja zagraniczna z VIES lookup
 */
import { useState, useCallback } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { suppliersApi } from '@/lib/apiClient'
import { Card, CardHeader, Toast, Modal, Spinner, EmptyState } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table, type Column } from '@/components/ui/Table'
import { GusLookup, type GusCompanyData } from '@/components/ui/GusLookup'
import { ViesLookup, type ViesCompanyData } from '@/components/ui/ViesLookup'
import { Plus, Truck, Phone, Mail, Building2, Globe, Flag } from 'lucide-react'
import type { Supplier, CreateSupplierDto } from '@/types'

function emptyForm(): CreateSupplierDto {
  return { code:'', name:'', nip:'', vetNumber:'', contactName:'', phone:'', email:'' }
}

const COLUMNS: Column<Supplier>[] = [
  { key:'code', header:'Kod', render: s => <span className="font-mono font-bold text-brand text-sm">{s.code}</span> },
  { key:'name', header:'Nazwa firmy', render: s => (
    <div>
      <div className="font-semibold text-ink">{s.name}</div>
      {s.nip && <div className="text-sm text-ink-3 font-mono font-semibold">NIP: {s.nip}</div>}
    </div>
  )},
  { key:'vetNumber', header:'Nr wet.', render: s => <span className="text-sm text-ink-3 font-mono">{s.vetNumber || '—'}</span> },
  { key:'contact', header:'Kontakt', render: s => (
    <div className="text-sm">
      {s.contactName && <div className="font-medium text-ink">{s.contactName}</div>}
      {s.phone && <div className="flex items-center gap-1 text-ink-3 text-xs"><Phone size={10}/>{s.phone}</div>}
      {s.email && <div className="flex items-center gap-1 text-ink-3 text-xs"><Mail size={10}/>{s.email}</div>}
    </div>
  )},
  { key:'status', header:'Status', render: s => (
    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.active?'bg-success-light text-success border border-success-border':'bg-surface-3 text-ink-3 border border-surface-4'}`}>
      {s.active ? 'Aktywny' : 'Nieaktywny'}
    </span>
  )},
]

interface CreateSupplierModalProps {
  open:boolean; onClose:()=>void; onSubmit:()=>void
  form:CreateSupplierDto; loading:boolean; error:string|null
  onFieldChange:<K extends keyof CreateSupplierDto>(key:K, value:CreateSupplierDto[K])=>void
  onGusFound:(data:GusCompanyData)=>void
  onViesFound:(data:ViesCompanyData)=>void
}

function CreateSupplierModal({ open, onClose, onSubmit, form, loading, error, onFieldChange, onGusFound, onViesFound }: CreateSupplierModalProps) {
  const [isAbroad, setIsAbroad] = useState(false)

  return (
    <Modal open={open} onClose={onClose} title="Nowy dostawca" subtitle="Dodaj nowego dostawcę do systemu" size="lg" preventClose>
      <div className="space-y-5" style={{fontFamily:'Roboto, sans-serif'}}>

        {/* Przełącznik kraj/zagranica */}
        <div className="flex gap-2">
          <button onClick={()=>setIsAbroad(false)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${!isAbroad?'bg-brand text-white border-brand':'bg-white text-ink-3 border-surface-4 hover:border-brand'}`}>
            <Flag size={14}/> Polska (GUS/NIP)
          </button>
          <button onClick={()=>setIsAbroad(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${isAbroad?'bg-blue-600 text-white border-blue-600':'bg-white text-ink-3 border-surface-4 hover:border-blue-400'}`}>
            <Globe size={14}/> Zagranica (VIES/VAT-UE)
          </button>
        </div>

        {/* GUS lub VIES lookup */}
        <div className="bg-surface-2 border border-surface-4 rounded-xl p-4">
          {isAbroad
            ? <ViesLookup onFound={onViesFound}/>
            : <GusLookup onFound={onGusFound}/>
          }
        </div>

        {/* Dane firmy */}
        <div className="border-t border-surface-4 pt-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-3 mb-3">Dane firmy</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-ink-3 uppercase tracking-wide mb-1.5">Kod dostawcy *</label>
              <input type="text" placeholder="np. DOW-001" value={form.code}
                onChange={e=>onFieldChange('code', e.target.value.toUpperCase())}
                style={{fontFamily:'Roboto, sans-serif'}}
                className="w-full h-12 px-4 text-lg font-bold font-mono text-brand rounded-xl border-2 border-surface-4 bg-white focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"/>
              <p className="text-[10px] text-ink-4 mt-1">Automatycznie sugerowany</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-3 uppercase tracking-wide mb-1.5">
                {isAbroad ? 'Numer VAT-UE' : 'NIP'}
              </label>
              <input type="text"
                placeholder={isAbroad?'np. DE123456789':'0000000000'}
                value={form.nip||''} onChange={e=>onFieldChange('nip', isAbroad?e.target.value.toUpperCase():e.target.value.replace(/\D/g,'').slice(0,10))}
                style={{fontFamily:'Roboto, sans-serif'}}
                className="w-full h-12 px-4 text-xl font-bold font-mono text-ink rounded-xl border-2 border-surface-4 bg-white focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 tracking-wider"/>
              <p className="text-[10px] text-ink-4 mt-1">{isAbroad?'Format: KK + numer (np. DE123456789)':'10 cyfr'}</p>
            </div>
            <Input label="Nazwa firmy *" placeholder="Pełna nazwa firmy" value={form.name}
              onChange={e=>onFieldChange('name',e.target.value)} className="col-span-2"
              style={{fontFamily:'Roboto, sans-serif'}}/>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-ink-3 uppercase tracking-wide mb-1.5">Numer weterynaryjny</label>
              <input type="text" placeholder="PL00000000WE" value={form.vetNumber||''}
                onChange={e=>onFieldChange('vetNumber',e.target.value.toUpperCase())}
                style={{fontFamily:'Roboto, sans-serif'}}
                className="w-full h-11 px-4 text-base font-mono text-ink rounded-xl border-2 border-surface-4 bg-white focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"/>
              <p className="text-[10px] text-ink-4 mt-1">Format: PL00000000WE</p>
            </div>
          </div>
        </div>

        {/* Dane kontaktowe */}
        <div className="border-t border-surface-4 pt-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-3 mb-3">Dane kontaktowe</div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Osoba kontaktowa" placeholder="Imię i nazwisko" value={form.contactName||''} onChange={e=>onFieldChange('contactName',e.target.value)}/>
            <Input label="Telefon" placeholder="+48 000 000 000" value={form.phone||''} onChange={e=>onFieldChange('phone',e.target.value)}/>
            <Input label="Email" type="email" placeholder="kontakt@firma.pl" value={form.email||''} onChange={e=>onFieldChange('email',e.target.value)} className="col-span-2"/>
          </div>
        </div>

        {error && <div className="text-sm text-danger bg-danger-light border border-danger-border rounded-lg px-4 py-2.5">{error}</div>}

        <div className="flex gap-3 pt-2">
          <Button variant="ghost" fullWidth onClick={onClose}>Anuluj</Button>
          <Button variant="primary" fullWidth loading={loading} onClick={onSubmit} icon={<Plus size={15}/>}>
            Dodaj dostawcę
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function SuppliersPage() {
  const { data: suppliers, loading, error, refetch } = useApi(()=>suppliersApi.list())
  const mutation = useMutation((dto:CreateSupplierDto)=>suppliersApi.create(dto))
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<CreateSupplierDto>(emptyForm())
  const [toast, setToast] = useState({msg:'', type:'success' as 'success'|'error', visible:false})

  const showToast = useCallback((msg:string, type:'success'|'error'='success')=>{
    setToast({msg,type,visible:true})
    setTimeout(()=>setToast(t=>({...t,visible:false})),3000)
  },[])

  const openModal = useCallback(async()=>{
    const newForm = emptyForm()
    try { newForm.code = await suppliersApi.nextCode() }
    catch { newForm.code = `DOW-${String((suppliers?.length||0)+1).padStart(3,'0')}` }
    setForm(newForm); mutation.clearError(); setModalOpen(true)
  },[suppliers,mutation])

  const closeModal = useCallback(()=>{ setModalOpen(false); mutation.clearError() },[mutation])

  const updateField = useCallback(<K extends keyof CreateSupplierDto>(key:K, value:CreateSupplierDto[K])=>{
    setForm(prev=>({...prev,[key]:value}))
  },[])

  const handleGusFound = useCallback((d:GusCompanyData)=>{
    setForm(prev=>({...prev, nip:d.nip, name:d.nazwa}))
  },[])

  const handleViesFound = useCallback((d:ViesCompanyData)=>{
    setForm(prev=>({
      ...prev,
      nip: d.vatNumber,
      name: d.traderName || prev.name,
    }))
  },[])

  const handleSubmit = useCallback(async()=>{
    if (!form.code.trim()) { showToast('Podaj kod dostawcy','error'); return }
    if (!form.name.trim()) { showToast('Podaj nazwę firmy','error'); return }
    try {
      const created = await mutation.mutate(form)
      setModalOpen(false); refetch()
      showToast(`Dostawca ${created.name} został dodany`)
    } catch(e) { showToast(e instanceof Error?e.message:'Błąd zapisu','error') }
  },[form,mutation,refetch,showToast])

  const suppliersList = suppliers??[]

  return (
    <div className="space-y-4 animate-fade-in">
      <Card noPad>
        <div className="px-5 pt-5">
          <CardHeader title="Dostawcy" subtitle={`${suppliersList.length} dostawców w systemie`}
            actions={<Button icon={<Plus size={15}/>} onClick={openModal}>Dodaj dostawcę</Button>}/>
        </div>
        <div className="flex items-center gap-6 px-5 py-3 bg-surface-2 border-y border-surface-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-light flex items-center justify-center"><Truck size={14} className="text-brand"/></div>
            <div><div className="text-lg font-black text-ink">{suppliersList.length}</div><div className="text-[10px] font-semibold text-ink-3 uppercase">Dostawców</div></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center"><Building2 size={14} className="text-success"/></div>
            <div><div className="text-lg font-black text-ink">{suppliersList.filter(s=>s.active).length}</div><div className="text-[10px] font-semibold text-ink-3 uppercase">Aktywnych</div></div>
          </div>
        </div>
        {loading
          ? <div className="flex items-center justify-center py-16"><Spinner size={32}/></div>
          : suppliersList.length===0
            ? <EmptyState icon={<Truck size={40}/>} title="Brak dostawców" message="Dodaj pierwszego dostawcę"/>
            : <Table columns={COLUMNS} data={suppliersList} loading={loading} keyFn={s=>s.id}/>
        }
      </Card>

      <CreateSupplierModal open={modalOpen} onClose={closeModal} onSubmit={handleSubmit}
        form={form} loading={mutation.loading} error={mutation.error}
        onFieldChange={updateField} onGusFound={handleGusFound} onViesFound={handleViesFound}/>
      <Toast message={toast.msg} type={toast.type} visible={toast.visible}/>
    </div>
  )
}
