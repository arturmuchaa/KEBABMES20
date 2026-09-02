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

import { Plus, Scissors, Factory, Users, ShieldCheck, Pencil, Archive, RotateCcw } from 'lucide-react'
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

const BLANK_FORM = { login: '', name: '', role: 'WORKER_DEBONING', ratePerKg: '0.55', ratePerHour: '0', sundayBonusEnabled: false, sundayBonusPerHour: '5', saturdayBonusEnabled: false, saturdayBonusPerHour: '5', payMode: 'hourly', ratePerDay: '150', contractType: 'zlecenie', employerCostAmount: '0', pin: '', departments: [] as string[], crewSize: '1', isWrapper: false, canSignPerformed: false, canSignChecked: false }

export function WorkersPage() {
  const { data, loading, refetch } = useApi(() => usersApi.list(true))
  const [open, setOpen]         = useState(false)
  const [editTarget, setEditTarget] = useState<UserType | null>(null)
  const [form, setForm]         = useState({ ...BLANK_FORM })
  const [editForm, setEditForm] = useState({ ...BLANK_FORM })
  // Archiwizacja zamiast kasowania: rekord trzymają deboning_entries,
  // payroll_settlements i traceability. Zwolniony znika z hali (default
  // /api/workers = tylko aktywni), a biuro widzi go w zakładce Archiwum.
  const [view, setView] = useState<'active' | 'archive'>('active')
  const [archiveTarget, setArchiveTarget] = useState<UserType | null>(null)
  const activeMut = useMutation((d: { id: string; active: boolean }) =>
    usersApi.setActive(d.id, d.active))

  const createMut = useMutation((d: typeof form) => usersApi.create({
    name: d.name, role: d.role,
    pin: d.pin || undefined,
    departments: d.departments,
    ratePerKg: parseFloat(d.ratePerKg) || 0,
    ratePerHour: parseFloat(d.ratePerHour) || 0,
    sundayBonusEnabled: d.sundayBonusEnabled,
    sundayBonusPerHour: parseFloat(d.sundayBonusPerHour) || 0,
    saturdayBonusEnabled: d.saturdayBonusEnabled,
    saturdayBonusPerHour: parseFloat(d.saturdayBonusPerHour) || 0,
    payMode: d.payMode,
    ratePerDay: parseFloat(d.ratePerDay) || 0,
    contractType: d.contractType,
    employerCostAmount: parseFloat(d.employerCostAmount) || 0,
    crewSize: parseInt(d.crewSize, 10) || 1,
    isWrapper: d.isWrapper,
    canSignPerformed: d.canSignPerformed,
    canSignChecked: d.canSignChecked,
  }))
  const updateMut = useMutation((d: { id: string } & typeof editForm) =>
    usersApi.update(d.id, {
      name: d.name, role: d.role,
      pin: d.pin || undefined,
      departments: d.departments,
      ratePerKg: parseFloat(d.ratePerKg) || 0,
      ratePerHour: parseFloat(d.ratePerHour) || 0,
      sundayBonusEnabled: d.sundayBonusEnabled,
      sundayBonusPerHour: parseFloat(d.sundayBonusPerHour) || 0,
      saturdayBonusEnabled: d.saturdayBonusEnabled,
      saturdayBonusPerHour: parseFloat(d.saturdayBonusPerHour) || 0,
      payMode: d.payMode,
      ratePerDay: parseFloat(d.ratePerDay) || 0,
      contractType: d.contractType,
      employerCostAmount: parseFloat(d.employerCostAmount) || 0,
      crewSize: parseInt(d.crewSize, 10) || 1,
      isWrapper: d.isWrapper,
      canSignPerformed: d.canSignPerformed,
      canSignChecked: d.canSignChecked,
    })
  )

  const allUsers = (data ?? []).filter(u => (view === 'archive' ? !u.active : u.active))
  const workers  = allUsers.filter(u => u.role.startsWith('WORKER'))
  const system   = allUsers.filter(u => !u.role.startsWith('WORKER'))
  const archivedCount = (data ?? []).filter(u => !u.active).length

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
      ratePerHour: String((u as any).ratePerHour ?? (u as any).rate_per_hour ?? 0),
      sundayBonusEnabled: !!((u as any).sundayBonusEnabled ?? (u as any).sunday_bonus_enabled ?? false),
      sundayBonusPerHour: String((u as any).sundayBonusPerHour ?? (u as any).sunday_bonus_per_hour ?? 0),
      saturdayBonusEnabled: !!((u as any).saturdayBonusEnabled ?? (u as any).saturday_bonus_enabled ?? false),
      saturdayBonusPerHour: String((u as any).saturdayBonusPerHour ?? (u as any).saturday_bonus_per_hour ?? 0),
      payMode: (u as any).payMode ?? (u as any).pay_mode ?? 'hourly',
      ratePerDay: String((u as any).ratePerDay ?? (u as any).rate_per_day ?? 0),
      crewSize: String((u as any).crewSize ?? (u as any).crew_size ?? 1),
      contractType: (u as any).contractType ?? (u as any).contract_type ?? 'zlecenie',
      employerCostAmount: String((u as any).employerCostAmount ?? (u as any).employer_cost_amount ?? 0),
      pin: '',
      departments: (u as any).departments ?? [],
      isWrapper: !!((u as any).isWrapper ?? (u as any).is_wrapper ?? false),
      canSignPerformed: !!((u as any).canSignPerformed ?? (u as any).can_sign_performed ?? false),
      canSignChecked: !!((u as any).canSignChecked ?? (u as any).can_sign_checked ?? false),
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

  async function handleSetActive(u: UserType, active: boolean) {
    try {
      await activeMut.mutate({ id: u.id, active })
      setArchiveTarget(null); refetch()
      toast.success(active ? `Przywrócono: ${u.name}` : `Zarchiwizowano: ${u.name}`)
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
          { label: 'Produkcja',value: allUsers.filter(u => u.role === 'WORKER_PRODUCTION').length, icon: <Factory size={18} className="text-ink-2" />,  accent: 'bg-surface-3' },
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
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border-2 border-border overflow-hidden">
              {([
                { v: 'active'  as const, l: 'Aktywni' },
                { v: 'archive' as const, l: `Archiwum${archivedCount ? ` (${archivedCount})` : ''}` },
              ]).map(o => (
                <button key={o.v} type="button" onClick={() => setView(o.v)}
                  className={`px-3 py-1.5 text-sm font-semibold transition-all ${view === o.v ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            <Button onClick={() => { setForm({ ...BLANK_FORM }); createMut.clearError?.(); setOpen(true) }}>
              <Plus size={14} className="mr-1.5" /> Dodaj pracownika
            </Button>
          </div>
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
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {view === 'archive' ? 'Archiwum jest puste' : 'Brak pracowników'}
              </CardTitle>
              <CardDescription>
                {view === 'archive'
                  ? 'Zarchiwizowani pracownicy pojawią się tutaj'
                  : 'Dodaj pierwszego pracownika klikając przycisk powyżej'}
              </CardDescription>
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
                            <span className="font-semibold text-green-700">
                              {u.role !== 'WORKER_GENERAL'
                                ? `${Number(rate).toFixed(2)} zł/kg`
                                : ((u as any).payMode ?? (u as any).pay_mode) === 'daily'
                                  ? `${Number((u as any).ratePerDay ?? (u as any).rate_per_day ?? 0).toFixed(2)} zł/dzień`
                                  : `${Number((u as any).ratePerHour ?? (u as any).rate_per_hour ?? 0).toFixed(2)} zł/h`}
                            </span>
                            {u.role === 'WORKER_GENERAL'
                              && ((u as any).sundayBonusEnabled ?? (u as any).sunday_bonus_enabled)
                              && <span className="text-amber-700 ml-1 text-xs">
                                   +{Number((u as any).sundayBonusPerHour ?? (u as any).sunday_bonus_per_hour ?? 0).toFixed(2)} nd.
                                 </span>}
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
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                          <Pencil size={13} className="mr-1" /> Edytuj
                        </Button>
                        {u.active ? (
                          <Button variant="ghost" size="sm" onClick={() => setArchiveTarget(u)}>
                            <Archive size={13} className="mr-1" /> Archiwizuj
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleSetActive(u, true)}>
                            <RotateCcw size={13} className="mr-1" /> Przywróć
                          </Button>
                        )}
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

      {/* Archiwizacja — rekord zostaje, znika tylko z list i paneli hali */}
      <Dialog open={!!archiveTarget} onOpenChange={v => { if (!v) setArchiveTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Zarchiwizować pracownika?</DialogTitle>
            <DialogDescription>{archiveTarget?.name}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Zniknie z paneli hali i z list wyboru. Wpisy rozbioru, godziny,
            historia i rozliczenia zostają nietknięte — możesz go przywrócić
            w każdej chwili z zakładki Archiwum.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>Anuluj</Button>
            <Button onClick={() => archiveTarget && handleSetActive(archiveTarget, false)}
              disabled={activeMut.loading}>
              <Archive size={14} className="mr-1.5" /> Archiwizuj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Reusable form component ──────────────────────────────────
function WorkerForm({ form, setForm, onRoleChange, onNameChange, hideSystemRoles }: {
  form: { login: string; name: string; role: string; ratePerKg: string; ratePerHour: string; sundayBonusEnabled: boolean; sundayBonusPerHour: string; saturdayBonusEnabled: boolean; saturdayBonusPerHour: string; payMode: string; ratePerDay: string; contractType: string; employerCostAmount: string; pin: string; departments: string[]; crewSize: string; isWrapper: boolean; canSignPerformed: boolean; canSignChecked: boolean }
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
            {form.role === 'WORKER_GENERAL' ? (
              <>
                {/* Myjący dostaje stawkę ZA DZIEŃ obecności — godziny nie mają
                    dla niego znaczenia, więc w grafiku wybiera się tylko
                    obecny/nieobecny. */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Sposób rozliczenia</Label>
                  <div className="flex gap-2">
                    {[{ v: 'hourly', l: 'Za godziny' }, { v: 'daily', l: 'Za dzień obecności' }].map(opt => (
                      <button key={opt.v} type="button"
                        onClick={() => setForm((f: any) => ({ ...f, payMode: opt.v }))}
                        className={`flex-1 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${form.payMode === opt.v ? 'border-primary bg-primary text-white' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
                {form.payMode === 'daily' ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Stawka dzienna (zł/dzień)</Label>
                    <Input type="number" step="0.01" min="0"
                      value={form.ratePerDay}
                      onChange={e => setForm((f: any) => ({ ...f, ratePerDay: e.target.value }))} />
                    <p className="text-[10px] text-muted-foreground">
                      W grafiku zaznacza się tylko obecność — bez godzin
                    </p>
                  </div>
                ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">Stawka godzinowa (zł/h)</Label>
                  <Input type="number" step="0.01" min="0"
                    value={form.ratePerHour}
                    onChange={e => setForm((f: any) => ({ ...f, ratePerHour: e.target.value }))} />
                  <p className="text-[10px] text-muted-foreground">
                    Pracownicy ogólni rozliczają się z godzin wpisywanych w zakładce „Godziny pracy"
                  </p>
                </div>
                )}
                {/* Premia niedzielna: dodatek do stawki naliczany WYŁĄCZNIE
                    za godziny przepracowane w niedzielę. Przełącznik osobno
                    od kwoty, żeby dało się ją wyłączyć bez kasowania wartości. */}
                {/* Premie liczą się ZA GODZINĘ, więc przy dniówce nie mają
                    zastosowania. */}
                {form.payMode !== 'daily' && ([
                  { key: 'saturday', on: 'saturdayBonusEnabled', amt: 'saturdayBonusPerHour', label: 'Premia za sobotę', day: 'soboty' },
                  { key: 'sunday',   on: 'sundayBonusEnabled',   amt: 'sundayBonusPerHour',   label: 'Premia za niedzielę', day: 'niedzieli' },
                ]).map(b => (
                  <div key={b.key} className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                        checked={(form as any)[b.on]}
                        onChange={e => setForm((f: any) => ({ ...f, [b.on]: e.target.checked }))} />
                      <span className="font-medium">{b.label}</span>
                    </label>
                    {(form as any)[b.on] && (
                      <div className="pl-6 space-y-1">
                        <Label className="text-xs">Dodatek do stawki (zł/h)</Label>
                        <Input type="number" step="0.01" min="0"
                          value={(form as any)[b.amt]}
                          onChange={e => setForm((f: any) => ({ ...f, [b.amt]: e.target.value }))} />
                        <p className="text-[10px] text-muted-foreground">
                          Doliczane tylko do godzin z {b.day} — reszta tygodnia po stawce podstawowej
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Stawka akordowa (zł/kg)</Label>
                <Input type="number" step="0.01" min="0"
                  value={form.ratePerKg}
                  onChange={e => setForm((f: any) => ({ ...f, ratePerKg: e.target.value }))} />
              </div>
            )}
            {/* Obsada stanowiska — część brygady rozbiera we dwoje na jedno
                nazwisko. Bez tego kg/h takiego stanowiska w raporcie jest
                dwukrotnie zawyżone. Nie dotyka akordu ani uzysku. */}
            <div className="space-y-1.5">
              <Label className="text-xs">Obsada stanowiska</Label>
              <div className="flex gap-2">
                {[{ v: '1', l: 'Pracuje sam' }, { v: '2', l: 'Pracuje w parze' }].map(opt => (
                  <button key={opt.v} type="button"
                    onClick={() => setForm((f: any) => ({ ...f, crewSize: opt.v }))}
                    className={`flex-1 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${form.crewSize === opt.v ? 'border-primary bg-primary text-white' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                    {opt.l}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                „W parze" = dwie osoby rozbierają, a wpisy idą na to jedno nazwisko.
                Dzieli tempo kg/h w raporcie przez dwa; kilogramy, uzysk i akord bez zmian.
              </p>
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
              {/* Foliowczyk to ZNACZNIK, nie rola: te same osoby zwykle też
                  układają, a płaca sumuje jedno i drugie. Panel produkcji
                  proponuje wpis zafoliowanych kilogramów tylko zaznaczonym. */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.isWrapper}
                  onChange={e => setForm((f: any) => ({ ...f, isWrapper: e.target.checked }))}
                />
                Foliowczyk (wpisuje zafoliowane kilogramy)
              </label>
            </div>
            <div className="space-y-1.5">
              {/* Uprawnienia podpisu HACCP. Dwa, bo kolumny l i m karty 1.1.1
                  znaczą co innego: „wykonał" to kto przyjął dostawę,
                  „sprawdził" to kierownik albo technolog. Domyślnie NIKT ich
                  nie ma — nadaje się je świadomie. */}
              <Label className="text-xs">Podpis elektroniczny (karta HACCP)</Label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.canSignPerformed}
                  onChange={e => setForm((f: any) => ({ ...f, canSignPerformed: e.target.checked }))}
                />
                Podpis: wykonał
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.canSignChecked}
                  onChange={e => setForm((f: any) => ({ ...f, canSignChecked: e.target.checked }))}
                />
                Podpis: sprawdził
              </label>
              <p className="text-[10px] text-muted-foreground">
                Decyduje, w której kolumnie karty 1.1.1 osoba może się podpisać.
                Wzór podpisu rysuje się na HMI rozbioru (kod 0099).
              </p>
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
