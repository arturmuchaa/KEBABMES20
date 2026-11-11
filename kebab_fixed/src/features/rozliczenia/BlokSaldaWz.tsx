/**
 * Tabelka salda drukowana pod WZ wychodzącą do klienta (spec p. 10.1).
 *
 * Stan z chwili wydruku, ze wspólnego źródła z panelem rozliczeń. Blok jest
 * dodatkiem do dokumentu, nie warunkiem jego wydruku: gdy backend nie ma
 * zestawienia (WM, WZ bez kontrahenta, sprzed daty startu → 404) albo
 * zapytanie padnie, WZ drukuje się normalnie bez tabelki.
 */
import { useEffect, useState } from 'react'
import { rozliczeniaApi } from '@/lib/api'
import { TabelaSalda } from './TabelaSalda'
import type { Zestawienie } from './druk'

export function BlokSaldaWz({ wzId }: { wzId: string }) {
  const [z, setZ] = useState<Zestawienie | null>(null)

  useEffect(() => {
    let porzucone = false
    setZ(null)
    rozliczeniaApi.naWz(wzId)
      .then(w => { if (!porzucone) setZ(w) })
      .catch(() => { if (!porzucone) setZ(null) })
    return () => { porzucone = true }
  }, [wzId])

  if (!z) return null
  return (
    <div data-testid="blok-salda" className="mt-3">
      <TabelaSalda z={z} />
    </div>
  )
}
