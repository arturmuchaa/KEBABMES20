import { useState } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { usersApi } from '@/lib/apiClient'
import { toast } from 'sonner'

// ── shadcn/ui ──────────────────────────────────────────────────
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

import { Plus, Scissors, Factory, Users, ShieldCheck } from 'lucide-react'
import type { User as UserType } from '@/types'

const WORKER_ROLES = [
  { value: 'WORKER_DEBONING',   label: 'Pracownik rozbioru',  icon: <Scissors size={15} />, desc: 'Hala — rozbiór ćwiartki' },
  { value: 'WORKER_PRODUCTION', label: 'Pracownik produkcji', icon: <Factory size={15} />,  desc: 'Hala — linia produkcyjna' },
  { value: 'WORKER_GENERAL',    label: 'Pracownik ogólny',    icon: <Users size={15} />,     desc: 'Hala — prace ogólne' },
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

function autoLogin(name: string) {
  const p = name.trim().toLowerCase().split(/\s+/)
  if (p.length >= 2) return `${p[0][0]}${p[p.length - 1]}`.replace(/[^a-z]/g, '')
  return p[0]?.replace(/[^a-z]/g, '') ?? ''
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export function WorkersPage() {
  const { data, loading, refetch } = useApi(() => usersApi.list())
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ login: '', name: '', role: 'WORKER_DEBONING' })
  const mutation = useMutation((d: typeof form) => usersApi.create(d))

  const allUsers = data ?? []
  const workers  = allUsers.filter(u => u.role.startsWith('WORKER'))
  const system   = allUsers.filter(u => !u.role.startsWith('WORKER'))

  function handleRoleChange(role: string) {
    setForm(f => ({ ...f, role, login: needsLogin(role) ? f.login : autoLogin(f.name) }))
  }
  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, login: needsLogin(f.role) ? f.login : autoLogin(name) }))
  }
  async function handleSubmit() {
    if (!form.name.trim()) return toast.error('Imię i nazwisko jest wymagane')
    if (needsLogin(form.role) && !form.login.trim()) return toast.error('Login jest wymagany dla tej roli')
    const finalLogin = form.login.trim() || autoLogin(form.name)
    try {
      await mutation.mutate({ ...form, login: finalLogin })
      setOpen(false)
      refetch()
      setForm({ login: '', name: '', role: 'WORKER_DEBONING' })
      toast.success(`Dodano pracownika: ${form.name}`)
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
          <Button onClick={() => { setForm({ login: '', name: '', role: 'WORKER_DEBONING' }); mutation.clearError?.(); setOpen(true) }}>
            <Plus size={14} className="mr-1.5" /> Dodaj pracownika
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {loading ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Pracownik', 'Stanowisko', 'Status', ''].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[0,1,2].map(i => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell><div className="flex items-center gap-3"><Skeleton className="w-9 h-9 rounded-full" /><Skeleton className="h-4 w-32" /></div></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
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
                  {['Pracownik', 'Stanowisko', 'Status', ''].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.map(u => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {initials(u.name)}
                        </div>
                        <div>
                          <CardTitle className="text-sm font-semibold">{u.name}</CardTitle>
                          {!u.role.startsWith('WORKER') && (
                            <code className="text-xs text-muted-foreground font-mono">{u.login}</code>
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
                      <Badge variant={u.active ? 'success' : 'secondary'}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${u.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {u.active ? 'Aktywny' : 'Nieaktywny'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">Edytuj</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modal: Nowy pracownik */}
      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nowy pracownik</DialogTitle>
            <DialogDescription>Dodaj pracownika hali lub użytkownika systemu</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Imię i nazwisko */}
            <div className="space-y-1.5">
              <Label htmlFor="worker-name">Imię i nazwisko *</Label>
              <Input
                id="worker-name"
                placeholder="np. Jan Kowalski"
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
              />
            </div>

            <Separator />

            {/* Stanowisko — hala */}
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Hala produkcyjna
              </Label>
              <RadioGroup value={form.role} onValueChange={handleRoleChange} className="gap-2">
                {WORKER_ROLES.map(opt => (
                  <label
                    key={opt.value}
                    htmlFor={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      form.role === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <RadioGroupItem value={opt.value} id={opt.value} />
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      form.role === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                      {opt.icon}
                    </div>
                    <div>
                      <CardTitle className={`text-sm ${form.role === opt.value ? 'text-primary' : ''}`}>
                        {opt.label}
                      </CardTitle>
                      <CardDescription className="text-xs">{opt.desc}</CardDescription>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* Stanowisko — system */}
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Dostęp do systemu
              </Label>
              <RadioGroup value={form.role} onValueChange={handleRoleChange} className="gap-2">
                {SYSTEM_ROLES.map(opt => (
                  <label
                    key={opt.value}
                    htmlFor={`sys-${opt.value}`}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      form.role === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <RadioGroupItem value={opt.value} id={`sys-${opt.value}`} />
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      form.role === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                      {opt.icon}
                    </div>
                    <div>
                      <CardTitle className={`text-sm ${form.role === opt.value ? 'text-primary' : ''}`}>
                        {opt.label}
                      </CardTitle>
                      <CardDescription className="text-xs">{opt.desc}</CardDescription>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* Login — tylko dla ról systemowych */}
            {needsLogin(form.role) && (
              <div className="space-y-1.5">
                <Label htmlFor="worker-login">Login *</Label>
                <Input
                  id="worker-login"
                  placeholder="np. jan_kowalski"
                  value={form.login}
                  onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                />
              </div>
            )}

            {/* Error */}
            {mutation.error && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="px-3 py-2">
                  <CardDescription className="text-destructive font-medium">{mutation.error}</CardDescription>
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.loading}>
              Anuluj
            </Button>
            <Button onClick={handleSubmit} disabled={mutation.loading} className="gap-2">
              {mutation.loading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Plus size={14} />
              }
              Dodaj pracownika
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
