/**
 * Wspólny stan załadunku auta — JEDYNE źródło prawdy ekranu skanera.
 *
 * Zasada: ekran nie liczy niczego sam i niczego o załadunku nie pamięta
 * między odświeżeniami. Każda operacja idzie na serwer i kończy się
 * PRZYJĘCIEM ŚWIEŻEJ MIGAWKI stamtąd. Dzięki temu nie może powstać
 * rozjazd „front mówi 10/10, backend 8/10".
 *
 * Synchronizacja to POLLING, nie SSE/WebSocket — świadomie. Tak działa
 * reszta MES (`useApi` ma wbudowane porównanie JSON, żeby identyczna
 * odpowiedź nie powodowała przerysowania; rozbiór HMI odpytuje co 5 s),
 * a dokładanie drugiego kanału transportowego do działającego systemu
 * kosztowałoby więcej niż daje: różnica między 0 a 4 s nie zmienia pracy
 * magazyniera, a poprawność zapewnia backend, nie szybkość powiadomienia.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { isOfflineError, vehicleLoadingApi, type VehicleState } from '@/lib/api'

/** Co ile dopytujemy serwer o stan auta. */
export const POLL_MS = 4000

export interface UseVehicleLoading {
  stan: VehicleState | null
  /** Pierwsze ładowanie — dopiero wtedy wolno pokazać „pusto". */
  ladowanie: boolean
  /** Czy ostatni kontakt z serwerem się udał. */
  online: boolean
  /** Wymuś odczyt teraz (po skanie, po akcji, po kliknięciu odśwież). */
  odswiez: () => Promise<VehicleState | null>
  /** Przyjmij migawkę zwróconą przez operację zapisu — bez dodatkowego GET-a. */
  przyjmij: (s: VehicleState) => void
}

/** Czy migawka różni się od poprzedniej.
 *
 *  Odpytywanie co 4 s ustawiałoby stan także wtedy, gdy serwer oddaje
 *  IDENTYCZNE dane — a każde takie ustawienie przerysowuje ekran i mruga
 *  paskami postępu. `useApi` w tym projekcie rozwiązuje to tak samo
 *  i z tego samego powodu; nie powielamy pomysłu, tylko wzorzec.
 */
function inna(a: unknown, b: unknown): boolean {
  if (a === b) return false
  try { return JSON.stringify(a) !== JSON.stringify(b) } catch { return true }
}

export function useVehicleLoading(vehicleId: string): UseVehicleLoading {
  const [stan, setStan] = useState<VehicleState | null>(null)
  const [ladowanie, setLadowanie] = useState(true)
  const [online, setOnline] = useState(true)
  // Żywotność komponentu — polling nie może pisać po odmontowaniu.
  const zywy = useRef(true)
  // Ostatnia migawka poza stanem Reacta — do porównania bez re-renderu.
  const ostatnia = useRef<VehicleState | null>(null)

  const odswiez = useCallback(async (): Promise<VehicleState | null> => {
    if (!vehicleId) return null
    try {
      const s = await vehicleLoadingApi.state(vehicleId)
      if (!zywy.current) return s
      if (inna(ostatnia.current, s)) {
        ostatnia.current = s
        setStan(s)
      }
      setOnline(true)
      return s
    } catch (e) {
      // Zerwana sieć NIE kasuje ostatniej znanej migawki — magazynier ma
      // dalej widzieć, co ma na aucie. Zmienia się tylko znacznik OFFLINE,
      // żeby wiedział, że patrzy na dane sprzed chwili.
      if (zywy.current && isOfflineError(e)) setOnline(false)
      return null
    } finally {
      if (zywy.current) setLadowanie(false)
    }
  }, [vehicleId])

  const przyjmij = useCallback((s: VehicleState) => {
    if (!zywy.current) return
    ostatnia.current = s
    setStan(s)
    setOnline(true)
  }, [])

  useEffect(() => {
    zywy.current = true
    setLadowanie(true)
    void odswiez()
    const t = setInterval(() => { void odswiez() }, POLL_MS)
    // Powrót do ekranu (telefon w kieszeni, kiosk wybudzony) — nie czekamy
    // na kolejny tik, bo przez ten czas ktoś mógł zamknąć załadunek.
    const naWidocznosc = () => { if (!document.hidden) void odswiez() }
    document.addEventListener('visibilitychange', naWidocznosc)
    window.addEventListener('online', naWidocznosc)
    return () => {
      zywy.current = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', naWidocznosc)
      window.removeEventListener('online', naWidocznosc)
    }
  }, [odswiez])

  return { stan, ladowanie, online, odswiez, przyjmij }
}
