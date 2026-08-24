/**
 * planLineModel — czysta mechanika pozycji planu produkcji.
 *
 * Bliźniak `features/orders/order-entry/model.ts` i celowo OSOBNY moduł:
 * w planie klient jest częścią TOŻSAMOŚCI pozycji (jeden plan dnia obsługuje
 * różnych klientów), a w zamówieniu klient jest raz na cały dokument. Sloty
 * i dziedziczenie różnią się więc na tyle, że wspólny moduł musiałby być
 * parametryzowany w każdym punkcie — a nagięcie działającego ekranu zamówień
 * kosztowałoby więcej niż te kilkadziesiąt linii.
 *
 * Zero importów z React/UI — testowane w node.
 */

export type Slot =
  | 'productTypeId' | 'recipeId' | 'packagingId' | 'clientId' | 'qty' | 'kgPerUnit'

/** Tożsamość najpierw, liczby na końcu — bo tylko liczby zmieniają się w serii. */
export const SLOT_ORDER: readonly Slot[] =
  ['productTypeId', 'recipeId', 'packagingId', 'clientId', 'qty', 'kgPerUnit'] as const

/** Pola przenoszone na kolejną pozycję. */
export const CARRIED: readonly Slot[] =
  ['productTypeId', 'recipeId', 'packagingId', 'clientId'] as const

export interface PlanLine {
  /** id istniejącej pozycji przy edycji planu; puste dla nowej. */
  id:                string
  qty:               string
  kgPerUnit:         string
  productTypeId:     string
  recipeId:          string
  packagingId:       string
  clientId:          string
  clientName:        string
  /** Partie przyprawionego w kolejności pobierania. */
  seasonedBatchIds:  string[]
  seasonedBatchId:   string
  /** Partie wybrał człowiek — FEFO ich nie nadpisuje (patrz planFefo). */
  batchesManual:     boolean
  /** Sztuki wykonane na hali; > 0 = pozycja zamrożona. */
  qtyDone?:          number
  /** Powiązanie z pozycją zamówienia klienta — po nim rozlicza się zamówienie. */
  clientOrderId:     string
  clientOrderNo:     string
  clientOrderLineId: string
}

export const emptyPlanLine = (): PlanLine => ({
  id: '', qty: '', kgPerUnit: '',
  productTypeId: '', recipeId: '', packagingId: '',
  clientId: '', clientName: '',
  seasonedBatchIds: [], seasonedBatchId: '', batchesManual: false,
  clientOrderId: '', clientOrderNo: '', clientOrderLineId: '',
})

/** Liczba z pola tekstowego — akceptuje przecinek (klawiatura numeryczna PL). */
export function num(s: string | number | undefined | null): number {
  if (s === null || s === undefined || s === '') return 0
  const v = parseFloat(String(s).replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

export const lineKg = (l: PlanLine): number => num(l.qty) * num(l.kgPerUnit)

/** Tożsamość kompletna = wiadomo CO produkujemy. Tuleja i klient opcjonalne —
 *  produkcja „na magazyn" nie ma klienta i to jest normalny przypadek. */
export const identityComplete = (l: PlanLine): boolean => !!l.productTypeId && !!l.recipeId

export const draftComplete = (l: PlanLine): boolean =>
  identityComplete(l) && num(l.qty) > 0 && num(l.kgPerUnit) > 0

/**
 * Nowa pozycja dziedzicząca tożsamość po ostatniej — czyścimy sztuki i wagę.
 *
 * NIE dziedziczymy przydziału partii ani powiązania z zamówieniem: partie
 * nowa pozycja dostaje od FEFO (inna ilość = inny przydział), a powiązanie
 * z pozycją zamówienia dotyczy dokładnie jednej pozycji planu.
 */
export function carryOver(last?: PlanLine | null): PlanLine {
  const fresh = emptyPlanLine()
  if (!last) return fresh
  return {
    ...fresh,
    productTypeId: last.productTypeId,
    recipeId:      last.recipeId,
    packagingId:   last.packagingId,
    clientId:      last.clientId,
    clientName:    last.clientName,
  }
}

/** Które sloty draftu przyszły z poprzedniej pozycji (do oznaczenia w UI). */
export function inheritedSlots(draft: PlanLine, last?: PlanLine | null): Set<Slot> {
  const out = new Set<Slot>()
  if (!last) return out
  for (const s of CARRIED) {
    const v = draft[s as keyof PlanLine]
    if (v && v === last[s as keyof PlanLine]) out.add(s)
  }
  return out
}

/** Slot, na którym staje kursor przy nowym drafcie. */
export function initialSlot(l: PlanLine): Slot {
  if (!l.productTypeId) return 'productTypeId'
  if (!l.recipeId)      return 'recipeId'
  return 'qty'
}

export function nextSlot(cur: Slot): Slot {
  const i = SLOT_ORDER.indexOf(cur)
  return SLOT_ORDER[Math.min(i + 1, SLOT_ORDER.length - 1)]
}

export function prevSlot(cur: Slot): Slot {
  const i = SLOT_ORDER.indexOf(cur)
  return SLOT_ORDER[Math.max(i - 1, 0)]
}

export interface RecipeLite { id: string; productTypeId?: string }

/**
 * Ustawienie pola tożsamości.
 *
 * Zmiana rodzaju unieważnia recepturę z innego produktu — inaczej zapisalibyśmy
 * pozycję z recepturą, która do niej nie należy. Zmiana receptury zeruje
 * przydział partii: partie są przyprawione POD RECEPTURĘ, więc stary przydział
 * wskazywałby na inne mięso.
 */
export function applyIdentity(
  line: PlanLine, slot: Slot, value: string, recipes: RecipeLite[],
): PlanLine {
  if (slot === 'productTypeId') {
    const rec = recipes.find(r => r.id === line.recipeId)
    const keep = !!rec && (!rec.productTypeId || rec.productTypeId === value)
    return {
      ...line,
      productTypeId: value,
      recipeId: keep ? line.recipeId : '',
      ...(keep ? {} : { seasonedBatchIds: [], seasonedBatchId: '', batchesManual: false }),
    }
  }
  if (slot === 'recipeId') {
    return {
      ...line, recipeId: value,
      seasonedBatchIds: [], seasonedBatchId: '', batchesManual: false,
    }
  }
  return { ...line, [slot]: value }
}
