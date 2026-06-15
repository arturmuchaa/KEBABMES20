import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireOffice({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user || user.kind !== 'office') return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/zmiana-hasla" replace />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user || user.role !== 'admin') return <Navigate to="/office/dashboard" replace />
  return <>{children}</>
}

export function RequireDepartment({ dept, children }: { dept: string; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/panel" replace />
  const ok = user.kind === 'office' || user.departments.includes(dept)
  if (!ok) return <Navigate to="/panel" replace />
  return <>{children}</>
}
