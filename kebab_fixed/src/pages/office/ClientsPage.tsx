/**
 * ClientsPage — Kontrahenci
 * Roboto font, opcja zagraniczna z VIES lookup
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientsApi } from '@/lib/apiClient'
import { Card, CardHeader, Spinner, EmptyState, Modal } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { GusLookup, type GusCompanyData } from '@/components/ui/GusLookup'
import { ViesLookup, type ViesCompanyData } from '@/components/ui/ViesLookup'
import { Building2, Mail, Pencil, Phone, Plus, Search, Globe, Flag } from 'lucide-react'
import type { Client, CreateClientDto } from '@/lib/mockApi'

function emptyForm(): CreateClientDto {
  return { name:'', nip:'', regon:'', address:'', city:'', contactName:'', phone:'', email:'' }
}

function ClientForm({ initial, onSave, onClose }: {
  initial?: Client|null; onSave:(dto:CreateClientDto)=>Promise<void>; onClose:()=>void
}) {
  const [form, setForm] = useState<CreateClientDto>(
    initial
      ? {name:initial.name,nip:initial.nip,regon:initial.regon,address:initial.address,city:initial.city,contactName:initial.contactName,phone:initial.phone,email:initial.email}
      : emptyForm()
  )
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [mode,    setMode]     = useState<'gus'|'vies'|'manual'>(initial?'manual':'gus')
  const [isAbroad, setIsAbroad] = useState(false)

  function applyGus(d:GusCompanyData) {
    setForm(p=>({...p, name:d.nazwa??p.name, nip:d.nip??p.nip, regon:d.regon??p.regon, address:d.adres??p.address, city:d.miasto??p.city}))
    setMode('manual')
  }

  function applyVies(d:ViesCompanyData) {
    setForm(p=>({...p, name:d.traderName||p.name, nip:d.vatNumber||p.nip, address:d.traderAddress||p.address}))
    setMode('manual')
  }

  function switchAbroad(abroad:boolean) {
    setIsAbroad(abroad)
    setMode(abroad?'vies':'gus')
    setError('')
  }

  const set = (k:keyof CreateClientDto, v:string) => setForm(p=>({...p,[k]:v}))

  async function handleSave() {
    if (!form.name.trim()) { setError('Podaj nazwę klienta'); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch(e) { setError(e instanceof Error?e.message:'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4" style={{fontFamily:'Roboto, sans-serif'}}>

      {/* Przełącznik kraj/zagranica — tylko przy tworzeniu */}
      {!initial && (
        <div className="flex gap-2">
          <button onClick={()=>switchAbroad(false)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${!isAbroad?'bg-brand text-white border-brand':'bg-white text-ink-3 border-surface-4 hover:border-brand'}`}>
            <Flag size={14}/> Polska (GUS/NIP)
          </button>
          <button onClick={()=>switchAbroad(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${isAbroad?'bg-blue-600 text-white border-blue-600':'bg-white text-ink-3 border-surface-4 hover:border-blue-400'}`}>
            <Globe size={14}/> Zagranica (VIES/VAT-UE)
          </button>
        </div>
      )}

      {/* Lookup */}
      {mode==='gus' && !initial && (
        <div className="bg-surface-2 border border-surface-4 rounded-xl p-4">
          <GusLookup onFound={applyGus}/>
          <button onClick={()=>setMode('manual')} className="mt-2 text-[11px] text-ink-3 hover:text-ink underline">→ Wpisz ręcznie</button>
        </div>
      )}
      {mode==='vies' && !initial && (
        <div className="bg-surface-2 border border-surface-4 rounded-xl p-4">
          <ViesLookup onFound={applyVies}/>
          <button onClick={()=>setMode('manual')} className="mt-2 text-[11px] text-ink-3 hover:text-ink underline">→ Wpisz ręcznie</button>
        </div>
      )}

      {/* Formularz */}
      {(mode==='manual'||initial) && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              {k:'name',        label:'Nazwa *',           ph:'ZAGROS SP. Z O.O.'},
              {k:'nip',         label:isAbroad?'VAT-UE':'NIP', ph:isAbroad?'DE123456789':'1234567890'},
              {k:'regon',       label:'REGON',             ph:'123456789'},
              {k:'address',     label:'Adres',             ph:'ul. Przykładowa 1'},
              {k:'city',        label:'Miasto',            ph:'Kraków'},
              {k:'contactName', label:'Osoba kontaktowa',  ph:'Jan Kowalski'},
              {k:'phone',       label:'Telefon',           ph:'+48 123 456 789'},
              {k:'email',       label:'E-mail',            ph:'kontakt@firma.pl'},
            ].map(f=>(
              <div key={f.k}>
                <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">{f.label}</label>
                <input value={(form as any)[f.k]??''} onChange={e=>set(f.k as any, e.target.value)}
                  placeholder={f.ph} style={{fontFamily:'Roboto, sans-serif'}}
                  className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-surface-3 rounded-lg"/>
              </div>
            ))}
          </div>
          {!initial && (
            <button onClick={()=>setMode(isAbroad?'vies':'gus')} className="text-[11px] text-brand hover:underline">
              ← Wróć do wyszukiwania {isAbroad?'VIES':'GUS'}
            </button>
          )}
        </>
      )}

      {error && <div className="text-[12px] text-danger bg-danger-light border border-danger-border px-3 py-2 rounded-lg">{error}</div>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleSave} loading={saving} disabled={!form.name.trim()} className="flex-1">
          {initial?'Zapisz':'Dodaj kontrahenta'}
        </Button>
      </div>
    </div>
  )
}

export function ClientsPage() {
  const { data:clientList, loading, refetch } = useApi(()=>clientsApi.list())
  const [modal,  setModal]  = useState(false)
  const [edit,   setEdit]   = useState<Client|null>(null)
  const [search, setSearch] = useState('')

  const clients = (clientList??[]).filter(c=>
    c.active&&(!search||c.name.toLowerCase().includes(search.toLowerCase())||c.nip?.includes(search))
  )

  async function handleSave(dto:CreateClientDto) {
    if (edit) await clientsApi.update(edit.id, dto)
    else await clientsApi.create(dto)
    refetch()
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Szukaj kontrahenta..."
            className="w-full h-9 pl-9 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50"/>
        </div>
        <Button icon={<Plus size={14}/>} onClick={()=>{ setEdit(null); setModal(true) }}>Dodaj kontrahenta</Button>
      </div>

      <div className="bg-surface border border-surface-4 rounded-xl">
        <div className="px-4 py-2.5 border-b border-surface-4">
          <span className="text-[13px] font-semibold text-ink">{clients.length} kontrahentów</span>
        </div>
        {loading
          ? <div className="flex justify-center py-10"><Spinner size={20}/></div>
          : clients.length===0
            ? <EmptyState icon={<Building2 size={32}/>} title="Brak kontrahentów" message="Dodaj pierwszego klienta"/>
            : (
              <div className="divide-y divide-slate-100">
                {clients.map(c=>(
                  <div key={c.id} className="px-4 py-3 flex items-center gap-3 hover:bg-surface-3/60">
                    <div className="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center flex-shrink-0">
                      <span className="text-brand font-black text-sm">{c.name[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{c.name}</span>
                        <span className="text-[10px] font-bold text-ink-4">{c.code}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-ink-3 mt-0.5">
                        {c.nip&&<span>NIP: {c.nip}</span>}
                        {c.city&&<span>{c.city}</span>}
                        {c.phone&&<span className="flex items-center gap-1"><Phone size={10}/>{c.phone}</span>}
                        {c.email&&<span className="flex items-center gap-1"><Mail size={10}/>{c.email}</span>}
                      </div>
                    </div>
                    <button onClick={()=>{ setEdit(c); setModal(true) }}
                      className="p-1.5 rounded border border-surface-4 text-ink-3 hover:border-brand hover:text-brand">
                      <Pencil size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            )
        }
      </div>

      {modal && (
        <Modal open title={edit?'Edytuj kontrahenta':'Dodaj kontrahenta'}
          onClose={()=>{ setModal(false); setEdit(null) }} size="lg">
          <ClientForm initial={edit} onSave={handleSave} onClose={()=>{ setModal(false); setEdit(null) }}/>
        </Modal>
      )}
    </div>
  )
}
