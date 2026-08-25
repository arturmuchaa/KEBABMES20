/**
 * Ręczne dodanie wyrobu gotowego z biura.
 *
 * Do czasu, aż produkcja i masownia dostaną komputery, wyrób wprowadza biuro.
 * Ten wpis ma robić DOKŁADNIE to, co zrobiłby kiosk: postawić sztuki na
 * magazynie, zdjąć tuleje, zdjąć mięso przyprawione i policzyć się do
 * pokrycia zamówienia. Inaczej stany rozjeżdżają się po tygodniu.
 *
 * Powiązanie z zamówieniem trzyma się na TRZECH polach naraz: `clientOrderNo`
 * + `recipeId` + `kgPerUnit` — tak liczy pokrycie `orders_service`. Dlatego
 * formularz wypełnia je z POZYCJI zamówienia, a nie z ręki.
 */
export interface ManualGoodsForm {
  qty: string
  kgPerUnit: string
  producedDate: string
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  clientId: string
  clientName: string
  clientOrderNo: string
  /** Wsad z masowni — z niego backend policzy numer partii wyrobu. */
  batchNos: string[]
  /** Zdjąć mięso przyprawione ze stanu masowni. */
  consumeSeasoned: boolean
}

/** „17,5" → 17.5. Biuro wpisuje przecinkiem. */
export const liczba = (v: string): number => {
  const n = Number(String(v ?? '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

export function manualGoodsIssues(f: ManualGoodsForm): string[] {
  const bledy: string[] = []
  if (!f.recipeId) bledy.push('Wskaż recepturę — bez niej wyrób nie połączy się z zamówieniem')
  if (liczba(f.qty) <= 0) bledy.push('Podaj liczbę sztuk')
  if (liczba(f.kgPerUnit) <= 0) bledy.push('Podaj wagę jednej sztuki')
  if (!f.producedDate) bledy.push('Podaj datę produkcji — z niej powstaje numer partii')
  if (f.consumeSeasoned && !(f.batchNos ?? []).length) {
    bledy.push('Wskaż partię z masowni albo odznacz zdejmowanie mięsa')
  }
  return bledy
}

export function manualGoodsPayload(f: ManualGoodsForm) {
  return {
    qty: Math.round(liczba(f.qty)),
    kgPerUnit: liczba(f.kgPerUnit),
    producedDate: f.producedDate,
    recipeId: f.recipeId,
    recipeName: f.recipeName,
    productTypeId: f.productTypeId,
    productTypeName: f.productTypeName,
    packagingId: f.packagingId,
    packagingName: f.packagingName,
    clientId: f.clientId,
    clientName: f.clientName,
    clientOrderNo: f.clientOrderNo,
    seasonedBatchNos: f.batchNos ?? [],
    consumeSeasoned: !!f.consumeSeasoned,
  }
}

/** Ile sztuk zostało do zrobienia na pozycji zamówienia. */
export function remainingOnLine(line: { qty?: number; qtyDone?: number }): number {
  const zostalo = Number(line?.qty ?? 0) - Number(line?.qtyDone ?? 0)
  return zostalo > 0 ? Math.round(zostalo) : 0
}
