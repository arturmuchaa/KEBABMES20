import { useEffect, useState } from 'react'
import { tokenStore } from '@/features/auth/storage'
import { RequireAdmin } from '@/features/auth/guards'
import { BASE } from '@/lib/api'

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

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Konta biura</h1>
      <div className="flex gap-2 items-end flex-wrap bg-white p-4 rounded shadow">
        <input className="border rounded px-2 py-1" placeholder="Login" value={form.login}
               onChange={e => setForm({ ...form, login: e.target.value })} />
        <input className="border rounded px-2 py-1" placeholder="Imię i nazwisko" value={form.display_name}
               onChange={e => setForm({ ...form, display_name: e.target.value })} />
        <input className="border rounded px-2 py-1" placeholder="Hasło (min.8)" type="password" value={form.password}
               onChange={e => setForm({ ...form, password: e.target.value })} />
        <select className="border rounded px-2 py-1" value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="office">Biuro</option><option value="admin">Admin</option>
        </select>
        <button onClick={create} className="bg-blue-600 text-white rounded px-3 py-1">Dodaj</button>
      </div>
      {err && <div className="text-red-600">{err}</div>}
      <table className="w-full bg-white rounded shadow text-sm">
        <thead><tr className="text-left border-b"><th className="p-2">Login</th><th>Imię</th><th>Rola</th><th>Aktywne</th><th></th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="border-b">
              <td className="p-2">{u.login}</td><td>{u.display_name}</td><td>{u.role}</td>
              <td>{u.active ? '✓' : '—'}</td>
              <td><button onClick={() => toggle(u)} className="text-blue-600">{u.active ? 'Dezaktywuj' : 'Aktywuj'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UsersPage() {
  return <RequireAdmin><UsersInner /></RequireAdmin>
}
