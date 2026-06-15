import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { KIOSK_DEPT_KEY } from '@/features/auth/storage'
import { BASE } from '@/lib/api'

const DEPTS: Record<string, { label: string; route: string }> = {
  rozbior: { label: 'Rozbiór', route: '/tablet/rozbior' },
  produkcja: { label: 'Produkcja', route: '/tablet/produkcja' },
  pakowanie: { label: 'Pakowanie', route: '/tablet/produkcja' },
  wydanie: { label: 'Wydanie', route: '/tablet/produkcja' },
}

export function PanelLoginPage() {
  const { loginPin } = useAuth()
  const nav = useNavigate()
  const [dept, setDept] = useState<string>(localStorage.getItem(KIOSK_DEPT_KEY) || '')
  const [ops, setOps] = useState<{ id: string; name: string }[]>([])
  const [sel, setSel] = useState<string>('')
  const [pin, setPin] = useState(''); const [err, setErr] = useState('')

  useEffect(() => {
    if (!dept) return
    fetch(`${BASE}/auth/operators?department=${dept}`).then(r => r.json()).then(setOps).catch(() => setOps([]))
  }, [dept])

  if (!dept) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-900 text-white">
        <h1 className="text-xl mb-2">Wybierz dział</h1>
        {Object.entries(DEPTS).map(([k, v]) => (
          <button key={k} onClick={() => setDept(k)}
            className="w-64 py-4 bg-gray-700 rounded-lg text-lg">{v.label}</button>
        ))}
      </div>
    )
  }

  const submit = async () => {
    setErr('')
    try { await loginPin(sel, pin); nav(DEPTS[dept].route, { replace: true }) }
    catch (e: any) { setErr(e.message || 'Błędny PIN'); setPin('') }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-900 text-white">
      <h1 className="text-xl">{DEPTS[dept].label} — zaloguj się</h1>
      <select className="text-black rounded px-3 py-3 w-72 text-lg"
              value={sel} onChange={e => setSel(e.target.value)}>
        <option value="">— wybierz nazwisko —</option>
        {ops.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input className="text-black rounded px-3 py-3 w-72 text-2xl text-center tracking-widest"
             placeholder="PIN" type="password" inputMode="numeric"
             value={pin} onChange={e => setPin(e.target.value)} />
      {err && <div className="text-red-400">{err}</div>}
      <button disabled={!sel || !pin} onClick={submit}
        className="w-72 py-4 bg-green-600 rounded-lg text-lg disabled:opacity-40">Zaloguj</button>
      <button onClick={() => { setDept(''); setSel(''); setPin('') }}
        className="text-sm text-gray-400">← zmień dział</button>
    </div>
  )
}
