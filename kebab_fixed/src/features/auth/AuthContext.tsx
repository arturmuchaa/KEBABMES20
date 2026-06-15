import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { tokenStore } from './storage'
import { BASE } from '@/lib/api'

export interface AuthUser {
  kind: 'office' | 'operator'
  id: string
  name: string
  role: 'admin' | 'office' | null
  departments: string[]
  must_change_password: boolean
}

interface AuthCtx {
  user: AuthUser | null
  loading: boolean
  loginOffice: (login: string, password: string) => Promise<AuthUser>
  loginPin: (workerId: string, pin: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as any)

async function call(path: string, opts: RequestInit = {}) {
  const token = tokenStore.get()
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(e.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return }
    try { setUser(await call('/auth/me')) }
    catch { tokenStore.clear(); setUser(null) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const loginOffice = async (login: string, password: string) => {
    const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) })
    tokenStore.set(r.token); setUser(r.user); return r.user as AuthUser
  }
  const loginPin = async (workerId: string, pin: string) => {
    const r = await call('/auth/login-pin', { method: 'POST', body: JSON.stringify({ worker_id: workerId, pin }) })
    tokenStore.set(r.token); setUser(r.user); return r.user as AuthUser
  }
  const logout = async () => {
    try { await call('/auth/logout', { method: 'POST' }) } catch {}
    tokenStore.clear(); setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, loginOffice, loginPin, logout, refresh }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
