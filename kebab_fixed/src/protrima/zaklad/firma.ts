/**
 * Dane firmy z serwera zakładu (`/api/settings/company`) — raz na sesję.
 * Część profilu zakładu, która już mieszka na serwerze; reszta: `zaklad.ts`.
 */
import { useEffect, useState } from 'react'
import { settingsApi } from '@/lib/api'
import type { Firma } from './zaklad'

let _firma: Firma | null = null
let _ladowanie: Promise<Firma | null> | null = null
/** Dane firmy z serwera — raz na sesję (zmieniają się rzadko). */
export function wczytajFirme(): Promise<Firma | null> {
  if (_firma) return Promise.resolve(_firma)
  if (!_ladowanie) {
    _ladowanie = (settingsApi.getCompany() as Promise<Firma>)
      .then(f => { _firma = f ?? null; return _firma })
      .catch(() => { _ladowanie = null; return null })
  }
  return _ladowanie
}
export function useFirma(): Firma | null {
  const [f, setF] = useState<Firma | null>(_firma)
  useEffect(() => {
    if (f) return
    let zywe = true
    void wczytajFirme().then(x => { if (zywe) setF(x) })
    return () => { zywe = false }
  }, [f])
  return f
}
