import { useState } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { usersApi } from '@/lib/apiClient'
import { toast } from 'sonner'

import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { Plus, Scissors, Factory, Users, ShieldCheck, Pencil } from 'lucide-react'
import type { User as UserType } from '@/types'

const WORKER_ROLES = [
  { value: 'WORKER_DEBONING',   label: 'Pracownik rozbioru',  icon: <Scissors size={15} />, desc: 'Hala — rozbiór ćwiartki', defaultRate: 0.55 },
  { value: 'WORKER_PRODUCTION', label: 'Pracownik produkcji', icon: <Factory size={15} />,  desc: 'Hala — linia produkcyjna', defaultRate: 0.50 },
  { value: 'WORKER_GENERAL',    label: 'Pracownik ogólny',    icon: <Users size={15} />,    desc: 'Hala — prace ogólne', defaultRate: 0 },
]
const SYSTEM_ROLES = [
  { value: 'OFFICE', label: 'Biuro',         icon: <Users size={15} />,       desc: 'Dostęp do systemu biurowego' },
  { value: 'ADMIN',  label: 'Administrator', icon: <ShieldCheck size={15} />, desc: 'Pełny dostęp do systemu' },
]

const ROLE_BADGE: Record<string, 'success' | 'info' | 'secondary' | 'warning' | 'danger'> = {
  WORKER_DEBONING:   'success',
  WORKER_PRODUCTION: 'info',
  WORKER_GENERAL:    'secondary',
  OFFICE:            'warning',
  ADMIN:             'danger',
}
const ROLE_LABEL: Record<string, string> = {
  WORKER_DEBONING: 'Rozbiór', WORKER_PRODUCTION: 'Produkcja',
  WORKER_GENERAL: 'Ogólny',  OFFICE: 'Biuro', ADMIN: 'Administrator',
}

function needsLogin(role: string) { return role === 'ADMIN' || role === 'OFFICE' }
function isWorkerRole(role: string) { return role.startsWith('WORKER') }

function autoLogin(name: string) {
  const p = name.trim().toLowerCase().split(/\s+/)
  if (p.length >= 2) return `${p[0][0]}${p[p.length - 1]}`.replace(/[^a-z]/g, '')
  return p[0]?.replace(/[^a-z]/g, '') ?? ''
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

const ALL_DEPTS = ['rozbior', 'produkcja', 'pakowanie', 'wydanie'] as const

const BLANK_FORM = { login: '', name: '', role: 'WORKER_DEBONING', ratePerKg: '0.55', contractType: 'zlecenie', employerCostAmount: '0', pin: '', departments: [] as string[] }

export function WorkersPage() {
  const { data, loading, refetch } = useApi(() => usersApi.list())
  const [open, setOpen]         = useState(false)
  const [editTarget, setEditTarget] = useState<UserType | null>(null)
  const [form, setForm]         = useState({ ...BLANK_FORM })
  const [editForm, setEditForm] = useState({ ...BLANK_FORM })

  const createMut = useMutation((d: typeof form) => usersApi.create({
    name: d.name, role: d.role,
    pin: d.pin || undefined,
    departments: d.departments,
    ratePerKg: parseFloat(d.ratePerKg) || 0,
    contractType: d.contractType,
    employerCostAmount: parseFloat(d.employerCostAmount) || 0,
  }))
  const updateMut = useMutation((d: { id: string } & typeof editForm) =>
    usersApi.update(d.id, {
      name: d.name, role: d.role,
      pin: d.pin || undefined,
      departments: d.departments,
      ratePerKg: parseFloat(d.ratePerKg) || 0,
      contractType: d.contractType,
      employerCostAmount: parseFloat(d.employerCostAmount) || 0,
    })
  )

  const allUsers = data ?? []
  const workers  = allUsers.filter(u => u.role.startsWith('WORKER'))
  const system   = allUsers.filter(u => !u.role.startsWith('WORKER'))

  function handleRoleChange(role: string) {
    const def = WORKER_ROLES.find(r => r.value === role)?.defaultRate ?? 0
    setForm(f => ({ ...f, role, login: needsLogin(role) ? f.login : autoLogin(f.name), ratePerKg: String(def) }))
  }
  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, login: needsLogin(f.role) ? f.login : autoLogin(name) }))
  }

  async function handleCreate() {
    if (!form.name.trim()) return toast.error('Imię i nazwisko jest wymagane')
    if (needsLogin(form.role) && !form.login.trim()) return toast.error('Login jest wymagany dla tej roli')
    try {
      await createMut.mutate({ ...form, login: form.login.trim() || autoLogin(form.name) })
      setOpen(false); refetch()
      setForm({ ...BLANK_FORM })
      toast.success(`Dodano pracownika: ${form.name}`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
    }
  }

  function openEdit(u: UserType) {
    setEditTarget(u)
    setEditForm({
      login: (u as any).login ?? '',
      name: u.name,
      role: u.role,
      ratePerKg: String((u as any).ratePerKg ?? (u as any).rate_per_kg ?? 0),
      contractType: (u as any).contractType ?? (u as any).contract_type ?? 'zlecenie',
      employerCostAmount: String((u as any).employerCostAmount ?? (u as any).employer_cost_amount ?? 0),
      pin: '',
      departments: (u as any).departments ?? [],
    })
  }

  async function handleUpdate() {
    if (!editTarget) return
    try {
      await updateMut.mutate({ id: editTarget.id, ...editForm })
      setEditTarget(null); refetch()
      toast.success('Zaktualizowano pracownika')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Wszyscy',  value: allUsers.length, icon: <Users size={18} />,       accent: 'bg-muted' },
          { label: 'Rozbiór',  value: allUsers.filter(u => u.role === 'WORKER_DEBONING').length,   icon: <Scissors size={18} className="text-green-600" />, accent: 'bg-green-50' },
          { label: 'Produkcja',value: allUsers.filter(u => u.role === 'WORKER_PRODUCTION').length, icon: <Factory size={18} className="text-blue-600" />,  accent: 'bg-blue-50' },
          { label: 'System',   value: system.length,   icon: <ShieldCheck size={18} className="text-amber-600" />, accent: 'bg-amber-50' },
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
            <CardTitle>Pracownicy</CardTitle>
            <CardDescription className="mt-0.5">Hala produkcyjna · Biuro · Administratorzy</CardDescription>
          </div>
          <Button onClick={() => { setForm({ ...BLANK_FORM }); createMut.clearError?.(); setOpen(true) }}>
            <Plus size={14} className="mr-1.5" /> Dodaj pracownika
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {loading ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Pracownik', 'Stanowisko', 'Stawka / Umowa', 'Status', ''].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[0,1,2].map(i => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell><div className="flex items-center gap-3"><Skeleton className="w-9 h-9 rounded-full" /><Skeleton className="h-4 w-32" /></div></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : allUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Users size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak pracowników</CardTitle>
              <CardDescription>Dodaj pierwszego pracownika klikając przycisk powyżej</CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Pracownik', 'Stanowisko', 'Stawka / Umowa', 'Status', ''].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.map(u => {
                  const rate = (u as any).ratePerKg ?? (u as any).rate_per_kg ?? 0
                  const ct   = (u as any).contractType ?? (u as any).contract_type ?? 'zlecenie'
                  const eca  = Number((u as any).employerCostAmount ?? (u as any).employer_cost_amount ?? 0)
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {initials(u.name)}
                          </div>
                          <div>
                            <CardTitle className="text-sm font-semibold">{u.name}</CardTitle>
                            {!isWorkerRole(u.role) && (
                              <code className="text-xs text-muted-foreground font-mono">{(u as any).login}</code>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ROLE_BADGE[u.role] ?? 'secondary'}>
                          {ROLE_LABEL[u.role] ?? u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isWorkerRole(u.role) ? (
                          <div className="text-sm">
                            <span className="font-semibold text-green-700">{Number(rate).toFixed(2)} zł/kg</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {ct === 'praca' ? 'UoP' : 'Zlecenie'}
                            </span>
                            {ct === 'praca' && eca > 0 && (
                              <span className="text-orange-600 ml-1 text-xs">+{eca.toFixed(0)} zł/mies.</span>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.active ? 'success' : 'secondary'}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${u.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {u.active ? 'Aktywny' : 'Nieaktywny'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                          <Pencil size={13} className="mr-1" /> Edytuj
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modal: Nowy pracownik */}
      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nowy pracownik</DialogTitle>
            <DialogDescription>Dodaj pracownika hali lub użytkownika systemu</DialogDescription>
          </DialogHeader>
          <WorkerForm
            form={form} setForm={setForm}
            onRoleChange={handleRoleChange} onNameChange={handleNameChange}
          />
          {createMut.error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="px-3 py-2">
                <CardDescription className="text-destructive font-medium">{createMut.error}</CardDescription>
              </CardContent>
            </Card>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={createMut.loading}>Anuluj</Button>
            <Button onClick={handleCreate} disabled={createMut.loading} className="gap-2">
              {createMut.loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
              Dodaj pracownika
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Edycja pracownika */}
      <Dialog open={!!editTarget} onOpenChange={v => { if (!v) setEditTarget(null) }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edytuj pracownika</DialogTitle>
            <DialogDescription>{editTarget?.name}</DialogDescription>
          </DialogHeader>
          <WorkerForm
            form={editForm} setForm={setEditForm}
            onRoleChange={role => setEditForm(f => ({ ...f, role }))}
            onNameChange={name => setEditForm(f => ({ ...f, name }))}
            hideSystemRoles
          />
          {updateMut.error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="px-3 py-2">
                <CardDescription className="text-destructive font-medium">{updateMut.error}</CardDescription>
              </CardContent>
            </Card>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={updateMut.loading}>Anuluj</Button>
            <Button onClick={handleUpdate} disabled={updateMut.loading} className="gap-2">
              {updateMut.loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Pencil size={14} />}
              Zapisz zmiany
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Reusable form component ──────────────────────────────────
function WorkerForm({ form, setForm, onRoleChange, onNameChange, hideSystemRoles }: {
  form: { login: string; name: string; role: string; ratePerKg: string; contractType: string; employerCostAmount: string; pin: string; departments: string[] }
  setForm: React.Dispatch<React.SetStateAction<any>>
  onRoleChange: (role: string) => void
  onNameChange: (name: string) => void
  hideSystemRoles?: boolean
}) {
  const isWorker = isWorkerRole(form.role)
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Imię i nazwisko *</Label>
        <Input placeholder="np. Jan Kowalski" value={form.name} onChange={e => onNameChange(e.target.value)} />
      </div>
      <Separator />
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Hala produkcyjna</Label>
        <RadioGroup value={form.role} onValueChange={onRoleChange} className="gap-2">
          {WORKER_ROLES.map(opt => (
            <label key={opt.value} htmlFor={opt.value}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.role === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
              <RadioGroupItem value={opt.value} id={opt.value} />
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${form.role === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {opt.icon}
              </div>
              <div>
                <CardTitle className={`text-sm ${form.role === opt.value ? 'text-primary' : ''}`}>{opt.label}</CardTitle>
                <CardDescription className="text-xs">{opt.desc}</CardDescription>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>
      {!hideSystemRoles && (
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Dostęp do systemu</Label>
          <RadioGroup value={form.role} onValueChange={onRoleChange} className="gap-2">
            {SYSTEM_ROLES.map(opt => (
              <label key={opt.value} htmlFor={`sys-${opt.value}`}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.role === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                <RadioGroupItem value={opt.value} id={`sys-${opt.value}`} />
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${form.role === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {opt.icon}
                </div>
                <div>
                  <CardTitle className={`text-sm ${form.role === opt.value ? 'text-primary' : ''}`}>{opt.label}</CardTitle>
                  <CardDescription className="text-xs">{opt.desc}</CardDescription>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>
      )}

      {needsLogin(form.role) && !hideSystemRoles && (
        <div className="space-y-1.5">
          <Label>Login *</Label>
          <Input placeholder="np. jan_kowalski" value={form.login}
            onChange={e => setForm((f: any) => ({ ...f, login: e.target.value }))} />
        </div>
      )}

      {/* Pola akordu — tylko dla pracowników hali */}
      {isWorker && (
        <>
          <Separator />
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Wynagrodzenie</Label>
            <div className="space-y-1.5">
              <Label className="text-xs">Stawka akordowa (zł/kg)</Label>
              <Input type="number" step="0.01" min="0"
                value={form.ratePerKg}
                onChange={e => setForm((f: any) => ({ ...f, ratePerKg: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rodzaj umowy</Label>
              <div className="flex gap-2">
                {[{ v: 'zlecenie', l: 'Umowa zlecenie' }, { v: 'praca', l: 'Umowa o pracę' }].map(opt => (
                  <button key={opt.v} type="button"
                    onClick={() => setForm((f: any) => ({ ...f, contractType: opt.v }))}
                    className={`flex-1 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${form.contractType === opt.v ? 'border-primary bg-primary text-white' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Koszty pracodawcy (zł/mies.)
                {form.contractType === 'praca'
                  ? <span className="text-muted-foreground ml-1">— ZUS, składki itp.</span>
                  : <span className="text-muted-foreground ml-1">— dodatkowe koszty</span>
                }
              </Label>
              <Input type="number" step="0.01" min="0"
                placeholder="np. 500.00"
                value={form.employerCostAmount}
                onChange={e => setForm((f: any) => ({ ...f, employerCostAmount: e.target.value }))} />
              <p className="text-[10px] text-muted-foreground">Zostanie uwzględnione w kalkulacji kosztów wyrobu gotowego</p>
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">PIN i działy</Label>
            <div className="space-y-1.5">
              <Label className="text-xs">PIN (opcjonalny)</Label>
              <Input
                value={form.pin ?? ''}
                onChange={e => setForm((f: any) => ({ ...f, pin: e.target.value }))}
                placeholder="np. 1234"
                inputMode="numeric"
                maxLength={8}
              />
              <p className="text-[10px] text-muted-foreground">Służy do logowania na panelu tabletu</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Działy (dostęp do paneli)</Label>
              <div className="flex flex-wrap gap-3 pt-1">
                {ALL_DEPTS.map(d => (
                  <label key={d} className="flex items-center gap-1 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(form.departments ?? []).includes(d)}
                      onChange={e => setForm((f: any) => ({
                        ...f,
                        departments: e.target.checked
                          ? [...(f.departments ?? []), d]
                          : (f.departments ?? []).filter((x: string) => x !== d),
                      }))}
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
