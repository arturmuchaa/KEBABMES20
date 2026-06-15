import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tokenStore } from '@/features/auth/storage'
import { useAuth } from '@/features/auth/AuthContext'
import { BASE } from '@/lib/api'

export function ChangePasswordPage() {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [oldP, setOld] = useState(''); const [newP, setNew] = useState(''); const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const res = await fetch(`${BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.get()}` },
      body: JSON.stringify({ old_password: oldP, new_password: newP }),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.detail || 'Błąd'); return }
    await refresh(); nav('/office/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white p-8 rounded-xl shadow w-80 space-y-4">
        <h1 className="text-lg font-bold text-center">Zmień hasło</h1>
        <input className="w-full border rounded px-3 py-2" placeholder="Stare hasło" type="password"
               value={oldP} onChange={e => setOld(e.target.value)} />
        <input className="w-full border rounded px-3 py-2" placeholder="Nowe hasło (min. 8)" type="password"
               value={newP} onChange={e => setNew(e.target.value)} />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button className="w-full bg-blue-600 text-white rounded py-2 font-medium">Zapisz</button>
      </form>
    </div>
  )
}
