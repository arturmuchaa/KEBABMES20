/**
 * palletCorrection — walidacja korekty palety ważenia zbiorczego.
 *
 * To samo, czego pilnuje backend (`update_pallet`), tylko pokazane od razu
 * w oknie: biuro ma zobaczyć, co jest nie tak, ZANIM kliknie „Zapisz",
 * a nie dostać 400 z serwera.
 *
 * Czysta funkcja bez DOM.
 */
import { BULK_TOL_KG } from './meatPallet'

export interface CorrectionLot { lotNo: string; kg: number }

/** Ta sama tolerancja, którą backend stosuje przy sumie składu. */
const SKLAD_TOL_KG = 0.05

export function correctionIssues(
  kgNet: number, lots: CorrectionLot[], reason: string,
): string[] {
  const out: string[] = []

  if (!(kgNet > 0)) out.push('Waga palety musi być większa od zera')
  if (!(reason ?? '').trim()) {
    out.push('Podaj powód korekty — bez niego nie wiadomo, co się stało')
  }
  if (lots.length === 0) {
    out.push('Paleta bez składu partii — etykieta nie powiedziałaby masowni nic')
    return out
  }

  for (const l of lots) {
    if (!(l.lotNo ?? '').trim()) out.push('Wiersz bez numeru partii')
    if (!(l.kg > 0)) out.push(`Partia ${l.lotNo || '(bez numeru)'} bez kilogramów`)
  }

  // Ta sama partia w dwóch wierszach to prawie zawsze pomyłka przy poprawianiu,
  // a przy okazji obchodziłaby limit wydajności liczony PO numerze partii.
  const widziane = new Set<string>()
  for (const l of lots) {
    const nr = (l.lotNo ?? '').trim()
    if (!nr) continue
    if (widziane.has(nr)) out.push(`Partia ${nr} wpisana dwa razy — połącz wiersze`)
    widziane.add(nr)
  }

  const suma = Math.round(lots.reduce((s, l) => s + (l.kg || 0), 0) * 100) / 100
  if (kgNet > 0 && Math.abs(suma - kgNet) > SKLAD_TOL_KG) {
    out.push(`Suma składu (${suma} kg) nie zgadza się z wagą palety (${kgNet} kg)`)
  }

  return out
}

export { BULK_TOL_KG }
