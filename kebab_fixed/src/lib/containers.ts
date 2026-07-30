/**
 * containers.ts — nośniki zwrotne (pojemniki E2, palety) po stronie UI.
 *
 * Lustro `backend/app/utils/containers.py`. Formularze przyjęcia i WZ muszą
 * podpowiadać DOKŁADNIE tę samą liczbę, którą zaksięguje backend — inaczej
 * operator widzi jedno, a saldo pokazuje drugie.
 */

export type AssetType =
  | 'e2' | 'net_e1' | 'pallet_h1'
  | 'pallet_euro' | 'pallet_plastic' | 'pallet_wood' | 'pallet_other'
export type CaliberValue = '15' | '20' | 'none'

// KAŻDY rodzaj ma własne saldo — siatki E1 nie zwraca się europaletą,
// więc wspólny worek „palety inne" ukrywałby, czego brakuje.
// 'pallet_other' zostaje dla danych sprzed rozbicia i jako awaryjny kosz.
export const ASSET_TYPES: AssetType[] = [
  'e2', 'net_e1', 'pallet_h1',
  'pallet_euro', 'pallet_plastic', 'pallet_wood', 'pallet_other',
]

/** Pełne etykiety — idą na druk „WZ na POJEMNIKI". */
export const ASSET_LABELS: Record<AssetType, string> = {
  e2: 'Ilość pojemników EURO2',
  net_e1: 'Ilość siatek E1',
  pallet_h1: 'Ilość palet H1',
  pallet_euro: 'Ilość europalet',
  pallet_plastic: 'Ilość palet plastikowych',
  pallet_wood: 'Ilość palet drewnianych',
  pallet_other: 'Ilość palet innych',
}

/** Krótkie etykiety do tabel i kafelków (pełne idą na wydruk). */
export const ASSET_SHORT: Record<AssetType, string> = {
  e2: 'Pojemniki E2',
  net_e1: 'Siatki E1',
  pallet_h1: 'Palety H1',
  pallet_euro: 'Europalety',
  pallet_plastic: 'Palety plastik',
  pallet_wood: 'Palety drewno',
  pallet_other: 'Palety inne',
}

/** Lista rozwijana „inne opakowania / palety" — E2 i H1 mają własne pola. */
export const OTHER_CARRIER_KINDS: { value: AssetType; label: string }[] = [
  { value: 'net_e1', label: 'Siatka E1' },
  { value: 'pallet_plastic', label: 'Plastik' },
  { value: 'pallet_euro', label: 'Europaleta' },
  { value: 'pallet_wood', label: 'Paleta drewniana' },
]

export const CALIBER_OPTIONS: { value: CaliberValue; label: string; kg: number | null }[] = [
  { value: '15', label: '15 kg', kg: 15 },
  { value: '20', label: '20 kg', kg: 20 },
  { value: 'none', label: 'niekalibrowany', kg: null },
]

export function caliberKg(value: CaliberValue): number | null {
  return CALIBER_OPTIONS.find(o => o.value === value)?.kg ?? null
}

/** Kilogramy kalibru → wartość selecta (odwrotność caliberKg). */
export function caliberValue(kg: number | null | undefined): CaliberValue {
  return kg === 15 ? '15' : kg === 20 ? '20' : 'none'
}

/**
 * Liczba pojemników dla masy.
 *
 * ceil, NIE floor — niepełny pojemnik to nadal jeden fizyczny pojemnik.
 * Zwraca null przy kalibrze nieznanym (niekalibrowany): wtedy liczbę
 * pojemników wpisuje operator.
 */
export function containersForKg(kg: number, containerKg: number | null): number | null {
  if (containerKg === null || containerKg <= 0) return null
  if (kg <= 0) return 0
  return Math.ceil(kg / containerKg)
}

/** Saldo dodatnie = mamy ich nośniki (my winni); ujemne = oni mają nasze. */
export function balanceTone(saldo: number): 'owed-by-us' | 'settled' | 'owed-to-us' {
  if (saldo > 0) return 'owed-by-us'
  if (saldo < 0) return 'owed-to-us'
  return 'settled'
}
