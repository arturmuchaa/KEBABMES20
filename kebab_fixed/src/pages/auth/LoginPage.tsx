import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'

export function LoginPage() {
  const { loginOffice } = useAuth()
  const nav = useNavigate()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    try {
      const u = await loginOffice(login, password)
      nav(u.must_change_password ? '/zmiana-hasla' : '/office/dashboard', { replace: true })
    } catch (e: any) { setErr(e.message || 'Błąd logowania') }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white p-8 rounded-xl shadow w-80 space-y-4">
        <h1 className="text-lg font-bold text-center">Kebab MES — biuro</h1>
        <input className="w-full border rounded px-3 py-2" placeholder="Login"
               value={login} onChange={e => setLogin(e.target.value)} autoFocus />
        <input className="w-full border rounded px-3 py-2" placeholder="Hasło" type="password"
               value={password} onChange={e => setPassword(e.target.value)} />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button className="w-full bg-blue-600 text-white rounded py-2 font-medium">Zaloguj</button>
        <a href="/panel" className="block text-center text-sm text-gray-500">Panel hali →</a>
      </form>
    </div>
  )
}
