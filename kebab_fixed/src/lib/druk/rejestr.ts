/**
 * Rejestr wydruków na serwerze. Nigdy nie blokuje druku: gdy serwer nie
 * odpowiada, wpis czeka w `localStorage` i dochodzi przy następnym wydruku
 * albo co minutę. `klientId` sprawia, że ponowienie nie dubluje wpisu.
 */
import { drukApi } from '@/lib/api'
import { natywny } from './natywny'
import type { RodzajDruku } from './rodzaje'

export interface WpisRejestru {
  rodzaj: RodzajDruku
  tytul: string
  orderId?: string
  palletIds?: string[]
  dokumentId?: string
  drukarka?: string
  zasobnik?: string
  kopie: number
  stron?: number
}

type WpisWyslany = WpisRejestru & { klientId: string; komputer: string }

const KLUCZ = 'druk.rejestr.kolejka'

function czytajKolejke(): WpisWyslany[] {
  try { const v = JSON.parse(localStorage.getItem(KLUCZ) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function zapiszKolejke(k: WpisWyslany[]) {
  try { if (k.length) localStorage.setItem(KLUCZ, JSON.stringify(k)); else localStorage.removeItem(KLUCZ) } catch { /* brak dostępu — trudno */ }
}

const noweId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export async function wyslijZaleglosci(): Promise<number> {
  const kolejka = czytajKolejke()
  const zostaje: WpisWyslany[] = []
  let wyslane = 0
  for (const w of kolejka) {
    try { await drukApi.rejestr(w); wyslane++ } catch { zostaje.push(w) }
  }
  zapiszKolejke(zostaje)
  return wyslane
}

export async function zarejestruj(w: WpisRejestru): Promise<void> {
  let komputer = ''
  try { komputer = await natywny.komputer() } catch { komputer = '' }
  const wpis: WpisWyslany = { ...w, klientId: noweId(), komputer }
  try {
    await drukApi.rejestr(wpis)
  } catch {
    zapiszKolejke([...czytajKolejke(), wpis])
    return
  }
  if (czytajKolejke().length) await wyslijZaleglosci()
}

let licznik: ReturnType<typeof setInterval> | null = null
/** Ponawianie co 60 s — uruchamia DrukHost. */
export function uruchomPonawianie() {
  if (licznik || typeof window === 'undefined') return
  licznik = setInterval(() => { if (czytajKolejke().length) void wyslijZaleglosci() }, 60_000)
}
