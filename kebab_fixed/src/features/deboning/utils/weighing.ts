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

/** Typowe pasmo % ubocznych (grzbiety/kości) względem ćwiartki — z historii
 * ~18 zakończonych partii >1 t: grzbiety śr. 19,3% ±1,0 p.p., kości śr.
 * 15,7% ±1,7 p.p. Dolna granica = średnia − 1,5 SD, z marginesem nad
 * zaobserwowanym minimum "normalnej" partii (żeby nie fałszować alarmu na
 * niższych, ale realnych wynikach).
 *
 * Poniżej granicy najczęściej oznacza NIEZWAŻONĄ paletę — zapomnianą albo
 * fizycznie pomieszaną z inną partią przy wadze (audyt partii 428,
 * 2026-07-23: grzbiety 15,8%, kości 9,9%, obie poniżej normy, brakowało
 * łącznie ~430 kg — wykryte dopiero retrospektywnie, po fakcie). */
export const TYPICAL_BYPRODUCT_PCT_MIN: Record<'backs' | 'bones', number> = {
  backs: 17.5,
  bones: 13.0,
}

/** Czy zważona ilość frakcji jest podejrzanie niska względem typowej normy?
 * `kg<=0` (nic jeszcze nie zważone) nigdy nie alarmuje — czekamy na dane. */
export function isByproductBelowNorm(
  kind: 'backs' | 'bones',
  kg: number,
  quarterKg: number,
): boolean {
  if (quarterKg <= 0 || kg <= 0) return false
  return (kg / quarterKg) * 100 < TYPICAL_BYPRODUCT_PCT_MIN[kind]
}

/** Tary palet pod uboczne — u tego klienta jedna, H1 18 kg. */
export const PALLET_TARES: { label: string; kg: number }[] = [
  { label: 'H1', kg: 18 },
]

export interface ByproductTareOption {
  /** Klucz kafla (stabilny w liście). */
  key: string
  /** Duży napis na kaflu. */
  title: string
  /** Podpis pod napisem. */
  sub: string
  /** Tara w kg odejmowana od brutto. */
  kg: number
  /** Co ląduje w palecie jako `tareLabel` — czytelne w dzienniku ważeń biura. */
  tareLabel: string
}

/** Kafle nośników w kreatorze ważenia ubocznych: paleta H1, WSZYSTKIE wózki
 * z systemu (ta sama lista co przy ważeniu mięsa, edytowana w biurze) i „bez".
 * Uboczne jadą na wagę raz na palecie, raz na wózku — operator musi mieć obie
 * tary pod ręką, inaczej waży „bez palety" i zawyża frakcję o tarę wózka.
 * Etykieta wózka niesie jego tarę („wózek 6,5"), więc dziennik ważeń pokazuje,
 * na czym realnie ważono. „bez palety" zostaje etykietą historyczną (tara 0),
 * żeby stare ważenia i filtry biura dalej się zgadzały. */
export function byproductTareOptions(cartTares: number[]): ByproductTareOption[] {
  const carts = sanitizeCartTares(cartTares)
  return [
    ...PALLET_TARES.map(p => ({
      key: `pallet:${p.label}`, title: p.label, sub: `${fmtTareKg(p.kg)} kg`,
      kg: p.kg, tareLabel: p.label,
    })),
    ...carts.map(kg => ({
      key: `cart:${kg}`, title: fmtTareKg(kg), sub: 'kg · wózek',
      kg, tareLabel: `wózek ${fmtTareKg(kg)}`,
    })),
    { key: 'none', title: 'Bez', sub: '0 kg', kg: 0, tareLabel: 'bez palety' },
  ]
}

/** Tara na kaflu: paleta całkowita („18"), wózek z jednym miejscem po
 * przecinku i przecinkiem po polsku („6,5", „6,0" — nie „6"), żeby kafle
 * wózków czytały się identycznie jak przy ważeniu mięsa. */
function fmtTareKg(kg: number): string {
  return Number.isInteger(kg) && kg >= 10
    ? String(kg)
    : kg.toFixed(1).replace('.', ',')
}

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

/** Ładunek jest parametrem: paleta ubocznych (PalletSnapshot) albo ważenie
 * mięsa (MeatSnapshot z meatDriveOff.ts). Tracker zna tylko wagę. */
export interface DriveOffTracker<T> {
  /** Ostatni kompletny stabilny odczyt — kandydat do zapisu. */
  armed: T | null
  /** Zjazd z wagi z niezapisanym odczytem — czeka na decyzję operatora. */
  prompt: T | null
}

/** Stan pusty pasujący do trackera o dowolnym ładunku. `any`, nie `never`,
 * bo repo ma strict:false — przy wyłączonym strictNullChecks `T | null`
 * zapada się do `T` i `never` nie przyjąłby nulli. */
export const DRIVE_OFF_IDLE: DriveOffTracker<any> = { armed: null, prompt: null }

/**
 * @param snap gotowy snapshot do zapamiętania albo `null`, gdy dane są
 *   niekompletne (brak tary, brak pracownika, netto 0 …) — wtedy nie uzbrajamy.
 *   Zaokrąglanie kilogramów należy do wywołującego; tracker zapamiętuje 1:1.
 */
export function driveOffStep<T>(
  state: DriveOffTracker<T>,
  reading: { connected: boolean; stable: boolean; gross: number },
  snap: T | null,
): DriveOffTracker<T> {
  // Prompt czeka na decyzję operatora — kolejne odczyty go nie ruszają,
  // inaczej następny wózek wjeżdżający na wagę skasowałby pytanie.
  if (state.prompt) return state
  if (reading.connected && reading.stable && reading.gross > SCALE_EMPTY_KG && snap != null) {
    return { armed: snap, prompt: null }
  }
  if (state.armed && reading.gross <= SCALE_EMPTY_KG) {
    return { armed: null, prompt: state.armed }
  }
  // Niestabilne odczyty nad progiem (drganie przy zjeżdżaniu) — armed zostaje.
  return state
}
