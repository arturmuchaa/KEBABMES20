/**
 * rowMath — matematyka pozycji dokumentu WZ.
 *
 * Wyciągnięte z `WzNewPage`, żeby dało się to przetestować bez ekranu:
 * wycena wyrobu gotowego idzie ZA KILOGRAM (40 szt × 10 kg × 12,50 zł),
 * a nie za sztukę — pomyłka w tym miejscu to dziesięciokrotna różnica
 * na dokumencie dla klienta.
 *
 * Zero importów z Reacta.
 */

/** Pozycja w siatce dokumentu. Liczby trzymamy jako TEKST — operator wpisuje
 *  „1 000,5" i pole nie może mu tego prostować w trakcie pisania. */
export interface WzRow {
  stockType: 'fg' | 'raw' | 'meat' | 'byproduct'
  stockId: string
  name: string
  unit: string
  qtyStr: string
  priceStr: string
  available: number
  containersStr?: string
  batchNo?: string
  /** Stempel zamówienia na wyrobie i klient, dla którego go zrobiono.
   *  Służą OSTRZEŻENIU przed wydaniem cudzej rezerwacji — patrz wzRezerwacje. */
  clientOrderNo?: string | null
  clientName?: string | null
  slaughterDate?: string | null
  expiryDate?: string | null
  productionDate?: string | null
  /** Waga jednej sztuki wyrobu gotowego — klucz do wyceny za kilogram. */
  kgPerUnit?: number
  /** Stawka VAT w % — cecha POZYCJI. Domyślną podpowiada NIP nabywcy. */
  vatRate?: number
}

/** „3,25" / „3.25" / „10" → liczba; śmieci → 0. */
export const toNum = (s: string): number => {
  const n = parseFloat((s || '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Zostaw tylko cyfry i JEDEN separator dziesiętny (przecinek albo kropkę). */
export const sanitizeDecimal = (s: string): string => {
  const cleaned = s.replace(/[^\d.,]/g, '')
  const firstSep = cleaned.search(/[.,]/)
  if (firstSep === -1) return cleaned
  return cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, '')
}

/** Pojemniki i sztuki są całkowite. */
export const sanitizeInt = (s: string): string => s.replace(/\D/g, '')

export const fmtKg3 = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')

/** Kilogramy po polsku — JEDNO źródło dla siatki i stopki dokumentu.
 *  Stopka miała własne formatowanie i pokazywała „1430.5 kg" tuż pod
 *  siatką z „1430,5 kg". */
export const fmtKgPl = (n: number): string => fmtKg3(n).replace('.', ',')

/** Kwota: zawsze dwa miejsca, przecinek dziesiętny. */
export const fmtMoneyPl = (n: number): string => n.toFixed(2).replace('.', ',')

export const rowQty = (r: WzRow): number => toNum(r.qtyStr)
export const rowPrice = (r: WzRow): number => toNum(r.priceStr)

/** Waga pozycji w kg: wyrób gotowy = szt × kg/szt, surowiec = ilość w kg. */
export const rowKg = (r: WzRow): number =>
  r.kgPerUnit ? rowQty(r) * r.kgPerUnit : (r.unit === 'kg' ? rowQty(r) : 0)

/** Wartość pozycji: cena ZA KG gdy znamy wagę, inaczej za jednostkę. */
export const rowValue = (r: WzRow): number =>
  (rowKg(r) > 0 ? rowKg(r) : rowQty(r)) * rowPrice(r)

/** Stawka pozycji; brak = 0 % (WDT/eksport albo dokument bez VAT). */
export const rowVat = (r: WzRow): number => Number(r.vatRate ?? 0)
