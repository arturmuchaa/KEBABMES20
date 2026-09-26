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
  const [spakowane, setSpakowane] = useState<OtwartyKarton[]>([])
  const [ladowanie, setLadowanie] = useState(true)
  const [blad, setBlad] = useState(false)
  const [aktualizacja, setAktualizacja] = useState<Date | null>(null)
  const numer = useRef(0)
  const ostatnia = useRef('')
  const zywy = useRef(true)

  const odswiez = useCallback(async () => {
    const n = ++numer.current
    try {
      const s = await magazynApi.pakowanie()
      if (!zywy.current || n !== numer.current) return
      const j = JSON.stringify(s)
      if (j !== ostatnia.current) {
        ostatnia.current = j
        setKontenery(s?.kontenery ?? [])
        setPula(s?.pula ?? [])
        setSpakowane(s?.spakowane ?? [])
      }
      setBlad(false)
      setAktualizacja(new Date())
    } catch {
      if (zywy.current && n === numer.current) setBlad(true)
    } finally {
      if (zywy.current && n === numer.current) setLadowanie(false)
    }
  }, [])

  useEffect(() => {
    zywy.current = true
    void odswiez()
    const t = setInterval(() => { void odswiez() }, POLL_PAKOWANIA_MS)
    return () => { zywy.current = false; numer.current++; clearInterval(t) }
  }, [odswiez])

  return { kontenery, spakowane, pula, ladowanie, blad, aktualizacja, odswiez }
}
