/**
 * Aktualizacja PROTRIMA z kanału serwera zakładu (`/api/desktop-updates/protrima/latest.json`).
 * Rust (`protrima_aktualizacja`, `protrima_zainstaluj` w src-tauri/src/lib.rs) sprawdza podpis
 * i instaluje po cichu (NSIS quiet, per-user — bez okna UAC), potem restartuje program.
 *
 * - Ekran logowania (`auto`): nic nie jest jeszcze wpisane — nowa wersja instaluje się sama.
 * - W trakcie pracy: tylko sygnał w pasku stanu; instalacja na żądanie (niezapisane karty!).
 * Sprawdzenie przy starcie i co godzinę. Brak serwera przy sprawdzaniu jest cichy — nie blokuje pracy.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { jestTauri } from '../okno'

const CO_ILE_MS = 60 * 60 * 1000

async function wolaj<T>(cmd: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd)
}

export interface Aktualizacja {
  /** Wersja dostępna na serwerze (inna niż zainstalowana) albo null. */
  wersja: string | null
  instaluje: boolean
  blad: string | null
  instaluj: () => Promise<void>
}

export function useAktualizacja({ auto = false }: { auto?: boolean } = {}): Aktualizacja {
  const [wersja, setWersja] = useState<string | null>(null)
  const [instaluje, setInstaluje] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const trwa = useRef(false)

  const instaluj = useCallback(async () => {
    if (!jestTauri() || trwa.current) return
    trwa.current = true
    setInstaluje(true); setBlad(null)
    try {
      // Po udanej instalacji program sam się restartuje — tu wracamy tylko przy błędzie albo braku wersji.
      await wolaj<string>('protrima_zainstaluj')
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
    } finally {
      trwa.current = false
      setInstaluje(false)
    }
  }, [])

  useEffect(() => {
    if (!jestTauri()) return
    let zywe = true
    const sprawdz = async () => {
      try {
        const w = await wolaj<string | null>('protrima_aktualizacja')
        if (!zywe) return
        setWersja(w || null)
        if (w && auto) void instaluj()
      } catch {
        // Serwer chwilowo niedostępny albo kanał pusty — spróbujemy za godzinę.
      }
    }
    void sprawdz()
    const t = setInterval(sprawdz, CO_ILE_MS)
    return () => { zywe = false; clearInterval(t) }
  }, [auto, instaluj])

  return { wersja, instaluje, blad, instaluj }
}
