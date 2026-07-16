/**
 * weighing.ts — czysta matematyka ważenia automatycznego (HMI rozbiór v10).
 *
 * Wózek z pojemnikami E2 wjeżdża na wagę najazdową; netto mięsa =
 * brutto − tara wózka − n × tara E2. Pasmo 15–25 kg mięsa na pojemnik to
 * kontrola wiarygodności (najczęstszy błąd operatora: źle policzone E2) —
 * ostrzeżenie, nie blokada.
 */

export const E2_TARE_KG = 2.0
/** Domyślne tary wózków (fallback, gdy backend i cache niedostępne) —
 * realną listę edytuje biuro (GET /api/deboning/cart-tares). */
export const CART_TARES_KG: readonly number[] = [5.5, 6.0, 6.5, 7.0]
export const KG_PER_E2_MIN = 15
export const KG_PER_E2_MAX = 25

/** Czyści listę tar z backendu/cache: liczby 0<kg≤50, do 0,1, bez duplikatów,
 * rosnąco (kafle zawsze od najlżejszego). Zwraca [] gdy nic sensownego —
 * caller używa wtedy CART_TARES_KG. */
export function sanitizeCartTares(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<number>()
  for (const v of raw) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
    if (Number.isFinite(n) && n > 0 && n <= 50) out.add(Math.round(n * 10) / 10)
  }
  return [...out].sort((a, b) => a - b)
}

export interface WeighingInput {
  gross: number
  cartTareKg: number | null
  e2Count: number
}

export interface WeighingResult {
  tareE2Kg: number
  tareTotalKg: number
  netKg: number
  kgPerContainer: number
  plausible: boolean
  /** true = jest sensowne netto do zapisania (tara wybrana i brutto > tara) */
  ready: boolean
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function computeWeighing({ gross, cartTareKg, e2Count }: WeighingInput): WeighingResult {
  const taraSet = cartTareKg != null && e2Count > 0
  const tareE2Kg = round1(e2Count * E2_TARE_KG)
  const tareTotalKg = taraSet ? round1((cartTareKg as number) + tareE2Kg) : 0
  const netKg = taraSet && gross > tareTotalKg ? round1(gross - tareTotalKg) : 0
  const kgPerContainer = netKg > 0 && e2Count > 0 ? netKg / e2Count : 0
  const plausible = kgPerContainer >= KG_PER_E2_MIN && kgPerContainer <= KG_PER_E2_MAX
  return { tareE2Kg, tareTotalKg, netKg, kgPerContainer, plausible, ready: netKg > 0 }
}

// ── Zjazd z wagi bez „Dodaj do sumy" (kreator ważenia ubocznych) ─────────────
//
// Operator wjeżdża paletą, system liczy netto — a potem zjeżdża z wagi bez
// dodania palety do sumy. Tracker pamięta ostatni KOMPLETNY stabilny odczyt
// (tara wybrana, netto > 0); gdy waga schodzi do ~zera, odczyt przechodzi do
// `prompt` — kreator pyta operatora, czy dodać zważoną paletę do sumy.

/** Poniżej tego brutto uznajemy wagę za opuszczoną (najlżejsza tara to
 * pojedynczy pojemnik E2 2 kg; paleta H1 sama waży 18 kg). */
export const SCALE_EMPTY_KG = 10

export interface PalletSnapshot {
  tareLabel: string
  tareKg: number
  containers: number
  gross: number
  net: number
}

export interface DriveOffTracker {
  /** Ostatni kompletny stabilny odczyt — kandydat na paletę. */
  armed: PalletSnapshot | null
  /** Zjazd z wagi z niedodaną paletą — odczyt czeka na decyzję operatora. */
  prompt: PalletSnapshot | null
}

export const DRIVE_OFF_IDLE: DriveOffTracker = { armed: null, prompt: null }

export function driveOffStep(
  state: DriveOffTracker,
  reading: { connected: boolean; stable: boolean; gross: number },
  snap: { tareKg: number | null; tareLabel: string; containers: number; net: number },
): DriveOffTracker {
  // Prompt czeka na decyzję operatora — kolejne odczyty go nie ruszają,
  // inaczej następna paleta wjeżdżająca na wagę skasowałaby pytanie.
  if (state.prompt) return state
  const complete = snap.tareKg != null && snap.net > 0
  if (reading.connected && reading.stable && reading.gross > SCALE_EMPTY_KG && complete) {
    return {
      armed: {
        tareLabel: snap.tareLabel,
        tareKg: snap.tareKg as number,
        containers: snap.containers,
        gross: reading.gross,
        net: round1(snap.net),
      },
      prompt: null,
    }
  }
  if (state.armed && reading.gross <= SCALE_EMPTY_KG) {
    return { armed: null, prompt: state.armed }
  }
  // Niestabilne odczyty nad progiem (drganie przy zjeżdżaniu) — armed zostaje.
  return state
}
