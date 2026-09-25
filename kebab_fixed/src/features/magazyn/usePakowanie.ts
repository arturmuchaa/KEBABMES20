/**
 * Stan pakowania (otwarte kartony + pula) odpytywany co 4 s.
 *
 * Ten sam wzorzec co `useVehicleLoading`: dwóch pakujących do jednego
 * kartonu (albo biuro dopinające karton) musi zobaczyć licznik drugiego
 * bez dotykania ekranu. Porównanie migawek — bez niego ekran mrugałby
 * co 4 s mimo braku zmian.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { magazynApi, type OtwartyKarton, type PulaPozycja } from '@/lib/api'

export const POLL_PAKOWANIA_MS = 4000

export function usePakowanie() {
  const [kontenery, setKontenery] = useState<OtwartyKarton[]>([])
  const [pula, setPula] = useState<PulaPozycja[]>([])
  const [ladowanie, setLadowanie] = useState(true)
  const [blad, setBlad] = useState(false)
  const ostatnia = useRef('')
  const zywy = useRef(true)

  const odswiez = useCallback(async () => {
    try {
      const s = await magazynApi.pakowanie()
      if (!zywy.current) return
      const j = JSON.stringify(s)
      if (j !== ostatnia.current) {
        ostatnia.current = j
        setKontenery(s?.kontenery ?? [])
        setPula(s?.pula ?? [])
      }
      setBlad(false)
    } catch {
      if (zywy.current) setBlad(true)
    } finally {
      if (zywy.current) setLadowanie(false)
    }
  }, [])

  useEffect(() => {
    zywy.current = true
    void odswiez()
    const t = setInterval(() => { void odswiez() }, POLL_PAKOWANIA_MS)
    return () => { zywy.current = false; clearInterval(t) }
  }, [odswiez])

  return { kontenery, pula, ladowanie, blad, odswiez }
}
