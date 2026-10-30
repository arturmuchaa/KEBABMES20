import { useEffect, useState } from 'react'
import { BASE } from '@/lib/api'
import { PROBA } from './proba'

/** Data zrobienia kopii bazy próby — nginx :8090 podaje ją jako /proba-kopia.json. */
export interface KopiaBazy { kopia: string; baza: string }

/** Adres pliku: w przeglądarce ścieżka względna, w Tauri serwer z BASE (bez /api). */
export const adresKopii = (base = BASE) => base.startsWith('http') ? `${base.replace(/\/api\/?$/, '')}/proba-kopia.json` : '/proba-kopia.json'

export function useKopia() {
  const [kopia, setKopia] = useState<KopiaBazy | null>(null)
  const [blad, setBlad] = useState(false)
  useEffect(() => {
    let off = false
    fetch(adresKopii(), { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(j => { if (!off) setKopia(j) })
      .catch(() => { if (!off) setBlad(true) })
    return () => { off = true }
  }, [])
  return { kopia, blad }
}

export const dataKopii = (k: KopiaBazy | null) => {
  if (!k?.kopia) return null
  const d = new Date(k.kopia)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Znacznik „PRÓBA — kopia bazy z …” — tylko w buildzie próby; w produkcji nic. */
export function ProbaZnacznik({ compact = false }: { compact?: boolean }) {
  return PROBA ? <ZnacznikKopii compact={compact} /> : null
}

function ZnacznikKopii({ compact }: { compact: boolean }) {
  const { kopia, blad } = useKopia()
  const d = dataKopii(kopia)
  return (
    <span className="proba-tag" role="status" data-tip={'Wersja PRÓBNA na KOPII bazy produkcji.\nZmiany tutaj nie trafiają do prawdziwego MES.\nKopia jest odświeżana na żądanie i wtedy zmiany z próby znikają.'}>
      PRÓBA{!compact && <> — kopia bazy {d ? `z ${d}` : blad ? '(brak daty kopii)' : '…'}</>}
    </span>
  )
}
