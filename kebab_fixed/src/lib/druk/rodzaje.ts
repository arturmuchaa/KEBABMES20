/** Rodzaje dokumentów — każdy ma osobne zapamiętane ustawienia druku na komputerze. */
export type RodzajDruku =
  | 'kartki-palet' | 'wz' | 'wm' | 'cmr' | 'hdi' | 'lista-kompletacji' | 'zamowienie'
  | 'rozrachunki' | 'rozliczenie-dostawy' | 'paski-wyplat' | 'plan-masowania' | 'inne'

export const NAZWA_RODZAJU: Record<RodzajDruku, string> = {
  'kartki-palet': 'Kartki palet',
  wz: 'WZ',
  wm: 'WM',
  cmr: 'CMR',
  hdi: 'HDI',
  'lista-kompletacji': 'Lista kompletacji',
  zamowienie: 'Zamówienie',
  rozrachunki: 'Rozrachunki',
  'rozliczenie-dostawy': 'Rozliczenie dostawy',
  'paski-wyplat': 'Paski wypłat',
  'plan-masowania': 'Plan masowania',
  inne: 'Inne dokumenty',
}
