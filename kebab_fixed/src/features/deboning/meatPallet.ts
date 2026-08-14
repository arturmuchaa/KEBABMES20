/**
 * Ważenie zbiorcze mięsa — kafelki celu i arytmetyka słupka.
 *
 * Po rozbiorze mięso jedzie do masowni w tym, co akurat stoi pod ręką: pięciu
 * ludzi odda po 100 kg, ktoś 40 kg, i na palecie ląduje zbieranina, o której
 * operator masowania nic nie wie. Ten ekran pozwala zbudować RÓWNE palety
 * i wózki, a etykieta mówi, co na nich leży.
 *
 * Kafelek niesie cel ŁĄCZNY i opcjonalnie cel SŁUPKA. Gdzie cel słupka jest,
 * ekran prowadzi stos po stosie (paleta: cztery równe słupki); gdzie go nie ma
 * (600 kg), operator dokłada swobodnie aż do celu łącznego.
 *
 * To NIE jest ruch magazynowy — mięso jest na stanie od chwili rozbioru.
 * Czysta logika bez DOM, testowana jednostkowo.
 */
import { E2_TARE_KG } from '@/features/deboning/utils/weighing'

/** Dopuszczalne odchylenie od celu — słupka i łącznego. */
export const TOLERANCE_KG = 0.5

export interface PalletTarget {
  key: string
  label: string
  totalKg: number
  /** Cel jednego słupka albo null, gdy kafelek nie dzieli palety. */
  stackKg: number | null
  /** Ile słupków przewiduje kafelek (null = dowolnie). */
  stacks: number | null
  hint: string
}

export const PALLET_TARGETS: PalletTarget[] = [
  { key: 't100', label: '100 kg', totalKg: 100, stackKg: 100, stacks: 1, hint: 'wózek' },
  { key: 't200', label: '200 kg', totalKg: 200, stackKg: 200, stacks: 1, hint: 'wózek' },
  { key: 't400', label: '400 kg', totalKg: 400, stackKg: 100, stacks: 4, hint: 'paleta — 4 słupki po 100 kg' },
  { key: 't600', label: '600 kg', totalKg: 600, stackKg: null, stacks: null, hint: 'paleta — bez podziału' },
  { key: 't800', label: '800 kg', totalKg: 800, stackKg: 200, stacks: 4, hint: 'paleta — 4 słupki po 200 kg' },
]

export function withinTolerance(kg: number, target: number): boolean {
  return Math.abs(kg - target) <= TOLERANCE_KG + 1e-9
}

/**
 * Netto słupka. Nośnik odejmujemy TYLKO przy pierwszym — potem paleta stoi na
 * wadze wytarowana przez operatora, a on dokłada kolejny stos. Pojemniki
 * odejmujemy przy każdym słupku, bo każdy ma swoje.
 */
export function stackNetKg(
  gross: number, carrierKg: number, containers: number, isFirstStack: boolean,
): number {
  const tare = (isFirstStack ? carrierKg : 0) + containers * E2_TARE_KG
  return Math.max(0, Math.round((gross - tare) * 10) / 10)
}

/** Cel szybkiej etykiety z ekranu głównego — typowy słupek z jednej ćwiartki. */
export const QUICK_TARGET_KG = 100

export interface LotPick { lotNo: string; kg: number }
export interface FefoResult {
  picks: LotPick[]
  /** Kilogramy, których nie ma z czego pokryć — ekran prosi o wskazanie partii. */
  unassignedKg: number
}

/**
 * Podział wagi palety na partie: bierz z najstarszej tyle, ile w niej zostało,
 * resztę z kolejnej. Lista wejściowa jest już w kolejności FEFO (API sortuje po
 * terminie), więc idziemy po niej wprost. Odpowiada to temu, jak pracuje hala:
 * pięciu ludzi odda po 100 kg z tej samej partii, a kto przywiózł nowszą,
 * ten wchodzi na końcu.
 *
 * Braku pokrycia NIE dopisujemy po cichu do ostatniego lotu — wraca jako
 * `unassignedKg`. Zgadywanie w tym miejscu kosztowałoby dokładnie tę
 * identyfikowalność, po którą powstaje etykieta.
 */
export function proposeLots(
  available: { lotNo: string; kgFree: number }[], kg: number,
): FefoResult {
  const r1 = (n: number) => Math.round(n * 10) / 10
  let zostalo = r1(kg)
  const picks: LotPick[] = []
  for (const lot of available) {
    if (zostalo <= 0.05) break
    const wziete = r1(Math.min(zostalo, lot.kgFree))
    if (wziete <= 0.05) continue
    picks.push({ lotNo: lot.lotNo, kg: wziete })
    zostalo = r1(zostalo - wziete)
  }
  return { picks, unassignedKg: Math.max(0, zostalo) }
}

export interface QuickPalletInput {
  /** Zmierzone netto słupka — to ONO trafia na etykietę, nie okrągły cel. */
  netKg: number
  containers: number
  /** Numer partii zaznaczonej na ekranie; lot mięsa ma ten sam numer. */
  batchNo: string
  carrierLabel: string
  carrierKg: number
  operator: string
  productionDate: string
  expiryDate: string
}

export interface PalletDraft {
  targetKg: number
  stackKg: number | null
  kgNet: number
  containers: number
  carrierLabel: string
  carrierKg: number
  operator: string
  productionDate: string
  expiryDate: string
  lots: LotPick[]
}

/**
 * Szybka etykieta z ekranu głównego: pracownik oddaje ~97-100 kg z ćwiartki,
 * operator dokłada brakujące kilogramy i jednym dotknięciem drukuje etykietę.
 *
 * Cały słupek idzie na partię zaznaczoną na ekranie — przy 2-3 kg dokładki
 * rozbijanie tego na drugą partię kosztowałoby więcej dotknięć niż jest warte.
 * Waga na etykiecie to ZMIERZONE netto, nie cel: 100 kg jest podpowiedzią,
 * a wydruk ma mówić prawdę o tym, co stoi na wózku.
 *
 * Zwraca `null`, gdy nie ma czego zapisać — brak partii albo zerowa waga.
 */
export function quickPalletDraft(i: QuickPalletInput): PalletDraft | null {
  const kg = Math.round((i.netKg ?? 0) * 10) / 10
  const nr = (i.batchNo ?? '').trim()
  if (!nr || kg <= 0) return null
  return {
    targetKg: QUICK_TARGET_KG,
    stackKg: QUICK_TARGET_KG,
    kgNet: kg,
    containers: Math.max(0, Math.round(i.containers ?? 0)),
    carrierLabel: i.carrierLabel ?? '',
    carrierKg: i.carrierKg ?? 0,
    operator: i.operator ?? '',
    productionDate: i.productionDate,
    expiryDate: i.expiryDate ?? '',
    lots: [{ lotNo: nr, kg }],
  }
}
