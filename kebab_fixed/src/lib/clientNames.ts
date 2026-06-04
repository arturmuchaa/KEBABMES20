import { useEffect, useState } from 'react'
import { clientsApi } from '@/lib/api'

let _cache: Map<string, string> | null = null
let _loading: Promise<Map<string, string>> | null = null

export async function loadClientNames(): Promise<Map<string, string>> {
  if (_cache) return _cache
  if (!_loading) {
    _loading = clientsApi.list()
      .then((list: any[]) => {
        const m = new Map<string, string>()
        for (const c of list ?? []) {
          const name = (c?.name ?? '').trim()
          const disp = (c?.displayName ?? '').trim()
          if (name) m.set(name, disp || name)
        }
        _cache = m
        return m
      })
      .catch(() => { _loading = null; return new Map<string, string>() })
  }
  return _loading
}

export function resolveClientName(map: Map<string, string> | null, fullName: string): string {
  if (!fullName) return fullName
  return map?.get(fullName.trim()) || fullName
}

export function useClientNames(): (fullName: string) => string {
  const [map, setMap] = useState<Map<string, string> | null>(_cache)
  useEffect(() => {
    if (map) return
    let alive = true
    loadClientNames().then(m => { if (alive) setMap(m) })
    return () => { alive = false }
  }, [map])
  return (fullName: string) => resolveClientName(map, fullName)
}
