import { useEffect, useState } from 'react'
import { tokenStore } from '@/features/auth/storage'
import { RequireAdmin } from '@/features/auth/guards'
import { BASE } from '@/lib/api'
import { DataTable } from '@/components/DataTable'

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.get()}` })

interface AppUser { id: string; login: string; role: string; display_name: string; active: boolean }

function UsersInner() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState({ login: '', password: '', display_name: '', role: 'office' })
  const [err, setErr] = useState('')

  const load = () => fetch(`${BASE}/app-users`, { headers: authHeaders() }).then(r => r.json()).then(setUsers)
  useEffect(() => { load() }, [])

  const create = async () => {
    setErr('')
    const res = await fetch(`${BASE}/app-users`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) })
    if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.detail || 'Błąd'); return }
    setForm({ login: '', password: '', display_name: '', role: 'office' }); load()
  }
  const toggle = async (u: AppUser) => {
    await fetch(`${BASE}/app-users/${u.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ active: !u.active }) })
    load()
  }

  const inputCls = 'h-9 rounded-md border border-surface-4 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand'

  return (
    <div className="space-y-4">
      {/* Nowe konto */}
      <div className="flex gap-2 items-end flex-wrap rounded-lg border border-surface-4 bg-white p-4">
        <input className={inputCls} placeholder="Login" value={form.login}
               onChange={e => setForm({ ...form, login: e.target.value })} />
        <input className={inputCls} placeholder="Imię i nazwisko" value={form.display_name}
               onChange={e => setForm({ ...form, display_name: e.target.value })} />
        <input className={inputCls} placeholder="Hasło (min. 8)" type="password" value={form.password}
               onChange={e => setForm({ ...form, password: e.target.value })} />
        <select className={inputCls} value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="office">Biuro</option><option value="admin">Admin</option>
        </select>
        <button onClick={create} className="h-9 px-4 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-dark">Dodaj konto</button>
      </div>
      {err && <div className="text-sm font-semibold text-red-600">{err}</div>}

      <DataTable
        rows={users} rowKey={u => u.id}
        searchText={u => `${u.login} ${u.display_name} ${u.role}`}
        searchPlaceholder="Szukaj: login, imię, rola…"
        initialSort={{ key: 'login' }}
        columns={[
          { key: 'login', header: 'Login', sortable: true, sortValue: u => u.login,
            cell: u => <span className="font-semibold text-ink">{u.login}</span> },
          { key: 'name', header: 'Imię i nazwisko', sortable: true, sortValue: u => u.display_name,
            cell: u => u.display_name || '—' },
          { key: 'role', header: 'Rola', sortable: true, sortValue: u => u.role,
            cell: u => u.role === 'admin' ? 'Administrator' : 'Biuro' },
          { key: 'active', header: 'Status', sortable: true, sortValue: u => (u.active ? 1 : 0),
            cell: u => u.active
              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">aktywne</span>
              : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-surface-3 text-ink-4 border border-surface-4">nieaktywne</span> },
          { key: 'act', header: '', align: 'right',
            cell: u => <button onClick={() => toggle(u)} className="text-brand text-xs font-semibold hover:underline">{u.active ? 'Dezaktywuj' : 'Aktywuj'}</button> },
        ]}
      />
    </div>
  )
}

export function UsersPage() {
  return <RequireAdmin><UsersInner /></RequireAdmin>
}
