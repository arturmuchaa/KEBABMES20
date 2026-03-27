import { useState } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { usersApi } from '@/lib/apiClient'
import { Card, CardHeader, Modal, Toast , PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Table } from '@/components/ui/Table'
import { Plus, Scissors, Factory, Users, ShieldCheck } from 'lucide-react'
import type { User as UserType } from '@/types'

// Role pracownicze (bez loginu) vs systemowe (z loginem)
const WORKER_ROLES = [
  { value: 'WORKER_DEBONING',    label: 'Pracownik rozbioru',  icon: <Scissors size={14} /> },
  { value: 'WORKER_PRODUCTION',  label: 'Pracownik produkcji', icon: <Factory size={14} /> },
  { value: 'WORKER_GENERAL',     label: 'Pracownik ogólny',    icon: <Users size={14} /> },
]

const SYSTEM_ROLES = [
  { value: 'OFFICE',  label: 'Biuro',          icon: <Users size={14} /> },
  { value: 'ADMIN',   label: 'Administrator',   icon: <ShieldCheck size={14} /> },
]

const ALL_ROLES = [...WORKER_ROLES, ...SYSTEM_ROLES]

const ROLE_VARIANT: Record<string, 'green'|'blue'|'red'|'gray'|'purple'|'orange'> = {
  WORKER_DEBONING:   'green',
  WORKER_PRODUCTION: 'blue',
  WORKER_GENERAL:    'gray',
  OFFICE:            'purple',
  ADMIN:             'red',
}

const ROLE_LABEL: Record<string, string> = {
  WORKER_DEBONING:   'Rozbiór',
  WORKER_PRODUCTION: 'Produkcja',
  WORKER_GENERAL:    'Ogólny',
  OFFICE:            'Biuro',
  ADMIN:             'Administrator',
}

// Czy dana rola wymaga loginu?
function needsLogin(role: string): boolean {
  return role === 'ADMIN' || role === 'OFFICE'
}

// Auto-generuj login z imienia i nazwiska
function autoLogin(name: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1]}`.replace(/[^a-z]/g, '')
  return parts[0]?.replace(/[^a-z]/g, '') ?? ''
}

export function WorkersPage() {
  const { data, loading, refetch } = useApi(() => usersApi.list())
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ login: '', name: '', role: 'WORKER_DEBONING' })
  const [toast, setToast] = useState({ msg: '', type: 'success' as 'success'|'error', visible: false })
  const mutation = useMutation((d: typeof form) => usersApi.create(d))

  const allUsers = data ?? []
  const workers  = allUsers.filter(u => u.role.startsWith('WORKER'))
  const system   = allUsers.filter(u => !u.role.startsWith('WORKER'))

  function showToast(msg: string, type: 'success'|'error' = 'success') {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000)
  }

  function handleRoleChange(role: string) {
    setForm(f => ({
      ...f,
      role,
      // Wyczyść login gdy przełączamy na rolę pracowniczą (nie systemową)
      login: needsLogin(role) ? f.login : autoLogin(f.name),
    }))
  }

  function handleNameChange(name: string) {
    setForm(f => ({
      ...f,
      name,
      // Auto-uzupełnij login jeśli rola nie systemowa
      login: needsLogin(f.role) ? f.login : autoLogin(name),
    }))
  }

  async function handleSubmit() {
    if (!form.name.trim()) return showToast('Imię i nazwisko jest wymagane', 'error')
    if (needsLogin(form.role) && !form.login.trim())
      return showToast('Login jest wymagany dla tej roli', 'error')

    // Dla pracowników fizycznych auto-generuj login jeśli pusty
    const finalLogin = form.login.trim() || autoLogin(form.name)
    try {
      await mutation.mutate({ ...form, login: finalLogin })
      setOpen(false)
      refetch()
      setForm({ login: '', name: '', role: 'WORKER_DEBONING' })
      showToast(`Dodano: ${form.name}`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Błąd', 'error')
    }
  }

  function openNew() {
    setForm({ login: '', name: '', role: 'WORKER_DEBONING' })
    mutation.clearError?.()
    setOpen(true)
  }

  function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  }

  const columns = [
    {
      key: 'name', header: 'Pracownik',
      render: (u: UserType) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-900-light text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {getInitials(u.name)}
          </div>
          <div>
            <div className="font-semibold text-slate-900 text-sm">{u.name}</div>
            {/* Login widoczny tylko dla ról systemowych */}
            {!u.role.startsWith('WORKER') && (
              <div className="text-xs text-slate-900-3 font-mono">{u.login}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Stanowisko',
      render: (u: UserType) => (
        <Badge variant={ROLE_VARIANT[u.role] ?? 'gray'}>
          {ROLE_LABEL[u.role] ?? u.role}
        </Badge>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (u: UserType) => (
        <Badge variant={u.active ? 'green' : 'gray'} dot>
          {u.active ? 'Aktywny' : 'Nieaktywny'}
        </Badge>
      ),
    },
    {
      key: 'actions', header: '',
      render: (_u: UserType) => (
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="ghost">Edytuj</Button>
        </div>
      ),
    },
  ]

  const isSystemRole = needsLogin(form.role)

  return (
    <div className="space-y-5 animate-fade-in">

      <PageHeader title="Pracownicy" subtitle="Zarządzaj pracownikami" />
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center">
              <Users size={20} className="text-slate-900-3" />
            </div>
            <div>
              <div className="text-2xl font-black text-slate-900">{allUsers.length}</div>
              <div className="text-[10px] font-semibold text-slate-900-3 uppercase">Wszyscy</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center">
              <Scissors size={20} className="text-success" />
            </div>
            <div>
              <div className="text-2xl font-black text-success">{allUsers.filter(u => u.role === 'WORKER_DEBONING').length}</div>
              <div className="text-[10px] font-semibold text-slate-900-3 uppercase">Rozbiór</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900-light flex items-center justify-center">
              <Factory size={20} className="text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-black text-blue-600">{allUsers.filter(u => u.role === 'WORKER_PRODUCTION').length}</div>
              <div className="text-[10px] font-semibold text-slate-900-3 uppercase">Produkcja</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warn-light flex items-center justify-center">
              <ShieldCheck size={20} className="text-warn" />
            </div>
            <div>
              <div className="text-2xl font-black text-warn">{system.length}</div>
              <div className="text-[10px] font-semibold text-slate-900-3 uppercase">Systemowi</div>
            </div>
          </div>
        </Card>
      </div>

      <Card noPad>
        <div className="px-5 pt-5">
          <CardHeader
            title="Pracownicy"
            subtitle="Hala produkcyjna · Biuro · Administratorzy"
            actions={<Button icon={<Plus size={15} />} onClick={openNew}>Dodaj pracownika</Button>}
          />
        </div>
        <Table columns={columns} data={allUsers} loading={loading} keyFn={u => u.id}
          empty="Brak pracowników — dodaj pierwszego klikając przycisk powyżej"
        />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nowy pracownik" size="sm" preventClose>
        <div className="space-y-4">

          {/* Imię i nazwisko */}
          <Input
            label="Imię i nazwisko *"
            placeholder="np. Jan Kowalski"
            value={form.name}
            onChange={e => handleNameChange(e.target.value)}
          />

          {/* Stanowisko */}
          <div>
            <label className="block text-xs font-bold text-slate-900-3 uppercase tracking-wide mb-2">
              Stanowisko *
            </label>

            {/* Pracownicy hali */}
            <div className="mb-2">
              <div className="text-[10px] font-bold text-slate-900-4 uppercase tracking-wider mb-1.5 px-1">
                Hala produkcyjna
              </div>
              <div className="space-y-1.5">
                {WORKER_ROLES.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      form.role === opt.value
                        ? 'border-brand bg-slate-900-light'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input type="radio" name="role" value={opt.value}
                      checked={form.role === opt.value}
                      onChange={e => handleRoleChange(e.target.value)}
                      className="sr-only"
                    />
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      form.role === opt.value ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-900-3'
                    }`}>
                      {opt.icon}
                    </span>
                    <span className={`font-semibold text-sm ${form.role === opt.value ? 'text-blue-600' : 'text-slate-900'}`}>
                      {opt.label}
                    </span>
                    {form.role === opt.value && <span className="ml-auto text-blue-600 text-sm">✓</span>}
                  </label>
                ))}
              </div>
            </div>

            {/* Użytkownicy systemowi */}
            <div>
              <div className="text-[10px] font-bold text-slate-900-4 uppercase tracking-wider mb-1.5 px-1">
                Dostęp do systemu
              </div>
              <div className="space-y-1.5">
                {SYSTEM_ROLES.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      form.role === opt.value
                        ? 'border-brand bg-slate-900-light'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input type="radio" name="role" value={opt.value}
                      checked={form.role === opt.value}
                      onChange={e => handleRoleChange(e.target.value)}
                      className="sr-only"
                    />
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      form.role === opt.value ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-900-3'
                    }`}>
                      {opt.icon}
                    </span>
                    <div className="flex-1">
                      <span className={`font-semibold text-sm ${form.role === opt.value ? 'text-blue-600' : 'text-slate-900'}`}>
                        {opt.label}
                      </span>
                      <div className="text-[10px] text-slate-900-4">Wymaga loginu do systemu</div>
                    </div>
                    {form.role === opt.value && <span className="ml-auto text-blue-600 text-sm">✓</span>}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Login — tylko dla ról systemowych */}
          {isSystemRole && (
            <Input
              label="Login *"
              placeholder="np. jan_kowalski"
              value={form.login}
              onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
            />
          )}

          {mutation.error && (
            <div className="text-sm text-danger bg-danger-light border border-danger-border rounded-lg px-3 py-2">
              {mutation.error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" fullWidth onClick={() => setOpen(false)}>Anuluj</Button>
            <Button fullWidth loading={mutation.loading} onClick={handleSubmit} icon={<Plus size={14} />}>
              Dodaj
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
